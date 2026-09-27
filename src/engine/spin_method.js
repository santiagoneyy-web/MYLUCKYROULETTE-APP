/**
 * spin_method.js — Post-Mortem Analysis Engine
 * 
 * Cada N predicciones resueltas, analiza QUÉ funcionó y POR QUÉ.
 * Encuentra "contextos dorados" donde el sistema acierta consistemente.
 * Genera estrategias automáticas que el usuario puede adoptar.
 */

const fs = require('fs');
const path = require('path');

const ANALYSIS_FILE = path.join(__dirname, 'spin_method_results.json');
const MIN_SAMPLES = 12;      // Mínimo de muestras para considerar un hallazgo
const PROMOTE_SAMPLES = 20;  // Muestras para promover a estrategia
const PROMOTE_HIT_RATE = 55; // % mínimo para promover

function loadPredictions(db, tableId) {
    return new Promise((resolve, reject) => {
        // Try loading from the DB module directly
        if (typeof db.getAiPredictions === 'function') {
            db.getAiPredictions(tableId, 5000, (err, rows) => {
                if (err) return reject(err);
                resolve(Array.isArray(rows) ? rows.filter(r => ['win', 'loss'].includes(r.result)) : []);
            });
        } else {
            resolve([]);
        }
    });
}

function extractFeatures(prediction) {
    const ctx = prediction.context_snapshot || {};
    const dom = ctx.dominance8 || {};
    const mom = ctx.momentum15 || {};
    const perf = ctx.performance8 || {};
    
    const domCW = Number(dom.cw || 0);
    const domCCW = Number(dom.ccw || 0);
    const domBig = Number(dom.big || 0);
    const domSmall = Number(dom.small || 0);
    
    // DOM8 route diff: how strong is the direction dominance?
    const routeDiff = Math.abs(domCW - domCCW);
    const zoneDiff = Math.abs(domBig - domSmall);
    
    // WL streaks from performance strings
    const cwN9 = String(perf.cwN9 || '').slice(-3);
    const ccwN9 = String(perf.ccwN9 || '').slice(-3);
    const cwWins = (cwN9.match(/W/g) || []).length;
    const ccwWins = (ccwN9.match(/W/g) || []).length;
    
    return {
        // Context
        stability: String(ctx.stability_level || 'red').toLowerCase(),
        pattern: String(ctx.pattern_label || 'unknown'),
        dominantAxis: String(ctx.dominant_axis || 'none'),
        dominantSignal: String(ctx.dominant_signal || 'NONE'),
        
        // Decision
        mode: String(prediction.mode || 'SAFE').toUpperCase(),
        route: String(prediction.route || 'ESPERAR'),
        zone: String(prediction.zone || 'ESPERAR'),
        basis: String(prediction.basis || 'dominance'),
        
        // Metrics
        domCW, domCCW, domBig, domSmall,
        routeDiff,
        zoneDiff,
        cwHot: cwWins >= 2,
        ccwHot: ccwWins >= 2,
        cwDominant: domCW > domCCW,
        ccwDominant: domCCW > domCW,
        
        // Strong signal flags
        strongRoute: routeDiff >= 4,
        strongZone: zoneDiff >= 3,
        mixedSignals: routeDiff <= 1 && zoneDiff <= 1,
        
        // Result
        result: String(prediction.result || 'loss'),
        isWin: prediction.result === 'win',
        reward: Number(prediction.rl_reward || 0),
        
        // Time
        hourBucket: getHourBucket(prediction.created_at || prediction.resolved_at)
    };
}

function getHourBucket(dateStr) {
    if (!dateStr) return 'unknown';
    const h = new Date(dateStr).getHours();
    if (h < 6) return 'madrugada';
    if (h < 12) return 'manana';
    if (h < 18) return 'tarde';
    return 'noche';
}

function groupByKey(predictions, keyFn, labelFn) {
    const groups = {};
    predictions.forEach(p => {
        const key = keyFn(p);
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    });
    
    return Object.entries(groups)
        .map(([key, items]) => ({
            key,
            label: labelFn ? labelFn(key, items) : key,
            total: items.length,
            wins: items.filter(i => i.isWin).length,
            losses: items.filter(i => !i.isWin).length,
            hitRate: Math.round((items.filter(i => i.isWin).length / items.length) * 100),
            avgReward: Math.round(items.reduce((s, i) => s + i.reward, 0) / items.length),
            items
        }))
        .filter(g => g.total >= MIN_SAMPLES)
        .sort((a, b) => b.hitRate - a.hitRate);
}

/**
 * MAIN: Run full analysis
 */
