// ============================================================
// agent5.js — Autonomous AI Pattern Matching (Backend Node)
// ============================================================
const Spin = require('../../models/Spin');

const WHEEL_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];
const WHEEL_INDEX = {};
WHEEL_ORDER.forEach((n, i) => { WHEEL_INDEX[n] = i; });

function getSector(number) {
    if (number === 0) return 'Zero';
    const voisins = [22,18,29,7,28,12,35,3,26,0,32,15,19,4,21,2,25];
    const tiers = [27,13,36,11,30,8,23,10,5,24,16,33];
    const orphelins = [1,20,14,31,9,17,34,6];
    
    if (voisins.includes(number)) return 'Voisins';
    if (tiers.includes(number)) return 'Tiers';
    if (orphelins.includes(number)) return 'Orphelins';
    return null;
}

// Calculate distance and direction between two numbers
function getPhysics(prev, current) {
    if (prev === null || current === null) return { distance: null, direction: null };
    
    const iPrev = WHEEL_INDEX[prev];
    const iCurr = WHEEL_INDEX[current];
    
    if (iPrev === iCurr) return { distance: 'Zero', direction: null };
    
    let dist = iCurr - iPrev;
    if (dist > 18) dist -= 37;
    if (dist < -18) dist += 37;
    
    const direction = dist > 0 ? 'DERECHA' : 'IZQUIERDA';
    const absDist = Math.abs(dist);
    
    let distanceClass = 'ULTRA';
    if (absDist >= 1 && absDist <= 9) distanceClass = 'Under';
    else if (absDist >= 10 && absDist <= 19) distanceClass = 'Over';
    
    return { distance: distanceClass, direction };
}

// Agent 5: Similarity Search + DNA Absorption
// Looks for historical instances where the exact same sequence occurred.
// Now DB-agnostic (receives expert rule and stats from server)
async function predictAgent5(currentHistoryNumbers, expert = null, stats = []) {
    if (currentHistoryNumbers.length < 5) return { topNum: null, dnaMatch: false, reason: 'Syncing...' };

    try {
        // 1. Check EXPERT RULES first (Human knowledge)
        if (expert) {
            return {
                topNum: null, 
                direction: expert.suggested_move,
                dnaMatch: true, 
                reason: `CONOCIMIENTO EXPERTO: ${expert.label}`
            };
        }

        // 2. Check GLOBAL PATTERNS (Statistical Learning)
        if (stats && stats.length > 0) {
            const best = stats[0];
            return {
                topNum: null,
                magnitude: best._id.mag === 'B' ? 'OVER' : 'UNDER',
                direction: best._id.dir === 'CW' ? 'CW' : 'CCW',
                dnaMatch: true,
                count: best.count,
                reason: `SIMILITUD DETECTADA (${best.count} coincidencias en BD)`
            };
        }

    } catch (e) { console.error('[Agent5] Error:', e); }

    return { topNum: null, dnaMatch: false, reason: 'Buscando patrones en base de datos...' };
}

function evaluatePrediction(realNumber, predictedNumber) {
    if (predictedNumber === null || realNumber === null) return null;
    if (realNumber === predictedNumber) return 'Direct';
    
    const iReal = WHEEL_INDEX[realNumber];
    const iPred = WHEEL_INDEX[predictedNumber];
    
    let dist = Math.abs(iReal - iPred);
    dist = Math.min(dist, 37 - dist);
    
    if (dist <= 2) return 'Neighbor'; // N2
    return 'Loss';
}

module.exports = {
    getSector,
    getPhysics,
    predictAgent5,
    evaluatePrediction,
    WHEEL_ORDER,
    WHEEL_INDEX
};
