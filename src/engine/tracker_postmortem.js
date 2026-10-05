function buildTrackerPredictionReview({
    previousNumber,
    resultNumber,
    systemCenter,
    systemMetric = '',
    systemReasoning = null,
    systemWon = null,
    aiCenter,
    aiMetric = '',
    aiModel = '',
    aiReasoning = '',
    aiWon = null,
    actualTransition = null,
    wheelNeighbors
}) {
    const center = value => {
        const parsed = value == null || value === '' ? null : Number(value);
        return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36 ? parsed : null;
    };
    const actual = resultNumber == null || resultNumber === '' ? NaN : Number(resultNumber);
    const validResult = Number.isInteger(actual) && actual >= 0 && actual <= 36 ? actual : null;
    const systemTarget = center(systemCenter);
    const aiTarget = center(aiCenter);
    const evaluate = (target, savedResult) => target === null || validResult === null
        ? null
        : typeof savedResult === 'boolean'
            ? savedResult
            : typeof wheelNeighbors === 'function' && wheelNeighbors(target, 4).includes(validResult);
    const systemHit = evaluate(systemTarget, systemWon);
    const aiHit = evaluate(aiTarget, aiWon);
    const reasoning = systemReasoning && typeof systemReasoning === 'object' ? systemReasoning : {};
    const signed = Number(actualTransition?.signed);
    const observedLevel = Number.isFinite(signed)
        ? ((signed >= 0 && Math.abs(signed) >= 10) || (signed < 0 && Math.abs(signed) < 10)) ? 'OVER' : 'UNDER'
        : '';
    const observedAxes = {
        direction: String(actualTransition?.direction || ''),
        zone: String(actualTransition?.magnitude || ''),
        level: observedLevel
    };
    const axisChecks = [
        ['dirección', String(reasoning.direction || ''), observedAxes.direction],
        ['zona', String(reasoning.zone_projection || ''), observedAxes.zone],
        ['nivel', String(reasoning.level_projection || ''), observedAxes.level]
    ].filter(([, predicted, observed]) => predicted && observed)
        .map(([axis, predicted, observed]) => ({ axis, predicted, observed, matched: predicted === observed }));
    const outcome = (hit, target) => target === null ? 'sin señal' : hit === null ? 'sin resultado' : hit ? 'acierto' : 'fallo';
    const comparison = systemHit === true && aiHit === false ? 'system_only_hit'
        : aiHit === true && systemHit === false ? 'ai_only_hit'
            : systemHit === true && aiHit === true ? 'both_hit'
                : systemHit === false && aiHit === false ? 'both_missed' : 'incomplete';
    const lesson = comparison === 'system_only_hit'
        ? 'SISTEMA acertó e IA falló: conservar como ejemplo de contraste el eje, patrón y razonamiento de SISTEMA junto con el razonamiento IA; no convertir un giro aislado en regla.'
        : comparison === 'ai_only_hit'
            ? 'IA acertó y SISTEMA falló: conservar el análisis IA como ejemplo útil y contrastarlo con la métrica de SISTEMA; no convertir un giro aislado en regla.'
            : comparison === 'both_hit'
                ? 'Ambos acertaron: guardar ambos razonamientos como ejemplos positivos sin asumir que uno causó el resultado.'
                : comparison === 'both_missed'
                    ? 'Ambos fallaron: guardar ambos razonamientos y el resultado como contraejemplo para revisar casos similares.'
                    : 'Resultado parcial: guardar cada predictor evaluable y no inferir una comparación para la señal ausente.';
    return {
        version: 1,
        result_number: validResult,
        previous_number: center(previousNumber),
        actual_transition: actualTransition ? {
            signed: Number.isFinite(signed) ? signed : null,
            direction: observedAxes.direction,
            zone: observedAxes.zone,
            level: observedAxes.level
        } : null,
        system: {
            center: systemTarget,
            metric: String(systemMetric || ''),
            outcome: outcome(systemHit, systemTarget),
            won: systemHit,
            reasoning: reasoning,
            axis_checks: axisChecks
        },
        ai: {
            center: aiTarget,
            metric: String(aiMetric || ''),
            model: String(aiModel || ''),
            outcome: outcome(aiHit, aiTarget),
            won: aiHit,
            reasoning: String(aiReasoning || '').slice(0, 1800)
        },
        comparison,
        lesson,
        evaluated_at: new Date().toISOString()
    };
}

module.exports = { buildTrackerPredictionReview };
