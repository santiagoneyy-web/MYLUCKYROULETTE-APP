// ============================================================
// predictor.js â€” Advanced Pattern Recognition & Trend Analysis
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

function getDistance(a, b) {
    const iA = WHEEL_INDEX[a], iB = WHEEL_INDEX[b];
    if (iA === undefined || iB === undefined) return 0;
    let d = iB - iA;
    if (d > 18) d -= 37;
    if (d < -18) d += 37;
    return d;
}

// Helper para determinar si una distancia es CW (positiva)
function isCW(dist) {
    return dist > 0;
}

// Helper para valor absoluto (para compatibilidad con entorno global)
function abs(val) {
    return Math.abs(val);
}

// (Estrategias antiguas eliminadas para optimizaciÃ³n)

function analyzeSpin(history, stats) {
    // Deprecated: Ya no se escanean 400 nÃºmeros
    return [];
}

function projectNextRound(history, stats) {
    // Deprecated: Dummy function for compatibility
    return [];
}

function computeDealerSignature(history) {
    if (history.length < 12) return { directionState: 'measuring', recommendedPlay: 'CHARGING', avgTravel: 0 };
    
    const travels = [];
    for (let i = 1; i < history.length; i++) travels.push(getDistance(history[i-1], history[i]));
    
    // Recent sample (last 10 travels)
    const recentTravels = travels.slice(-10);
    const avg = recentTravels.reduce((a,b) => a+b, 0) / recentTravels.length;
    
    // Calculate variability (Stability)
    const variance = recentTravels.reduce((a,b) => a + Math.pow(b - avg, 2), 0) / recentTravels.length;
    const stdDev = Math.sqrt(variance);

    // Calculate RUNS (direction blocks) over the last 20 throws to detect "SOLID" tables
    let isSolid = false;
    let runsCount = 0;
    if (travels.length >= 20) {
        const last20 = travels.slice(-20);
        runsCount = 1;
        for (let i = 1; i < last20.length; i++) {
            const currentDir = last20[i] >= 0;
            const prevDir = last20[i-1] >= 0;
            if (currentDir !== prevDir) runsCount++;
        }
        // If it changes direction <= 10 times in 20 spins, the blocks average 2+ in size (WWLLWW...)
        if (runsCount <= 10) isSolid = true;
    }
    
    // Determine strict state
    let state = 'CHAOS';
    if (isSolid) {
        state = 'SÃ“LIDA';
    } else if (stdDev <= 6) {
        state = 'ESTABLE';
    } else if (stdDev <= 10) {
        state = 'ZIGZAG';
    }
    
    // Recommendation based on the weighted trend
    const rec = avg > 0 ? 'OVER (CW)' : 'UNDER (CCW)';
    
    return { 
        directionState: state, 
        recommendedPlay: rec, 
        avgTravel: Math.round(avg * 10) / 10, 
        stdDev: Math.round(stdDev * 10) / 10,
        travelHistory: recentTravels,
        casilla4: WHEEL_ORDER[(WHEEL_INDEX[history[history.length-1]] + 4) % 37],
        casilla14: WHEEL_ORDER[(WHEEL_INDEX[history[history.length-1]] + 14) % 37],
        casillaNeg4: WHEEL_ORDER[(WHEEL_INDEX[history[history.length-1]] - 4 + 37) % 37],
        casillaNeg14: WHEEL_ORDER[(WHEEL_INDEX[history[history.length-1]] - 14 + 37) % 37],
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

function getIAMasterSignals(prox, sig, history, currentAvgs = { cw: 9, ccw: -9, offset: 0 }) {
    if (!sig || history.length === 0) return [];
    const lastNum = history[history.length - 1];
    const idx = WHEEL_INDEX[lastNum];
    
    // ── FIXED SYSTEM TARGETS (Android 1717) ──
    // N9 se mide en la casilla 9 (+9/-9, ultima distancia SMALL)
    // UNDER = casilla 4 (+4/-4) | OVER = casilla 14 (+14/-14)
    const mainCW  = 9;
    const mainCCW = -9;

    // CW Targets (positive)
    const targetCW      = WHEEL_ORDER[(idx + 9 + 37) % 37];
    const targetUnderCW = WHEEL_ORDER[(idx + 4 + 37) % 37];
    const targetOverCW  = WHEEL_ORDER[(idx + 14 + 37) % 37];

    // CCW Targets (negative)
    const targetCCW      = WHEEL_ORDER[(idx - 9 + 37) % 37];
    const targetUnderCCW = WHEEL_ORDER[(idx - 4 + 37) % 37];
    const targetOverCCW  = WHEEL_ORDER[(idx - 14 + 37) % 37];

    // â”€â”€ DIRECTION CONFIDENCE â”€â”€
    // Calculate from actual recent travel history
    const travels = [];
    for (let i = 1; i < history.length; i++) travels.push(getDistance(history[i-1], history[i]));
    const recent = travels.slice(-20);
    const cwCount = recent.filter(d => d > 0).length;
    const ccwCount = recent.filter(d => d < 0).length;
    const totalDir = cwCount + ccwCount;
    
    let confidenceCW = 50;
    let confidenceCCW = 50;
    let mainDir = 'CW';
    
    if (totalDir > 0) {
        confidenceCW = Math.round((cwCount / totalDir) * 100);
        confidenceCCW = Math.round((ccwCount / totalDir) * 100);
        mainDir = confidenceCW > confidenceCCW ? 'CW' : 'CCW';
        
        // If one direction dominates (>65%), boost confidence
        if (confidenceCW >= 65) { confidenceCW = Math.min(95, confidenceCW + 10); confidenceCCW = Math.max(5, confidenceCCW - 10); }
        else if (confidenceCCW >= 65) { confidenceCCW = Math.min(95, confidenceCCW + 10); confidenceCW = Math.max(5, confidenceCW - 10); }
    }
    
    // mainDir stays purely based on recent direction counts â€” no override

    return [{
        name: 'Android 1717',
        targetCW, targetCCW,
        targetUnderCW, targetOverCW,
        targetUnderCCW, targetOverCCW,
        betZoneCW: getWheelNeighbors(targetCW, 4), 
        betZoneCCW: getWheelNeighbors(targetCCW, 4),
        rule: `N${mainCW}p / N${Math.abs(mainCCW)}n`,
        mode: 'DUAL',
        confidenceCW,
        confidenceCCW,
        mainDir,
        avgTravel: sig.avgTravel,
        stdDev: sig.stdDev,
        directionState: sig.directionState,
        mainCW,
        mainCCW
    }];
}

function predictZonePattern(history, patternStats = null) {
    if (history.length < 4) return { magnitude: 'SMALL', direction: 'CW', confidence: 0, isCharging: true };

    const distances = [];
    for (let i = 1; i < history.length; i++) {
        distances.push(getDistance(history[i-1], history[i]));
    }

    const recent = distances.slice(-12);
    if (recent.length < 3) return { magnitude: 'SMALL', direction: 'CW', confidence: 0, isCharging: true };

    const mags = recent.map(d => Math.abs(d) >= 10 ? 'B' : 'S');
    const dirs = recent.map(d => d >= 0 ? 'CW' : 'CCW');

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SIGNAL 1: MARKOV â€” Transition probabilities
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    function markovProb(seq, stateA, stateB) {
        const trans = {};
        trans[stateA] = {}; trans[stateA][stateA] = 0; trans[stateA][stateB] = 0;
        trans[stateB] = {}; trans[stateB][stateA] = 0; trans[stateB][stateB] = 0;
        for (let i = 0; i < seq.length - 1; i++) trans[seq[i]][seq[i+1]]++;
        const last = seq[seq.length - 1];
        const total = trans[last][stateA] + trans[last][stateB];
        if (total === 0) return 0.5;
        return trans[last][stateA] / total; // P(stateA | last)
    }
    const markovPBig = markovProb(mags, 'B', 'S');
    const markovPCW  = markovProb(dirs, 'CW', 'CCW');

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SIGNAL 2: RUN-LENGTH â€” Streak break prediction
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    function runLengthProb(seq, target) {
        // Measure all run lengths of `target` in history
        const runs = [];
        let currentRun = 0;
        for (const s of seq) {
            if (s === target) { currentRun++; }
            else { if (currentRun > 0) runs.push(currentRun); currentRun = 0; }
        }
        // Current active streak
        let activeStreak = 0;
        for (let i = seq.length - 1; i >= 0; i--) {
            if (seq[i] === target) activeStreak++; else break;
        }
        if (runs.length === 0) return 0.5;
        const avgRun = runs.reduce((a,b) => a+b, 0) / runs.length;
        // If active streak exceeds average, predict a break
        if (activeStreak >= avgRun) {
            const overshoot = activeStreak / avgRun;
            return Math.max(0.1, 1 - (overshoot * 0.3)); // Declines as streak grows
        }
        return 0.5 + (activeStreak / avgRun) * 0.2; // Building confidence
    }
    const rlPBig = runLengthProb(mags, 'B');
    const rlPCW  = runLengthProb(dirs, 'CW');

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SIGNAL 3: GLOBAL FREQUENCY â€” Overall ratio
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const globalPBig = mags.filter(m => m === 'B').length / mags.length;
    const globalPCW  = dirs.filter(d => d === 'CW').length / dirs.length;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SIGNAL 4: PATTERN MEMORY â€” MongoDB historical matches
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    let memPBig = 0.5, memPCW = 0.5;
    let memWeight = 0; // Starts at 0 until we have database matches

    if (patternStats && patternStats.mag && patternStats.dir) {
        const magStats = patternStats.mag;
        const totalMag = (magStats.B || 0) + (magStats.S || 0);
        if (totalMag > 0) {
            memPBig = (magStats.B || 0) / totalMag;
            memWeight = Math.min(0.40, totalMag * 0.05); // Up to 40% weight if >= 8 matches
        }

        const dirStats = patternStats.dir;
        const totalDir = (dirStats.CW || 0) + (dirStats.CCW || 0);
        if (totalDir > 0) {
            memPCW = (dirStats.CW || 0) / totalDir;
            // Use highest weight found between mag and dir matches
            memWeight = Math.max(memWeight, Math.min(0.40, totalDir * 0.05));
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // BAYESIAN BLEND â€” Dynamically weighted combination
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // If memory is strong (memWeight=0.40), other weights scale down proportionally
    const wMark = 0.50 - (memWeight * 0.50);
    const wRun  = 0.30 - (memWeight * 0.25);
    const wGlob = 0.20 - (memWeight * 0.25);

    const blendPBig = (markovPBig * wMark) + (rlPBig * wRun) + (globalPBig * wGlob) + (memPBig * memWeight);
    const blendPCW  = (markovPCW  * wMark) + (rlPCW  * wRun) + (globalPCW  * wGlob) + (memPCW  * memWeight);

    const finalMagProb = blendPBig >= 0.5 ? blendPBig : 1 - blendPBig;
    const finalDirProb = blendPCW >= 0.5 ? blendPCW : 1 - blendPCW;

    const predMag = blendPBig >= 0.5 ? 'OVER' : 'UNDER';
    const predDir = blendPCW >= 0.5 ? 'CW' : 'CCW';

    const magProb = Math.round(finalMagProb * 100);
    const dirProb = Math.round(finalDirProb * 100);
    const confidence = Math.round(Math.sqrt(magProb * dirProb));

    // Solo cargar baterÃ­a si no hay suficiente historial
    let isCharging = false;
    if (history.length < 5) {
        isCharging = true;
    }

    return { magnitude: predMag, direction: predDir, confidence: confidence, isCharging: isCharging };
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
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// TRAVEL ANALYST AGENT â€” Technical Analysis (Trading Style)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function analyzeTravelWave(travels) {
    if (travels.length < 8) return { 
        signal: 'BUSCANDO PATRÃ“N CLARO...', targetDir: null, size: null,
        reason: 'Recolectando datos iniciales...', type: 'neutral', res: 0, sup: 0 
    };

    const abs = Math.abs;
    const sample = travels.slice(-30);
    const lastMoves = travels.slice(-10);

    // â”€â”€â”€ 1. SOPORTES Y RESISTENCIAS â”€â”€â”€
    const peaks   = sample.filter(v => v > 0).sort((a,b) => b - a).slice(0, 3);
    const valleys = sample.filter(v => v < 0).sort((a,b) => a - b).slice(0, 4);
    const res = peaks.length   > 0 ? peaks.reduce((a,b)=>a+b,0)   / peaks.length   : 14;
    const sup = valleys.length > 0 ? valleys.reduce((a,b)=>a+b,0) / valleys.length : -14;

    const m3 = travels[travels.length - 3] ?? 0;
    const m2 = travels[travels.length - 2] ?? 0;
    const m1 = travels[travels.length - 1]; 

    // â”€â”€â”€ 2. DETECTOR DE FRACTALES (MODO CONSERVADOR) â”€â”€â”€
    // Convertimos los Ãºltimos 4 movimientos en un vector de "ADN"
    const getDNA = (arr) => arr.map(v => (Math.abs(v) >= 10 ? 'B' : 'S') + (v >= 0 ? '+' : '-')).join('|');
    const currentDNA = getDNA(travels.slice(-4));
    let fractalTarget = null;
    let fractalReason = '';

    // Escaneamos el pasado buscando el mismo ADN (necesitamos histÃ³rico largo para esto)
    if (travels.length > 20) {
        for (let i = 0; i < travels.length - 8; i++) {
            const pastDNA = getDNA(travels.slice(i, i + 4));
            if (pastDNA === currentDNA) {
                const nextMove = travels[i + 4];
                fractalTarget = { dir: nextMove >= 0 ? 'CW' : 'CCW', size: abs(nextMove) >= 10 ? 'OVER' : 'UNDER' };
                fractalReason = `Figura fractal detectada en tiro #${i+1}. RepeticiÃ³n geomÃ©trica probable.`;
                break; // Encontramos la primera coincidencia clara
            }
        }
    }

    // â”€â”€â”€ 3. DETECTOR DE CANAL / TENDENCIA (SLOPE) â”€â”€â”€
    // RECALIBRADO V5: Umbrales mÃ¡s altos para evitar falsas tendencias en ruleta.
    // En ruleta la inercia es suave, no explosiva como en trading.
    const firstHalfAvg = lastMoves.slice(0, 5).reduce((a,b)=>a+b,0) / 5;
    const secondHalfAvg = lastMoves.slice(5).reduce((a,b)=>a+b,0) / 5;
    const slope = secondHalfAvg - firstHalfAvg;
    const isTrendingUp = slope > 5.5;   // era 3.5 â†’ mucho mÃ¡s exigente
    const isTrendingDown = slope < -5.5; // era -3.5 â†’ mucho mÃ¡s exigente
    // Tendencia suave (para canales leves que SÃ existen en ruleta)
    const isSoftTrendUp = slope > 2.5 && !isTrendingUp;
    const isSoftTrendDown = slope < -2.5 && !isTrendingDown;

    // â”€â”€â”€ 4. COMPRESIÃ“N DE VOLATILIDAD â”€â”€â”€
    const recentSD = Math.sqrt(lastMoves.reduce((s, x) => s + x*x, 0) / 10);
    const isCompressed = recentSD < 4.5 && travels.length > 15;

    // â”€â”€â”€ 5. INERCIA DIRECCIONAL (NUEVO V5) â”€â”€â”€
    // Contar cuÃ¡ntos de los Ãºltimos 5 fueron CW o CCW
    const last5dirs = lastMoves.slice(-5).map(v => v >= 0 ? 'CW' : 'CCW');
    const cwCount = last5dirs.filter(d => d === 'CW').length;
    const ccwCount = last5dirs.filter(d => d === 'CCW').length;
    const hasInertia = cwCount >= 4 || ccwCount >= 4;
    const inertiaDir = cwCount >= 4 ? 'CW' : (ccwCount >= 4 ? 'CCW' : null);

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ SELECCIÃ“N DE SEÃ‘AL (PRIORIDAD V5: INERCIA > CANAL > FRACTAL > REBOTE) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // FILOSOFÃA V5: En ruleta las rupturas son RARAS. La inercia suave del dealer es la seÃ±al dominante.
    let signal    = 'BUSCANDO PATRÃ“N CLARO...';
    let targetDir = null; 
    let size      = null; 
    let reason    = 'Analizando flujo de ondas...';
    let type      = 'neutral';

    // A. Prioridad 1: INERCIA DIRECCIONAL (4+ de 5 tiros en la misma direcciÃ³n)
    if (hasInertia && inertiaDir) {
        signal    = inertiaDir === 'CW' ? 'âž¡ï¸ INERCIA CW SÃ“LIDA' : 'â¬…ï¸ INERCIA CCW SÃ“LIDA';
        targetDir = inertiaDir;
        size      = Math.abs(m1) >= 10 ? 'OVER' : 'UNDER';
        reason    = `${cwCount >= 4 ? cwCount : ccwCount}/5 tiros en direcciÃ³n ${inertiaDir}. El dealer mantiene ritmo constante.`;
        type      = inertiaDir === 'CW' ? 'bullish' : 'bearish';
    }
    // B. Prioridad 2: CANALES SUAVES (ContinuaciÃ³n de tendencia leve â€” lo mÃ¡s comÃºn en ruleta)
    else if (isSoftTrendUp || isTrendingUp) {
        signal    = isTrendingUp ? 'ðŸ“ˆ CANAL ALCISTA FUERTE' : 'ðŸ“ˆ CANAL ALCISTA';
        targetDir = 'CW';
        size      = abs(m1) < 5 ? 'OVER' : 'UNDER';
        reason    = 'Hondas en ascenso constante. El dealer mantiene inercia de subida.';
        type      = 'bullish';
    }
    else if (isSoftTrendDown || isTrendingDown) {
        signal    = isTrendingDown ? 'ðŸ“‰ CANAL BAJISTA FUERTE' : 'ðŸ“‰ CANAL BAJISTA';
        targetDir = 'CCW';
        size      = abs(m1) < 5 ? 'OVER' : 'UNDER';
        reason    = 'Hondas en descenso constante. El dealer mantiene inercia de caÃ­da.';
        type      = 'bearish';
    }
    // C. Prioridad 3: FRACTAL (SeÃ±al de memoria especÃ­fica)
    else if (fractalTarget) {
        signal    = 'ðŸ”„ FRACTAL REPETITIVO';
        targetDir = fractalTarget.dir;
        size      = fractalTarget.size;
        reason    = fractalReason;
        type      = targetDir === 'CW' ? 'bullish' : 'bearish';
    }
    // D. Prioridad 4: REBOTES (Solo con margen MUY amplio â€” conservador)
    else if (m1 >= res + 1.0) {
        signal    = 'ðŸ”´ RESISTENCIA TOCADA';
        targetDir = 'CCW';
        size      = 'UNDER'; // era OVER â€” en ruleta los rebotes son leves
        reason    = `Techo en +${res.toFixed(1)}p superado. Posible correcciÃ³n leve.`;
        type      = 'bearish';
    }
    else if (m1 <= sup - 1.0) {
        signal    = 'ðŸŸ¢ SOPORTE TOCADO';
        targetDir = 'CW';
        size      = 'UNDER'; // era OVER â€” en ruleta los rebotes son leves
        reason    = `Suelo en ${sup.toFixed(1)}p superado. Posible correcciÃ³n leve.`;
        type      = 'bullish';
    }
    // E. CompresiÃ³n y Agotamiento
    else if (isCompressed) {
        signal    = 'âš ï¸ COMPRESIÃ“N';
        targetDir = null;
        size      = null; // era BIG â€” en ruleta la compresiÃ³n no garantiza un salto brutal
        reason    = 'Varianza mÃ­nima. Observar prÃ³ximos tiros para definir direcciÃ³n.';
        type      = 'neutral';
    }
    else if (isCW(m3) && isCW(m2) && isCW(m1) && abs(m3) > abs(m2) && abs(m2) > abs(m1)) {
        signal    = 'ðŸ“‰ AGOTAMIENTO';
        targetDir = 'CCW';
        size      = 'UNDER';
        reason    = `Impulso alcista perdiendo fuerza gradualmente.`;
        type      = 'bearish';
    }
    // F. Prioridad ÃšLTIMA: RUPTURAS (Degradadas â€” rara vez ocurren en ruleta)
    // Solo se activan si NADA mÃ¡s se detectÃ³ Y la tendencia es extrema
    else if (m1 >= res - 0.5 && isTrendingUp) {
        signal    = 'ðŸš€ RUPTURA ALCISTA (RARA)';
        targetDir = 'CW';
        size      = 'OVER';
        reason    = `Inercia (+) extrema sobre resistencia (+${res.toFixed(1)}p). Ruptura inusual.`;
        type      = 'bullish';
    }
    else if (m1 <= sup + 0.5 && isTrendingDown) {
        signal    = 'ðŸ’¥ RUPTURA BAJISTA (RARA)';
        targetDir = 'CCW';
        size      = 'OVER';
        reason    = `PresiÃ³n (-) extrema sobre soporte (${sup.toFixed(1)}p). Ruptura inusual.`;
        type      = 'bearish';
    }

    return { signal, targetDir, size, reason, type, res: +res.toFixed(1), sup: +sup.toFixed(1) };
}

if (typeof window !== 'undefined') {
    window.analyzeSpin = analyzeSpin;
    window.projectNextRound = projectNextRound;
    window.computeDealerSignature = computeDealerSignature;
    window.getIAMasterSignals = getIAMasterSignals;
    window.predictZonePattern = predictZonePattern;
    window.analyzeTravelWave = analyzeTravelWave;
    window.analyzeMasterConfluence = analyzeMasterConfluence; // New
    window.wheelNeighbors = getWheelNeighbors;
    window.calcDist = calcDist;
    window.WHEEL_ORDER = WHEEL_ORDER;
    window.WHEEL_INDEX = WHEEL_INDEX;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        WHEEL_ORDER, WHEEL_INDEX, TERMINALS_MAP,
        analyzeSpin, projectNextRound, computeDealerSignature, getIAMasterSignals, 
        predictZonePattern, analyzeTravelWave, analyzeMasterConfluence,
        getDistance
    };
}

/**
 * MASTER CONFLUENCE AI â€” V4 (Rhythm Dominance)
 */
function analyzeMasterConfluence(history, travelView, zoneView, sectorStats = {}) {
    if (history.length < 10) return { signal: 'SYNCHRONIZING...', target: null, confidence: 0, reasons: 'Deep history required.' };

    const travels = [];
    for (let i = 1; i < history.length; i++) travels.push(getDistance(history[i-1], history[i]));
    
    // 1. RHYTHM DETECTOR (Improved V4)
    const getPattern = (arr, len) => arr.slice(-len).map(v => v >= 0 ? 'R' : 'L').join('');
    
    let rhythmPredict = null;
    let rhythmLabel = null;

    // A. Detect Local Block Periodicity (Mirroring/Oscillation)
    // Check for 2-2-2 (RRLLRRLL)
    const d8 = getPattern(travels, 8);
    if (d8 === 'RRLLRRLL') { rhythmPredict = 'CCW'; rhythmLabel = 'ðŸ”„ PATRÃ“N 2-2 CLARO'; }
    else if (d8 === 'LLRRLLRR') { rhythmPredict = 'CW'; rhythmLabel = 'ðŸ”„ PATRÃ“N 2-2 CLARO'; }
    
    // Check for 1-1-1 (RLRLRLRL)
    const d6 = getPattern(travels, 6);
    if (!rhythmPredict) {
        if (d6 === 'RLRLRL') { rhythmPredict = 'CCW'; rhythmLabel = 'ðŸ”„ ZIGZAG PERFECTO'; }
        else if (d6 === 'LRLRLR') { rhythmPredict = 'CW'; rhythmLabel = 'ðŸ”„ ZIGZAG PERFECTO'; }
    }

    // B. Detect "Room to Run" (Continuation of solid blocks)
    const d4 = getPattern(travels, 4);
    if (!rhythmPredict) {
        if (d4 === 'RRRR') { rhythmPredict = 'CW'; rhythmLabel = 'ðŸ”¥ RACHA ALCISTA'; }
        else if (d4 === 'LLLL') { rhythmPredict = 'CCW'; rhythmLabel = 'ðŸ”¥ RACHA BAJISTA'; }
    }

    // C. Historical Fallback (Original method)
    if (!rhythmPredict) {
        const last3 = getPattern(travels, 3);
        const searchArea = travels.slice(-60, -3);
        for (let i = 0; i < searchArea.length - 4; i++) {
            const past3 = getPattern(searchArea.slice(i, i + 3), 3);
            if (past3 === last3) {
                rhythmPredict = (travels[searchArea.length - 60 + i + 3] >= 0 ? 'CW' : 'CCW');
                rhythmLabel = 'ðŸ”„ RITMO HISTÃ“RICO';
                break;
            }
        }
    }

    // 2. SCORING ENGINE (V4 Weighting)
    let scoreCW  = 0;
    let scoreCCW = 0;
    let reasons = [];

    // Factor A: Rhythm Pattern (HIGH PRIORITY V4: +3.5)
    if (rhythmPredict === 'CW') { scoreCW += 3.5; reasons.push(rhythmLabel); }
    if (rhythmPredict === 'CCW') { scoreCCW += 3.5; reasons.push(rhythmLabel); }

    // Factor B: Travel Chart (+2.0)
    if (travelView.targetDir === 'CW') scoreCW += 2;
    if (travelView.targetDir === 'CCW') scoreCCW += 2;
    // V5: Las rupturas son raras en ruleta â€” peso mÃ­nimo (+0.3 en vez de +1)
    if (travelView.signal.includes('RUPTURA')) {
        if (travelView.targetDir === 'CW') scoreCW += 0.3;
        else if (travelView.targetDir === 'CCW') scoreCCW += 0.3;
    }
    // V5: La INERCIA del dealer pesa mÃ¡s (+1.5 extra)
    if (travelView.signal.includes('INERCIA')) {
        if (travelView.targetDir === 'CW') scoreCW += 1.5;
        else if (travelView.targetDir === 'CCW') scoreCCW += 1.5;
    }

    // Factor C: Zone Sniper (+1.0)
    if (zoneView.direction === 'CW') scoreCW += 1;
    if (zoneView.direction === 'CCW') scoreCCW += 1;

    // Result compilation
    const diff = Math.abs(scoreCW - scoreCCW);
    const confidence = Math.min(98, Math.round((diff / 7.5) * 100)); // Adjusted denominator
    
    let finalTarget = null;
    let signal = 'WAITING FOR CONFLUENCE...';
    
    // Aggressive Confidence in V4 (starts at 70%)
    if (confidence >= 70) {
        finalTarget = scoreCW > scoreCCW ? 'CW' : 'CCW';
        signal = finalTarget === 'CW' ? 'ðŸŽ¯ SNIPER MASTER: CW' : 'ðŸŽ¯ SNIPER MASTER: CCW';
    }

    return {
        signal,
        target: finalTarget,
        confidence,
        reasons: reasons.length ? reasons.slice(0, 2).join(' + ') : 'Analizando flujos...',
        type: finalTarget === 'CW' ? 'bullish' : (finalTarget === 'CCW' ? 'bearish' : 'neutral')
    };
}
