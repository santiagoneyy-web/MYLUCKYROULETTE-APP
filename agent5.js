// ============================================================
// agent5.js — Autonomous AI Pattern Matching (Backend Node)
// ============================================================
const Spin = require('./models/Spin');

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
    if (absDist >= 1 && absDist <= 9) distanceClass = 'Small';
    else if (absDist >= 10 && absDist <= 19) distanceClass = 'Big';
    
    return { distance: distanceClass, direction };
}

// Agent 5: Similarity Search + DNA Absorption
// Looks for historical instances where the exact same sequence occurred.
// Also 'absorbs' DNA from other agents to check for alignment.
async function predictAgent5(tableId, currentHistoryNumbers, otherAgentsDNA = []) {
    // CRITICAL: We need at least 50 spins to have a statistically relevant base for similarity search
    if (currentHistoryNumbers.length < 50) return null;
    
    // We base our search on the last 3 spin numbers
    const seq = currentHistoryNumbers.slice(-3);
    
    // We want to find cases in MongoDB where this exact 3-number sequence played out, 
    // and see what the *next* number was mostly.
    
    try {
        let history = [];
        if (Spin.db.readyState === 1) { // 1 = connected
            history = await Spin.find({ table_id: tableId }).sort({ id: 1 }).limit(5000).exec();
        } else {
            // Fallback to local file if Mongo is not connected
            const db = require('./database');
            history = await new Promise((resolve, reject) => {
                db.getHistory(tableId, 5000, (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
        }
        const nums = history.map(h => h.number);
        const physicsData = history.map(h => ({ dist: h.distance, dir: h.direction }));
        
        // Current Physics sequence
        const currentPhys = [];
        for (let i = currentHistoryNumbers.length - 3; i < currentHistoryNumbers.length - 1; i++) {
            currentPhys.push(getPhysics(currentHistoryNumbers[i], currentHistoryNumbers[i+1]));
        }        // --- 1. TACTICAL DNA INGESTION (Expert Inputs) ---
        let combinedIntelligence = {}; // Weighted selection pool
        
        // Célula STUDIES his teammates' logic
        otherAgentsDNA.forEach(ag => {
            const weight = (ag.confidence && ag.confidence.includes('%')) ? parseInt(ag.confidence)/100 : 0.8;
            if (ag.number !== null && ag.number !== undefined) {
                combinedIntelligence[ag.number] = (combinedIntelligence[ag.number] || 0) + (5 * weight);
                // Neighbor Influence (Célula anticipates shifts)
                const i = WHEEL_INDEX[ag.number];
                [WHEEL_ORDER[(i+36)%37], WHEEL_ORDER[(i+1)%37]].forEach(n => {
                    combinedIntelligence[n] = (combinedIntelligence[n] || 0) + (1.5 * weight);
                });
            }
            if (ag.tp !== null && ag.tp !== undefined) combinedIntelligence[ag.tp] = (combinedIntelligence[ag.tp] || 0) + (3 * weight);
            if (Array.isArray(ag.cor)) ag.cor.forEach(n => combinedIntelligence[n] = (combinedIntelligence[n] || 0) + (1 * weight));
        });

        // --- 2. DEEP HISTORICAL MEMORY (Physics & Numbers) ---
        let memoryMatches = {};
        let totalMatches = 0;
        for (let i = 0; i < nums.length - 3; i++) {
            const numMatch = (nums[i] === seq[0] && nums[i+1] === seq[1] && nums[i+2] === seq[2]);
            const p1 = getPhysics(nums[i], nums[i+1]);
            const p2 = getPhysics(nums[i+1], nums[i+2]);
            const physMatch = (p1.distance === currentPhys[0].distance && p1.direction === currentPhys[0].direction &&
                               p2.distance === currentPhys[1].distance && p2.direction === currentPhys[1].direction);

            if (numMatch || physMatch) {
                const nextNum = nums[i+3];
                memoryMatches[nextNum] = (memoryMatches[nextNum] || 0) + (numMatch ? 4 : 2);
                totalMatches++;
            }
        }
        
        // --- 4. AUTONOMOUS SYNTHESIS (Synthesis of All Intelligence) ---
        // Fallback: If memory is empty, use global table frequencies as a base
        if (totalMatches === 0) {
            nums.forEach(n => memoryMatches[n] = (memoryMatches[n] || 0) + 0.1);
        }

        // FUSE Intelligence Layers
        // Célula takes his memory score and FUSES it with the Tactical DNA of his team
        Object.keys(combinedIntelligence).forEach(n => {
            if (memoryMatches[n]) {
                memoryMatches[n] += combinedIntelligence[n] * 1.5; // SYNERGY BOOST
            } else {
                memoryMatches[n] = combinedIntelligence[n] * 0.7; // DNA INFLUENCE
            }
        });

        // Final Choice
        let topNum = null, maxScore = 0;
        for (const [numStr, score] of Object.entries(memoryMatches)) {
            const s = parseFloat(score);
            if (s > maxScore) { maxScore = s; topNum = parseInt(numStr); }
        }

        // PERFECT DNA Check
        let dnaMatchFound = false;
        if (topNum !== null && otherAgentsDNA.some(a => a.number === topNum || a.tp === topNum)) {
            if (maxScore > 10) {
                console.log(`🧬 [Célula] ABSOLUTE PERFECTION: Intelligence fused for number ${topNum}`);
                dnaMatchFound = true;
            }
        }

        return { topNum, dnaMatch: dnaMatchFound };
        
    } catch (e) {
        console.error("Agent 5 execution error:", e);
        return null;
    }
}

function evaluatePrediction(realNumber, predictedNumber, radius = 9) {
    if (predictedNumber === null || realNumber === null || predictedNumber === undefined) return null;
    if (realNumber === predictedNumber) return 'Direct';
    
    const iReal = WHEEL_INDEX[realNumber];
    const iPred = WHEEL_INDEX[predictedNumber];
    if (iReal === undefined || iPred === undefined) return 'Loss';
    
    let dist = Math.abs(iReal - iPred);
    dist = Math.min(dist, 37 - dist);
    
    if (dist <= radius) return 'Neighbor';
    return 'Loss';
}

if (typeof window !== 'undefined') {
    window.evaluatePrediction = evaluatePrediction;
    window.WHEEL_ORDER = WHEEL_ORDER;
    window.WHEEL_INDEX = WHEEL_INDEX;
}

module.exports = {
    getSector,
    getPhysics,
    predictAgent5,
    evaluatePrediction,
    WHEEL_ORDER,
    WHEEL_INDEX
};
