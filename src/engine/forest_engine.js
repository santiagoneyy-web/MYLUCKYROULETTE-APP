/**
 * forest_engine.js — Mini-Forest Discovery Engine
 *
 * Cada métrica (CW, CCW, BIG, SMALL) "descubre" en qué contextos acierta.
 * Solo cuando un descubrimiento tiene 3+ aciertos comprobados, influye en
 * la predicción final. Hasta entonces es solo observación.
 *
 * Contexto = stability + pattern + dominance_axis
 * Ej: "green|Bloque direccional fuerte|direction"
 */

const fs = require('fs');
const path = require('path');

const FOREST_FILE = path.join(__dirname, 'forest_memory.json');

function loadForest() {
    try {
        if (fs.existsSync(FOREST_FILE)) {
            return JSON.parse(fs.readFileSync(FOREST_FILE, 'utf8'));
        }
    } catch (e) { /* ignore */ }
    return { version: 1, discoveries: [], updatedAt: null };
}

function saveForest(forest) {
    forest.updatedAt = new Date().toISOString();
    fs.writeFileSync(FOREST_FILE, JSON.stringify(forest, null, 2));
}

function contextKey(ctx) {
    const stability = ctx.stability || 'unknown';
    const pattern = ctx.pattern || 'unknown';
    const axis = ctx.dominant_axis || 'none';
    return `${stability}|${pattern}|${axis}`;
}

/**
 * Register a discovery observation.
 * When a new number resolves, we check which metrics would have predicted it.
 */
function observe(forest, context, metricId, wasCorrect) {
    const key = contextKey(context);
    let discovery = forest.discoveries.find(d => d.contextKey === key && d.metricId === metricId);
    
    if (!discovery) {
        discovery = {
            contextKey: key,
            metricId,
            context,
            observations: 0,
            wins: 0,
            losses: 0,
            promoted: false,
            promotedAt: null,
            score: 0,
            createdAt: new Date().toISOString()
        };
        forest.discoveries.push(discovery);
    }
    
    discovery.observations++;
    if (wasCorrect) {
        discovery.wins++;
        discovery.score = Math.round((discovery.wins / discovery.observations) * 100);
    } else {
        discovery.losses++;
        discovery.score = Math.round((discovery.wins / discovery.observations) * 100);
    }
    
    // Promote after 3+ wins and hit rate >= 55%
    if (!discovery.promoted && discovery.wins >= 3 && discovery.score >= 55) {
        discovery.promoted = true;
        discovery.promotedAt = new Date().toISOString();
    }
    
    // Demote if hit rate drops below 40% with enough observations
    if (discovery.promoted && discovery.observations >= 8 && discovery.score < 40) {
        discovery.promoted = false;
        discovery.promotedAt = null;
    }
    
    // Limit forest size
    if (forest.discoveries.length > 200) {
        forest.discoveries = forest.discoveries
            .sort((a, b) => b.score - a.score)
            .slice(0, 200);
    }
    
    saveForest(forest);
    return discovery;
}

/**
 * Get promoted discoveries for the current context.
 * These are the ones that have proven themselves and can influence predictions.
 */
function getPromotedForContext(forest, context) {
    const key = contextKey(context);
    return forest.discoveries.filter(d => 
        d.contextKey === key && d.promoted
    ).sort((a, b) => b.score - a.score);
}

/**
 * Get all promoted discoveries (for display).
 */
function getPromotedDiscoveries(forest) {
    return forest.discoveries
        .filter(d => d.promoted)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
}

/**
 * Score each active metric given the current context.
 * Promoted discoveries add weight to their metric.
 * Returns { metricId: boostedScore }
 */
function scoreMetrics(forest, context, baseScores) {
    const promoted = getPromotedForContext(forest, context);
    const boosted = { ...baseScores };
    
    promoted.forEach(d => {
        const weight = Math.min(d.score / 100, 1.0); // 0.55 → 1.0
        boosted[d.metricId] = (boosted[d.metricId] || 0) + weight * 2;
    });
    
    return boosted;
}

/**
 * RL Context Memory — Which contexts are most successful?
 */
function getRlBestContexts(forest, minSamples = 3) {
    // Group discoveries by context key and find highest win-rate contexts
    const byContext = {};
    forest.discoveries.forEach(d => {
        if (!byContext[d.contextKey]) byContext[d.contextKey] = { wins: 0, total: 0, metrics: {} };
        byContext[d.contextKey].wins += d.wins;
        byContext[d.contextKey].total += d.observations;
        byContext[d.contextKey].metrics[d.metricId] = d.score;
    });
    
    return Object.entries(byContext)
        .filter(([, v]) => v.total >= minSamples)
        .map(([key, v]) => ({
            contextKey: key,
            winRate: Math.round((v.wins / v.total) * 100),
            total: v.total,
            topMetric: Object.entries(v.metrics).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none'
        }))
        .filter(c => c.winRate >= 55)
        .sort((a, b) => b.winRate - a.winRate)
        .slice(0, 5);
}

module.exports = {
    loadForest,
    saveForest,
    observe,
    getPromotedForContext,
    getPromotedDiscoveries,
    scoreMetrics,
    getRlBestContexts,
    contextKey
};
