// ============================================================
// predictor.js — Advanced Pattern Recognition & Trend Analysis
// ============================================================

const WHEEL_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];
const WHEEL_INDEX = {};
WHEEL_ORDER.forEach((n, i) => { WHEEL_INDEX[n] = i; });

// User Terminal Correlation Chart
const TERMINALS_MAP = {
    0:  [4, 6],         1:  [8],            2:  [7, 9],         3:  [8], 
    4:  [11],           5:  [12, 10],       6:  [11],           7:  [14, 2], 
    8:  [15, 13, 3, 1], 9:  [14, 2],        10: [17, 5],        11: [18, 16, 6, 4], 
    12: [17, 5],        13: [20, 23],       14: [9, 21, 7, 19], 15: [8, 20], 
    16: [11],           17: [12, 24, 10, 22],18: [11, 23],      19: [14, 26], 
    20: [13, 25, 15, 27],21: [14, 26],      22: [17, 29],       23: [18, 30, 16, 28], 
    24: [17, 29],       25: [20, 32],       26: [19, 31, 33, 21],27: [20, 32], 
    28: [23, 35],       29: [22, 34, 24, 36],30: [23, 35],      31: [26], 
    32: [25, 27],       33: [26],           34: [29],           35: [28, 30], 
    36: [29]
};

const STRATEGIES = [
    { strategy: '-',     betZone: [1, 2, 4, 5, 6, 10, 11, 13, 14, 15, 16, 23, 24, 25, 27, 30, 33, 36] },
    { strategy: '+',     betZone: [0, 2, 3, 4, 7, 8, 10, 12, 13, 15, 17, 18, 21, 22, 25, 26, 28, 29, 31, 32, 35] },
    { strategy: '-,-1',  betZone: [1, 5, 8, 10, 11, 13, 16, 23, 24, 27, 30, 33, 36] },
    { strategy: '-,+1',  betZone: [1, 2, 4, 6, 13, 14, 15, 16, 24, 25, 33, 36] },
    { strategy: '+,-1',  betZone: [0, 2, 3, 4, 7, 12, 15, 17, 18, 21, 25, 26, 28, 32, 35] },
    { strategy: '+,+1',  betZone: [0, 3, 7, 8, 10, 12, 13, 18, 21, 22, 26, 28, 29, 31, 32, 35] }
];

function getDistance(a, b) {
    const iA = WHEEL_INDEX[a], iB = WHEEL_INDEX[b];
    let d = iB - iA;
    if (d > 18) d -= 37;
    if (d < -18) d += 37;
    return d;
}

function analyzeSpin(history, stats) {
    if (history.length < 3) return [];
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    const prev2 = history[history.length - 3];
    
    const results = [];
    STRATEGIES.forEach(s => {
        const key = s.strategy;
        if (!stats[key]) stats[key] = { wins: 0, losses: 0, attempts: 0, outcomes: [] };
        
        const win = s.betZone.includes(last);
        stats[key].attempts++;
        if (win) stats[key].wins++; else stats[key].losses++;
        stats[key].outcomes.push(win);
        if (stats[key].outcomes.length > 20) stats[key].outcomes.shift();
        
        results.push({ strategy: key, win, wins: stats[key].wins, losses: stats[key].losses, attempts: stats[key].attempts, outcomes: stats[key].outcomes, betZone: s.betZone });
    });
    return results;
}

function projectNextRound(history, stats) {
    if (history.length < 2) return [];
    return STRATEGIES.map(s => {
        const key = s.strategy;
        const st = stats[key] || { wins: 0, losses: 0, attempts: 0, outcomes: [] };
        const hitRate = st.attempts > 0 ? (st.wins / st.attempts) * 100 : 0;
        
        let streakWin = 0, streakLoss = 0;
        for (let i = st.outcomes.length - 1; i >= 0; i--) {
            if (st.outcomes[i]) { if (streakLoss > 0) break; streakWin++; }
            else { if (streakWin > 0) break; streakLoss++; }
        }
        
        return { strategy: key, hitRate, streakWin, streakLoss, tp: s.betZone[0], cor: s.betZone.slice(1, 5), betZone: s.betZone, rule: 'MOMENTUM', targetPattern: 'neutral' };
    });
}

