// ============================================================
// predictor.js — Port of predictor.py logic to JavaScript
// ============================================================

const WHEEL_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const WHEEL_INDEX = {};
WHEEL_ORDER.forEach((n, i) => { WHEEL_INDEX[n] = i; });

const TERMINALS_MAP = {
    0: [0, 4, 6],
    1: [1, 8],
    2: [2, 7, 9],
    3: [3, 8],
    4: [4, 11],
    5: [5, 12, 10],
    6: [6, 11],
    7: [7, 14, 2],
    8: [8, 15, 13, 3, 1],
    9: [9, 14, 2],
    10: [10, 17, 5],
    11: [11, 18, 16, 6, 4],
    12: [12, 17, 5],
    13: [13, 20, 23],
    14: [14, 9, 21, 7, 19],
    15: [15, 8, 20],
    16: [16, 11],
    17: [17, 12, 24, 10, 22],
    18: [18, 11, 23],
    19: [19, 14, 26],
    20: [20, 13, 25, 15, 27],
    21: [21, 14, 26],
    22: [22, 17, 29],
    23: [23, 18, 30, 16, 28],
    24: [24, 17, 29],
    25: [25, 20, 32],
    26: [26, 19, 31, 33, 21],
    27: [27, 20, 32],
    28: [28, 23, 35],
    29: [29, 22, 34, 24, 36],
    30: [30, 23, 35],
    31: [31, 26],
    32: [32, 25, 27],
    33: [33, 26],
    34: [34, 29],
    35: [35, 28, 30],
    36: [36, 29],
};

const STRATEGIES = {
    '-': (a, b) => Math.abs(a - b),
    '+': (a, b) => a + b,
    '-,-1': (a, b) => Math.abs(a - b) - 1,
    '-,+1': (a, b) => Math.abs(a - b) + 1,
    '+,-1': (a, b) => (a + b) - 1,
    '+,+1': (a, b) => (a + b) + 1,
};

// StrategyStats class
class StrategyStats {
    constructor(windowSize = 12) {
        this.windowSize = windowSize;
        this.outcomes = [];
    }

    register(win) {
        this.outcomes.push(win);
        if (this.outcomes.length > this.windowSize) {
            this.outcomes.shift();
        }
    }

    get wins() {
        return this.outcomes.filter(x => x).length;
    }

    get losses() {
        return this.outcomes.filter(x => !x).length;
    }

    get attempts() {
        return this.outcomes.length;
    }

    get hitRate() {
        return this.attempts > 0 ? (this.wins / this.attempts * 100.0) : 0.0;
    }

    get currentWinStreak() {
        let c = 0;
        for (let i = this.outcomes.length - 1; i >= 0; i--) {
            if (this.outcomes[i]) c++;
            else break;
        }
        return c;
    }

    get currentLossStreak() {
        let c = 0;
        for (let i = this.outcomes.length - 1; i >= 0; i--) {
            if (!this.outcomes[i]) c++;
            else break;
        }
        return c;
    }

    get maxWinStreak() {
        let best = 0, run = 0;
        for (const v of this.outcomes) {
            if (v) { run++; best = Math.max(best, run); }
            else run = 0;
        }
        return best;
    }

    get maxLossStreak() {
        let best = 0, run = 0;
        for (const v of this.outcomes) {
            if (!v) { run++; best = Math.max(best, run); }
            else run = 0;
        }
        return best;
    }

    get recentPattern() {
        return this.outcomes.map(x => x ? 'W' : 'L').join('');
    }
}

// Helper functions
function mod37(n) {
    return ((n % 37) + 37) % 37;
}

function wheelNeighbors(number, n) {
    const idx = WHEEL_INDEX[number];
    const out = [];
    for (let step = 1; step <= n; step++) {
        out.push(WHEEL_ORDER[(idx + step) % 37]);
        out.push(WHEEL_ORDER[((idx - step) % 37 + 37) % 37]);
    }
    return out;
}

function wheelDistance(a, b) {
    const ia = WHEEL_INDEX[a];
    const ib = WHEEL_INDEX[b];
    const delta = Math.abs(ia - ib);
    return Math.min(delta, 37 - delta);
}

