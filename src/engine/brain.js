/**
 * brain.js — Unified Intelligence Engine
 *
 * Combines:
 *   1. Spin Method findings (what works, proven)
 *   2. Dynamic threshold learning (optimal DOM diff, hit rate cutoffs)
 *   3. Streak protection (back off when losing)
 *   4. Ensemble weights (which predictor to trust more now)
 *   5. Actionable digest for LLM prompts
 */

const fs = require('fs');
const path = require('path');

const BRAIN_FILE = path.join(__dirname, 'brain_state.json');
const SPIN_METHOD_FILE = path.join(__dirname, 'spin_method_results.json');

// ─── State ─────────────────────────────────────────────────
function loadBrain() {
    try {
        if (fs.existsSync(BRAIN_FILE)) return JSON.parse(fs.readFileSync(BRAIN_FILE, 'utf8'));
    } catch (e) {}
    return {
        thresholds: { minRouteDiff: 3, minHitRate: 40, maxLossStreak: 4 },
        predictorWeights: { SAFE: 1.0, FULL: 1.0, RAW: 1.0, METRICS: 1.0, DIR: 1.0 },
        streakState: { currentLosses: 0, currentWins: 0, protected: false },
        learnedRules: [],
        updatedAt: null
    };
}

function saveBrain(brain) {
    brain.updatedAt = new Date().toISOString();
    fs.writeFileSync(BRAIN_FILE, JSON.stringify(brain, null, 2));
}

// ─── Threshold Learning ────────────────────────────────────
function learnThresholds(brain, spinMethodData) {
    if (!spinMethodData || !spinMethodData.goldenContexts) return brain;
    
    // Find optimal routeDiff threshold from golden contexts
    const golden = spinMethodData.goldenContexts || [];
    if (golden.length === 0) return brain;
    
    // Analyze: what DOM diff range produces best results?
    const signalAnalysis = spinMethodData.signalAnalysis || {};
    
    // If strong route signals outperform global, increase confidence in thresholds
    if (signalAnalysis.strongRouteRate > spinMethodData.overallHitRate + 3) {
        // Strong routes work - keep or tighten threshold
        brain.thresholds.minRouteDiff = Math.max(2, brain.thresholds.minRouteDiff);
    } else if (signalAnalysis.strongRouteRate < spinMethodData.overallHitRate - 3) {
        // Strong routes underperform - relax threshold
        brain.thresholds.minRouteDiff = Math.min(6, brain.thresholds.minRouteDiff + 1);
    }
    
    // Adapt hit rate threshold based on global performance
    if (spinMethodData.overallHitRate > 50) {
        brain.thresholds.minHitRate = Math.min(55, brain.thresholds.minHitRate + 2);
    } else if (spinMethodData.overallHitRate < 35) {
        brain.thresholds.minHitRate = Math.max(30, brain.thresholds.minHitRate - 3);
    }
    
    // Learn max loss streak from actual data
    const sequences = extractLossStreaks(spinMethodData);
    if (sequences.length > 0) {
        const avgLossStreak = Math.round(sequences.reduce((a,b) => a+b, 0) / sequences.length);
        brain.thresholds.maxLossStreak = Math.max(2, Math.min(8, avgLossStreak + 1));
    }
    
    saveBrain(brain);
    return brain;
}

function extractLossStreaks(data) {
    // Approximate from context data if available
    const streaks = [];
    if (data.goldenContexts) {
        data.goldenContexts.forEach(c => {
            if (c.losses > 0 && c.total >= 10) {
                streaks.push(Math.round(c.losses / Math.max(1, c.total / 10)));
            }
        });
    }
    return streaks.length ? streaks : [3];
}

// ─── Predictor Weights ─────────────────────────────────────
function updatePredictorWeights(brain, spinMethodData) {
    const modes = spinMethodData.modePerformance || [];
    
    modes.forEach(m => {
        const key = m.label ? m.label.replace('Modo ', '') : m.key;
        const weight = Math.max(0.3, Math.min(3.0, m.hitRate / 50));
        brain.predictorWeights[key] = Math.round(weight * 100) / 100;
    });
    
    // Also weight metrics from golden contexts
    if (spinMethodData.routePerStability) {
        const cwWeight = spinMethodData.routePerStability
            .filter(r => r.key.includes('CW'))
            .reduce((s, r) => s + r.hitRate, 0) / Math.max(1, spinMethodData.routePerStability.filter(r => r.key.includes('CW')).length);
        const ccwWeight = spinMethodData.routePerStability
            .filter(r => r.key.includes('CCW'))
            .reduce((s, r) => s + r.hitRate, 0) / Math.max(1, spinMethodData.routePerStability.filter(r => r.key.includes('CCW')).length);
        
        brain.predictorWeights.CW_METRIC = Math.round(Math.max(0.3, Math.min(3.0, cwWeight / 50)) * 100) / 100;
        brain.predictorWeights.CCW_METRIC = Math.round(Math.max(0.3, Math.min(3.0, ccwWeight / 50)) * 100) / 100;
    }
    
    saveBrain(brain);
    return brain;
}