function computeDealerSignature(history) {
    if (history.length < 2) return { directionState: 'measuring', recommendedPlay: 'NONE', avgTravel: null };
    const travels = [];
    for (let i = 1; i < history.length; i++) travels.push(getDistance(history[i-1], history[i]));
    
    const lastT = travels[travels.length - 1];
    const state = Math.abs(lastT) <= 9 ? 'stable' : 'chaos';
    const rec = lastT > 0 ? 'BIG' : 'SMALL';
    
    return { 
        directionState: state, 
        recommendedPlay: rec, 
        avgTravel: lastT, 
        travelHistory: travels,
        casilla5: WHEEL_ORDER[(WHEEL_INDEX[history[history.length-1]] + 5) % 37],
        casilla14: WHEEL_ORDER[(WHEEL_INDEX[history[history.length-1]] + 14) % 37],
        casilla1: WHEEL_ORDER[(WHEEL_INDEX[history[history.length-1]] + 1) % 37],
        casilla19: WHEEL_ORDER[(WHEEL_INDEX[history[history.length-1]] + 19) % 37],
        casilla10: WHEEL_ORDER[(WHEEL_INDEX[history[history.length-1]] + 10) % 37]
    };
}

function getWheelNeighbors(num, radius) {
    const idx = WHEEL_INDEX[num];
    if (idx === undefined) return [num];
    const neighbors = [];
    for (let i = -radius; i <= radius; i++) {
        let nIdx = (idx + i + 37) % 37;
        neighbors.push(WHEEL_ORDER[nIdx]);
    }
    return neighbors;
}

function getSixStrategieSignals(lastNum) {
    if (lastNum === undefined || lastNum === null) return [];
    
    // Dynamic offset based on the Terminal (Last Digit) of the number
    const t = lastNum % 10;
    
    const strategies = [
        { name: '+',     tp: (lastNum + t + 37) % 37 },
        { name: '-',     tp: (lastNum - t + 37) % 37 },
        { name: '-,+1',  tp: (lastNum - t + 1 + 37) % 37 },
        { name: '-,-1',  tp: (lastNum - t - 1 + 37) % 37 },
        { name: '+,+1',  tp: (lastNum + t + 1 + 37) % 37 },
        { name: '+,-1',  tp: (lastNum + t - 1 + 37) % 37 }
    ];

    return strategies.map(s => {
        let tp = s.tp;
        const cors = TERMINALS_MAP[tp] || [];
        
        // Neighbor Logic: 1 COR -> N3/N3 | 2 COR -> N2/N3 | 3+ COR -> N2/N2
        let tpN = 3, corN = 3;
        if (cors.length === 2) { tpN = 2; corN = 3; }
        else if (cors.length >= 3) { tpN = 2; corN = 2; }

        let betZone = [...getWheelNeighbors(tp, tpN)];
        cors.forEach(c => {
            const cNeighbors = getWheelNeighbors(c, corN);
            betZone = [...new Set([...betZone, ...cNeighbors])];
        });

        return { 
            strategy: s.name, 
            tp, 
            cors, 
            betZone,
            rule: 'SIX STRATEGIE',
            reason: `TP:${tp} COR:${cors.join(',')}`
        };
    });
}