function getPhaseStreaks(phases) {
    const streaks = [];
    if (!phases.length) return streaks;
    let currentPhase = phases[0];
    let count = 1;
    for (let i = 1; i < phases.length; i++) {
        if (phases[i] === currentPhase) count++;
        else {
            streaks.push({ phase: currentPhase, count });
            currentPhase = phases[i];
            count = 1;
        }
    }
    streaks.push({ phase: currentPhase, count });
    return streaks;
}

function buildBetZone(mainTerminal, correlated) {
    const length = correlated.length;
    let tpN = 2, corN = 3;

    if (length <= 3) {
        tpN = 2; corN = 3;
    } else {
        tpN = 2; corN = 2;
    }

    const zone = new Set();
    
    // Anexa TP
    zone.add(mainTerminal);
    for (const nb of wheelNeighbors(mainTerminal, tpN)) zone.add(nb);
    
    // Anexa COR
    let hasCor = false;
    for (const n of correlated) {
        if (n === mainTerminal) continue;
        hasCor = true;
        zone.add(n);
        for (const nb of wheelNeighbors(n, corN)) zone.add(nb);
    }
    
    const ruleStr = hasCor ? `TP:N${tpN} COR:N${corN}` : `TP:N3`;
    if (!hasCor) {
        for (const nb of wheelNeighbors(mainTerminal, 3)) zone.add(nb);
        return { zone: [...zone].sort((a, b) => a - b), rule: 'TP:N3' };
    }

    return { zone: [...zone].sort((a, b) => a - b), rule: ruleStr };
}

function analyzeSpin(history, stats) {
    const prevA = history[history.length - 3];
    const prevB = history[history.length - 2];
    const real = history[history.length - 1];

    const results = [];

    for (const [name, fn] of Object.entries(STRATEGIES)) {
        const mainTerminal = mod37(fn(prevA, prevB));
        const correlated = TERMINALS_MAP[mainTerminal] || [mainTerminal];

        const { zone: betZone, rule: ruleUsed } = buildBetZone(mainTerminal, correlated);
        const win = betZone.includes(real);

        if (!stats[name]) stats[name] = new StrategyStats();
        const stat = stats[name];
        stat.register(win);

        const distMain = wheelDistance(real, mainTerminal);
        const distGroup = Math.min(...correlated.map(c => wheelDistance(real, c)));

        let hitVia;
        if (real === mainTerminal) hitVia = 'tp';
        else if (correlated.includes(real)) hitVia = 'cor';
        else if (betZone.includes(real)) hitVia = 'n';
        else hitVia = '-';

        results.push({
            strategy: name,
            basePrevA: prevA,
            basePrevB: prevB,
            mainTerminal,
            correlated,
            rule: ruleUsed,
            betZone,
            win,
            distMain,
            distGroupMin: distGroup,
            hitRate: stat.hitRate,
            streakWin: stat.currentWinStreak,
            streakLoss: stat.currentLossStreak,
            maxWinStreak: stat.maxWinStreak,
            maxLossStreak: stat.maxLossStreak,
            wins: stat.wins,
            losses: stat.losses,
            attempts: stat.attempts,
            recentPattern: stat.recentPattern,
            outcomes: [...stat.outcomes],
            hitVia,
        });
    }

    return results;
}

function pickRecommendation(results) {
    return [...results].sort((a, b) => {
        if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate;
        if (b.streakWin !== a.streakWin) return b.streakWin - a.streakWin;
        return a.distGroupMin - b.distGroupMin;
    })[0];
}

function pickRecommendationTop2(results) {
    let candidates = results.filter(r => r.win || r.distGroupMin <= 1);
    if (!candidates.length) candidates = [...results];
    return [...candidates].sort((a, b) => {
        const aw = a.win ? 1 : 0, bw = b.win ? 1 : 0;
        if (bw !== aw) return bw - aw;
        if (a.distGroupMin !== b.distGroupMin) return a.distGroupMin - b.distGroupMin;
        if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate;
        return b.streakWin - a.streakWin;
    }).slice(0, 2);
}

