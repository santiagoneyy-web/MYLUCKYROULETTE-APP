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
    
    const direction = dist > 0 ? 'CW' : 'CCW';
    const absDist = Math.abs(dist);
    const distanceClass = absDist <= 9 ? 'Small' : 'Big';
    
    return { distance: distanceClass, direction };
}

// Agent 5: Similarity Search
// Looks for historical instances where the exact same sequence of the last N physical parameters occurred.
async function predictAgent5(tableId, currentHistoryNumbers) {
    if (currentHistoryNumbers.length < 3) return null;
    
    // We base our search on the last 3 spin numbers
    const seq = currentHistoryNumbers.slice(-3);
    
    // We want to find cases in MongoDB where this exact 3-number sequence played out, 
    // and see what the *next* number was mostly.
    
    try {
        // Query MongoDB for the last 5000 spins for this table
        // We could use an aggregation pipeline, but for simplicity we fetch and scan.
        // It's very fast in Node.js for 5000 records.
        const history = await Spin.find({ table_id: tableId }).sort({ id: 1 }).limit(5000).exec();
        const nums = history.map(h => h.number);
        
        let nextNumberFrequencies = {};
        let matches = 0;
        
        for (let i = 0; i < nums.length - 3; i++) {
            if (nums[i] === seq[0] && nums[i+1] === seq[1] && nums[i+2] === seq[2]) {
                const nextNum = nums[i+3];
                if (!nextNumberFrequencies[nextNum]) nextNumberFrequencies[nextNum] = 0;
                nextNumberFrequencies[nextNum]++;
                matches++;
            }
        }
        
        // If exact sequence not found, fallback to 2 numbers
        if (matches === 0) {
            for (let i = 0; i < nums.length - 2; i++) {
                if (nums[i] === seq[1] && nums[i+1] === seq[2]) {
                    const nextNum = nums[i+2];
                    if (!nextNumberFrequencies[nextNum]) nextNumberFrequencies[nextNum] = 0;
                    nextNumberFrequencies[nextNum]++;
                    matches++;
                }
            }
        }
        
        // If still no matches, we can't predict
        if (matches === 0) return null;
        
        // Find the most frequent next number
        let topNum = null;
        let maxFreq = 0;
        for (const [numStr, freq] of Object.entries(nextNumberFrequencies)) {
            if (freq > maxFreq) {
                maxFreq = freq;
                topNum = parseInt(numStr);
            }
        }
        
        return topNum;
        
    } catch (e) {
        console.error("Agent 5 execution error:", e);
        return null;
    }
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