function getIAMasterSignals(prox, sig, history) {
    if (!sig || history.length === 0) return [];
    const lastNum = history[history.length - 1];
    const signals = [];

    // Analyze Patterns
    const isBigTrend = history.slice(-5).filter(n => n >= 10 && n <= 19).length >= 3;
    const isSmallTrend = history.slice(-5).filter(n => n >= 1 && n <= 9).length >= 3;
    
    // Zig Zag Detectors
    const isDirZigZag = history.length >= 3 && Math.sign(calcDist(history[history.length-2], history[history.length-1])) !== Math.sign(calcDist(history[history.length-3], history[history.length-2]));
    const isZoneZigZag = history.length >= 3 && (history[history.length-1] >= 10 && history[history.length-1] <= 19) !== (history[history.length-2] >= 10 && history[history.length-2] <= 19);

    // 1. Android n16 (Six Strategie - The User's Core Logic)
    // Intelligent Selection: Find which strategy is hitting best in the last 10 spins
    const ssOutcomes = getSixStrategieSignals(lastNum);
    let bestSS = ssOutcomes[0];
    let maxHits = -1;

    ssOutcomes.forEach(strategy => {
        let hits = 0;
        // Check performance in last 10 spins
        for (let i = Math.max(0, history.length - 10); i < history.length - 1; i++) {
            const hNum = history[i];
            const nextHNum = history[i+1];
            // Re-calculate what THIS strategy would have predicted at that moment
            const t = hNum % 10;
            let predBase = 0;
            if (strategy.name === '+') predBase = hNum + t;
            else if (strategy.name === '-') predBase = hNum - t;
            else if (strategy.name === '-,+1') predBase = hNum - t + 1;
            else if (strategy.name === '-,-1') predBase = hNum - t - 1;
            else if (strategy.name === '+,+1') predBase = hNum + t + 1;
            else if (strategy.name === '+,-1') predBase = hNum + t - 1;
            
            const predTP = (predBase + 37) % 37;
            const predCors = TERMINALS_MAP[predTP] || [];
            
            // Count hit if next number is in TP or COR neighbors
            const tpRad = (predCors.length >= 3) ? 2 : 2; 
            const corRad = (predCors.length === 1) ? 3 : (predCors.length === 2 ? 3 : 2);
            
            const isHit = getWheelNeighbors(predTP, tpRad).includes(nextHNum) || 
                          predCors.some(c => getWheelNeighbors(c, corRad).includes(nextHNum));
            
            if (isHit) hits++;
        }
        if (hits > maxHits) {
            maxHits = hits;
            bestSS = strategy;
        }
    });

    signals.push({
        name: 'Android n16',
        tp: bestSS.tp,
        cor: bestSS.cors,
        betZone: bestSS.betZone,
        number: bestSS.tp,
        confidence: "94%",
        reason: `${bestSS.name} (Hits: ${maxHits}/10)`,
        rule: 'SIX STRATEGIE',
        mode: 'ZONAS',
        radius: "N2/N3"
    });

    // 2. Android n17 (SOPORTE + HIBRIDO)
    let target17 = sig.casilla1;
    if (history.length > 5 && Math.abs(sig.avgTravel) < 5) target17 = sig.casilla10; 
    signals.push({
        name: 'Android n17',
        number: target17,
        confidence: "88%",
        reason: target17 === sig.casilla10 ? "HIBRIDO" : "SOPORTE",
        rule: "FISICA/SOPORTE",
        mode: "ESCUDO",
        betZone: getWheelNeighbors(target17, 9),
        radius: "N9"
    });

    // 3. Android 1717 (SOPORTE + HIBRIDO + ZIG ZAG)
    let target1717 = sig.casilla10; 
    if (isDirZigZag || isZoneZigZag) target1717 = sig.casilla19; 
    signals.push({
        name: 'Android 1717',
        number: target1717,
        confidence: "90%",
        reason: (isDirZigZag || isZoneZigZag) ? "ZIGZAG SOPORTE" : "ATAQUE HIBRIDO",
        rule: "HIBRIDO/ZIGZAG",
        mode: 'ATAQUE',
        betZone: getWheelNeighbors(target1717, 9),
        radius: "N9"
    });

    // 4. N18 (SOPORTE PURO)
    let targetSoporte = isBigTrend ? sig.casilla19 : sig.casilla1;
    signals.push({
        name: 'N18',
        number: targetSoporte,
        confidence: "86%",
        reason: isBigTrend ? "SOPORTE BIG" : "SOPORTE SMALL",
        rule: "SOPORTE",
        mode: 'SOPORTE',
        betZone: getWheelNeighbors(targetSoporte, 9),
        radius: "N9"
    });

    // 5. CELULA (COMBINADO TOTAL - SNIPER HYBRID)
    // Primary: n9 target based on physics, Secondary: n4 snipes on small/big
    let targetSnipe = isBigTrend ? sig.casilla14 : sig.casilla5;
    if (isZoneZigZag) targetSnipe = (history[history.length-1] >= 10 && history[history.length-1] <= 19) ? sig.casilla5 : sig.casilla14;
    
    signals.push({
        name: 'CELULA',
        number: targetSnipe,
        top: targetSnipe,
        confidence: "92%",
        reason: "SNIPE COMBINADO",
        rule: "SNIPER",
        mode: 'GANANCIA',
        betZone: getWheelNeighbors(targetSnipe, 9), // Main target is n9
        radius: "N9",
        smallSnipe: sig.casilla5,
        bigSnipe: sig.casilla14
    });

    // Populate secondary snipes for all agents to fill the 3-column UI
    signals.forEach(s => {
        if (!s.smallSnipe) s.smallSnipe = sig.casilla5;
        if (!s.bigSnipe) s.bigSnipe = sig.casilla14;
    });

    return signals;
}

// Ensure calcDist is available globally if needed by predictor.js
function calcDist(from, to) {
    const i1 = WHEEL_INDEX[from];
    const i2 = WHEEL_INDEX[to];
    if (i1 === undefined || i2 === undefined) return 0;
    let d = i2 - i1;
    if (d > 18) d -= 37;
    if (d < -18) d += 37;
    return d;
}

// Helper for browser/node hybrid
if (typeof window !== 'undefined') {
    window.analyzeSpin = analyzeSpin;
    window.projectNextRound = projectNextRound;
    window.computeDealerSignature = computeDealerSignature;
    window.getIAMasterSignals = getIAMasterSignals;
    window.getSixStrategieSignals = getSixStrategieSignals;
    window.WHEEL_ORDER = WHEEL_ORDER;
    window.WHEEL_INDEX = WHEEL_INDEX;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        WHEEL_ORDER, WHEEL_INDEX, TERMINALS_MAP,
        analyzeSpin, projectNextRound, computeDealerSignature, getIAMasterSignals, getSixStrategieSignals
    };
}