function projectNextRound(history, stats) {
    if (history.length < 2) return [];
    const a = history[history.length - 2];
    const b = history[history.length - 1];
    const out = [];

    for (const [name, fn] of Object.entries(STRATEGIES)) {
        const tp = mod37(fn(a, b));
        const cor = TERMINALS_MAP[tp] || [tp];
        const { zone: bz, rule } = buildBetZone(tp, cor);
        const st = stats[name] || new StrategyStats();
        out.push({
            strategy: name,
            tp,
            cor,
            rule,
            betZone: bz,
            hitRate: st.hitRate,
            streakWin: st.currentWinStreak,
            streakLoss: st.currentLossStreak,
            recentPattern: st.recentPattern,
        });
    }

    return [...out].sort((a, b) => {
        if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate;
        return b.streakWin - a.streakWin;
    }).slice(0, 2);
}

function computeDealerSignature(history) {
    if (history.length < 2) return { avgTravel: null, travelHistory: [], topOverZone: [], topUnderZone: [] };
    
    const travelHistory = [];
    for (let i = 1; i < history.length; i++) {
        const from = WHEEL_INDEX[history[i-1]];
        const to   = WHEEL_INDEX[history[i]];
        let dist = to - from;
        if (dist > 18) dist -= 37;
        if (dist < -18) dist += 37;
        travelHistory.push(dist);
    }
    
    const signedAvg = travelHistory.length > 0 
        ? travelHistory.reduce((a, b) => a + b, 0) / travelHistory.length 
        : 0;
    const avgTravel = Math.abs(signedAvg);
    
    // ── Current Trend Direction (Cinemática Reciente Avanzada) ──
    const dirs = travelHistory.map(t => Math.sign(t) || 1);
    const dirStreaks = getPhaseStreaks(dirs);

    let currentTrendDir = Math.sign(signedAvg) || 1;
    let directionState = 'unstable';

    if (dirs.length >= 6) {
        const recent6 = dirs.slice(-6);
        const posC = recent6.filter(d => d > 0).length;
        const negC = recent6.filter(d => d < 0).length;
        let domDir = posC > negC ? 1 : (negC > posC ? -1 : 0);
        
        // Detect weakening dir
        const posStreaks = dirStreaks.filter(s => s.phase === 1).map(s => s.count);
        const negStreaks = dirStreaks.filter(s => s.phase === -1).map(s => s.count);
        
        const lastPos = posStreaks.length > 0 ? posStreaks[posStreaks.length - 1] : 0;
        const prevPos = posStreaks.length > 1 ? posStreaks[posStreaks.length - 2] : 0;
        const lastNeg = negStreaks.length > 0 ? negStreaks[negStreaks.length - 1] : 0;
        const prevNeg = negStreaks.length > 1 ? negStreaks[negStreaks.length - 2] : 0;
        
        let dirWeakening = false;
        if (domDir === 1 && posStreaks.length >= 2 && lastPos < prevPos && dirs[dirs.length - 1] !== 1) {
            dirWeakening = true;
            domDir = -1; // trend Shift!
        } else if (domDir === -1 && negStreaks.length >= 2 && lastNeg < prevNeg && dirs[dirs.length - 1] !== -1) {
            dirWeakening = true;
            domDir = 1; // trend Shift!
        }
        
        currentTrendDir = domDir !== 0 ? domDir : (Math.sign(signedAvg) || 1);
        
        // State Check
        let altern = true;
        for (let i = 1; i < 4; i++) { 
            if (dirs.length > i && dirs[dirs.length - i] === dirs[dirs.length - 1 - i]) altern = false; 
        }
        if (dirs.length >= 4 && altern) {
            directionState = 'zigzag';
        } else if (dirWeakening) {
            directionState = 'debilitado';
        } else if (posC >= 4 || negC >= 4 || lastPos >= 3 || lastNeg >= 3) {
            directionState = 'stable';
        } else {
            directionState = 'unstable';
        }
    } else if (travelHistory.length >= 2) {
        currentTrendDir = Math.sign(travelHistory[travelHistory.length - 1]) || 1;
        directionState = dirs[dirs.length-1] === dirs[dirs.length-2] ? 'stable': 'unstable';
    }

    const baseDir = currentTrendDir;
    const lastNum = history[history.length - 1];
    const lastIdx = WHEEL_INDEX[lastNum];
    
    // Physical trend playing direction
    const lastDir = travelHistory.length > 0 ? Math.sign(travelHistory[travelHistory.length - 1]) : baseDir;
    const playingDir = directionState === 'zigzag' ? (-lastDir || 1) : Math.sign(baseDir);

    // ── Physical Matrix (Cinemática Vectorial Pro offsets) ──────────────
    const target1  = WHEEL_ORDER[(lastIdx + playingDir * 1 + 37) % 37];
    const target5  = WHEEL_ORDER[(lastIdx + playingDir * 5 + 37) % 37];
    const target10 = WHEEL_ORDER[(lastIdx + playingDir * 10 + 37) % 37];
    const target14 = WHEEL_ORDER[(lastIdx + playingDir * 14 + 37) % 37];
    const target19 = WHEEL_ORDER[(lastIdx + playingDir * 19 + 37) % 37];

    const smallNum = target5;
    const bigNum   = target14;

    // ── Recommended Play (Oportunidad por Fase) ─────────────────────────
    const phases = travelHistory.map(t => Math.abs(t) <= 9 ? 'S' : 'B');
    const phaseStreaks = getPhaseStreaks(phases);
    
    let recommendedPlay = null;
    let recNumber = null;
    let energyAlternating = false;
    let phaseStateText = 'MIDIENDO...';

    if (phaseStreaks.length >= 2) {
        const lastPhase = phases[phases.length - 1];
        
        const recentPhases = phases.slice(-6);
        let sScore = recentPhases.filter(p => p === 'S').length;
        let bScore = recentPhases.filter(p => p === 'B').length;
        let dominant = sScore > bScore ? 'S' : (bScore > sScore ? 'B' : null);

        const allS = phaseStreaks.filter(x => x.phase === 'S').map(x => x.count);
        const allB = phaseStreaks.filter(x => x.phase === 'B').map(x => x.count);
        
        // Un patrón se debilita cuando su streak actual fue cortado (cayó algo distinto) 
        // y ese ultimó streak completado es menor al anterior de su propio bando.
        const isS_Weakening = allS.length >= 2 && allS[allS.length - 1] < allS[allS.length - 2] && lastPhase !== 'S';
        const isB_Weakening = allB.length >= 2 && allB[allB.length - 1] < allB[allB.length - 2] && lastPhase !== 'B';
        
        if (dominant === 'S' && isS_Weakening) {
            recommendedPlay = 'BIG'; // S is weakening, flip B
            recNumber = target14;
            phaseStateText = 'SMALL DEBILITADO -> BIG';
        } else if (dominant === 'B' && isB_Weakening) {
            recommendedPlay = 'SMALL'; // B is weakening, flip S
            recNumber = target5;
            phaseStateText = 'BIG DEBILITADO -> SMALL';
        } else if (dominant === 'S') {
            recommendedPlay = 'SMALL';
            recNumber = target5;
            phaseStateText = 'SMALL DOMINANTE';
        } else if (dominant === 'B') {
            recommendedPlay = 'BIG';
            recNumber = target14;
            phaseStateText = 'BIG DOMINANTE';
        } else {
            recommendedPlay = 'HIBRIDO';
            recNumber = target10;
            phaseStateText = 'ZONAS NIVELADAS';
        }

        // Intercalation Override (ZigZag)
        if (phases.length >= 4) {
            const recent4 = phases.slice(-4);
            let altern = true;
            for (let i = 1; i < 4; i++) {
                if (recent4[i] === recent4[i-1]) { altern = false; break; }
            }
            if (altern) {
                energyAlternating = true;
                recommendedPlay = 'HIBRIDO'; // Neutralizamos el ataque
                recNumber = target10;
                phaseStateText = 'ZIG ZAG -> MODO PAUSA';
            }
        }
    } else if (travelHistory.length >= 1) {
        recommendedPlay = phases[phases.length - 1] === 'S' ? 'SMALL' : 'BIG';
        recNumber = recommendedPlay === 'SMALL' ? target5 : target14;
    } else {
        recommendedPlay = 'HIBRIDO';
        recNumber = target10;
        phaseStateText = 'Midiendo...';
    }

    // ── Last Hit Zone classification ─────────────────────────────
    let lastHitZone = null;
    let lastHitNum = null;
    if (travelHistory.length >= 1) {
        const lastDist = Math.abs(travelHistory[travelHistory.length - 1]);
        lastHitZone = lastDist <= 9 ? 'SMALL' : 'BIG';
        lastHitNum  = lastDist <= 9 ? smallNum : bigNum;
    }

    // ── Physical Matrix (Cinemática Vectorial Pro) ──────────────
    // 1. SOPORTE SMALL (Offset -1, 0, 1) -> Casilla 1 (Real dist 0-1)
    // 2. SMALL EXACTO (Casilla 5) -> Real dist 4
    // 3. HÍBRIDO (Casilla 10) -> Real dist 9
    // 4. BIG EXACTO (Casilla 14) -> Real dist 13
    // 5. SOPORTE BIG (Casilla 19) -> Real dist 18 (Polo Opuesto)

    // ── Pattern Analysis ─────────────────────────────────────────
    const recentPhases = travelHistory.slice(-4).map(t => Math.abs(t) <= 9 ? 'S' : 'B');
    let isRuptura = false;
    let isFuga = false;
    if (recentPhases.length === 4) {
        // Rule: S,S,S -> B (Ruptura detectada)
        if (recentPhases[0] === 'S' && recentPhases[1] === 'S' && recentPhases[2] === 'S' && recentPhases[3] === 'B') {
            isRuptura = true;
        }
        // Rule: Fuga (last 3 travels are increasing while stable)
        const last3Dist = travelHistory.slice(-3).map(Math.abs);
        if (directionState === 'stable' && last3Dist[2] > last3Dist[1] && last3Dist[1] > last3Dist[0]) {
            isFuga = true;
        }
    }

    return {
        avgTravel,
        signedAvg,
        currentTrendDir,
        travelHistory,
        playingDir,
        casilla1: target1,
        casilla5: target5,
        casilla10: target10,
        casilla14: target14,
        casilla19: target19,
        directionState,
        recommendedPlay,
        phaseStateText,
        recNumber,
        isRuptura,
        isFuga,
        energyAlternating,
        lastHitZone,
        lastHitNum
    };
}

