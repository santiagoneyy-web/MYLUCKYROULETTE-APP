function normalizePredictionResult(prediction) {
    return {
        result: prediction.result || 'pending',
        n9_result: prediction.n9_result || prediction.result || 'pending',
        n4_result: prediction.n4_result || prediction.result || 'pending'
    };
}

function contextKey(state) {
    if (!state) return 'unknown';
    return [
        `block:${state.block_state || 'none'}`,
        `blockSize:${state.block_size || 0}`,
        `turb:${state.turbulence_level || 'none'}`,
        `dom:${state.dominance_state || 'none'}`,
        `side:${state.dominance_side || 'NONE'}`,
        `farol:${state.farol_state || 'none'}`,
        `risk:${state.reversal_risk || 'low'}`,
        `color:${state.color_state || 'red'}`,
        `bias:${state.continuation_bias || 'NONE'}`
    ].join('|');
}

function buildPredictionView(prediction, state) {
    const outcome = normalizePredictionResult(prediction);
    return {
        predictionId: prediction.id,
        spin_id: prediction.spin_id,
        route: prediction.route || 'ESPERAR',
        zone: prediction.zone || 'ESPERAR',
        basis: prediction.basis || 'dominance',
        confidence: Number(prediction.confidence || 0),
        result: outcome.result,
        n9_result: outcome.n9_result,
        n4_result: outcome.n4_result,
        state,
        contextKey: contextKey(state)
    };
}

function summarizeGroup(key, items) {
    const total = items.length;
    const wins = items.filter(item => item.result === 'win').length;
    const losses = items.filter(item => item.result === 'loss').length;
    const skips = items.filter(item => item.result === 'skip').length;
    const pending = items.filter(item => item.result === 'pending').length;
    const routeCw = items.filter(item => item.route === 'CW').length;
    const routeCcw = items.filter(item => item.route === 'CCW').length;
    const zoneBig = items.filter(item => item.zone === 'BIG').length;
    const zoneSmall = items.filter(item => item.zone === 'SMALL').length;
    const winRate = total ? Number(((wins / total) * 100).toFixed(1)) : 0;
    const lossRate = total ? Number(((losses / total) * 100).toFixed(1)) : 0;
    const skipRate = total ? Number(((skips / total) * 100).toFixed(1)) : 0;
    const avgConfidence = total
        ? Number((items.reduce((acc, item) => acc + Number(item.confidence || 0), 0) / total).toFixed(1))
        : 0;

    return {
        context: key,
        total,
        wins,
        losses,
        skips,
        pending,
        winRate,
        lossRate,
        skipRate,
        avgConfidence,
        routeBias: routeCw >= routeCcw ? 'CW' : 'CCW',
        zoneBias: zoneBig >= zoneSmall ? 'BIG' : 'SMALL',
        exampleState: items[0]?.state || null
    };
}

function buildContextGroups(predictions, statesBySpinId) {
    const grouped = new Map();
    const views = predictions.map(prediction => buildPredictionView(prediction, statesBySpinId.get(String(prediction.spin_id)) || null));

    for (const item of views) {
        const key = item.contextKey;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(item);
    }

    return Array.from(grouped.entries())
        .map(([key, items]) => summarizeGroup(key, items))
        .sort((a, b) => b.total - a.total);
}

function buildStrategyCandidate(group, name, summary, action, tags = []) {
    return {
        source: 'ai',
        origin: 'evaluation_engine',
        category: 'strategy',
        status: 'candidate',
        priority: 'suggestion',
        name,
        summary,
        pattern: group.context,
        trigger: group.context,
        action,
        tags,
        sample_size: group.total,
        confidence_weight: Number((group.winRate / 100).toFixed(2)),
        success_hits: group.wins,
        fail_hits: group.losses,
        effectiveness: {
            direct_rate: group.winRate,
            neighbor_rate: 0,
            loss_rate: group.lossRate
        },
        evidence: {
            sample_size: group.total,
            win_rate: group.winRate,
            loss_rate: group.lossRate,
            skip_rate: group.skipRate,
            contexts: [group.context]
        },
        last_context: group.context
    };
}

function buildCandidates(groups) {
    const candidates = [];
    for (const group of groups) {
        const state = group.exampleState || {};
        if (
            group.total >= 6 &&
            group.winRate >= 60 &&
            state.block_state === 'active' &&
            ['micro', 'short'].includes(state.turbulence_level) &&
            ['strong', 'forming'].includes(state.dominance_state)
        ) {
            candidates.push(buildStrategyCandidate(
                group,
                `Continuidad de bloques ${state.continuation_bias || 'ACTIVA'}`,
                `En bloque activo con turbulencia corta, la continuidad mantiene ${group.winRate}% de acierto.`,
                `Seguir continuidad ${state.continuation_bias || group.routeBias} mientras no suba el riesgo de rebote.`,
                ['blocks', 'continuation', String(state.color_state || 'red')]
            ));
        }

        if (
            group.total >= 6 &&
            group.lossRate >= 55 &&
            ['tired', 'reversing', 'breaking'].includes(state.dominance_state)
        ) {
            candidates.push(buildStrategyCandidate(
                group,
                `Evitar dominancia fatigada ${state.dominance_side || 'NONE'}`,
                `Cuando la dominancia llega fatigada o en reversa, esta lectura falla ${group.lossRate}% de veces.`,
                `Reducir confianza o esperar confirmacion antes de seguir ${state.dominance_side || group.routeBias}.`,
                ['fatigue', 'reversal', 'risk']
            ));
        }

        if (
            group.total >= 5 &&
            group.winRate >= 55 &&
            ['suspected', 'active'].includes(state.farol_state)
        ) {
            candidates.push(buildStrategyCandidate(
                group,
                `Lectura de farol ${state.farol_side || 'NONE'}`,
                `Con farol ${state.farol_state}, este contexto conserva ${group.winRate}% de acierto.`,
                `Analizar si el salto ${state.farol_side || 'contrario'} es farol corto o cambio real antes de confirmar.`,
                ['farol', 'context', 'counter-move']
            ));
        }
    }

    return candidates;
}

function evaluatePredictionContexts(predictions, tableStates) {
    const statesBySpinId = new Map(
        (Array.isArray(tableStates) ? tableStates : [])
            .filter(item => item && item.spin_id != null)
            .map(item => [String(item.spin_id), item])
    );

    const groups = buildContextGroups(Array.isArray(predictions) ? predictions : [], statesBySpinId);
    const candidates = buildCandidates(groups);

    return {
        evaluated_predictions: Array.isArray(predictions) ? predictions.length : 0,
        matched_states: statesBySpinId.size,
        groups,
        candidates
    };
}

module.exports = {
    evaluatePredictionContexts
};