// ─── Streak Protection ─────────────────────────────────────
function checkStreakProtection(brain, recentResults) {
    // recentResults: array of 'win'/'loss'/'skip' from last N predictions
    let currentLosses = 0;
    let currentWins = 0;
    
    for (let i = recentResults.length - 1; i >= 0; i--) {
        if (recentResults[i] === 'loss') { currentLosses++; currentWins = 0; }
        else if (recentResults[i] === 'win') { currentWins++; currentLosses = 0; }
        else break;
    }
    
    brain.streakState.currentLosses = currentLosses;
    brain.streakState.currentWins = currentWins;
    brain.streakState.protected = currentLosses >= brain.thresholds.maxLossStreak;
    
    saveBrain(brain);
    return brain.streakState;
}

function getStreakProtectionDigest(streakState) {
    if (streakState.protected) {
        return `PROTECCION ACTIVA: ${streakState.currentLosses} perdidas seguidas. RECOMIENDO ESPERAR este giro.`;
    }
    if (streakState.currentLosses >= 2) {
        return `PRECAUCION: ${streakState.currentLosses} perdidas seguidas. Solo entrar si senial es muy fuerte.`;
    }
    if (streakState.currentWins >= 3) {
        return `RACHA POSITIVA: ${streakState.currentWins} aciertos seguidos. Se puede mantener agresividad.`;
    }
    return '';
}

// ─── Build Actionable Digest ───────────────────────────────
function buildBrainDigest(context) {
    const brain = loadBrain();
    let spinData = null;
    try {
        if (fs.existsSync(SPIN_METHOD_FILE)) {
            spinData = JSON.parse(fs.readFileSync(SPIN_METHOD_FILE, 'utf8'));
        }
    } catch (e) {}
    
    // Update brain with latest data
    if (spinData && spinData.status !== 'insufficient_data') {
        learnThresholds(brain, spinData);
        updatePredictorWeights(brain, spinData);
    }
    
    const lines = [];
    
    // 1. Dynamic thresholds
    lines.push(`UMBRALES: DOMdiff>${brain.thresholds.minRouteDiff} para entrar, hitRate>${brain.thresholds.minHitRate}%, max ${brain.thresholds.maxLossStreak} perdidas seguidas.`);
    
    // 2. Golden contexts (proven patterns)
    if (spinData && spinData.goldenContexts && spinData.goldenContexts.length > 0) {
        lines.push('CONTEXTOS PROBADOS:');
        spinData.goldenContexts.slice(0, 5).forEach(c => {
            lines.push(`  ${c.context}: ${c.hitRate}% (${c.wins}W/${c.losses}L en ${c.total})`);
        });
    }
    
    // 3. Predictor weights
    const weights = brain.predictorWeights;
    const sortedWeights = Object.entries(weights)
        .filter(([,w]) => w !== 1.0)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5);
    if (sortedWeights.length > 0) {
        lines.push('PESOS (confianza relativa):');
        sortedWeights.forEach(([k, w]) => {
            const label = w > 1.5 ? 'ALTA' : w > 1.0 ? 'MEDIA' : w < 0.7 ? 'BAJA' : 'NORMAL';
            lines.push(`  ${k}: x${w} (${label})`);
        });
    }
    
    // 4. Mode comparison
    if (spinData && spinData.modePerformance) {
        const best = spinData.modePerformance[0];
        if (best) {
            lines.push(`MEJOR MODO: ${best.label || best.key} con ${best.hitRate}% (${best.wins}W/${best.losses}L).`);
        }
    }
    
    // 5. Streak protection
    if (brain.streakState.protected || brain.streakState.currentLosses >= 2) {
        lines.push(getStreakProtectionDigest(brain.streakState));
    }
    
    // 6. Learned rules (from golden contexts)
    if (brain.learnedRules.length > 0) {
        lines.push('REGLAS APRENDIDAS:');
        brain.learnedRules.slice(-3).forEach(r => lines.push(`  ${r}`));
    }
    
    return lines.join('\n');
}

// ─── Record result and learn ───────────────────────────────
function recordResult(result, context) {
    const brain = loadBrain();
    
    // Update streak
    if (result === 'win') {
        brain.streakState.currentWins++;
        brain.streakState.currentLosses = 0;
        brain.streakState.protected = false;
    } else if (result === 'loss') {
        brain.streakState.currentLosses++;
        brain.streakState.currentWins = 0;
        if (brain.streakState.currentLosses >= brain.thresholds.maxLossStreak) {
            brain.streakState.protected = true;
        }
    }
    
    // Learn from win: record what worked
    if (result === 'win' && context) {
        const rule = `WIN en ${context.stability || '?'} + ${context.pattern || '?'} → ${context.route || '?'}/${context.zone || '?'}.`;
        brain.learnedRules.push(rule);
        if (brain.learnedRules.length > 50) brain.learnedRules.shift();
    }
    
    saveBrain(brain);
}

function getBrain() {
    return loadBrain();
}

module.exports = {
    buildBrainDigest,
    recordResult,
    getBrain,
    checkStreakProtection,
    loadBrain
};