function getIAMasterSignals(prox, sig, history) {
    if (!prox || prox.length < 2) return null;
    
    const signals = [];
    const isStable = sig.directionState === 'stable';
    const isChaos = sig.directionState === 'unstable' && sig.travelHistory.length >= 6;
    
    // 1. Detección de Caos (STOP)
    let finalRule = "CHARGING";
    let finalReason = "ANALIZANDO...";
    let finalConf = "75%";
    
    const isDirZigZag = sig.directionState === 'zigzag';
    
    // TOP NUMBER (MODO ESCUDO N9)
    let escudoTarget = sig.recommendedPlay === 'SMALL' ? sig.casilla1 : (sig.recommendedPlay === 'BIG' ? sig.casilla19 : sig.casilla10);
    
    if (sig.energyAlternating || isDirZigZag) {
        escudoTarget = sig.casilla10; 
        finalReason = "ZIG ZAG INESTABLE (CHOP) - RIESGO";
        finalRule = "STOP";
        finalConf = "0%";
    } else if (sig.isFuga || sig.recommendedPlay === 'HIBRIDO') {
        escudoTarget = sig.casilla10;
        finalReason = sig.isFuga ? "FUGA DETECTADA - BLOQUEO HÍBRIDO" : "DISTANCIA INCONSTANTE - HÍBRIDO";
        finalRule = "HÍBRIDO N9";
        finalConf = "88%";
    } else if (sig.isRuptura) {
        escudoTarget = sig.casilla19;
        finalReason = "RUPTURA DETECTADA - POLO BIG";
        finalRule = "SOPORTE BIG N9";
        finalConf = "91%";
    } else {
        finalRule = sig.recommendedPlay === 'SMALL' ? "SOPORTE SMALL N9" : "SOPORTE BIG N9";
        finalReason = isStable ? "BLOQUEO PREVENTIVO" : "DIR. INEXACTA - BLOQUEO TOTAL";
        finalConf = isStable ? "88%" : "85%";
    }

    if (isChaos && !isStable) {
        finalRule = "STOP";
        finalReason = "CAOS DETECTADO - PAUSA";
        finalConf = "0%";
    }

    // JUGADA EXACTA (MODO ATAQUE N4)
    let lanzaTarget = sig.recommendedPlay === 'SMALL' ? sig.casilla5 : (sig.recommendedPlay === 'BIG' ? sig.casilla14 : sig.casilla10);

    // Agent 1: FISICA STUDIO (Physical Matrix - TOP NUMBER N9)
    signals.push({
        name: 'FISICA STUDIO',
        number: escudoTarget,
        small: sig.casilla5,
        big: sig.casilla14,
        confidence: finalConf,
        reason: finalReason,
        rule: finalRule,
        mode: 'ESCUDO', // Siempre N9
        lanzaTarget: lanzaTarget, // Para la recomendación abajo
        recPlay: sig.recommendedPlay, // Exponer decision
        energyAlternating: sig.energyAlternating
    });

    // Agent 2: SIX STRATEGIE (Mathematical Momentum)
    const bestStrat = getBestMathematicalStrategy(prox);
    signals.push({
        name: 'SIX STRATEGIE',
        strategy: bestStrat.strategy,
        tp: bestStrat.tp,
        cor: bestStrat.cor,
        betZone: bestStrat.betZone, // IMPORTANT for tracking N
        confidence: bestStrat.momentum > 0 ? "92%" : "85%",
        reason: "MOMENTUM MATEMÁTICO",
        rule: bestStrat.rule,
        mode: 'MATH',
        streakWin: bestStrat.streakWin,
        streakLoss: bestStrat.streakLoss
    });

    // Agent 3: COMBINATION -> ANDROIDE PERFECTO (Physical + Zone Hybrid)
    let androidRule = "PROCESANDO MATRIZ...";
    let androidConf = "0%";
    let androidReason = "ESPERANDO CORTES LIMPIOS";
    let androidMode = 'NEUTRAL';
    let androidTarget = sig.casilla10; 
    let androidTargetZone = sig.recommendedPlay;
    
    const isDebilitado = sig.phaseStateText.includes('DEBILITADO');
    const isDominante = sig.phaseStateText.includes('DOMINANTE');
    
    // 1. ZIG-ZAG & INTERCALATION (Read physical flips and predict the next step)
    if (isDirZigZag || sig.energyAlternating) {
        const nextZone = (sig.lastHitZone === 'SMALL') ? 'BIG' : (sig.lastHitZone === 'BIG' ? 'SMALL' : sig.recommendedPlay);
        androidTargetZone = nextZone;
        androidTarget = nextZone === 'SMALL' ? sig.casilla5 : sig.casilla14;
        androidConf = isDirZigZag && sig.energyAlternating ? "94%" : "89%";
        androidRule = "INTERCALACIÓN MÁSTER";
        androidReason = "ANTICIPACIÓN ZIG-ZAG CONFIRMADA";
        androidMode = 'ATAQUE_ZONA';
    }
    // 2. CLEAVAGE / BREAK (Debilitado) -> SNIPER
    else if (!isChaos && isDebilitado) {
        androidConf = "96%"; 
        androidRule = "RUPTURA DIRECCIONAL N4";
        androidReason = "CAMBIO DE FASE FÍSICA INMINENTE";
        androidMode = 'ATAQUE_ZONA';
        androidTarget = sig.recommendedPlay === 'SMALL' ? sig.casilla5 : sig.casilla14;
    }
    // 3. STABLE DOMINANCE
    else if (!isChaos && isDominante) {
        androidConf = "87%";
        androidRule = "FLUJO FÍSICO ESTABLE";
        androidReason = "ALINEACIÓN ZONA-VECTORES";
        androidMode = 'ATAQUE_ZONA';
        androidTarget = sig.recommendedPlay === 'SMALL' ? sig.casilla5 : sig.casilla14;
    }
    // 4. CHAOS CONTROL 
    else if (isChaos) {
        // In complete chaos, Android falls back to the absolute physical Top Number anchor (N9 shield)
        androidTarget = sig.recommendedPlay === 'SMALL' ? sig.casilla1 : sig.casilla19;
        androidConf = "84%";
        androidRule = "CAOS CONTROL - TOP NUMBER N9";
        androidReason = "RESETEO A FIRMA FÍSICA ANCLA";
        androidMode = 'TOP_NUMBER';
    }

    signals.push({
        name: 'COMBINATION',
        number: androidTarget,
        small: sig.casilla5,
        big: sig.casilla14,
        confidence: androidConf,
        reason: androidReason,
        rule: androidRule,
        mode: androidMode,
        targetZone: androidTargetZone
    });

    // Agent 4: SOPORTE CLÁSICO (Top Number + Zone Sides, no Híbrido)
    let soporteNum = sig.recommendedPlay === 'SMALL' ? sig.casilla1 : sig.casilla19;
    let soporteMode = sig.recommendedPlay === 'SMALL' ? 'SOPORTE_SMALL' : 'SOPORTE_BIG';
    let soporteRule = sig.recommendedPlay === 'SMALL' ? 'SOPORTE SMALL N9' : 'SOPORTE BIG N9';
    let soporteConf = '80%';
    let soporteReason = 'LECTURA DE ZONA';

    // Zone intercalation read: if energyAlternating or chaos, use SOPORTE BIG (wider safety)
    if (sig.energyAlternating || isDirZigZag || isChaos) {
        soporteNum = sig.casilla19;
        soporteMode = 'SOPORTE_BIG';
        soporteRule = 'SOPORTE BIG N9';
        soporteConf = '0%';
        soporteReason = 'ZONA INESTABLE - PAUSA';
    } else if (sig.directionState === 'stable') {
        soporteConf = isDebilitado ? '91%' : '86%';
        soporteReason = isDebilitado ? 'RUPTURA DE ZONA DETECTADA' : 'ZONA DOMINANTE CONFIRMADA';
    } else if (sig.directionState === 'debilitado') {
        soporteConf = '88%';
        soporteReason = 'DIRECCIÓN DEBILITADA → INTERCEPCIÓN';
    }

    signals.push({
        name: 'SOPORTE PRO',
        number: soporteNum,
        small: sig.casilla5,
        big: sig.casilla14,
        casilla1: sig.casilla1,
        casilla19: sig.casilla19,
        confidence: soporteConf,
        reason: soporteReason,
        rule: soporteRule,
        mode: soporteMode,
        targetZone: sig.recommendedPlay
    });

    return signals;
}