async function analyze(db, tableId) {
    try {
        const predictions = await loadPredictions(db, tableId);
        if (predictions.length < 20) {
            return { 
                status: 'insufficient_data', 
                message: `Solo ${predictions.length} predicciones resueltas. Se necesitan 20+.`,
                total: predictions.length 
            };
        }
        
        const features = predictions.map(extractFeatures);
        const wins = features.filter(f => f.isWin);
        const overallRate = Math.round((wins.length / features.length) * 100);
        
        // 1. Golden contexts: stability + pattern + route
        const contexts = groupByKey(
            features.filter(f => f.route !== 'ESPERAR'),
            f => `${f.stability}|${f.pattern}|${f.route}`,
            (key) => key.replace(/\|/g, ' + ')
        );
        
        // 2. Best route per stability
        const routePerStability = groupByKey(
            features.filter(f => f.route !== 'ESPERAR'),
            f => `${f.stability}|${f.route}`,
            (key) => key.replace('|', ' → ')
        );
        
        // 3. Best zone per pattern
        const zonePerPattern = groupByKey(
            features.filter(f => f.zone !== 'ESPERAR'),
            f => `${f.pattern}|${f.zone}`,
            (key) => key.replace('|', ' → ')
        );
        
        // 4. Mode performance
        const modePerf = groupByKey(
            features,
            f => f.mode,
            (key) => `Modo ${key}`
        );
        
        // 5. Strong route signal analysis
        const strongSignalHits = features.filter(f => f.strongRoute && f.isWin);
        const signalAnalysis = {
            strongRouteTotal: features.filter(f => f.strongRoute).length,
            strongRouteWins: strongSignalHits.length,
            strongRouteRate: features.filter(f => f.strongRoute).length > 0 
                ? Math.round((strongSignalHits.length / features.filter(f => f.strongRoute).length) * 100) 
                : 0,
            strongZoneTotal: features.filter(f => f.strongZone).length,
            strongZoneWins: features.filter(f => f.strongZone && f.isWin).length,
            strongZoneRate: features.filter(f => f.strongZone).length > 0
                ? Math.round((features.filter(f => f.strongZone && f.isWin).length / features.filter(f => f.strongZone).length) * 100)
                : 0,
            mixedTotal: features.filter(f => f.mixedSignals).length,
            mixedWins: features.filter(f => f.mixedSignals && f.isWin).length,
            mixedRate: features.filter(f => f.mixedSignals).length > 0
                ? Math.round((features.filter(f => f.mixedSignals && f.isWin).length / features.filter(f => f.mixedSignals).length) * 100)
                : 0
        };
        
        // 6. Generate automatic strategies
        const autoStrategies = [];
        contexts.forEach(ctx => {
            if (ctx.total >= PROMOTE_SAMPLES && ctx.hitRate >= PROMOTE_HIT_RATE) {
                const [stability, pattern, route] = ctx.key.split('|');
                const zone = ctx.items[0]?.zone || 'SMALL';
                autoStrategies.push({
                    name: `Auto: ${route} en ${stability} + ${pattern}`,
                    summary: `${ctx.hitRate}% de acierto en ${ctx.total} muestras. Rewards: ${ctx.avgReward}.`,
                    trigger: `stability=${stability}&pattern=${pattern}`,
                    action: `Entrar ${route}/${zone}. Confianza: ${ctx.hitRate}%.`,
                    context: { stability, pattern, route, zone },
                    confidence: ctx.hitRate,
                    samples: ctx.total,
                    wins: ctx.wins,
                    losses: ctx.losses,
                    promoted: true,
                    generatedAt: new Date().toISOString()
                });
            }
        });
        
        const results = {
            generatedAt: new Date().toISOString(),
            tableId,
            totalAnalyzed: features.length,
            overallHitRate: overallRate,
            totalWins: wins.length,
            totalLosses: features.length - wins.length,
            
            // Top 10 golden contexts
            goldenContexts: contexts.slice(0, 10).map(c => ({
                context: c.key,
                hitRate: c.hitRate,
                total: c.total,
                wins: c.wins,
                losses: c.losses,
                avgReward: c.avgReward
            })),
            
            // Best route per stability
            routePerStability: routePerStability.slice(0, 8),
            
            // Best zone per pattern  
            zonePerPattern: zonePerPattern.slice(0, 8),
            
            // Mode comparison
            modePerformance: modePerf,
            
            // Signal analysis
            signalAnalysis,
            
            // Auto-generated strategies (promoted)
            autoStrategies,
            
            // Summary
            summary: buildSummary(features, overallRate, signalAnalysis, modePerf)
        };
        
        // Save results
        fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(results, null, 2));
        
        return results;
        
    } catch (e) {
        console.error('[SpinMethod] Analysis error:', e.message);
        return { status: 'error', message: e.message };
    }
}

function buildSummary(features, overallRate, signalAnalysis, modePerf) {
    const parts = [];
    
    parts.push(`Tasa global: ${overallRate}% en ${features.length} predicciones.`);
    
    // Best mode
    const bestMode = modePerf[0];
    if (bestMode) {
        parts.push(`Mejor modo: ${bestMode.label} con ${bestMode.hitRate}% (${bestMode.wins}W/${bestMode.losses}L).`);
    }
    
    // Strong signals help?
    if (signalAnalysis.strongRouteRate > overallRate) {
        parts.push(`Ruta fuerte (DOM diff >=4): ${signalAnalysis.strongRouteRate}% vs ${overallRate}% global. ${signalAnalysis.strongRouteRate > overallRate + 5 ? '+MEJORA' : '+leve'}.`);
    }
    
    // Mixed signals hurt?
    if (signalAnalysis.mixedRate < overallRate && signalAnalysis.mixedTotal >= MIN_SAMPLES) {
        parts.push(`Seniales mixtas: ${signalAnalysis.mixedRate}%. ${signalAnalysis.mixedRate < overallRate - 5 ? 'ESPERAR en mixtas.' : 'Similar.'}`);
    }
    
    // Recommendation
    if (overallRate < 40) {
        parts.push('RECOMENDACION: Tasa baja. Priorizar SAFE (bloquear mas). Solo entrar en contextos fuertes.');
    } else if (overallRate < 55) {
        parts.push('RECOMENDACION: Tasa regular. Usar los contextos dorados para filtrar entradas.');
    } else {
        parts.push('RECOMENDACION: Tasa aceptable. Seguir operando, afinar contextos especificos.');
    }
    
    return parts.join(' ');
}

module.exports = { analyze, ANALYSIS_FILE };
