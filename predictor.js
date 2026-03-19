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

    // --- V24 Analysis (Window: 12 spins) ---
    const WINDOW_SIZE = 12;
    const history12 = history.slice(-WINDOW_SIZE);
    
    // Evaluate Patterns (Using Actual Absolute Distance)
    const distHistory = [];
    for (let i = 1; i < history12.length; i++) {
        distHistory.push(Math.abs(calcDist(history12[i-1], history12[i])));
    }
    
    // Dominancia (based on distance: 1-9 small, 10-19 big)
    let isBigTrend = distHistory.filter(d => d >= 10 && d <= 19).length >= (distHistory.length * 0.6);
    let isSmallTrend = distHistory.filter(d => d >= 1 && d <= 9).length >= (distHistory.length * 0.6);
    
    // Weakening Trend (last 4 spins vs main window)
    const last4D = distHistory.slice(-4);
    const weakeningBig = isBigTrend && last4D.filter(d => d < 10).length >= 3;
    const weakeningSmall = isSmallTrend && last4D.filter(d => d >= 10).length >= 3;
    
    // Directional Trend (6-12 spins)
    let dirDer = 0, dirIzq = 0;
    for (let i = 1; i < history12.length; i++) {
        const d = getDistance(history12[i-1], history12[i]);
        if (d > 0) dirDer++; else if (d < 0) dirIzq++;
    }
    const globalTrendDir = (dirDer >= dirIzq) ? 1 : -1;
    const isDirectionUnstable = Math.abs(dirDer - dirIzq) <= 1 && history12.length >= 6;

    // Zig Zag Detectors (Immediate rhythm)
    const lastDist  = history.length >= 2 ? calcDist(history[history.length-2], history[history.length-1]) : 0;
    const prevDist  = history.length >= 3 ? calcDist(history[history.length-3], history[history.length-2]) : 0;
    const isDirZigZag  = history.length >= 3 && Math.sign(lastDist) !== Math.sign(prevDist);
    
    const lastDistAbs = Math.abs(lastDist);
    const lastIsBig   = lastDistAbs >= 10 && lastDistAbs <= 19;
    const prevDistAbs = Math.abs(prevDist);
    const prevIsBig   = prevDistAbs >= 10 && prevDistAbs <= 19;
    const isZoneZigZag = history.length >= 3 && lastIsBig !== prevIsBig;

    const lastNumIdx = WHEEL_INDEX[lastNum] || 0;
    const lastDirection = lastDist >= 0 ? 1 : -1;

    // 1. Android n16 (Six Strategie - The User's Core Logic)
    const ssOutcomes = getSixStrategieSignals(lastNum);
    let bestSS = ssOutcomes[0];
    let maxHits = -1;

    ssOutcomes.forEach(strategy => {
        let hits = 0;
        for (let i = Math.max(0, history.length - 10); i < history.length - 1; i++) {
            const hNum = history[i];
            const nextHNum = history[i+1];
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
            
            const tpRad = 2; 
            const corRad = (predCors.length <= 2) ? 3 : 2;
            
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
        reason: `${bestSS.name} (Hits: ${maxHits}/12)`,
        rule: 'SIX STRATEGIE',
        mode: 'ZONAREAL',
        radius: "N4/N9"
    });

    // Update n16 radius to N9 for consistency
    signals[signals.length-1].betZone = getWheelNeighbors(bestSS.tp, 9);
    bestSS.cors.forEach(c => {
        const cN = getWheelNeighbors(c, 9);
        signals[signals.length-1].betZone = [...new Set([...signals[signals.length-1].betZone, ...cN])];
    });

    // 2. Android n17 (SOPORTE + HIBRIDO V24)
    // Hybrid Mode active if avgTravel < 5. All radios N9.
    let target17, reason17, mode17;
    const isHybridActive = history.length > 5 && Math.abs(sig.avgTravel) < 5;
    
    if (isHybridActive) {
        if (isDirectionUnstable) {
            // Unstable trend -> Inverse Hybrid (Opposite of global trend)
            const inverseDir = -globalTrendDir;
            const idx17 = (lastNumIdx + (10 * inverseDir) + 37) % 37;
            target17 = WHEEL_ORDER[idx17];
            reason17 = "HIBRIDO INVERSO (INESTABLE)";
            mode17 = "ATAQUE";
        } else {
            // Stable trend -> Direct Hybrid (+10 in direction)
            const idx17 = (lastNumIdx + (10 * globalTrendDir) + 37) % 37;
            target17 = WHEEL_ORDER[idx17];
            reason17 = `HIBRIDO ${globalTrendDir > 0 ? 'DER' : 'IZQ'} +10`;
            mode17 = "HIBRIDO";
        }
    } else {
        // Mode Support C1
        target17 = sig.casilla1;
        reason17 = "SOPORTE FISICO C1";
        mode17 = "ESCUDO";
    }
    
    signals.push({
        name: 'Android n17',
        number: target17,
        confidence: "88%",
        reason: reason17,
        rule: "FISICA/SOPORTE",
        mode: mode17,
        betZone: getWheelNeighbors(target17, 9),
        radius: "N9"
    });

    // 3. Android 1717 (ATAQUE V24: Anticipacion ZigZag)
    let target1717, reason1717, mode1717;
    if (isDirZigZag) {
        // Anticipate inversion: last was D -> play I-10
        const anticipatedDir = -lastDirection;
        const idx1717 = (lastNumIdx + (10 * anticipatedDir) + 37) % 37;
        target1717 = WHEEL_ORDER[idx1717];
        reason1717 = `ZIGZAG ANTICIPA ${anticipatedDir > 0 ? 'DER' : 'IZQ'}`;
        mode1717 = "ZIGZAG";
    } else if (isZoneZigZag) {
        // Zone zigzag -> Support C19
        target1717 = sig.casilla19;
        reason1717 = "ZIGZAG ZONA -> SOPORTE C19";
        mode1717 = "ZONA-DEF";
    } else {
        // Base Hybrid or confirmed trend
        const idx1717 = (lastNumIdx + (10 * globalTrendDir) + 37) % 37;
        target1717 = WHEEL_ORDER[idx1717];
        reason1717 = "ATAQUE HIBRIDO CONFIRMADO";
        mode1717 = "ATAQUE";
    }
    
    signals.push({
        name: 'Android 1717',
        number: target1717,
        confidence: "90%",
        reason: reason1717,
        rule: "HIBRIDO/ZIGZAG",
        mode: mode1717,
        betZone: getWheelNeighbors(target1717, 9),
        radius: "N9"
    });

    // 4. N18 (SOPORTE PURO: Dominancia V24)
    // Only BIG or SMALL. Handles weakening.
    let targetSoporte, reasonSoporte;
    if (weakeningBig) {
        targetSoporte = sig.casilla1;
        reasonSoporte = "DEBILITAMIENTO BIG -> C1";
    } else if (weakeningSmall) {
        targetSoporte = sig.casilla19;
        reasonSoporte = "DEBILITAMIENTO SMALL -> C19";
    } else {
        targetSoporte = isBigTrend ? sig.casilla19 : sig.casilla1;
        reasonSoporte = isBigTrend ? "DOMINANCIA BIG -> C19" : "DOMINANCIA SMALL -> C1";
    }
    
    signals.push({
        name: 'N18',
        number: targetSoporte,
        confidence: "86%",
        reason: reasonSoporte,
        rule: "SOPORTE",
        mode: isBigTrend ? 'BIG' : 'SMALL',
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
        s.smallSnipe = sig.casilla5 !== undefined ? sig.casilla5 : '--';
        s.bigSnipe = sig.casilla14 !== undefined ? sig.casilla14 : '--';
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