function getBestMathematicalStrategy(prox) {
    let best = prox[0];
    let maxMomentum = -Infinity;
    
    for (const p of prox) {
        let momentum = 0;
        const pat = p.recentPattern || "";
        const len = pat.length;
        
        const winStreaks = pat.split('L').filter(s => s.length > 0).map(s => s.length);
        
        // SIX STRATEGIE: Analyze Weakening Pattern (Drop in momentum size)
        if (winStreaks.length >= 2) {
            const lastW = winStreaks[winStreaks.length - 1];
            const prevW = winStreaks[winStreaks.length - 2];
            if (lastW < prevW && !pat.endsWith('W'.repeat(lastW + 1))) {
                momentum -= 4; // Harsh penalty: Pattern is dying
            }
            if (lastW > prevW) momentum += 3; // Strengthening
        }
        
        if (p.streakWin >= 2) momentum += 3;
        else if (pat.endsWith('W')) momentum += 1;
        
        if (p.streakLoss >= 2) momentum -= 4;
        if (pat.endsWith('LL')) momentum -= 2;
        
        // Target exact Guide Pattern: 'WWLW' (Hot Table - single resistant loss)
        if (pat.endsWith('WLW') || pat.endsWith('WWLW') || pat.endsWith('WWWLW')) momentum += 4;
        
        if (momentum > maxMomentum) {
            maxMomentum = momentum;
            best = { ...p, momentum };
        }
    }
    
    // Si la lectura determina que la racha del patrón simplemente colapsó y no hay opciones viables
    if (maxMomentum < -1) {
        best.rule = 'PAUSA (DEBILITAMIENTO)';
        best.confidence = "15%";
        best.mode = 'DEBILITADO';
    }
    
    return best;
}


