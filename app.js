// Version bump 20240421

// app.js Ã¢ÂÂ SHADOW ROULETTE UI ENGINE
// ============================================================

let mongoStatusPoll = null;
let mongoReconnectBusy = false;
let mongoPreviouslyConnected = null;

function renderMongoConnectionStatus(status) {
    const banner = document.getElementById('mongo-connection-alert');
    const message = document.getElementById('mongo-connection-message');
    if (!banner) return;
    banner.style.display = status?.connected ? 'none' : 'flex';
    if (message && !status?.connected) {
        message.textContent = status?.error || 'MongoDB Atlas desconectado. Los datos y análisis están pausados.';
    }
}

async function checkMongoConnection() {
    try {
        const response = await fetch('/api/db/status', { cache: 'no-store' });
        const status = await response.json();
        renderMongoConnectionStatus(status);
        if (!status.connected && typeof pauseTrackerForMongo === 'function') pauseTrackerForMongo();
        if (status.connected && mongoPreviouslyConnected === false && typeof loadTrackerAiMemory === 'function') {
            loadTrackerAiMemory();
            if (typeof loadTrackerBankSessions === 'function') loadTrackerBankSessions();
        }
        mongoPreviouslyConnected = Boolean(status.connected);
        return status;
    } catch (error) {
        renderMongoConnectionStatus({ error: 'No se puede contactar al servidor para verificar MongoDB.' });
        return { connected: false };
    }
}

async function reconnectMongo() {
    if (mongoReconnectBusy) return;
    mongoReconnectBusy = true;
    const button = document.getElementById('mongo-reconnect-button');
    if (button) { button.disabled = true; button.textContent = 'Conectando...'; }
    const message = document.getElementById('mongo-connection-message');
    if (message) message.textContent = 'Intentando reconectar con MongoDB Atlas...';
    try {
        const response = await fetch('/api/db/reconnect', { method: 'POST' });
        const status = await response.json();
        renderMongoConnectionStatus(status);
        if (status.connected) {
            if (message) message.textContent = 'MongoDB Atlas conectado. Actualizando datos...';
            setTimeout(() => window.location.reload(), 700);
        }
    } catch (error) {
        renderMongoConnectionStatus({ error: 'Falló la reconexión. Comprueba la configuración de MongoDB Atlas y vuelve a intentarlo.' });
    } finally {
        mongoReconnectBusy = false;
        if (button) { button.disabled = false; button.textContent = 'Reconectar'; }
    }
}

window.reconnectMongo = reconnectMongo;
document.addEventListener('DOMContentLoaded', () => {
    checkMongoConnection();
    mongoStatusPoll = setInterval(checkMongoConnection, 10000);
});

const history = [];
const processedLiveSpinIds = new Set();
const cwHistory = [];
const ccwHistory = [];
const cwN4History = [];
const ccwN4History = [];

// Pattern Matching variables
const patternMemory = []; // Almacena patrones históricos extraídos (dir+mag)
const patternSession = []; // Spins de la sesión actual
const dirOnlyMemory = []; // Patrones solo de dirección R/L (más fáciles de matchear)
const dirOnlySession = []; // Sesión actual solo-dir
const evalTimestamps = []; // Timestamps reales de cada evaluación (para línea de tiempo)
let patternLastSeq = null; // Última secuencia detectada
let patternStats = { matches: 0, hits: 0, total: 0 }; // Estadísticas
const macroPatterns = []; // Patrones macro: turbulencia, dominancia, zigzag, ola, etc.
let lastAiPredN9 = null;
let lastAiPredN4 = null;
let lastAiPredMode = 'SAFE';
let aiStatsSafe = { n9: {wins:0,losses:0,total:0,rate:0}, n4: {wins:0,losses:0,total:0,rate:0} };
let aiStatsFull = { n9: {wins:0,losses:0,total:0,rate:0}, n4: {wins:0,losses:0,total:0,rate:0} };
let aiHistSafe = { n9: [], n4: [] };
let aiHistFull = { n9: [], n4: [] };
const aiN9History = [];
const aiN4History = [];
let aiN9Stats = { wins: 0, losses: 0, total: 0, rate: 0 };
let aiN4Stats = { wins: 0, losses: 0, total: 0, rate: 0 };

// === META-PATRONES (W/L Tracking) ===
const sniperWLHistory = []; // Track de aciertos/fallos del Sniper: [{pred: 'CW', result: 'W', number: 14}, ...]
let lastSniperPred = null; // Última predicción del Sniper para evaluar
const MAX_WL_HISTORY = 20; // Mantener últimos 20 resultados
const pendingMetaPatterns = []; // Meta-patrones pendientes de resolución (con IDs de DB)

// === V2 W/L TRACKING ===
const analystV2History = []; // Historial de aciertos V2
const sniperV2History = []; // Historial de aciertos V2
let lastAnalystV2Dir = null; // Última dirección del Analyst V2
let lastSniperV2Dir = null; // Última dirección del Sniper V2

// Eliminar completamente AUTO - usar solo Sniper y Analyst
// window.currentAIMode = 'SAFE';
// AUTO ELIMINADO - toggleAIMode comentado
// window.toggleAIMode = function() {
//     const btn = document.getElementById('btn-ai-mode');
//     const note = document.getElementById('auto-ai-mode-note');
//     if (window.currentAIMode === 'SAFE') {
//         window.currentAIMode = 'FULL';
//         if(btn) { btn.innerText = 'FULL ACTIVO'; btn.style.background = 'rgba(255,100,100,0.15)'; btn.style.color = '#f55'; btn.style.borderColor = '#f55'; }
//         if(note) note.innerText = 'FULL: siempre propone una jugada, incluso si la ventaja es corta o la mesa esta mixta.';
//     } else {
//         window.currentAIMode = 'SAFE';
//         if(btn) { btn.innerText = 'SAFE FILTRA'; btn.style.background = 'rgba(240,192,64,0.15)'; btn.style.color = '#f0c040'; btn.style.borderColor = '#f0c040'; }
let lastSignal  = null;
let currentTableId = null;

let lastOverHitCW  = false;
let lastUnderHitCW = false;
let lastOverHitCCW = false;
let lastUnderHitCCW = false;

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ZONE STATE Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
const zoneOverHistory = [];   
const zoneUnderHistory = [];
let lastZoneOverHit   = false;
let lastZoneUnderHit = false;

// Dynamic Reference Lines
let currentAvgCW = 9;
let currentAvgCCW = -9;
let predictorOffset = 0; // CALIBRACION MANUAL DEL PREDICTOR (+/- casillas)
let manualAvgOffset = 0; // CALIBRACION MANUAL DEL TRAVEL CHART

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ JUGADAS STATE Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
let jugView = { magnitude: 'UNDER', direction: 'CW', confidence: 0 };
const jugHistory = [];
let lastJugHit = false;
let patternStatsCache = null;

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ANALYST STATE (V26) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
const analystHistory = [];
let analystView = { signal: 'ANALIZANDO...', targetDir: null, size: null, reason: '-', type: 'neutral' };
let lastAnalystHit = false;

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ MASTER SNIPER STATE (CONFLUENCE) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
const masterHistory = [];
let masterView = { signal: 'SYNCHRONIZING...', target: null, confidence: 0, reasons: '-', type: 'neutral' };
let lastMasterHit = false;

// ===== LOCALSTORAGE PERSISTENCE (24/7 DATA SURVIVAL) =====
function getLSKey(tableId) {
    return 'clasi_roulette_session_' + (tableId || 'default');
}

function saveSessionToLocalStorage() {
    return;
    try {
        const state = {
            tableId: currentTableId,
            history: history.slice(),
            cwHistory: cwHistory.slice(),
            ccwHistory: ccwHistory.slice(),
            cwN4History: cwN4History.slice(),
            ccwN4History: ccwN4History.slice(),
            zoneOverHistory: zoneOverHistory.slice(),
            zoneUnderHistory: zoneUnderHistory.slice(),
            jugHistory: jugHistory.slice(),
            analystHistory: analystHistory.slice(),
            masterHistory: masterHistory.slice(),
            analystV2History: analystV2History.slice(),
            sniperV2History: sniperV2History.slice(),
            sniperWLHistory: sniperWLHistory.slice(),
            metricaScoresHistory: metricaScoresHistory,
            metricaLastScores: metricaLastScores,
            metricaHitCounts: metricaHitCounts,
            travelPatternHistory: travelPatternHistory.slice(),
            patternMemory: patternMemory.slice(),
            patternSession: patternSession.slice(),
            dirOnlyMemory: dirOnlyMemory.slice(),
            dirOnlySession: dirOnlySession.slice(),
            macroPatterns: macroPatterns.slice(),
            macroTransitions: macroTransitions.slice(),
            macroCurrentState: macroCurrentState,
            macroStateStartIdx: macroStateStartIdx,
            evalTimestamps: evalTimestamps.slice(),
            pendingMetaPatterns: pendingMetaPatterns.slice(),
            predictorOffset: predictorOffset,
            savedAt: Date.now()
        };
        localStorage.setItem(getLSKey(currentTableId), JSON.stringify(state));
    } catch(e) { /* quota exceeded or localStorage disabled */ }
}

function loadSessionFromLocalStorage(tableIdOverride) {
    return false;
    try {
        const tid = tableIdOverride || currentTableId;
        const raw = localStorage.getItem(getLSKey(tid));
        if (!raw) return false;
        const state = JSON.parse(raw);
        if (!state || !state.history || !Array.isArray(state.history) || state.history.length === 0) return false;

        if (state.tableId) currentTableId = state.tableId;
        history.length = 0; cwHistory.length = 0; ccwHistory.length = 0;
        cwN4History.length = 0; ccwN4History.length = 0;
        zoneOverHistory.length = 0; zoneUnderHistory.length = 0;
        jugHistory.length = 0; analystHistory.length = 0; masterHistory.length = 0;
        analystV2History.length = 0; sniperV2History.length = 0;
        sniperWLHistory.length = 0; travelPatternHistory.length = 0;
        patternMemory.length = 0; patternSession.length = 0;
        dirOnlyMemory.length = 0; dirOnlySession.length = 0;
        macroPatterns.length = 0;
        macroTransitions.length = 0;
        macroCurrentState = null;
        macroStateStartIdx = 0;
        evalTimestamps.length = 0;
        pendingMetaPatterns.length = 0;

        history.push(...(state.history || []));
        cwHistory.push(...(state.cwHistory || []));
        ccwHistory.push(...(state.ccwHistory || []));
        cwN4History.push(...(state.cwN4History || []));
        ccwN4History.push(...(state.ccwN4History || []));
        zoneOverHistory.push(...(state.zoneOverHistory || []));
        zoneUnderHistory.push(...(state.zoneUnderHistory || []));
        jugHistory.push(...(state.jugHistory || []));
        analystHistory.push(...(state.analystHistory || []));
        masterHistory.push(...(state.masterHistory || []));
        analystV2History.push(...(state.analystV2History || []));
        sniperV2History.push(...(state.sniperV2History || []));
        sniperWLHistory.push(...(state.sniperWLHistory || []));
        if (state.metricaScoresHistory) { for (const k in metricaScoresHistory) delete metricaScoresHistory[k]; Object.assign(metricaScoresHistory, state.metricaScoresHistory); }
        if (state.metricaLastScores) { metricaLastScores = {}; Object.assign(metricaLastScores, state.metricaLastScores); }
        if (state.metricaHitCounts) { for (const k in metricaHitCounts) delete metricaHitCounts[k]; Object.assign(metricaHitCounts, state.metricaHitCounts); }
        travelPatternHistory.push(...(state.travelPatternHistory || []));
        patternMemory.push(...(state.patternMemory || []));
        patternSession.push(...(state.patternSession || []));
        dirOnlyMemory.push(...(state.dirOnlyMemory || []));
        dirOnlySession.push(...(state.dirOnlySession || []));
        // Clean up sequences with < 5 occurrences (only true patterns survive)
        for (let i = patternMemory.length - 1; i >= 0; i--) {
            if ((patternMemory[i].outcomes?.total || 0) < 5) patternMemory.splice(i, 1);
        }
        for (let i = dirOnlyMemory.length - 1; i >= 0; i--) {
            if ((dirOnlyMemory[i].outcomes?.total || 0) < 5) dirOnlyMemory.splice(i, 1);
        }
        macroPatterns.length = 0; macroPatterns.push(...(state.macroPatterns || []));
        macroTransitions.length = 0; macroTransitions.push(...(state.macroTransitions || []));
        macroCurrentState = state.macroCurrentState || null;
        macroStateStartIdx = state.macroStateStartIdx || 0;
        evalTimestamps.push(...(state.evalTimestamps || []));
        pendingMetaPatterns.push(...(state.pendingMetaPatterns || []));
        if (state.predictorOffset !== undefined) predictorOffset = state.predictorOffset;
        return true;
    } catch(e) { return false; }
}

function clearSessionStorage(tableId) {
    try { localStorage.removeItem(getLSKey(tableId)); } catch(e) {}
}

function clearAllLocalStorage() {
    try {
        const keys = Object.keys(localStorage);
        keys.forEach(k => {
            if (k.startsWith('clasi_roulette_')) localStorage.removeItem(k);
        });
    } catch(e) {}
}

// Pattern memory fetcher
async function fetchPatternMemory(historyArr) {
    if (historyArr.length < 5) return;
    
    const tableIdInput = document.getElementById('table-select');
    let tableId = 1;
    if (tableIdInput && tableIdInput.value) tableId = tableIdInput.value;
    
    // We need the sequence of 4 jumps (5 numbers)
    const last5 = historyArr.slice(-5);
    let seqMag = '';
    let seqDir = '';
    
    for (let i = 1; i < last5.length; i++) {
        const d = calcDist(last5[i-1], last5[i]);
        seqMag += Math.abs(d) >= 10 ? 'B' : 'S';
        seqDir += d >= 0 ? 'CW' : 'CCW';
    }
    
    try {
        const res = await fetch(`/api/patterns/${tableId}?seq_mag=${seqMag}&seq_dir=${seqDir}`);
        const data = await res.json();
        patternStatsCache = data;
        
        // Re-evaluate Sniper with new data
        if (typeof predictZonePattern === 'function') {
            jugView = predictZonePattern(historyArr, patternStatsCache);
            renderShadowPanel();
        }
    } catch (e) {
        console.error('Pattern fetch failed', e);
    }
}

const RED_NUMS  = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const WHEEL_NUMS = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];

function calcDist(from, to) {
    const i1 = WHEEL_NUMS.indexOf(from);
    const i2 = WHEEL_NUMS.indexOf(to);
    if (i1 === -1 || i2 === -1) return 0;
    let d = i2 - i1;
    if (d > 18) d -= 37;
    if (d < -18) d += 37;
    return d;
}


// HELPERS: WHEEL NEIGHBORS
const RED_NUMS_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function numColorClass(n) { return n===0?'fn-zero':(RED_NUMS_SET.has(n)?'fn-red':'fn-black'); }
function getNeighbors(target, radius) {
    const idx = WHEEL_NUMS.indexOf(target);
    if (idx === -1) return [];
    const out = [];
    for (let i = -radius; i <= radius; i++) out.push(WHEEL_NUMS[(idx+i+37)%37]);
    return out;
}
function getFilteredNeighborsHTML(target, radius) {
    if (target===undefined||target===null||target==='--') return '';
    const all = getNeighbors(Number(target), radius);
    return all
        .map(n => `<span class="fn-ball ${numColorClass(n)}">${n}</span>`)
        .join('');
}
function renderShadowPanelNeighborsOnly() {
    try {
        if (lastSignal) {
            document.getElementById('dir-cw-c-balls').innerHTML  = getFilteredNeighborsHTML(lastSignal.targetCW, 9);
            document.getElementById('dir-cw-l-balls').innerHTML  = getFilteredNeighborsHTML(lastSignal.targetUnderCW, 4);
            document.getElementById('dir-cw-r-balls').innerHTML  = getFilteredNeighborsHTML(lastSignal.targetOverCW, 4);
            document.getElementById('dir-ccw-c-balls').innerHTML = getFilteredNeighborsHTML(lastSignal.targetCCW, 9);
            document.getElementById('dir-ccw-l-balls').innerHTML = getFilteredNeighborsHTML(lastSignal.targetUnderCCW, 4);
            document.getElementById('dir-ccw-r-balls').innerHTML = getFilteredNeighborsHTML(lastSignal.targetOverCCW, 4);
        }
        if (history.length >= 2) {
            const idx = WHEEL_NUMS.indexOf(history[history.length-1]);
            const sT = WHEEL_NUMS[(idx+1+37)%37], bT = WHEEL_NUMS[(idx+19+37)%37];
            const sEl = document.getElementById('sup-s-c-balls');
            const bEl = document.getElementById('sup-b-c-balls');
            if (sEl) sEl.innerHTML = getFilteredNeighborsHTML(sT, 9);
            if (bEl) bEl.innerHTML = getFilteredNeighborsHTML(bT, 9);
        }
    } catch(e) { console.error('neighborsOnly:', e); }
}
function wipeData() {
    if (!confirm('\u{26A0}\u{FE0F} WIPE TOTAL?\n\nEsto borra: DB del servidor + localStorage + TODA la memoria.\nLos patrones aprendidos se perderán.\n\nTodos los dispositivos conectados se limpiarán.')) return;

    // Limpieza local
    localWipe();

    // Limpiar servidor (fire and forget) — el servidor broadcast a todos los dispositivos
    fetch('/api/wipe-all', { method: 'DELETE' })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
            console.log('[WIPE] Servidor limpiado. Gen:', data.wipeGeneration);
            if (data.wipeGeneration) {
                localStorage.setItem('clasi_roulette_wipe_gen', String(data.wipeGeneration));
            }
        })
        .catch(() => console.log('[WIPE] Servidor no disponible, solo limpieza local.'));

    alert('\u{2705} WIPE completado.\nTodos los dispositivos conectados han sido limpiados.');
}

// Wipe local sin confirmación (usado por SSE remote wipe)
function localWipe() {
    if (typeof isWiping !== 'undefined' && isWiping) return;
    try {
        history.length=0; cwHistory.length=0; ccwHistory.length=0;
        cwN4History.length=0; ccwN4History.length=0;
        aiN9History.length=0; aiN4History.length=0;
        aiN9Stats = { wins: 0, losses: 0, total: 0, rate: 0 };
        aiN4Stats = { wins: 0, losses: 0, total: 0, rate: 0 };
        aiStatsSafe = { n9: {wins:0,losses:0,total:0,rate:0}, n4: {wins:0,losses:0,total:0,rate:0} };
        aiStatsFull = { n9: {wins:0,losses:0,total:0,rate:0}, n4: {wins:0,losses:0,total:0,rate:0} };
        aiHistSafe = { n9: [], n4: [] };
        aiHistFull = { n9: [], n4: [] };
        lastAiPredN9 = null; lastAiPredN4 = null;
        zoneOverHistory.length=0; zoneUnderHistory.length=0;
        jugHistory.length=0; analystHistory.length=0; masterHistory.length=0;
        analystV2History.length=0; sniperV2History.length=0;
        sniperWLHistory.length=0; travelPatternHistory.length=0;
        patternMemory.length=0; patternSession.length=0;
        dirOnlyMemory.length=0; dirOnlySession.length=0;
        macroPatterns.length=0;
        macroTransitions.length=0;
        macroCurrentState = null;
        macroStateStartIdx = 0;
        evalTimestamps.length=0;
        pendingMetaPatterns.length=0;
        for (const k in metricaScoresHistory) delete metricaScoresHistory[k];
        metricaLastScores = {};
        for (const k in metricaHitCounts) delete metricaHitCounts[k];
        lastSignal=null; lastMasterHit=false; lastAnalystHit=false; lastJugHit=false;
        masterView = { signal: 'SYNCHRONIZING...', target: null, confidence: 0, reasons: '-', type: 'neutral' };
        analystView = { signal: 'ANALIZANDO...', targetDir: null, size: null, reason: '-', type: 'neutral' };
        jugView = null; patternStatsCache = null; patternLastSeq = null;
        lastAnalystV2Dir = null; lastSniperV2Dir = null;
        ['analyst-v2-signal','analyst-v2-dir','analyst-v2-size','analyst-v2-detail',
         'analyst-v2-rate','analyst-v2-perf','analyst-v2-pattern-boost',
         'sniper-v2-conf','sniper-v2-target','sniper-v2-reasons',
         'sniper-v2-rate','sniper-v2-perf','sniper-v2-rhythm','sniper-v2-patterns',
         'pattern-memory-count','pattern-session-count','pattern-current-seq',
         'panel-content','panel-status','dash-content',
         'analyst-perf-string','master-perf','master-rate','analyst-rate'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.innerText = id.includes('count') ? '0' : (id.includes('rate') ? '0%' : '--'); el.style.display = ''; }
        });
        const be = document.getElementById('analyst-v2-pattern-boost');
        if (be) be.style.display = 'none';
        clearAllLocalStorage();
        renderShadowPanel(); renderWheelAndHistory(); renderTravelPanel();
        renderAnalystUI(); renderMasterUI(); renderAgentDashboard();
        renderDashPatterns();
        // Sync wipe to Tracker
        if (typeof clearTrackerData === 'function') {
            clearTrackerData();
        }
        console.log('[localWipe] Datos locales, localStorage y UI limpiados por wipe remoto.');
    } catch(e) {
        console.error('[localWipe] Error:', e);
    }
}

function toggleAiHist(metricId, btn) {
    const panel = document.getElementById('ai-hist-' + metricId);
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    const opened = panel.style.display === 'block';
    if (btn) {
        btn.innerHTML = opened ? '&#9652;' : '&#9662;';
    }
}

function toggleDirMetricHistory(metricId, btn) {
    const panel = document.getElementById(`dir-${metricId}-hist-panel`);
    if (!panel) return;
    panel.classList.toggle('show');
    const opened = panel.classList.contains('show');
    if (btn) {
        const label = metricId.endsWith('n9') ? 'N9' : 'N4';
        btn.innerHTML = opened ? `${label} &#9652;` : `${label} &#9662;`;
        btn.setAttribute('aria-expanded', opened ? 'true' : 'false');
    }
}

function getPerfHtml(items, limit = 12) {
    const recent = items.filter(isResolvedAiOutcome).slice(-limit);
    if (!recent.length) return '<span style="opacity:0.5">Sin datos</span>';
    return recent.map(r => {
        return `<span class="${r==='win'?'perf-w':'perf-l'}">${r==='win'?'W':'L'}</span>`;
    }).join('');
}
function getAiModeStats(rows, metricKey) {
    const outcomes = rows
        .map(item => item[metricKey] || (isResolvedAiOutcome(item.result) ? item.result : null))
        .filter(isResolvedAiOutcome);
    const wins = outcomes.filter(item => item === 'win').length;
    const losses = outcomes.length - wins;
    const rate = outcomes.length ? Math.round((wins / outcomes.length) * 100) : 0;
    return { wins, losses, total: outcomes.length, records: outcomes.length, rate };
}
function getAiPerfHtml(items, stats, limit = 50) {
    const marks = getPerfHtml(items, limit);
    const summary = stats && stats.total > 0
        ? `<span style="margin-left:8px; color:var(--accent); font-weight:700;">${stats.rate}%</span><span style="margin-left:4px; color:var(--muted);">(${stats.wins}W/${stats.losses}L)</span>`
        : '<span style="margin-left:8px; color:var(--muted);">0%</span>';
    return marks + summary;
}

function getPerfText(items, limit = 8) {
    const recent = items.filter(isResolvedAiOutcome).slice(-limit);
    if (!recent.length) return 'Sin datos';
    return recent.map(r => r === 'win' ? 'W' : 'L').join('');
}

async function syncAiPredictionState() {
    if (!currentTableId) return;
    try {
        const mode = String(window.currentAIMode || 'SAFE').toUpperCase();
        const resp = await fetch(`/api/ai/predictions/${currentTableId}?limit=5000&mode=${mode}&basis=ai_analysis`);
        if (!resp.ok) return;
        const rows = await resp.json();
        const predictions = Array.isArray(rows) ? rows.slice().reverse() : [];

        const latestPending = predictions.slice().reverse().find(item => item.result === 'pending') || null;
        const latestAny = predictions.length ? predictions[predictions.length - 1] : null;
        const current = latestPending || latestAny;

        const n9El = document.getElementById('ai-pred-n9-text');
        const n4El = document.getElementById('ai-pred-n4-text');
        const statusEl = document.getElementById('ai-status');
        const analysisEl = document.getElementById('auto-ai-analysis');

        if (current) {
            lastAiPredN9 = current.n9 || null;
            lastAiPredN4 = current.n4 || null;
            // Usar modo real de la prediccion, no el del UI actual
            if (current.mode) lastAiPredMode = String(current.mode).toUpperCase();
            if (n9El) n9El.innerText = current.n9 || 'Esperar';
            if (n4El) n4El.innerText = current.n4 || 'Esperar';
            if (analysisEl) analysisEl.innerText = current.analysis || 'Analisis AI sincronizado desde la base.';
            if (statusEl) statusEl.innerText = latestPending ? 'ONLINE' : 'STANDBY';
            
            // Debug: mostrar las 6 métricas actuales junto al análisis
            if (analysisEl && lastSignal) {
                const s = lastSignal;
                analysisEl.innerText = 
                    'CW_N9=' + s.targetCW + ' CW_S=' + s.targetUnderCW + ' CW_B=' + s.targetOverCW + ' | ' +
                    'CCW_N9=' + s.targetCCW + ' CCW_S=' + s.targetOverCCW + ' CCW_B=' + s.targetUnderCCW + ' | ' +
                    (current.analysis || '');
            }
        } else {
            if (n9El) n9El.innerText = 'Sin datos';
            if (n4El) n4El.innerText = 'Sin datos';
            if (analysisEl) analysisEl.innerText = `${mode}: sin historial de aciertos todavia.`;
            if (statusEl) statusEl.innerText = 'STANDBY';
        }

        renderDirMetricHistories();
    } catch (e) {
        console.error('syncAiPredictionState:', e);
    }
}

function renderDirMetricHistories() {
    const metrics = [
        { id: 'cw-n9', label: 'CW N9', items: cwHistory },
        { id: 'cw-n4', label: 'CW N4', items: cwN4History },
        { id: 'ccw-n9', label: 'CCW N9', items: ccwHistory },
        { id: 'ccw-n4', label: 'CCW N4', items: ccwN4History }
    ];

    const mode = lastAiPredMode === 'SAFE' ? 'safe' : 'full';
    const mStats = mode === 'safe' ? aiStatsSafe : aiStatsFull;
    const mHist = mode === 'safe' ? aiHistSafe : aiHistFull;

    const aiN9List = document.getElementById('ai-hist-list-n9');
    if (aiN9List) aiN9List.innerHTML = getAiPerfHtml(mHist.n9, mStats.n9, 20);
    const aiN4List = document.getElementById('ai-hist-list-n4');
    if (aiN4List) aiN4List.innerHTML = getAiPerfHtml(mHist.n4, mStats.n4, 20);

    metrics.forEach(metric => {
        const list = document.getElementById(`dir-${metric.id}-hist-list`);
        if (!list) return;
        const wins = metric.items.filter(x => x === 'win').length;
        const total = metric.items.length;
        const rate = total > 0 ? Math.round((wins / total) * 100) : 0;
        list.innerHTML = `<div class="dir-hist-item"><span class="dir-hist-label">${metric.label}</span><span class="dir-hist-rate">${rate}%</span><span class="compact-perf">${getPerfHtml(metric.items)}</span></div>`;
    });
}


/// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ RENDER: UNIFIED PANEL Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

function getZoneTargets(lastNum) {
    const idx = WHEEL_NUMS.indexOf(lastNum);
    if (idx === -1) return {};
    
    if (zoneView === 'OVER') {
        return {
            // OVER mode: Anchor is at +19 distance
            // Targets: Principal(+19), Soporte(+10), Inverso(-19)
            main:    WHEEL_NUMS[(idx + 19 + 37) % 37],
            support: WHEEL_NUMS[(idx + 10 + 37) % 37],
            inverse: WHEEL_NUMS[(idx - 19 + 37) % 37]
        };
    } else {
        // UNDER mode: Anchor is at 0/1/-1 distance
        // Targets: Principal(+1), Soporte(0), Inverso(-1)
        return {
            main:    WHEEL_NUMS[(idx + 1 + 37) % 37],
            support: lastNum,
            inverse: WHEEL_NUMS[(idx - 1 + 37) % 37]
        };
    }
}

function renderShadowPanel() {
    try {
    renderDirMetricHistories();
    // 1. DIR (ANDROID 1717)
    if (lastSignal) {
        // --- CW BLOCK ---
        document.getElementById('dir-cw-c-val').innerText = lastSignal.targetCW ?? '--';
        document.getElementById('dir-cw-l-val').innerText = lastSignal.targetUnderCW ?? '--';
        document.getElementById('dir-cw-r-val').innerText = lastSignal.targetOverCW ?? '--';
        document.getElementById('dir-cw-l-hit').innerText = lastUnderHitCW ? 'OK HIT' : '';
        document.getElementById('dir-cw-r-hit').innerText = lastOverHitCW ? 'OK HIT' : '';

        // --- CCW BLOCK ---
        document.getElementById('dir-ccw-c-val').innerText = lastSignal.targetCCW ?? '--';
        document.getElementById('dir-ccw-l-val').innerText = lastSignal.targetUnderCCW ?? '--';
        document.getElementById('dir-ccw-r-val').innerText = lastSignal.targetOverCCW ?? '--';
        document.getElementById('dir-ccw-l-hit').innerText = lastUnderHitCCW ? 'OK HIT' : '';
        document.getElementById('dir-ccw-r-hit').innerText = lastOverHitCCW ? 'OK HIT' : '';

        // Shared Tendency
        if (history.length >= 2) {
            const d = calcDist(history[history.length-2], history[history.length-1]);
            const trendTxt = `TEND: ${ d >= 0 ? 'DER ->' : 'IZQ <-'}`;
            document.getElementById('dir-cw-trend').innerText = trendTxt;
            document.getElementById('dir-ccw-trend').innerText = trendTxt;
        }

        // CW Stats
        const last10cw = cwHistory.slice(-10);
        const winsCW   = last10cw.filter(x => x === 'win').length;
        document.getElementById('dir-cw-w').innerText = winsCW;
        document.getElementById('dir-cw-l').innerText = last10cw.length - winsCW;
        document.getElementById('dir-cw-rate').innerText = last10cw.length > 0 ? ((winsCW / last10cw.length) * 100).toFixed(1) + '%' : '0.0%';
        document.getElementById('dir-cw-perf').innerHTML = last10cw.map(r => `<span class="${r==='win'?'perf-w':'perf-l'}">${r==='win'?'W':'L'}</span>`).join('') || '--';

        // CCW Stats
        const last10ccw = ccwHistory.slice(-10);
        const winsCCW   = last10ccw.filter(x => x === 'win').length;
        document.getElementById('dir-ccw-w').innerText = winsCCW;
        document.getElementById('dir-ccw-l').innerText = last10ccw.length - winsCCW;
        document.getElementById('dir-ccw-rate').innerText = last10ccw.length > 0 ? ((winsCCW / last10ccw.length) * 100).toFixed(1) + '%' : '0.0%';
        document.getElementById('dir-ccw-perf').innerHTML = last10ccw.map(r => `<span class="${r==='win'?'perf-w':'perf-l'}">${r==='win'?'W':'L'}</span>`).join('') || '--';

        // --- NEIGHBOR BALLS: DISABLED (Per user request: remove "bolitas") ---
        document.getElementById('dir-cw-c-balls').innerHTML  = '';
        document.getElementById('dir-cw-l-balls').innerHTML  = '';
        document.getElementById('dir-cw-r-balls').innerHTML  = '';
        document.getElementById('dir-ccw-c-balls').innerHTML = '';
        document.getElementById('dir-ccw-l-balls').innerHTML = '';
        document.getElementById('dir-ccw-r-balls').innerHTML = '';
    } else {
        // Si no hay lastSignal, mostrar valores por defecto
        document.getElementById('dir-cw-c-val').innerText = '--';
        document.getElementById('dir-cw-l-val').innerText = '--';
        document.getElementById('dir-cw-r-val').innerText = '--';
        document.getElementById('dir-ccw-c-val').innerText = '--';
        document.getElementById('dir-ccw-l-val').innerText = '--';
        document.getElementById('dir-ccw-r-val').innerText = '--';
    }
    } catch (err) {
        console.error('Error in renderShadowPanel:', err);
    }
}



// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ WHEEL DRAW Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function drawWheel(highlightNum = null) {
    const canvas = document.getElementById('wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = 65, cy = 65;
    ctx.clearRect(0, 0, 130, 130);
    const goldColor = '#f5c842';
    ctx.beginPath(); ctx.arc(cx, cy, 63, 0, Math.PI*2);
    ctx.fillStyle = '#1a1a1a'; ctx.fill();
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1.5; ctx.stroke();
    WHEEL_NUMS.forEach((n, i) => {
        const startAng = (i*(360/37)-90-(360/74))*(Math.PI/180);
        const endAng   = (i*(360/37)-90+(360/74))*(Math.PI/180);
        const midAng   = (i*(360/37)-90)*(Math.PI/180);
        ctx.beginPath();
        ctx.moveTo(cx+Math.cos(startAng)*35, cy+Math.sin(startAng)*35);
        ctx.arc(cx, cy, 60, startAng, endAng);
        ctx.lineTo(cx+Math.cos(endAng)*35, cy+Math.sin(endAng)*35);
        ctx.closePath();
        ctx.fillStyle = n===0 ? '#006600' : (RED_NUMS.has(n) ? '#c41e3a' : '#111');
        ctx.fill();
        ctx.strokeStyle = '#333'; ctx.lineWidth=0.5; ctx.stroke();
        const rx = cx+Math.cos(midAng)*48, ry = cy+Math.sin(midAng)*48;
        ctx.save(); ctx.translate(rx,ry); ctx.rotate(midAng+Math.PI/2);
        ctx.fillStyle = n===highlightNum ? goldColor : '#fff';
        ctx.font = `bold ${n===highlightNum?9:7}px Inter`;
        ctx.textAlign = 'center'; ctx.fillText(n,0,3);
        ctx.restore();
        if (n === highlightNum) {
            ctx.beginPath(); ctx.arc(rx,ry,9,0,Math.PI*2);
            ctx.strokeStyle=goldColor; ctx.lineWidth=2;
            ctx.shadowBlur=12; ctx.shadowColor=goldColor;
            ctx.stroke(); ctx.shadowBlur=0;
        }
    });
    const gr = ctx.createRadialGradient(cx,cy,0,cx,cy,35);
    gr.addColorStop(0,'#3a3a3a'); gr.addColorStop(1,'#111');
    ctx.beginPath(); ctx.arc(cx,cy,35,0,Math.PI*2);
    ctx.fillStyle=gr; ctx.fill();
    ctx.strokeStyle='#555'; ctx.lineWidth=1; ctx.stroke();
}

function renderWheelAndHistory() {
    const strip = document.getElementById('history-strip-mini');
    if (!strip) return;
    const last10 = history.slice(-10).reverse();
    strip.innerHTML = last10.map(n => {
        const cls = n===0 ? 'ball-zero' : (RED_NUMS.has(n) ? 'ball-red' : 'ball-black');
        return `<div class="mini-ball ${cls}">${n}</div>`;
    }).join('');
    // drawWheel removed
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ TAB LISTENERS Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
document.addEventListener('click', (e) => {
    const allTabs = ['tab-btn-dir', 'tab-btn-pattern', 'tab-btn-sniper', 'tab-btn-panel'];
    const allPanels = ['panel-dir', 'panel-pattern', 'panel-sniper', 'panel-panel'];
    const tabMap = { 'tab-btn-dir': 'panel-dir', 'tab-btn-pattern': 'panel-pattern', 'tab-btn-sniper': 'panel-sniper', 'tab-btn-panel': 'panel-panel' };
    
    if (e.target && tabMap[e.target.id]) {
        allTabs.forEach(t => { const el = document.getElementById(t); if(el) el.classList.remove('active'); });
        allPanels.forEach(p => { const el = document.getElementById(p); if(el) el.style.display = 'none'; });
        e.target.classList.add('active');
        const panel = document.getElementById(tabMap[e.target.id]);
        if (panel) panel.style.display = 'flex';
        renderShadowPanel();
        // AUTO eliminado
        // if (e.target.id === 'tab-btn-auto' && document.getElementById('ai-pred-n9-text')?.innerText.includes('Analizando')) { requestAutoAI(); }
        if (e.target.id === 'tab-btn-pattern') { analyzePatternSequence(); }
        if (e.target.id === 'tab-btn-sniper') { renderMasterUI(); renderAnalystUI(); }
        if (e.target.id === 'tab-btn-panel') { renderAgentDashboard(); }
    }
    if (e.target.id !== 'tab-btn-sniper' && e.target.id !== 'tab-btn-panel') {
        const el = document.getElementById('ai-chat-panel');
        if (el) el.style.display = 'none';
    }
});

// ─── METRICAS PANEL ───────────────────────────────────────
const metricaScoresHistory = {}; // { metricId: [score, score, ...] }
let metricaLastScores = {}; // { metricId: lastScore }
const metricaHitCounts = {}; // { metricId: { wins: 0, losses: 0 } }
let lastEvalNumber = null;

function renderMetricasPanel() {
    if (!lastSignal || history.length < 2) {
        document.getElementById('metricas-stability').innerText = 'Sin datos';
        return;
    }
    
    const cw = lastSignal.targetCW;
    const ccw = lastSignal.targetCCW;
    const cwN4s = lastSignal.targetUnderCW;
    const cwN4b = lastSignal.targetOverCW;
    const ccwN4s = lastSignal.targetOverCCW;
    const ccwN4b = lastSignal.targetUnderCCW;
    
    const der = cwHistory.filter(x => x === 'win').length;
    const izq = ccwHistory.filter(x => x === 'win').length;
    const derTotal = cwHistory.length || 1;
    const izqTotal = ccwHistory.length || 1;
    const cwRate = Math.round((der / derTotal) * 100);
    const ccwRate = Math.round((izq / izqTotal) * 100);
    
    // DOM8 from recent history
    let domCW = 0, domCCW = 0, domBig = 0, domSmall = 0;
    for (let i = 1; i < Math.min(history.length, 9); i++) {
        const d = calcDist(history[i-1], history[i]);
        if (d >= 0) domCW++; else domCCW++;
        if (Math.abs(d) >= 10) domBig++; else domSmall++;
    }
    
    document.getElementById('met-dom-cw').innerText = domCW;
    document.getElementById('met-dom-ccw').innerText = domCCW;
    document.getElementById('met-dom-big').innerText = domBig;
    document.getElementById('met-dom-small').innerText = domSmall;
    
    // Stability
    const diff = Math.abs(domCW - domCCW);
    let stability, stabColor;
    if (diff >= 4) { stability = 'VERDE'; stabColor = '#00ff88'; }
    else if (diff >= 2) { stability = 'AMARILLA'; stabColor = '#f0c040'; }
    else { stability = 'ROJA'; stabColor = '#f55'; }
    document.getElementById('metricas-stability').innerText = stability;
    document.getElementById('metricas-stability').style.color = stabColor;
    
    // Score each metric
    const scores = {
        'cw_n9': (domCW * 3) + (der * 2) + cwRate / 10,
        'ccw_n9': (domCCW * 3) + (izq * 2) + ccwRate / 10,
        'cw_n4s': (domCW * 2) + (domSmall * 2) + cwRate / 10,
        'cw_n4b': (domCW * 2) + (domBig * 2) + cwRate / 10,
        'ccw_n4s': (domCCW * 2) + (domSmall * 2) + ccwRate / 10,
        'ccw_n4b': (domCCW * 2) + (domBig * 2) + ccwRate / 10
    };
    
    // Apply forest boosts
    if (typeof forestBoost !== 'undefined' && forestBoost) {
        Object.keys(forestBoost).forEach(k => {
            if (scores[k] !== undefined) scores[k] += forestBoost[k];
        });
    }
    
    // Track history for trends
    Object.keys(scores).forEach(k => {
        if (!metricaScoresHistory[k]) metricaScoresHistory[k] = [];
        metricaScoresHistory[k].push(scores[k]);
        if (metricaScoresHistory[k].length > 10) metricaScoresHistory[k].shift();
    });
    
    // Init hit counters
    Object.keys(scores).forEach(k => {
        if (!metricaHitCounts[k]) metricaHitCounts[k] = { wins: 0, losses: 0 };
    });
    
    // Check which metrics hit the last number
    const lastNum = history[history.length - 1];
    if (lastNum !== lastEvalNumber) {
        lastEvalNumber = lastNum;
        const targets = {
            'cw_n9': { target: cw, radius: 9 },
            'ccw_n9': { target: ccw, radius: 9 },
            'cw_n4s': { target: cwN4s, radius: 4 },
            'cw_n4b': { target: cwN4b, radius: 4 },
            'ccw_n4s': { target: ccwN4s, radius: 4 },
            'ccw_n4b': { target: ccwN4b, radius: 4 }
        };
        Object.entries(targets).forEach(([id, t]) => {
            if (t.target != null && typeof wheelNeighbors === 'function') {
                const hit = wheelNeighbors(t.target, t.radius).includes(lastNum);
                if (hit) metricaHitCounts[id].wins++;
                else metricaHitCounts[id].losses++;
            }
        });
    }
    
    // Update metric cards
    const cards = [
        { id: 'cw_n9', el: 'met-cw-n9-val', wl: 'met-cw-n9-wl', sc: 'met-cw-n9-score', str: 'met-cw-n9-streak', tr: 'met-cw-n9-trend', val: cw, wlData: cwHistory, color: '#00e5c8' },
        { id: 'ccw_n9', el: 'met-ccw-n9-val', wl: 'met-ccw-n9-wl', sc: 'met-ccw-n9-score', str: 'met-ccw-n9-streak', tr: 'met-ccw-n9-trend', val: ccw, wlData: ccwHistory, color: '#f55' },
        { id: 'cw_n4s', el: 'met-cw-n4s-val', wl: null, sc: 'met-cw-n4s-score', str: 'met-cw-n4s-streak', tr: 'met-cw-n4s-trend', val: cwN4s, wlData: null, color: '#8ff' },
        { id: 'cw_n4b', el: 'met-cw-n4b-val', wl: null, sc: 'met-cw-n4b-score', str: 'met-cw-n4b-streak', tr: 'met-cw-n4b-trend', val: cwN4b, wlData: null, color: '#8ff' },
        { id: 'ccw_n4s', el: 'met-ccw-n4s-val', wl: null, sc: 'met-ccw-n4s-score', str: 'met-ccw-n4s-streak', tr: 'met-ccw-n4s-trend', val: ccwN4s, wlData: null, color: '#f88' },
        { id: 'ccw_n4b', el: 'met-ccw-n4b-val', wl: null, sc: 'met-ccw-n4b-score', str: 'met-ccw-n4b-streak', tr: 'met-ccw-n4b-trend', val: ccwN4b, wlData: null, color: '#f88' }
    ];
    
    let bestScore = -1;
    let bestCard = null;
    let bestId = null;
    
    cards.forEach(c => {
        const el = document.getElementById(c.el);
        const scEl = document.getElementById(c.sc);
        const strEl = document.getElementById(c.str);
        const trEl = document.getElementById(c.tr);
        const score = scores[c.id] || 0;
        if (el) el.innerText = c.val != null ? c.val : '--';
        if (scEl) scEl.innerText = 's:' + score.toFixed(1);
        if (c.wl && document.getElementById(c.wl)) {
            document.getElementById(c.wl).innerText = getPerfText(c.wlData);
        }
        
        // Streak counter
        const hc = metricaHitCounts[c.id] || { wins: 0, losses: 0 };
        const hcTotal = hc.wins + hc.losses;
        if (strEl) strEl.innerText = hcTotal ? Math.round((hc.wins / hcTotal) * 100) + '%' : '--';
        if (strEl) strEl.style.color = hc.wins > hc.losses ? '#0f0' : hc.losses > hc.wins ? '#f55' : 'var(--text-dim)';
        
        // Trend arrow
        const prev = metricaLastScores[c.id] || 0;
        if (trEl) {
            if (score > prev + 0.5) trEl.innerText = '\u2191';
            else if (score < prev - 0.5) trEl.innerText = '\u2193';
            else trEl.innerText = '\u2192';
            trEl.style.color = score > prev + 0.5 ? '#0f0' : score < prev - 0.5 ? '#f55' : 'var(--text-dim)';
        }
        metricaLastScores[c.id] = score;
        
        // Highlight best
        const card = document.getElementById('met-' + c.id);
        if (card) {
            if (score > bestScore) { bestScore = score; bestCard = card; bestId = c.id; }
            card.style.borderColor = 'rgba(255,255,255,0.08)';
            card.style.boxShadow = 'none';
        }
    });
    
    // Best pick
    if (bestCard && bestId) {
        bestCard.style.borderColor = 'var(--gold)';
        bestCard.style.boxShadow = '0 0 8px rgba(240,192,64,0.2)';
        const bestMetric = cards.find(c => c.id === bestId);
        if (bestMetric) {
            const pickN9 = bestId.includes('n9') ? bestMetric.val : (bestId.includes('cw') ? cw : ccw);
            const pickN4 = bestId.includes('n4') ? bestMetric.val : (bestId.includes('cw') ? cwN4s : ccwN4s);
            document.getElementById('met-pick-text').innerText = 'N9: ' + pickN9 + ' | N4: ' + pickN4;
            document.getElementById('met-pick-reason').innerText = bestId.toUpperCase() + ' domina (s:' + bestScore.toFixed(1) + ')';
        }
    }
    
    // Confluence detector
    renderConfluence(scores, domCW, domCCW, domBig, domSmall, stability, cards, bestId);
}

function renderConfluence(scores, domCW, domCCW, domBig, domSmall, stability, cards, bestId) {
    const confDiv = document.getElementById('metricas-confluence');
    const confSignal = document.getElementById('met-confluence-signal');
    const confDetail = document.getElementById('met-confluence-detail');
    if (!confDiv || !confSignal || !confDetail) return;
    
    // Group metrics by direction
    const cwScore = (scores['cw_n9'] || 0) + (scores['cw_n4s'] || 0) + (scores['cw_n4b'] || 0);
    const ccwScore = (scores['ccw_n9'] || 0) + (scores['ccw_n4s'] || 0) + (scores['ccw_n4b'] || 0);
    const bigScore = (scores['cw_n4b'] || 0) + (scores['ccw_n4b'] || 0);
    const smallScore = (scores['cw_n4s'] || 0) + (scores['ccw_n4s'] || 0);
    
    const cwDom = domCW >= 5;
    const ccwDom = domCCW >= 5;
    const cwN9Hot = (scores['cw_n9'] || 0) > (scores['ccw_n9'] || 0) + 3;
    const ccwN9Hot = (scores['ccw_n9'] || 0) > (scores['cw_n9'] || 0) + 3;
    
    // Detect confluence types
    let confType = '', confColor = 'var(--text-dim)', confDesc = '';
    
    if (cwDom && cwN9Hot && cwScore > ccwScore * 1.5) {
        confType = 'FUERTE CW \u27A1';
        confColor = '#00e5c8';
        confDesc = 'DOM8 + Score + N9 coinciden en CW';
    } else if (ccwDom && ccwN9Hot && ccwScore > cwScore * 1.5) {
        confType = 'FUERTE CCW \u2B05';
        confColor = '#f55';
        confDesc = 'DOM8 + Score + N9 coinciden en CCW';
    } else if (cwScore > ccwScore * 1.3 && cwN9Hot) {
        confType = 'LEVE CW \u27A1';
        confColor = '#8ff';
        confDesc = 'Score CW domina con N9 caliente';
    } else if (ccwScore > cwScore * 1.3 && ccwN9Hot) {
        confType = 'LEVE CCW \u2B05';
        confColor = '#f88';
        confDesc = 'Score CCW domina con N9 caliente';
    } else if (stability === 'ROJA') {
        confType = 'SIN CONFLUENCIA';
        confColor = 'var(--text-dim)';
        confDesc = 'Mesa roja, esperar a que se defina';
    } else {
        confType = 'MIXTA';
        confColor = 'var(--gold)';
        confDesc = 'Metricas divididas. Observar.';
    }
    
    confDiv.style.display = 'block';
    confSignal.innerText = confType;
    confSignal.style.color = confColor;
    confDetail.innerText = confDesc + ' | CW:' + cwScore.toFixed(1) + ' vs CCW:' + ccwScore.toFixed(1);
    
    // Flash hit: highlight metric cards that just covered the last number
    const lastN = history[history.length - 1];
    cards.forEach(c => {
        const card = document.getElementById('met-' + c.id);
        if (!card || c.val == null) return;
        const radius = c.id.includes('n4') ? 4 : 9;
        if (typeof wheelNeighbors === 'function' && wheelNeighbors(c.val, radius).includes(lastN)) {
            card.style.transition = 'all 0.15s';
            card.style.boxShadow = '0 0 12px rgba(0,255,136,0.5)';
            card.style.borderColor = '#00ff88';
            setTimeout(() => {
                if (card.id !== bestId) {
                    card.style.boxShadow = 'none';
                    card.style.borderColor = 'rgba(255,255,255,0.08)';
                }
            }, 1200);
        }
    });
}

let forestBoost = {};

async function loadForestDiscoveries() {
    try {
        const resp = await fetch('/api/forest/discoveries');
        if (!resp.ok) return;
        const data = await resp.json();
        
        forestBoost = {};
        if (data.discoveries && data.discoveries.length > 0) {
            const discDiv = document.getElementById('metricas-discoveries');
            const listDiv = document.getElementById('metricas-discoveries-list');
            if (discDiv) discDiv.style.display = 'block';
            
            let html = '';
            data.discoveries.slice(0, 5).forEach(d => {
                forestBoost[d.metricId] = (forestBoost[d.metricId] || 0) + (d.score / 100) * 2;
                html += '<div style="margin:2px 0; font-size:8px;">' +
                    '<span style="color:var(--accent);">' + d.metricId.toUpperCase() + '</span> ' +
                    '<span style="color:var(--text-dim);">en</span> ' +
                    '<span style="color:var(--gold);">' + (d.context?.stability || '?').toUpperCase() + '</span>: ' +
                    '<strong>' + d.score + '%</strong> (' + d.wins + 'W/' + d.losses + 'L)' +
                    '</div>';
            });
            
            if (data.rlBestContexts && data.rlBestContexts.length > 0) {
                html += '<div style="margin-top:6px; font-size:9px; color:var(--accent);">RL: MEJORES CONTEXTOS</div>';
                data.rlBestContexts.forEach(c => {
                    html += '<div style="font-size:8px; color:var(--gold);">' +
                        c.winRate + '% en ' + c.total + ' spins → ' + c.topMetric.toUpperCase() +
                        '</div>';
                });
            }
            
            if (listDiv) listDiv.innerHTML = html || '--';
        }
        
        if (document.getElementById('panel-metricas')?.style.display !== 'none') {
            renderMetricasPanel();
        }
    } catch (e) { /* non-critical */ }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ SUBMIT NUMBER Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function submitNumber(val, silent = false, batch = false, spinId = null) {
    const raw = val !== undefined ? val : '';
    const n = parseInt(raw);
    
    if (!isNaN(n) && n >= 0 && n <= 36) {
        // Prevent duplicate: skip if same as the last number in history
        // (e.g. SSE re-sends on reconnect while batch sync already processed it)
        if (spinId != null) {
            const stableId = String(spinId);
            if (processedLiveSpinIds.has(stableId)) return;
            processedLiveSpinIds.add(stableId);
            if (processedLiveSpinIds.size > 3000) processedLiveSpinIds.delete(processedLiveSpinIds.values().next().value);
        } else if (history.length > 0 && history[history.length - 1] === n) {
            return;
        }
        // Evaluate previous predictions before pushing to history
        if (lastSignal && history.length > 0) {
            // Main CW prediction Ã¢ÂÂ evaluated at N9 (win radius 9, under/over radius 4)
            if (lastSignal.targetCW !== undefined) {
                const distCW = Math.abs(calcDist(n, lastSignal.targetCW));
                cwHistory.push(distCW <= 9 ? 'win' : 'loss');
                
                // Dynamically evaluate hits against under/over targets at radius 4
                lastUnderHitCW = Math.abs(calcDist(n, lastSignal.targetUnderCW)) <= 4;
                lastOverHitCW  = Math.abs(calcDist(n, lastSignal.targetOverCW)) <= 4;
                cwN4History.push((lastUnderHitCW || lastOverHitCW) ? 'win' : 'loss');
            }
            // Main CCW prediction Ã¢ÂÂ evaluated at N9 (9-ball neighborhood = radius 4)
            if (lastSignal.targetCCW !== undefined) {
                const distCCW = Math.abs(calcDist(n, lastSignal.targetCCW));
                ccwHistory.push(distCCW <= 9 ? 'win' : 'loss');
                
                // Dynamically evaluate hits against under/over targets at radius 4
                lastUnderHitCCW = Math.abs(calcDist(n, lastSignal.targetUnderCCW)) <= 4;
                lastOverHitCCW  = Math.abs(calcDist(n, lastSignal.targetOverCCW)) <= 4;
                ccwN4History.push((lastUnderHitCCW || lastOverHitCCW) ? 'win' : 'loss');
            }
        }
        
        // Evaluate ZONE OVER prediction Ã¢ÂÂ Offset 14
        if (history.length >= 1) {
            const prevForZone = history[history.length - 1];
            const idxZ = WHEEL_NUMS.indexOf(prevForZone);
            if (idxZ !== -1) {
                const overTarget = lastSignal ? lastSignal.targetOverCW : WHEEL_NUMS[(idxZ + 14 + 37) % 37];
                const distToT = Math.abs(calcDist(n, overTarget));
                lastZoneOverHit = (distToT <= 4);
                zoneOverHistory.push(lastZoneOverHit ? 'win' : 'loss');
            }
        }

        // Evaluate ZONE UNDER prediction Ã¢ÂÂ Offset 4
        if (history.length >= 1) {
            const prevForZone = history[history.length - 1];
            const idxZ = WHEEL_NUMS.indexOf(prevForZone);
            if (idxZ !== -1) {
                const underTarget = lastSignal ? lastSignal.targetUnderCW : WHEEL_NUMS[(idxZ + 4 + 37) % 37];
                const distToT = Math.abs(calcDist(n, underTarget));
                lastZoneUnderHit = (distToT <= 4);
                zoneUnderHistory.push(lastZoneUnderHit ? 'win' : 'loss');
            }
        }

        // Evaluate JUGADAS prediction Ã¢ÂÂ only when ACTIVE (not charging)
        if (history.length >= 1 && jugView.isCharging === false) {
            const jump = calcDist(history[history.length - 1], n);
            const mag = Math.abs(jump);
            
            const hitMag = jugView.magnitude === 'UNDER' ? (mag <= 9 && mag >= 1) : (mag >= 10 && mag <= 18);
            const hitDir = jugView.direction === 'CW' ? (jump >= 0) : (jump < 0);
            
            lastJugHit = hitMag && hitDir;
            jugHistory.push(lastJugHit ? 'win' : 'loss');
        } else if (history.length >= 1) {
            lastJugHit = false; // Charging, no W/L recorded
        }

// Evaluate ANALYST prediction (TRADING)
        if (history.length >= 1 && analystView.targetDir) {
            const jump = calcDist(history[history.length - 1], n);
            const dirHit = (analystView.targetDir === 'CW' && jump >= 0) || (analystView.targetDir === 'CCW' && jump < 0);
            lastAnalystHit = dirHit;
            analystHistory.push(lastAnalystHit ? 'win' : 'loss');
        }

        // Evaluate MASTER SNIPER prediction
        if (history.length >= 1 && masterView.target) {
            const jump = calcDist(history[history.length - 1], n);
            const dirHit = (masterView.target === 'CW' && jump >= 0) || (masterView.target === 'CCW' && jump < 0);
            lastMasterHit = dirHit;
            masterHistory.push(lastMasterHit ? 'win' : 'loss');
        }

        // Evaluate ANALYST V2 prediction
        if (history.length >= 1 && lastAnalystV2Dir) {
            const jump = calcDist(history[history.length - 1], n);
            const dirHit = (lastAnalystV2Dir === 'CW' && jump >= 0) || (lastAnalystV2Dir === 'CCW' && jump < 0);
            analystV2History.push(dirHit ? 'win' : 'loss');
        }

        // Evaluate SNIPER V2 prediction
        if (history.length >= 1 && lastSniperV2Dir) {
            const jump = calcDist(history[history.length - 1], n);
            const dirHit = (lastSniperV2Dir === 'CW' && jump >= 0) || (lastSniperV2Dir === 'CCW' && jump < 0);
            sniperV2History.push(dirHit ? 'win' : 'loss');
        }

        // Registrar timestamp real de esta evaluación
        evalTimestamps.push(Date.now());

        history.push(n);

        // Compute new predictions (Se calculan siempre para que la historia de W/L se llene, incluso en lote)
        if (typeof computeDealerSignature === 'function' && history.length >= 3) {
            try {
                const sig  = computeDealerSignature(history);
                const prox = projectNextRound(history, {});
                const masterSignals = getIAMasterSignals(prox, sig, history, { cw: currentAvgCW, ccw: currentAvgCCW, offset: predictorOffset });
                if (masterSignals && masterSignals.length > 0) {
                    lastSignal = masterSignals[0];
                }
                
                // JUGADAS Sniper automatically reads the table
                if (typeof predictZonePattern === 'function') {
                    jugView = predictZonePattern(history, patternStatsCache);
                }

                // Analyst Agent calculation
                if (typeof analyzeTravelWave === 'function') {
                    const travels = [];
                    for (let i = 1; i < history.length; i++) travels.push(calcDist(history[i-1], history[i]));
                    analystView = analyzeTravelWave(travels);
                }

                // Master Sniper AI calculation (CONFLUENCE)
                if (typeof analyzeMasterConfluence === 'function') {
                    masterView = analyzeMasterConfluence(history, analystView, jugView, {});

                    // V5 Neural Overlay: If Agent 5 has Expert knowledge, it overrides
                    if (jugView.agent5_top_new && jugView.agent5_top_new.dnaMatch) {
                        masterView.signal = `Ã°ÂÂ§Â  NEURAL: ${jugView.agent5_top_new.direction}`;
                        masterView.reasons = jugView.agent5_top_new.reason;
                        masterView.confidence = Math.max(masterView.confidence, 90);
                        masterView.target = jugView.agent5_top_new.direction;
                    }

                    // Actualizar el motor de patrones del Travel Chart
                    updateTravelPatternUI();

                    if (typeof AIChat !== 'undefined' && masterView.reasons) {
                        AIChat.onNewSpin(n, { 
                            masterConfidence: masterView.confidence,
                            isRhythm: String(masterView.reasons).includes('RITMO'),
                            rhythmName: masterView.reasons
                        });
                    }
                }
            } catch(e) { console.error('Predict error:', e); }
        }

        // --- RENDER UPDATES (Always if not batch) ---
        if (!batch) {
            renderShadowPanel();
            renderWheelAndHistory();
            renderTravelPanel();
            renderAnalystUI();
            renderMasterUI();
            if (history.length > 0) fetchPatternMemory(history);

            // Extraer patrones dir-only automáticamente en cada spin
            if (history.length >= 10) extractDirOnlyPatterns();
            
            // AUTO ELIMINADO - Usando solo Sniper y Analyst
            // 🔥 Sync AI history to update W/L counters automatically
            // if (typeof syncAiPredictionState === 'function') syncAiPredictionState();
            
            // Trigger new AI prediction (always, even in background)
            // setTimeout(requestAutoAI, 800);
            
            // Evaluate AUTO AI predictions ALWAYS
            // evaluateAiPredictions(n);
            
            // 🆕 Pattern Matching V2 con Meta-Patrones
            // 1. Registrar resultado del Sniper anterior (si existe)
            if (typeof registerSniperResult === 'function') registerSniperResult(n);
            
            // 2. Analizar patrones y hacer nueva predicción
            if (typeof analyzePatternSequence === 'function') analyzePatternSequence();
            
            // 3. Guardar predicción actual para evaluar en el próximo número
            if (typeof saveSniperPrediction === 'function' && lastSignal) {
                const sniperPred = masterView.target || (analystView.targetDir);
                const sniperTarget = lastSignal.targetCW || lastSignal.targetCCW;
                if (sniperPred && sniperTarget) {
                    saveSniperPrediction(sniperPred, sniperTarget);
                }
            }

            saveSessionToLocalStorage();
            
            // Appendea resultados V1/V2 al log del servidor (ligero, solo el nuevo resultado)
            appendV1V2ResultToServer();
        }
    }
}

function appendV1V2ResultToServer() {
    if (!currentTableId || history.length < 1) return;
    const lastSpin = history[history.length - 1];
    const entry = {
        spin: lastSpin,
        idx: history.length - 1,
        analyst: analystHistory.length > 0 ? analystHistory[analystHistory.length - 1] : null,
        master: masterHistory.length > 0 ? masterHistory[masterHistory.length - 1] : null,
        analystV2: analystV2History.length > 0 ? analystV2History[analystV2History.length - 1] : null,
        sniperV2: sniperV2History.length > 0 ? sniperV2History[sniperV2History.length - 1] : null,
        ts: Date.now()
    };
    try {
        fetch(`/api/sync-log/${currentTableId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
        }).catch(() => {});
    } catch(e) {}
}

async function loadSyncLogFromServer() {
    if (!currentTableId) return;
    try {
        const resp = await fetch(`/api/sync-log/${currentTableId}?localCount=${analystHistory.length}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data || !data.entries || data.entries.length === 0) return;
        
        // Reconstruir historiales desde el log
        const newAnalyst = [], newMaster = [], newAnalystV2 = [], newSniperV2 = [];
        for (const e of data.entries) {
            if (e.analyst !== null && e.analyst !== undefined) newAnalyst.push(e.analyst);
            if (e.master !== null && e.master !== undefined) newMaster.push(e.master);
            if (e.analystV2 !== null && e.analystV2 !== undefined) newAnalystV2.push(e.analystV2);
            if (e.sniperV2 !== null && e.sniperV2 !== undefined) newSniperV2.push(e.sniperV2);
        }
        
        if (newAnalyst.length > analystHistory.length) {
            analystHistory.length = 0;
            analystHistory.push(...newAnalyst);
        }
        if (newMaster.length > masterHistory.length) {
            masterHistory.length = 0;
            masterHistory.push(...newMaster);
        }
        if (newAnalystV2.length > analystV2History.length) {
            analystV2History.length = 0;
            analystV2History.push(...newAnalystV2);
        }
        if (newSniperV2.length > sniperV2History.length) {
            sniperV2History.length = 0;
            sniperV2History.push(...newSniperV2);
        }
        console.log('[SyncLog] ' + data.entries.length + ' entradas sincronizadas desde servidor');
    } catch(e) { console.error('[SyncLog] Error:', e); }
}

// legacy shims
async function syncFullStateToServer() { appendV1V2ResultToServer(); }
async function loadFullStateFromServer() { return loadSyncLogFromServer(); }
async function saveV1V2HistoryToServer() { appendV1V2ResultToServer(); }
async function loadV1V2HistoryFromServer() { return loadSyncLogFromServer(); }

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ TRAVEL PATTERN ANALYSIS (DOBLE EJE) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
const travelPatternHistory = []; // ÃÂ­ÃÂ¡ltimos 8 episodios

// --- TRAVEL STABILITY COLORS ---
function detectSolidBlocks(events) {
    if (!events || events.length < 4) return false;
    var recent = events.slice(-10); var runs = []; var count = 1;
    for (var i = 1; i < recent.length; i++) {
        if (recent[i].dir === recent[i-1].dir && recent[i].zone === recent[i-1].zone) { count++; }
        else { runs.push(count); count = 1; }
    }
    runs.push(count);
    return runs.filter(function(r){return r>=2;}).length >= 2;
}
function getStabilityLevel(result, events) {
    if (!events || events.length === 0) return 'red';

    // Usar las ultimas 8 tiradas para el color de fondo
    var n8 = Math.min(events.length, 8);
    var last8 = events.slice(-n8);

    var derCount = 0, izqCount = 0, bigCount = 0, smallCount = 0;
    for (var i = 0; i < n8; i++) {
        if (last8[i].dir === 'DER') derCount++; else izqCount++;
        if (last8[i].zone === 'BIG') bigCount++; else smallCount++;
    }

    // Mayoria simple (mas de la mitad del total)
    var majDir = Math.max(derCount, izqCount) > (n8 / 2);
    var majZon = Math.max(bigCount, smallCount) > (n8 / 2);
    var domDirName = derCount >= izqCount ? 'DER' : 'IZQ';
    var domZonName = bigCount >= smallCount ? 'BIG' : 'SMALL';

    // Tendencia reciente: las ultimas 3 o 4 del mismo tipo
    var trend4 = last8.slice(-4);
    var trendDir = trend4.filter(function(e){ return e.dir === domDirName; }).length >= 3;
    var trendZon = trend4.filter(function(e){ return e.zone === domZonName; }).length >= 3;

    var doubleMaj = majDir && majZon;
    var strongDir = majDir && trendDir;
    var strongZon = majZon && trendZon;

    // VERDE: doble mayoria, o un eje fuerte con al menos mayoria en el otro
    if (doubleMaj) return 'green';
    if (strongDir && majZon) return 'green';
    if (strongZon && majDir) return 'green';
    if (detectSolidBlocks(last8)) return 'green';

    // AMARILLO: un eje con mayoria o tendencia emergente
    if (majDir || majZon || strongDir || strongZon) return 'yellow';

    return 'red';
}
function applyTravelStabilityColor(level) {
    // Ya no pintamos la columna ni el borde, solo el canvas
    var s = document.querySelector('.col-travel'); if (!s) return;
    s.style.background = 'transparent';
    s.style.borderLeft = 'none';
}

function analyzeTravelPattern(hist) {
    if (hist.length < 3) return { label: '-', tiradas: 0, emoji: '' };

    const events = [];
    for (let i = 1; i < hist.length; i++) {
        const d = calcDist(hist[i - 1], hist[i]);
        events.push({
            dir:  d >= 0 ? 'DER' : 'IZQ',
            zone: Math.abs(d) >= 10 ? 'BIG' : 'SMALL'
        });
    }

    const window = events.slice(-12);
    const N = window.length;
    if (N < 2) return { label: '-', tiradas: N, emoji: '' };

    const dirs  = window.map(e => e.dir);
    const zones = window.map(e => e.zone);

    // Helpers
    const getSolid = (arr) => N >= 3 && arr.slice(-N).every(x => x === arr[arr.length - 1]);
    const getZigzag = (arr) => {
        if (N < 4) return false;
        for (let i = 1; i < N; i++) if (arr[i] === arr[i - 1]) return false;
        return true;
    };
    const getPairs = (arr) => {
        if (N < 4) return false;
        let runs = [], c = 1;
        for(let i=1; i<N; i++) { if(arr[i]===arr[i-1]) c++; else { runs.push(c); c=1; } }
        runs.push(c);
        if (runs.length < 2 || runs[runs.length-1] > 2) return false;
        let prev = runs.slice(0, -1).slice(-3);
        if (prev.length === 0) return false;
        return prev.every(r => r === 2);
    };

    // DIR STATE
    const dirLast = dirs[dirs.length - 1];
    const derCount = dirs.filter(d => d === 'DER').length;
    const domDer = derCount / N >= 0.58;
    const domIzq = (N - derCount) / N >= 0.58;
    
    let dirState = 'INEST';
    if (getSolid(dirs)) dirState = `S:${dirLast}`;
    else if (getZigzag(dirs)) dirState = 'ZZ';
    else if (getPairs(dirs)) dirState = 'PARES';
    else if (domDer) dirState = 'DOM:DER';
    else if (domIzq) dirState = 'DOM:IZQ';

    // ZONE STATE
    const zoneLast = zones[zones.length - 1];
    const smallCount = zones.filter(z => z === 'SMALL').length;
    const domSmall = smallCount / N >= 0.58;
    const domBig = (N - smallCount) / N >= 0.58;

    let zoneState = 'INEST';
    if (getSolid(zones)) zoneState = `ZS:${zoneLast}`;
    else if (getZigzag(zones)) zoneState = 'ZZ';
    else if (getPairs(zones)) zoneState = 'PARES';
    else if (domSmall) zoneState = 'DOM:SMALL';
    else if (domBig) zoneState = 'DOM:BIG';

    // COMBINED LABEL
    let label = '';
    let emoji = '\\uD83D\\uDD39'; // Small blue diamond

    const getStr = (state, type) => {
        if (state.startsWith('S:')) return type === 'dir' ? `Dir ${state.split(':')[1]} SÃ³lida` : `Zona ${state.split(':')[1]} SÃ³lida`;
        if (state === 'ZZ') return 'Zigzag';
        if (state === 'PARES') return 'Pares';
        if (state.startsWith('DOM:')) return `Dom: ${state.split(':')[1]}`;
        return 'Inestable';
    };

    let dirStr = getStr(dirState, 'dir');
    let zonStr = getStr(zoneState, 'zon');

    if (dirState !== 'INEST' && zoneState !== 'INEST') {
        label = `${zonStr}, ${dirStr}`;
        emoji = '\\u2705'; // Check mark
    } else if (zoneState !== 'INEST') {
        label = `${zonStr}, Dir Inest.`;
        emoji = zoneState.includes('BIG') ? '\\uD83D\\uDD38' : '\\uD83D\\uDD39'; // Orange/Blue diamond
    } else if (dirState !== 'INEST') {
        label = `Zona Inest, ${dirStr}`;
        emoji = '\\uD83D\\uDD04'; // Refresh
    } else {
        label = 'Sin PatrÃ³n Claro';
        emoji = '\\u26A0'; // Warning
    }

    return { label, tiradas: N, emoji };
}

function updateTravelPatternUI() {
    if (history.length < 3) return;
    const result = analyzeTravelPattern(history);

    const labelEl = document.getElementById('travel-pattern-label');
    const tirasEl = document.getElementById('travel-pattern-count');
    const histEl  = document.getElementById('travel-pattern-hist');

    if (labelEl) labelEl.innerText = `Â· ${result.label}`;
    if (tirasEl) tirasEl.innerText = `${result.tiradas}t`;

    const current = travelPatternHistory[0];
    if (!current) {
        travelPatternHistory.unshift({ label: result.label, emoji: result.emoji, tiradas: result.tiradas });
    } else if (current.label !== result.label) {
        travelPatternHistory.unshift({ label: result.label, emoji: result.emoji, tiradas: result.tiradas });
        if (travelPatternHistory.length > 8) travelPatternHistory.length = 8;
    } else {
        current.tiradas = result.tiradas;
        current.emoji = result.emoji;
    }

    if (histEl) {
        histEl.innerHTML = travelPatternHistory.slice(0, 8).map(p =>
            `<div style="display:flex; justify-content:space-between; padding: 2px 0; font-size:10px; border-bottom:1px solid var(--border);">
                <span style="color:var(--text)">${p.emoji} ${p.label}</span>
                <span style="color:var(--muted); font-family:var(--mono);">${p.tiradas}t</span>
            </div>`
        ).join('') || `<div style="opacity:0.5; font-size:10px; text-align:center; padding:4px;">Sin historial todavia</div>`;
    }

    // Aplicar fondo de color segun estabilidad del Travel
    var evts = [];
    for (var _i = 1; _i < history.length; _i++) {
        var _d = calcDist(history[_i-1], history[_i]);
        evts.push({dir: _d >= 0 ? 'DER' : 'IZQ', zone: Math.abs(_d) >= 10 ? 'BIG' : 'SMALL'});
    }
    applyTravelStabilityColor(getStabilityLevel(result, evts));
}

function renderTravelChart() {
    try {
    const canvas = document.getElementById('travelChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    const padL = isMobile ? 24 : 30, padR = isMobile ? 34 : 50, padT = 20, padB = 20;
    const H = canvas.height || 120;
    const parentW = (canvas.parentElement && canvas.parentElement.offsetWidth) || canvas.clientWidth || 420;
    const baseW = Math.max(120, Math.floor(parentW));
    
    // Build travel array
    const travels = [];
    for (let i = 1; i < history.length; i++) travels.push(calcDist(history[i-1], history[i]));
        if (history.length < 2 || travels.length < 1) {
            const W = baseW;
            canvas.width = W;
            canvas.style.width = W + 'px';
            ctx.clearRect(0, 0, W, H);
            // Draw placeholder axes
            ctx.strokeStyle = '#2a3a5d';
            ctx.lineWidth = 1;
            // X axis
            ctx.beginPath();
            ctx.moveTo(padL, H - padB);
            ctx.lineTo(W - padR, H - padB);
            ctx.stroke();
            // Y axis
            ctx.beginPath();
            ctx.moveTo(padL, padT);
            ctx.lineTo(padL, H - padB);
            ctx.stroke();
            // Text
            ctx.fillStyle = '#7a9bb8';
            ctx.font = '10px Inter';
            ctx.fillText('Sin datos', W/2, H/2);
            return;
        }
    
    // WINDOWED TRAVEL: fixed viewport (latest points only)
    const windowSize = isMobile ? 16 : 22;
    const dataStart = Math.max(0, travels.length - windowSize);
    const data = travels.slice(dataStart);
    const numPoints = data.length;

    const totalW = baseW;
    canvas.width = totalW;
    canvas.style.width = totalW + 'px';
    const W = totalW;
    ctx.clearRect(0, 0, W, H);

    // --- Fondo de color canvas segun estabilidad ---
    (function paintBg() {
        var _evts = [];
        for (var _ci = 1; _ci < history.length; _ci++) {
            var _cd = calcDist(history[_ci-1], history[_ci]);
            var _dir = _cd >= 0 ? 'DER' : 'IZQ';
            var _zon = Math.abs(_cd) >= 10 ? 'BIG' : 'SMALL';
            _evts.push({dir: _dir, zone: _zon});
        }
        var _pat = (typeof analyzeTravelPattern === "function") ? analyzeTravelPattern(history) : {label:"",tiradas:0};
        var _lvl = (typeof getStabilityLevel === "function") ? getStabilityLevel(_pat, _evts) : "red";
        var _bgMap = {
            green:  '#0C3824', // Puro verde atenuado (sin mezcla azul)
            yellow: '#3C3010',
            red:    '#3C1018'  // Puro rojo atenuado
        };
        ctx.fillStyle = _bgMap[_lvl] || _bgMap.red;
        ctx.fillRect(padL, padT, W - padL - padR, H - padT - padB);
    })();

    // Averages
    const cwVals = data.filter(d => d > 0);
    const ccwVals = data.filter(d => d < 0);
    let avgCW  = cwVals.length  > 0 ? cwVals.reduce((a,b)=>a+b,0)/cwVals.length   :  10;
    let avgCCW = ccwVals.length > 0 ? ccwVals.reduce((a,b)=>a+b,0)/ccwVals.length : -10;
    
    // APPLY MANUAL CALIBRATION (OFFSET)
    avgCW += manualAvgOffset;
    if (avgCCW < 0) avgCCW -= manualAvgOffset; // subtract expands the negative channel
    else avgCCW += manualAvgOffset;
    
    // Update Global References for logic classification
    currentAvgCW = avgCW;
    currentAvgCCW = avgCCW;

    const allAbs = data.map(d=>Math.abs(d));
    const avgAbs = allAbs.reduce((a,b)=>a+b,0)/allAbs.length;
    const stdDev = Math.sqrt(allAbs.reduce((a,b)=>a+Math.pow(b-avgAbs,2),0)/allAbs.length);
    const upperRange = avgCW  + stdDev;
    const lowerRange = avgCCW - stdDev;

    const chartW = W-padL-padR, chartH = H-padT-padB;
    const midY = padT + chartH/2;
    const maxVal = 18;
    const scaleY = v => midY - (v/maxVal)*(chartH/2);
    const pxPerPoint = (windowSize > 1) ? (chartW / (windowSize - 1)) : chartW;
    const scaleX = i => padL + i * pxPerPoint;

    // Update the offset UI badge
    const badgeCalib = document.getElementById('travel-avg-offset');
    if (badgeCalib) badgeCalib.innerText = `CALIB: ${manualAvgOffset >= 0 ? '+'+manualAvgOffset : manualAvgOffset}`;

    // Grid
    ctx.strokeStyle='rgba(255, 100, 0, 0.4)'; ctx.lineWidth=1; // Lineas limite en naranja
    [18, 10, -10, -18].forEach(v => {
        ctx.beginPath();ctx.moveTo(padL,scaleY(v));ctx.lineTo(W-padR,scaleY(v));ctx.stroke();
    });
    ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(padL,midY); ctx.lineTo(W-padR,midY); ctx.stroke();

    // Y labels
    ctx.fillStyle='#4a6080';ctx.font='9px Inter';ctx.textAlign='right';
    [18, 10, -10, -18].forEach(v => {
        ctx.fillText(v>0?`+${v}`:`${v}`,padL-4,scaleY(v)+3);
    });
    ctx.fillText('0',padL-4,midY+3);
    // X labels removed per user request
// 
    // Range bands
//     ctx.setLineDash([4,4]);
//     ctx.strokeStyle='rgba(240,192,64,0.4)';ctx.lineWidth=1;
//     ctx.beginPath();ctx.moveTo(padL,scaleY(upperRange));ctx.lineTo(W-padR,scaleY(upperRange));ctx.stroke();
//     ctx.strokeStyle='rgba(100,180,255,0.4)';
//     ctx.beginPath();ctx.moveTo(padL,scaleY(lowerRange));ctx.lineTo(W-padR,scaleY(lowerRange));ctx.stroke();
//     ctx.setLineDash([]);
// 
    // AvgCW line (red)
//     ctx.strokeStyle='#f04060';ctx.lineWidth=1.5;ctx.setLineDash([6,3]);
//     ctx.beginPath();ctx.moveTo(padL,scaleY(avgCW));ctx.lineTo(W-padR,scaleY(avgCW));ctx.stroke();
    // AvgCCW line (orange)
//     ctx.strokeStyle='#ff8c40';
//     ctx.beginPath();ctx.moveTo(padL,scaleY(avgCCW));ctx.lineTo(W-padR,scaleY(avgCCW));ctx.stroke();
//     ctx.setLineDash([]);
// 
    // Fill zones
//     ctx.fillStyle='rgba(48,224,144,0.04)';ctx.fillRect(padL,padT,chartW,chartH/2);
//     ctx.fillStyle='rgba(192,144,255,0.04)';ctx.fillRect(padL,midY,chartW,chartH/2);

    // Main line (SMOOTH WAVES V5)
    // Usamos curvas de BÃÂ©zier cÃÂ­ÃÂºbicas con puntos de control suavizados
    ctx.lineWidth=4; ctx.lineJoin='round'; ctx.lineCap='round';
    
    for(let i=0; i < numPoints - 1; i++){
        const x1 = scaleX(i), y1 = scaleY(data[i]);
        const x2 = scaleX(i+1), y2 = scaleY(data[i+1]);
        
        // Puntos de control para suavizado (Curva de BÃÂ©zier)
        const cpX = (x1 + x2) / 2;
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(cpX, y1, cpX, y2, x2, y2);
        
        // Color dinÃÂ¡mico segÃÂ­ÃÂºn la zona y pÃÂ©rdida de rango
        const val = data[i+1];
        if(val > upperRange || val < lowerRange) ctx.strokeStyle='#ffe600';
        else ctx.strokeStyle = val >= 0 ? '#00ffa2' : '#ff2a4b';
        
        // Sutil brillo en la lÃÂ­ÃÂ­nea
        ctx.shadowBlur = 10; ctx.shadowColor = ctx.strokeStyle;
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    // Data points (Dots on the wave)
    for(let i=0;i<numPoints;i++){
        const x=scaleX(i),y=scaleY(data[i]);
        ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);
        ctx.fillStyle='#fff'; // Puntos blancos sobre la onda para contraste
        ctx.fill();ctx.strokeStyle='#0d1520';ctx.lineWidth=1;ctx.stroke();
    }
    // Last point highlight
    if(numPoints>0){
        const lx=scaleX(numPoints-1),ly=scaleY(data[numPoints-1]);
        ctx.beginPath();ctx.arc(lx,ly,6,0,Math.PI*2);
        ctx.strokeStyle='#fff';ctx.lineWidth=2;
        ctx.shadowBlur=8;ctx.shadowColor=data[numPoints-1]>=0?'#00ffa2':'#ff2a4b';
        ctx.stroke();ctx.shadowBlur=0;
        ctx.fillStyle='#fff';ctx.font='bold 10px JetBrains Mono';ctx.textAlign='center';
        const v=data[numPoints-1];
        ctx.fillText((v>0?'+':'')+v,lx,ly-10);
    }
    // Legend
    const leg=[['#30e090','Travel'],['#f04060','Avg CW'],['#ff8c40','Avg CCW'],['#f5c842','Range']];
    let lx2=padL;
    ctx.font='8px Inter';
    leg.forEach(([color,label])=>{
        ctx.fillStyle=color;ctx.fillRect(lx2,5,8,8);
        ctx.fillStyle='#7a9bb8';ctx.textAlign='left';
        ctx.fillText(label,lx2+10,13);
        lx2+=ctx.measureText(label).width+22;
    });
    } catch(err) { console.error(err); }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ TRAVEL TABLE Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function renderTravelPanel() {
    try {
        const tbody   = document.getElementById('travel-tbody');
    const patEl   = document.getElementById('travel-pattern');
    const lastZEl = document.getElementById('travel-last-zone');
    if (!tbody) return;

    if (history.length >= 3) {
        updateTravelPatternUI();
    }

    if (history.length < 2) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">Selecciona una mesa...</td></tr>';
        renderTravelChart();
        return;
    }

    // Pattern & SD badges using predictor.js
    if (patEl) {
        const dealerSig = computeDealerSignature(history);
        let pat = dealerSig.directionState;
        let patClass = 'badge-stable';
        
        if (pat === 'SÃÂ­Ã¢ÂÂLIDA') patClass = 'badge-solid';
        else if (pat === 'ZIGZAG') patClass = 'badge-zigzag';
        else if (pat === 'CHAOS') patClass = 'badge-zone'; // Red color for chaos
        
        patEl.textContent = pat;
        patEl.className = `badge ${patClass}`;
        
        const sdEl = document.getElementById('travel-sd');
        if (sdEl) {
            sdEl.textContent = `SD: ${dealerSig.stdDev || '0.0'}`;
            if (dealerSig.stdDev > 10) sdEl.style.borderColor = 'var(--red)';
            else if (dealerSig.stdDev > 6) sdEl.style.borderColor = 'var(--gold)';
            else sdEl.style.borderColor = 'var(--green)';
        }
    }

    const lastN = history[history.length - 1];
    if (lastZEl) {
        let label = "UNDER";
        const lastDist = (history.length >= 2) ? calcDist(history[history.length-2], history[history.length-1]) : 0;
        if (lastDist > 0) label = (lastDist >= currentAvgCW) ? "OVER" : "UNDER";
        else if (lastDist < 0) label = (lastDist <= currentAvgCCW) ? "OVER" : "UNDER";
        
        lastZEl.textContent = `LAST: ${label}`;
        lastZEl.style.color = label === 'OVER' ? 'var(--red)' : 'var(--green)';
    }

    tbody.innerHTML = history.slice(-50).reverse().map((n, i) => {
        const idxInHistory = history.length - 1 - i;
        const prev = history[idxInHistory - 1];
        const dist = (prev !== undefined) ? calcDist(prev, n) : 0;
        const absDist = Math.abs(dist);
        const dir  = dist > 0 ? 'DER.' : (dist < 0 ? 'IZQ.' : '--');
        const numClass = n===0 ? 'num-zero' : (RED_NUMS.has(n) ? 'num-red' : 'num-black');
        const dirClass = dist >= 0 ? 'dir-der' : 'dir-izq';
        let phaseHtml = '';
        let uoHtml = '';
        if (dist !== 0) {
            const label = (absDist >= 10) ? "BIG" : "SMALL";
            const pClass = label.toLowerCase();
            phaseHtml = '<span class="phase-pill pill-' + pClass + '" style="background-color:' + (label==='BIG'?'var(--red)':'var(--green)') + '; color:white;">' + label + '</span>';
            const uo = dist > 0 ? (dist >= currentAvgCW ? 'OVER' : 'UNDER') : (dist <= currentAvgCCW ? 'OVER' : 'UNDER');
            uoHtml = '<span class="phase-pill pill-' + uo.toLowerCase() + '" style="background-color:' + (uo==='OVER'?'#ff6b35':'#4ecdc4') + '; color:white; font-size:9px;">' + uo + '</span>';
        }
        const isLast = (i === 0);
        return `<tr${isLast ? ' class="last-row"' : ''}>
            <td class="${numClass}">${n}</td>
            <td style="color:var(--text2)">${absDist}p</td>
            <td class="${dirClass}">${dir} <span style="font-size:9px;opacity:0.5">${dist >= 0 ? "&#8635;" : "&#8634;"}</span></td>
            <td>${phaseHtml}</td>
            <td>${uoHtml}</td>
        </tr>`;
    }).join('');

    renderTravelChart(); } catch (err) { console.error(err); }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ SYNC FROM SERVER Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
async function syncData() {
    if (!currentTableId) return;
    try {
        // Check wipe generation to detect remote wipes from other devices
        let localWipeGen = 0;
        try {
            localWipeGen = parseInt(localStorage.getItem('clasi_roulette_wipe_gen') || '0');
        } catch(e) {}
        
        const genResp = await fetch('/api/wipe-generation');
        let serverWipeGen = 0;
        if (genResp.ok) {
            const genData = await genResp.json();
            serverWipeGen = genData.wipeGeneration || 0;
        }
        
        if (serverWipeGen > localWipeGen) {
            console.log('[Sync] Wipe remoto detectado (gen ' + localWipeGen + ' → ' + serverWipeGen + '). Limpiando datos locales...');
            clearAllLocalStorage();
            history.length = 0; cwHistory.length = 0; ccwHistory.length = 0;
            cwN4History.length = 0; ccwN4History.length = 0;
            zoneOverHistory.length = 0; zoneUnderHistory.length = 0;
            jugHistory.length = 0; analystHistory.length = 0; masterHistory.length = 0;
            analystV2History.length = 0; sniperV2History.length = 0;
            sniperWLHistory.length = 0; travelPatternHistory.length = 0;
            patternMemory.length = 0; patternSession.length = 0;
            dirOnlyMemory.length = 0; dirOnlySession.length = 0;
            macroPatterns.length = 0; macroTransitions.length = 0;
            macroCurrentState = null; macroStateStartIdx = 0;
            evalTimestamps.length = 0; pendingMetaPatterns.length = 0;
            for (const k in metricaScoresHistory) delete metricaScoresHistory[k];
            metricaLastScores = {};
            for (const k in metricaHitCounts) delete metricaHitCounts[k];
            lastSignal = null; jugView = null; patternStatsCache = null;
            renderShadowPanel(); renderWheelAndHistory(); renderTravelPanel();
            renderAnalystUI(); renderMasterUI(); renderAgentDashboard();
        }
        localStorage.setItem('clasi_roulette_wipe_gen', String(serverWipeGen));

        const r = await fetch(`/api/history/${currentTableId}`);
        if (!r.ok) return;
        const spins = await r.json();
        const serverNums = spins.map(s => s.number);
        const serverCount = serverNums.length;
        const localCount = history.length;

        if (serverCount > localCount) {
            // Check if local history is a prefix of server history (normal operation)
            let isPrefix = true;
            if (history.length > 0 && serverNums.length >= history.length) {
                for (let i = 0; i < history.length; i++) {
                    if (history[i] !== serverNums[i]) {
                        isPrefix = false;
                        break;
                    }
                }
            } else if (history.length > serverNums.length) {
                isPrefix = false;
            }

            if (isPrefix) {
                // Normal case: local is prefix of server, just add the new entries
                const newNums = serverNums.slice(history.length);
                for (const n of newNums) submitNumber(n, false, true);
            } else {
                // Desync detected: local data doesn't match server prefix.
                // Rebuild entirely from server (source of truth) to guarantee sync
                console.log('[Sync] Desincronizacion detectada (local no es prefijo del server). Reconstruyendo desde servidor...');
                history.length = 0; cwHistory.length = 0; ccwHistory.length = 0;
                cwN4History.length = 0; ccwN4History.length = 0;
                zoneOverHistory.length = 0; zoneUnderHistory.length = 0;
                jugHistory.length = 0; analystHistory.length = 0; masterHistory.length = 0;
                analystV2History.length = 0; sniperV2History.length = 0;
                sniperWLHistory.length = 0; travelPatternHistory.length = 0;
                patternMemory.length = 0; patternSession.length = 0;
                dirOnlyMemory.length = 0; dirOnlySession.length = 0;
                macroPatterns.length = 0; macroTransitions.length = 0;
                macroCurrentState = null; macroStateStartIdx = 0;
                evalTimestamps.length = 0; pendingMetaPatterns.length = 0;
                for (const k in metricaScoresHistory) delete metricaScoresHistory[k];
                metricaLastScores = {};
                for (const k in metricaHitCounts) delete metricaHitCounts[k];
                lastSignal = null; jugView = null; patternStatsCache = null;
                lastAnalystV2Dir = null; lastSniperV2Dir = null;
                lastMasterHit = false; lastAnalystHit = false; lastJugHit = false;
                for (const n of serverNums) {
                    submitNumber(n, false, true);
                }
            }

            // Compute fresh predictions on the full history
            if (typeof computeDealerSignature === 'function' && history.length >= 3) {
                try {
                    const sig  = computeDealerSignature(history);
                    const prox = projectNextRound(history, {});
                    const masterSignals = getIAMasterSignals(prox, sig, history);
                    if (masterSignals && masterSignals.length > 0) {
                        lastSignal = masterSignals[0];
                    }
                    if (typeof predictZonePattern === 'function') {
                        jugView = predictZonePattern(history, patternStatsCache);
                    }
                    if (history.length > 0) {
                        fetchPatternMemory(history);
                    }
                } catch(e) { console.error('Predict error on sync:', e); }
            }

            // Re-render
            renderShadowPanel();
            renderTravelPanel();
            applyUniformScale();
            renderWheelAndHistory();
            renderMasterUI();
            renderAnalystUI();
            saveSessionToLocalStorage();
        } else if (serverCount < localCount && serverCount > 0) {
            // Server has fewer spins than localStorage. Server is the source of truth.
            // Rebuild entirely from server to ensure cross-device consistency.
            console.log('[Sync] Server tiene menos datos (' + serverCount + ') que localStorage (' + localCount + '). Reconstruyendo desde servidor...');
            history.length = 0; cwHistory.length = 0; ccwHistory.length = 0;
            cwN4History.length = 0; ccwN4History.length = 0;
            zoneOverHistory.length = 0; zoneUnderHistory.length = 0;
            jugHistory.length = 0; analystHistory.length = 0; masterHistory.length = 0;
            analystV2History.length = 0; sniperV2History.length = 0;
            sniperWLHistory.length = 0; travelPatternHistory.length = 0;
            patternMemory.length = 0; patternSession.length = 0;
            dirOnlyMemory.length = 0; dirOnlySession.length = 0;
            macroPatterns.length = 0; macroTransitions.length = 0;
            macroCurrentState = null; macroStateStartIdx = 0;
            evalTimestamps.length = 0; pendingMetaPatterns.length = 0;
            for (const k in metricaScoresHistory) delete metricaScoresHistory[k];
            metricaLastScores = {};
            for (const k in metricaHitCounts) delete metricaHitCounts[k];
            lastSignal = null; jugView = null; patternStatsCache = null;
            lastAnalystV2Dir = null; lastSniperV2Dir = null;
            lastMasterHit = false; lastAnalystHit = false; lastJugHit = false;
            for (const n of serverNums) {
                submitNumber(n, false, true);
            }
            if (typeof computeDealerSignature === 'function' && history.length >= 3) {
                try {
                    const sig  = computeDealerSignature(history);
                    const prox = projectNextRound(history, {});
                    const masterSignals = getIAMasterSignals(prox, sig, history);
                    if (masterSignals && masterSignals.length > 0) {
                        lastSignal = masterSignals[0];
                    }
                    if (typeof predictZonePattern === 'function') {
                        jugView = predictZonePattern(history, patternStatsCache);
                    }
                    if (history.length > 0) {
                        fetchPatternMemory(history);
                    }
                } catch(e) { console.error('Predict error on sync:', e); }
            }
            renderShadowPanel();
            renderTravelPanel();
            applyUniformScale();
            renderWheelAndHistory();
            renderMasterUI();
            renderAnalystUI();
            if (typeof trackerSource !== 'undefined' && trackerSource === 'live' && typeof renderTracker === 'function') {
                syncTrackerFromLive();
            }
            saveSessionToLocalStorage();
        } else if (serverCount === 0 && localCount > 0) {
            // Server empty, keep local data (server may be restarting)
            saveSessionToLocalStorage();
        } else if (serverCount === localCount) {
            // Data is synced; update W/L history arrays if they were lost on reload
            // W/L arrays are already loaded from localStorage, just ensure predictions are computed
            if (typeof computeDealerSignature === 'function' && history.length >= 3 && !lastSignal) {
                try {
                    const sig  = computeDealerSignature(history);
                    const prox = projectNextRound(history, {});
                    const masterSignals = getIAMasterSignals(prox, sig, history);
                    if (masterSignals && masterSignals.length > 0) {
                        lastSignal = masterSignals[0];
                    }
                    if (typeof predictZonePattern === 'function') {
                        jugView = predictZonePattern(history, patternStatsCache);
                    }
                    if (history.length > 0) {
                        fetchPatternMemory(history);
                    }
            renderShadowPanel();
            renderTravelPanel();
            applyUniformScale();
            renderWheelAndHistory();
            renderMasterUI();
            renderAnalystUI();
            if (typeof trackerSource !== 'undefined' && trackerSource === 'live' && typeof renderTracker === 'function') {
                syncTrackerFromLive();
            }
                } catch(e) { console.error('Predict error on sync:', e); }
            }
        }
        // Refresh the Tracker from the canonical Live history after every server sync.
        if (typeof trackerSource !== 'undefined' && trackerSource === 'live' && typeof syncTrackerFromLive === 'function') {
            syncTrackerFromLive();
        }
        await syncAiPredictionState();
        await loadSyncLogFromServer();
    } catch(e) {}
}

let eventSource = null;
let syncInterval = null;
let reconnectTimeout = null;
function connectSSE(tId) {
    if (eventSource) { eventSource.close(); eventSource = null; }
    eventSource = new EventSource(`/api/events/${tId}`);
    eventSource.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.type === 'ping') return;
            if (data.type === 'wipe') {
                console.log('[SSE] Wipe remoto recibido del servidor. Limpiando datos locales...');
                localWipe();
                return;
            }
            if (data.type === 'batch_load') {
                console.log("\u{1F525} Lote recibido del bot. Resincronizando datos...");
                syncData();
                return;
            }
            if (data.type === 'new_spin' && data.number !== undefined) {
                // Instantly react to new live spins
                submitNumber(data.number, false, false, data.spin_id);
            }
        } catch(err) {}
    };
    eventSource.onerror = () => {
        // On SSE disconnect, schedule a re-sync to catch missed spins
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
            console.log('[SSE] Reconectando y resincronizando...');
            syncData();
        }, 5000);
    };

    // Periodic auto-sync every 60s to catch any missed spins (cross-device safety net)
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
        if (currentTableId) syncData();
    }, 60000);
}


function applyUniformScale() {
    const shell = document.querySelector('.app-shell');
    if (!shell) return;

    // Keep real responsive sizing without artificial zoom gaps.
    shell.style.zoom = '1';
    shell.style.width = '100%';
    shell.style.maxWidth = '100%';
}

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof AIChat !== 'undefined') AIChat.init();

    // MongoDB is the only source of truth for persisted roulette data.

    renderShadowPanel();
    renderTravelPanel();
    applyUniformScale();

    try {
        let ts = [];
        try {
            const r = await fetch('/api/tables');
            if (r.ok) ts = await r.json();
        } catch(err) { console.warn('MongoDB tables request failed.', err); }

        if (!ts || ts.length === 0) {
            renderMongoConnectionStatus({ error: 'No se pudieron cargar las mesas desde MongoDB Atlas. Reconecta para continuar.' });
            return;
        }

        const tableSelect = document.getElementById('table-select');
        if (tableSelect) {
            tableSelect.innerHTML = '';
            ts.forEach(t => {
                const opt = document.createElement('option');
                opt.value = String(t.id);
                opt.textContent = t.name;
                tableSelect.appendChild(opt);
            });

            tableSelect.onchange = async () => {
                saveSessionToLocalStorage();
                currentTableId = tableSelect.value;
                if (typeof loadTrackerAiMemory === 'function') loadTrackerAiMemory();
                const tImg = document.querySelector('.table-image-container img');
                if (tImg) tImg.src = currentTableId == "1" ? 'table-1.jpg' : 'table-2.jpg';

                history.length = 0;
                cwHistory.length = 0;
                ccwHistory.length = 0;
                cwN4History.length = 0;
                ccwN4History.length = 0;
                aiN9History.length = 0;
                aiN4History.length = 0;
                lastAiPredN9 = null;
                lastAiPredN4 = null;
                lastSignal = null;
                zoneOverHistory.length = 0;
                zoneUnderHistory.length = 0;
                jugHistory.length = 0;
                analystHistory.length = 0;
                masterHistory.length = 0;
                analystV2History.length = 0;
                sniperV2History.length = 0;
                sniperWLHistory.length = 0;
                travelPatternHistory.length = 0;
                patternMemory.length = 0;
                patternSession.length = 0;
                dirOnlyMemory.length = 0;
                dirOnlySession.length = 0;
                macroPatterns.length = 0;
                macroTransitions.length = 0;
                macroCurrentState = null;
                macroStateStartIdx = 0;
                evalTimestamps.length = 0;
                pendingMetaPatterns.length = 0;
                for (const k in metricaScoresHistory) delete metricaScoresHistory[k];
                metricaLastScores = {};
                for (const k in metricaHitCounts) delete metricaHitCounts[k];

                renderWheelAndHistory();

                // Try loading from localStorage for the new table first
                const loaded = loadSessionFromLocalStorage(currentTableId);
                if (loaded) {
                    if (typeof computeDealerSignature === 'function' && history.length >= 3) {
                        try {
                            const sig  = computeDealerSignature(history);
                            const prox = projectNextRound(history, {});
                            const masterSignals = getIAMasterSignals(prox, sig, history);
                            if (masterSignals && masterSignals.length > 0) {
                                lastSignal = masterSignals[0];
                            }
                            if (typeof predictZonePattern === 'function') {
                                jugView = predictZonePattern(history, patternStatsCache);
                            }
                            if (history.length > 0) fetchPatternMemory(history);
                        } catch(e) { console.error('Predict error on tab switch:', e); }
                    }
                    renderShadowPanel();
                    renderTravelPanel();
                    applyUniformScale();
                    renderWheelAndHistory();
                    renderMasterUI();
                }

                await syncData();
                connectSSE(currentTableId);
            };

            // Force Load Initial
            currentTableId = String(ts[0].id);
            if (typeof loadTrackerAiMemory === 'function') loadTrackerAiMemory();
            tableSelect.value = currentTableId;
            const tImgInit = document.querySelector('.table-image-container img');
            if (tImgInit) tImgInit.src = currentTableId == "1" ? 'table-1.jpg' : 'table-2.jpg';

            // Load from localStorage FIRST for instant display
            const loaded = loadSessionFromLocalStorage(currentTableId);
            if (loaded) {
                if (typeof computeDealerSignature === 'function' && history.length >= 3) {
                    try {
                        const sig  = computeDealerSignature(history);
                        const prox = projectNextRound(history, {});
                        const masterSignals = getIAMasterSignals(prox, sig, history);
                        if (masterSignals && masterSignals.length > 0) {
                            lastSignal = masterSignals[0];
                        }
                        if (typeof predictZonePattern === 'function') {
                            jugView = predictZonePattern(history, patternStatsCache);
                        }
                        if (history.length > 0) fetchPatternMemory(history);
                    } catch(e) { console.error('Predict error on load:', e); }
                }
                renderShadowPanel();
                renderTravelPanel();
                applyUniformScale();
                renderWheelAndHistory();
                renderMasterUI();
            }

            await syncData();
            connectSSE(currentTableId);
        }
    } catch (e) {
        console.error('Boot error:', e);
    }
});
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ANALYST UI RENDERER Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function renderAnalystUI() {
    const boxEl    = document.getElementById('analyst-panel');
    const signalEl = document.getElementById('analyst-signal');
    const dirEl    = document.getElementById('analyst-dir');
    const sizeEl   = document.getElementById('analyst-size');
    const reasonEl = document.getElementById('analyst-reason');
    const rateEl   = document.getElementById('analyst-rate');
    const perfEl   = document.getElementById('analyst-perf-string');

    if (!signalEl) return;

    // Reset classes
    signalEl.className = 'analyst-signal';
    boxEl.setAttribute('data-type', analystView.type || 'neutral');

    // Signal & Special CSS Classes
    signalEl.innerText = analystView.signal;
    if (analystView.signal.includes('FRACTAL')) signalEl.classList.add('fractal');
    else if (analystView.signal.includes('CANAL')) signalEl.classList.add('channel');
    else if (analystView.signal.includes('RUPTURA')) signalEl.classList.add('breakout');
    else if (analystView.signal.includes('COMPRESIÃÂ­Ã¢ÂÂN')) signalEl.classList.add('compression');

    if (analystView.type === 'bullish') signalEl.style.color = 'var(--green)';
    else if (analystView.type === 'bearish') signalEl.style.color = 'var(--red)';
    else if (!signalEl.classList.contains('fractal')) signalEl.style.color = '#fff';

    // Badges
    if (analystView.targetDir) {
        dirEl.innerText = analystView.targetDir === 'CW' ? 'DER.' : 'IZQ.';
        dirEl.style.display = 'inline-block';
        dirEl.style.background = analystView.targetDir === 'CW' ? 'rgba(48,224,144,0.15)' : 'rgba(192,144,255,0.15)';
        dirEl.style.color = analystView.targetDir === 'CW' ? 'var(--green)' : '#d1abff';
        dirEl.style.borderColor = analystView.targetDir === 'CW' ? 'rgba(48,224,144,0.4)' : 'rgba(192,144,255,0.4)';
    } else {
        dirEl.style.display = 'none';
    }

    if (analystView.size) {
        sizeEl.innerText = analystView.size;
        sizeEl.style.display = 'inline-block';
    } else {
        sizeEl.style.display = 'none';
    }

    // Reason
    reasonEl.innerText = analystView.reason;

    // Stats
    const last10 = analystHistory.slice(-10);
    const wins = last10.filter(x => x === 'win').length;
    const rate = last10.length > 0 ? ((wins / last10.length) * 100).toFixed(0) : 0;
    
    rateEl.innerText = `${rate}%`;
    perfEl.innerHTML = last10.map(r => `<span class="${r==='win'?'perf-w':'perf-l'}">${r==='win'?'W':'L'}</span>`).join('');
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ MASTER UI RENDERER Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function renderMasterUI() {
    const signalEl = document.getElementById('master-signal');
    const targetEl = document.getElementById('master-target');
    const reasonEl = document.getElementById('master-reason');
    const confText = document.getElementById('master-conf-text');
    const confFill = document.getElementById('master-conf-fill');
    const rateEl   = document.getElementById('master-rate');
    const perfEl   = document.getElementById('master-perf');

    if (!signalEl) return;

    signalEl.innerText = masterView.signal;
    targetEl.innerText = masterView.target ? (masterView.target === 'CW' ? 'DERECHA' : 'IZQUIERDA') : '--';
    reasonEl.innerText = masterView.reasons || 'Analizando flujos...';
    
    // Confidence
    confText.innerText = `${masterView.confidence}%`;
    confFill.style.width = `${masterView.confidence}%`;

    // Colors
    if (masterView.confidence >= 80) {
        signalEl.style.color = '#ffeb3b';
        confFill.style.background = 'linear-gradient(90deg, #ffeb3b, #fff)';
    } else {
        signalEl.style.color = '#fff';
        confFill.style.background = 'linear-gradient(90deg, #555, #888)';
    }

    // Stats
    const last10 = masterHistory.slice(-10);
    const wins = last10.filter(x => x === 'win').length;
    const rate = last10.length > 0 ? ((wins / last10.length) * 100).toFixed(0) : 0;
    
    rateEl.innerText = `${rate}%`;
    perfEl.innerHTML = last10.map(r => `<span class="${r==='win'?'perf-w':'perf-l'}">${r==='win'?'W':'L'}</span>`).join('');
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ TOGGLE TRAVEL TABLE Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
document.addEventListener('DOMContentLoaded', () => {
    const btnCollapse = document.getElementById('toggle-travel-table');
    if (btnCollapse) {
        btnCollapse.addEventListener('click', (e) => {
            const wrap = document.getElementById('travel-table-wrap');
            if (wrap.style.display === 'none') {
                wrap.style.display = 'block';
                e.target.innerText = 'Ã¢ÂÂ² CERRAR HISTORIAL Ã¢ÂÂ²';
            } else {
                wrap.style.display = 'none';
                e.target.innerText = 'Ã¢ÂÂ¼ ABRIR HISTORIAL DE RUTAS Ã¢ÂÂ¼';
            }
        });
    }

    // Botones de Patrones
    document.getElementById('travel-history-toggle')?.addEventListener('click', function() {
        const wrap = document.getElementById('travel-pattern-hist');
        if (!wrap) return;
        if (wrap.classList.contains('hidden')) {
            wrap.classList.remove('hidden');
            this.innerHTML = '&#9652;';
            this.setAttribute('aria-expanded', 'true');
        } else {
            wrap.classList.add('hidden');
            this.innerHTML = '&#9662;';
            this.setAttribute('aria-expanded', 'false');
        }
    });

    window.addEventListener('resize', () => {
        applyUniformScale();
        if (history.length >= 2) renderTravelChart();
    });

    // Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Botones de CalibraciÃÂ³n del PREDICTOR ÃÂ±1 casilla Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
    function updatePredBadge() {
        const badge = document.getElementById('pred-offset-badge');
        if (badge) {
            badge.innerText = predictorOffset === 0 ? '0' : ((predictorOffset > 0 ? '+' : '') + predictorOffset);
            badge.style.color = predictorOffset !== 0 ? '#f0c040' : '#00e5c8';
        }
    }
    document.getElementById('btn-pred-inc')?.addEventListener('click', () => {
        predictorOffset += 1;
        updatePredBadge();
        if (history.length >= 3 && typeof computeDealerSignature === 'function') {
            const sig = computeDealerSignature(history);
            const prox = projectNextRound(history, {});
            const sigs = getIAMasterSignals(prox, sig, history, { cw: currentAvgCW, ccw: currentAvgCCW, offset: predictorOffset });
            if (sigs && sigs.length > 0) { 
                lastSignal = sigs[0]; 
                renderShadowPanel(); 
            }
        }
    });
    document.getElementById('btn-pred-dec')?.addEventListener('click', () => {
        predictorOffset -= 1;
        updatePredBadge();
        if (history.length >= 3 && typeof computeDealerSignature === 'function') {
            const sig = computeDealerSignature(history);
            const prox = projectNextRound(history, {});
            const sigs = getIAMasterSignals(prox, sig, history, { cw: currentAvgCW, ccw: currentAvgCCW, offset: predictorOffset });
            if (sigs && sigs.length > 0) { 
                lastSignal = sigs[0]; 
                renderShadowPanel(); 
            }
        }
    });
});

















// --- AUTO AI PREDICTORS VIA GROQ ---
let autoAiInFlight = false;
let lastAutoAiRequestAt = 0;
let lastAutoAiRequestKey = '';
const AUTO_AI_MIN_INTERVAL_MS = 12000;

function evaluateAiPredictions(number) {
    const mode = lastAiPredMode === 'SAFE' ? 'safe' : 'full';
    const mStats = mode === 'safe' ? aiStatsSafe : aiStatsFull;
    const mHist = mode === 'safe' ? aiHistSafe : aiHistFull;
    
    if (lastAiPredN9 && lastAiPredN9 !== 'ESPERAR' && lastAiPredN9 !== 'Sin datos' && typeof wheelNeighbors === 'function') {
        const n9Hit = wheelNeighbors(Number(lastAiPredN9), 9).includes(number);
        if (n9Hit) { mStats.n9.wins++; mHist.n9.push('win'); }
        else { mStats.n9.losses++; mHist.n9.push('loss'); }
        mStats.n9.total = mStats.n9.wins + mStats.n9.losses;
        mStats.n9.rate = mStats.n9.total ? Math.round((mStats.n9.wins / mStats.n9.total) * 100) : 0;
        if (mHist.n9.length > 20) mHist.n9.shift();
    }
    if (lastAiPredN4 && lastAiPredN4 !== 'ESPERAR' && lastAiPredN4 !== 'Sin datos' && typeof wheelNeighbors === 'function') {
        const n4Hit = wheelNeighbors(Number(lastAiPredN4), 4).includes(number);
        if (n4Hit) { mStats.n4.wins++; mHist.n4.push('win'); }
        else { mStats.n4.losses++; mHist.n4.push('loss'); }
        mStats.n4.total = mStats.n4.wins + mStats.n4.losses;
        mStats.n4.rate = mStats.n4.total ? Math.round((mStats.n4.wins / mStats.n4.total) * 100) : 0;
        if (mHist.n4.length > 20) mHist.n4.shift();
    }
    renderDirMetricHistories();
}

async function requestAutoAI() {
    const n9El = document.getElementById('ai-pred-n9-text');
    const n4El = document.getElementById('ai-pred-n4-text');
    const statusEl = document.getElementById('ai-status');
    const analysisEl = document.getElementById('auto-ai-analysis');
    if (!n9El || !n4El) return;

    if (history.length < 2) {
        n9El.innerText = "Esperando tiradas...";
        n4El.innerText = "Esperando tiradas...";
        return;
    }

    if (!lastSignal || lastSignal.targetCW === undefined || lastSignal.targetCCW === undefined) {
        n9El.innerText = "Esperando DIR...";
        n4El.innerText = "Esperando DIR...";
        if (analysisEl) analysisEl.innerText = 'Esperando las 6 medidas del panel DIR para decidir ruta y zona.';
        return;
    }

    const tableId = document.getElementById('table-select')?.value || '1';
    const requestKey = [
        tableId,
        String(window.currentAIMode || 'SAFE').toUpperCase(),
        history.slice(-6).join('-'),
        lastSignal.targetCW,
        lastSignal.targetCCW,
        lastSignal.targetUnderCW,
        lastSignal.targetOverCW,
        lastSignal.targetOverCCW,
        lastSignal.targetUnderCCW
    ].join('|');
    const now = Date.now();
    if (autoAiInFlight || (requestKey === lastAutoAiRequestKey && now - lastAutoAiRequestAt < AUTO_AI_MIN_INTERVAL_MS)) {
        return;
    }
    autoAiInFlight = true;
    lastAutoAiRequestAt = now;
    lastAutoAiRequestKey = requestKey;

    if (statusEl) statusEl.innerText = 'THINKING';
    
    let der=0, izq=0, big=0, small=0;
    let der15=0, izq15=0, big15=0, small15=0;
    let lvl = 'red';
    let pat = {label:'Estandar'};
    
    try {
        let stabilityInfo = '';
        try {
            let evts = [];
            const nCount = Math.min(history.length - 1, 8);
            for (let i = history.length - nCount; i < history.length; i++) {
                let d = calcDist(history[i-1], history[i]);
                const dir = d >= 0 ? 'DER' : 'IZQ';
                const zon = Math.abs(d) >= 10 ? 'BIG' : 'SMALL';
                evts.push({dir, zone: zon});
                if(dir==='DER') der++; else izq++;
                if(zon==='BIG') big++; else small++;
            }

            let dirSeq15 = [];
            let zoneSeq15 = [];
            const nCount15 = Math.min(history.length - 1, 15);
            for (let i = history.length - nCount15; i < history.length; i++) {
                let d = calcDist(history[i-1], history[i]);
                if (d >= 0) { der15++; dirSeq15.push('DER'); } else { izq15++; dirSeq15.push('IZQ'); }
                if (Math.abs(d) >= 10) { big15++; zoneSeq15.push('BIG'); } else { small15++; zoneSeq15.push('SMALL'); }
            }

            pat = (typeof analyzeTravelPattern === 'function') ? analyzeTravelPattern(history) : {label:'Estandar',tiradas:0};
            lvl = (typeof getStabilityLevel === 'function') ? getStabilityLevel(pat, evts) : 'red';
            const colorNames = { green: 'VERDE', yellow: 'AMARILLO', red: 'ROJO' };
            stabilityInfo = 'DOMINANCIA: DER(' + der + ') IZQ(' + izq + ') | ZONA: BIG(' + big + ') SMALL(' + small + ') | ESTADO: ' + colorNames[lvl];
        } catch(e) { stabilityInfo = 'ESTADO: Analizando...'; }

        // === CONSTRUIR PROMPT CON LAS 6 METRICAS ===
        let validMetrics = [];
        let validN9Nums = [];
        let validN4Nums = [];
        let mathContext = '';
        let cwRate = 0;
        let ccwRate = 0;
        if (lastSignal) {
            const s = lastSignal;
            const last10cw = cwHistory.slice(-10);
            const last10ccw = ccwHistory.slice(-10);
            cwRate = last10cw.length > 0 ? Number((last10cw.filter(x=>x==='win').length / last10cw.length * 100).toFixed(0)) : 0;
            ccwRate = last10ccw.length > 0 ? Number((last10ccw.filter(x=>x==='win').length / last10ccw.length * 100).toFixed(0)) : 0;
            
            validMetrics = [
                {label:'CW_N9', num: s.targetCW},
                {label:'CW_N4S', num: s.targetUnderCW},
                {label:'CW_N4B', num: s.targetOverCW},
                {label:'CCW_N9', num: s.targetCCW},
                {label:'CCW_N4S', num: s.targetUnderCCW},
                {label:'CCW_N4B', num: s.targetOverCCW}
            ];
            validN9Nums = [String(s.targetCW), String(s.targetCCW)];
            validN4Nums = [
                String(s.targetUnderCW),
                String(s.targetOverCW),
                String(s.targetOverCCW),
                String(s.targetUnderCCW)
            ];
            
            // Prompt SIN historial - solo opciones
            mathContext = 'OPCIONES (elige SOLO de aqui):\n';
            mathContext += 'A) ' + s.targetCW + ' (CW N9, Eff:' + cwRate + '%)\n';
            mathContext += 'B) ' + s.targetUnderCW + ' (CW SMALL)\n';
            mathContext += 'C) ' + s.targetOverCW + ' (CW BIG)\n';
            mathContext += 'D) ' + s.targetCCW + ' (CCW N9, Eff:' + ccwRate + '%)\n';
            mathContext += 'E) ' + s.targetUnderCCW + ' (CCW SMALL)\n';
            mathContext += 'F) ' + s.targetOverCCW + ' (CCW BIG)';
        } else {
            mathContext = 'SIN MEDIDAS - Responde ESPERAR.';
        }

        let modeInstruction = window.currentAIMode === 'SAFE' ? 'SAFE: si no hay ventaja clara, responde ESPERAR.' : 'FULL: elige la mejor jugada disponible aunque la ventaja sea corta.';
        const p = stabilityInfo + '\n' + mathContext + '\n' + modeInstruction + '\nElige 1 para N9 y 1 para N4. JSON: {"n9":"NUMERO","n4":"NUMERO"}';

        const autoAiContext = lastSignal ? {
            mode: window.currentAIMode,
            stabilityLevel: lvl,
            patternLabel: pat.label || 'Estandar',
            dominance8: { cw: der, ccw: izq, big: big, small: small },
            momentum15: { cw: der15, ccw: izq15, big: big15, small: small15 },
            sequence15: {
                dir: typeof dirSeq15 !== 'undefined' ? dirSeq15.join(' ') : '',
                zone: typeof zoneSeq15 !== 'undefined' ? zoneSeq15.join(' ') : ''
            },
            performance8: {
                cwN9: getPerfText(cwHistory),
                cwN4: getPerfText(cwN4History),
                ccwN9: getPerfText(ccwHistory),
                ccwN4: getPerfText(ccwN4History)
            },
            routes: {
                cw: {
                    n9: lastSignal.targetCW,
                    n4Small: lastSignal.targetUnderCW,
                    n4Big: lastSignal.targetOverCW,
                    hitRate: Number(cwRate)
                },
                ccw: {
                    n9: lastSignal.targetCCW,
                    n4Small: lastSignal.targetUnderCCW,
                    n4Big: lastSignal.targetOverCCW,
                    hitRate: Number(ccwRate)
                }
            },
            recentNumbers: history.slice(-15)
        } : null;

        const resp = await fetch('/api/ai/groq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: p, tableId, historyStr: history.join(','), autoAiContext })
        });
        const data = await resp.json();
        if (data.rateLimited) {
            if (statusEl) statusEl.innerText = 'WAIT';
            if (analysisEl) analysisEl.innerText = 'IA limitada por 429. No se guarda jugada ni se fuerza lectura; esperando cooldown.';
            n9El.innerText = 'ESPERAR';
            n4El.innerText = 'ESPERAR';
            return;
        }
        
        if (data.reply) {
            // Guardar prediccion en memoria con el modo en que se genero
            const parts = String(data.reply || '').split('|');
            const n9Part = parts[0] ? parts[0].replace('N9:', '').trim() : null;
            const n4Part = parts[1] ? parts[1].replace('N4:', '').trim() : null;
            if (n9Part && n9Part !== 'ESPERAR') lastAiPredN9 = n9Part;
            if (n4Part && n4Part !== 'ESPERAR') lastAiPredN4 = n4Part;
            lastAiPredMode = String(window.currentAIMode || 'SAFE').toUpperCase();
            
            // Sync from DB for display only (no afecta lastAiPredMode)
            if (typeof syncAiPredictionState === 'function') syncAiPredictionState();
        } else {
            n9El.innerText = 'Error API';
            n4El.innerText = 'Error API';
        }
    } catch(e) {
        console.error('Predictor error:', e);
        n9El.innerText = 'Error';
        n4El.innerText = 'Error';
    } finally {
        autoAiInFlight = false;
    }
}


async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msgsEl = document.getElementById('chat-messages');
    const statusEl = document.getElementById('chat-status');
    if (!input || !msgsEl) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    // Append user bubble
    const userBubble = document.createElement('div');
    userBubble.style.cssText = 'background:rgba(255,255,255,0.08);border-radius:10px;padding:6px 10px;font-size:10px;color:var(--text);max-width:85%;align-self:flex-end;line-height:1.4;';
    userBubble.innerText = text;
    msgsEl.appendChild(userBubble);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    // Thinking bubble
    const thinking = document.createElement('div');
    thinking.style.cssText = 'background:rgba(0,229,200,0.08);border-radius:10px;padding:6px 10px;font-size:10px;color:var(--accent);max-width:85%;align-self:flex-start;line-height:1.4;font-style:italic;';
    thinking.innerText = 'Pensando...';
    msgsEl.appendChild(thinking);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    if (statusEl) statusEl.innerText = 'THINKING';

    const tableId = document.getElementById('table-select') ? document.getElementById('table-select').value : 'default';

    try {
        const resp = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, tableId, historyStr: history.join(',') })
        });
        const data = await resp.json();
        thinking.innerText = data.reply || 'Sin respuesta.';
        thinking.style.fontStyle = 'normal';
    } catch(e) {
        thinking.innerText = 'Error de conexion con la IA.';
        thinking.style.color = '#f55';
    }
    if (statusEl) statusEl.innerText = 'ONLINE';
    msgsEl.scrollTop = msgsEl.scrollHeight;
}

// ─── SPIN METHOD ANALYSIS ──────────────────────────────────
async function loadSpinAnalysis() {
    const statusEl = document.getElementById('analisis-status');
    if (statusEl) statusEl.innerText = 'Cargando ultimo analisis...';
    
    try {
        const resp = await fetch('/api/spin-method/results');
        const data = await resp.json();
        renderSpinAnalysis(data);
    } catch (e) {
        if (statusEl) statusEl.innerText = 'Error cargando analisis.';
    }
}

async function runSpinAnalysis() {
    const statusEl = document.getElementById('analisis-status');
    const btn = document.getElementById('btn-analisis-run');
    if (statusEl) statusEl.innerText = 'Ejecutando analisis...';
    if (btn) { btn.innerText = '...'; btn.disabled = true; }
    
    try {
        const tableId = document.getElementById('table-select')?.value || '1';
        const resp = await fetch('/api/spin-method/analyze/' + tableId);
        const data = await resp.json();
        renderSpinAnalysis(data);
        if (statusEl) statusEl.innerText = 'Analisis completado.';
    } catch (e) {
        if (statusEl) statusEl.innerText = 'Error ejecutando analisis.';
    } finally {
        if (btn) { btn.innerText = 'EJECUTAR'; btn.disabled = false; }
    }
}

function renderSpinAnalysis(data) {
    if (!data || data.status === 'insufficient_data' || data.status === 'no_data') {
        document.getElementById('analisis-status').innerText = data?.message || 'Sin datos suficientes.';
        document.getElementById('analisis-global').style.display = 'none';
        return;
    }
    
    document.getElementById('analisis-global').style.display = 'block';
    document.getElementById('analisis-rate').innerText = data.overallHitRate + '%';
    document.getElementById('analisis-counts').innerText = data.totalAnalyzed + ' predicciones | ' + data.totalWins + 'W / ' + data.totalLosses + 'L';
    document.getElementById('analisis-rate').style.color = data.overallHitRate >= 55 ? '#0f0' : data.overallHitRate >= 40 ? '#f0c040' : '#f55';
    
    // Golden contexts
    let gold = '';
    (data.goldenContexts || []).forEach(c => {
        const color = c.hitRate >= 60 ? '#0f0' : c.hitRate >= 50 ? '#f0c040' : 'var(--text-dim)';
        gold += '<div style="font-size:9px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.03);">' +
            '<span style="color:' + color + '; font-weight:700;">' + c.hitRate + '%</span> ' +
            '<span style="color:var(--text-dim);">' + c.context + '</span> ' +
            '<span style="color:var(--text-dim);">(' + c.wins + 'W/' + c.losses + 'L en ' + c.total + ')</span>' +
            '</div>';
    });
    document.getElementById('analisis-golden').innerHTML = gold || '<span style="font-size:9px; color:var(--text-dim);">Sin contextos dorados aun (necesitan +55% en 20+ muestras).</span>';
    
    // Modes
    let modes = '';
    (data.modePerformance || []).forEach(m => {
        modes += '<div style="flex:1; background:rgba(0,0,0,0.2); border-radius:6px; padding:6px; text-align:center;">' +
            '<div style="font-size:9px; color:var(--text-dim);">' + m.label + '</div>' +
            '<div style="font-size:1.1rem; font-weight:900; color:#fff;">' + m.hitRate + '%</div>' +
            '<div style="font-size:8px; color:var(--text-dim);">' + m.wins + 'W/' + m.losses + 'L</div>' +
            '</div>';
    });
    document.getElementById('analisis-modes').innerHTML = modes || '<span style="font-size:9px; color:var(--text-dim);">--</span>';
    
    // Signals
    const sig = data.signalAnalysis || {};
    document.getElementById('analisis-signals').innerHTML = 
        '<div style="font-size:8px; color:var(--text-dim);">' +
        'Ruta fuerte (DOM≥4): <b style="color:#0f0;">' + sig.strongRouteRate + '%</b> (' + sig.strongRouteWins + 'W/' + sig.strongRouteTotal + ')' +
        ' | Mixtas: <b style="color:#f55;">' + sig.mixedRate + '%</b> (' + sig.mixedWins + 'W/' + sig.mixedTotal + ')' +
        '</div>';
    
    // Auto strategies
    let strats = '';
    (data.autoStrategies || []).slice(0, 5).forEach(s => {
        strats += '<div style="font-size:8px; padding:3px 6px; margin:2px 0; background:rgba(0,255,136,0.05); border-left:2px solid #0f0; border-radius:2px;">' +
            '<b style="color:#0f0;">' + s.name + '</b> ' +
            '<span style="color:var(--text-dim);">' + s.summary + '</span>' +
            '</div>';
    });
    document.getElementById('analisis-strategies').innerHTML = strats || '<span style="font-size:9px; color:var(--text-dim);">Sin estrategias promovidas. Se necesita +55% en 20+ muestras.</span>';
    
    // Summary
    document.getElementById('analisis-summary').innerText = data.summary || '';
    
    document.getElementById('analisis-status').innerText = 'Analisis de ' + new Date(data.generatedAt).toLocaleString();
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD ANALÍTICO INTERACTIVO — 5 sub-pestañas
// ═══════════════════════════════════════════════════════════════

let dashActiveTab = 'summary';

function switchDashTab(tab) {
    dashActiveTab = tab;
    document.querySelectorAll('.dash-subtab').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-dash') === tab);
    });
    const panels = ['summary', 'timeline', 'compare', 'patterns', 'insights', 'besthours'];
    panels.forEach(id => {
        const el = document.getElementById('dash-' + id);
        if (el) el.style.display = id === tab ? 'block' : 'none';
    });
    const placeholder = document.getElementById('dash-content');
    if (placeholder) placeholder.style.display = 'none';
    renderAgentDashboard();
}

function stats(h) {
    const t = h.filter(x => x === 'win' || x === 'loss').length;
    const w = h.filter(x => x === 'win').length;
    const l = h.filter(x => x === 'loss').length;
    const r = t > 0 ? Math.round((w / t) * 100) : 0;
    const rc = h.filter(x => x === 'win' || x === 'loss').slice(-10);
    const rw = rc.filter(x => x === 'win').length;
    const rr = rc.length > 0 ? Math.round((rw / rc.length) * 100) : 0;
    const tr = t >= 5 ? (rr > r ? 1 : rr < r ? -1 : 0) : 0;
    return { t, w, l, r, rw, rt: rc.length, rr, tr };
}

function clr(r, th) { th = th || 50; return r >= th + 5 ? 'var(--green)' : r >= th ? 'var(--gold)' : 'var(--red)'; }
function delta(v1, v2) { const d = v2 - v1; return '<span style="color:' + (d > 0 ? 'var(--green)' : d < 0 ? 'var(--red)' : 'var(--muted)') + ';">' + (d >= 0 ? '+' : '') + d + '%</span>'; }
function bar(r, c, w) { return '<div style="height:3px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:2px;width:' + (w || '100%') + ';"><div style="height:100%;width:' + r + '%;background:' + c + ';border-radius:2px;"></div></div>'; }
function winLossStr(arr, n) { const last = arr.filter(x => x === 'win' || x === 'loss').slice(-(n || 10)); return last.map(x => x === 'win' ? '<span style="color:var(--green);">W</span>' : '<span style="color:var(--red);">L</span>').join(''); }

function getDashStats() {
    const a1 = stats(analystHistory);
    const a2 = stats(analystV2History);
    const s1 = stats(masterHistory);
    const s2 = stats(sniperV2History);
    return { a1, a2, s1, s2, aDelta: a2.r - a1.r, sDelta: s2.r - s1.r };
}

function renderAgentDashboard() {
    const status = document.getElementById('panel-status');
    if (status) status.innerText = '4 AGENTES | ACTIVO';

    // Refrescar solo la pestaña activa
    switch (dashActiveTab) {
        case 'summary':  renderDashSummary(); break;
        case 'timeline': renderDashTimeline(); break;
        case 'compare':  renderDashCompare(); break;
        case 'patterns': renderDashPatterns(); break;
        case 'insights': renderDashInsights(); break;
        case 'besthours': renderDashBestHours(); break;
        default: renderDashSummary();
    }
}

// ─── SUB-TAB CLICK HANDLER ───
document.addEventListener('click', function(e) {
    if (!e.target || !e.target.classList.contains('dash-subtab')) return;
    const tab = e.target.getAttribute('data-dash');
    if (!tab) return;
    switchDashTab(tab);
});

// ═══════════════════════════════════════════
// 1. RESUMEN — KPI cards + mejor agente
// ═══════════════════════════════════════════
function renderDashSummary() {
    const panel = document.getElementById('dash-summary');
    if (!panel) return;
    panel.style.display = 'block';

    const { a1, a2, s1, s2 } = getDashStats();
    let html = '';

    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<span style="font-size:9px;font-weight:700;color:var(--text);">&#128200; RESUMEN DE AGENTES</span>';
    html += '<span style="font-size:7px;color:var(--muted);">' + history.length + ' spins | ' + (a1.t + s1.t) + ' evals</span>';
    html += '</div>';

    // KPI GRID 2x2
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:6px;">';

    // Analyst V1
    html += '<div class="dash-kpi" style="border-color:rgba(0,229,200,0.12);" onclick="switchDashTab(\'compare\')">';
    html += '<div style="font-size:7px;color:var(--muted);">&#128202; ANALYST V1</div>';
    html += '<span style="font-size:1.2rem;font-weight:900;color:' + clr(a1.r) + ';">' + a1.r + '%</span>';
    html += '<div style="font-size:7px;color:var(--text-dim);">' + a1.w + 'W/' + a1.l + 'L (' + a1.t + ' total)</div>';
    html += bar(a1.r, clr(a1.r));
    html += '<div style="font-size:7px;color:var(--muted);margin-top:1px;">Últ 10: ' + a1.rr + '%</div>';
    html += '</div>';

    // Analyst V2
    html += '<div class="dash-kpi" style="border-color:rgba(0,229,200,0.2);" onclick="switchDashTab(\'compare\')">';
    html += '<div style="display:flex;justify-content:space-between;">';
    html += '<span style="font-size:7px;color:var(--accent);">&#128202; ANALYST V2 +DB</span>';
    html += '<span style="font-size:7px;">' + delta(a1.r, a2.r) + '</span>';
    html += '</div>';
    html += '<span style="font-size:1.2rem;font-weight:900;color:' + clr(a2.r) + ';">' + a2.r + '%</span>';
    html += '<div style="font-size:7px;color:var(--text-dim);">' + a2.w + 'W/' + a2.l + 'L (' + a2.t + ' total)</div>';
    html += bar(a2.r, clr(a2.r));
    html += '<div style="font-size:7px;color:var(--muted);margin-top:1px;">Últ 10: ' + a2.rr + '%</div>';
    html += '</div>';

    // Sniper V1
    html += '<div class="dash-kpi" style="border-color:rgba(255,100,100,0.12);" onclick="switchDashTab(\'compare\')">';
    html += '<div style="font-size:7px;color:var(--muted);">&#127919; SNIPER V1</div>';
    html += '<span style="font-size:1.2rem;font-weight:900;color:' + clr(s1.r) + ';">' + s1.r + '%</span>';
    html += '<div style="font-size:7px;color:var(--text-dim);">' + s1.w + 'W/' + s1.l + 'L (' + s1.t + ' total)</div>';
    html += bar(s1.r, clr(s1.r));
    html += '<div style="font-size:7px;color:var(--muted);margin-top:1px;">Últ 10: ' + s1.rr + '%</div>';
    html += '</div>';

    // Sniper V2
    html += '<div class="dash-kpi" style="border-color:rgba(255,100,100,0.2);" onclick="switchDashTab(\'compare\')">';
    html += '<div style="display:flex;justify-content:space-between;">';
    html += '<span style="font-size:7px;color:#f55;">&#127919; SNIPER V2 +DB</span>';
    html += '<span style="font-size:7px;">' + delta(s1.r, s2.r) + '</span>';
    html += '</div>';
    html += '<span style="font-size:1.2rem;font-weight:900;color:' + clr(s2.r) + ';">' + s2.r + '%</span>';
    html += '<div style="font-size:7px;color:var(--text-dim);">' + s2.w + 'W/' + s2.l + 'L (' + s2.t + ' total)</div>';
    html += bar(s2.r, clr(s2.r));
    html += '<div style="font-size:7px;color:var(--muted);margin-top:1px;">Últ 10: ' + s2.rr + '%</div>';
    html += '</div>';

    html += '</div>'; // end KPI grid

    // MEJOR AGENTE destacado
    const all = [
        { n: 'Analyst V1', r: a1.r, t: a1.t, c: 'var(--green)' },
        { n: 'Analyst V2', r: a2.r, t: a2.t, c: 'var(--accent)' },
        { n: 'Sniper V1', r: s1.r, t: s1.t, c: '#f55' },
        { n: 'Sniper V2', r: s2.r, t: s2.t, c: '#ff9800' }
    ];
    all.sort((a, b) => b.r - a.r);
    if (all[0].t > 0) {
        html += '<div style="padding:6px;background:rgba(240,192,64,0.06);border:1px solid rgba(240,192,64,0.15);border-radius:6px;text-align:center;">';
        html += '<div style="font-size:8px;color:var(--gold);font-weight:700;">&#11088; MEJOR AGENTE</div>';
        html += '<span style="font-size:13px;font-weight:900;color:' + all[0].c + ';">' + all[0].n + ' — ' + all[0].r + '%</span>';
        html += '<div style="font-size:7px;color:var(--muted);">' + all[0].t + ' evaluaciones</div>';
        html += '</div>';
    }

    // Acceso rápido
    html += '<div style="display:flex;gap:4px;margin-top:6px;font-size:7px;color:var(--muted);">';
    html += '<span style="cursor:pointer;padding:3px 6px;background:rgba(255,255,255,0.03);border-radius:3px;" onclick="switchDashTab(\'timeline\')">&#128200; Ver Línea de Tiempo</span>';
    html += '<span style="cursor:pointer;padding:3px 6px;background:rgba(255,255,255,0.03);border-radius:3px;" onclick="switchDashTab(\'compare\')">&#9878; Comparar V1 vs V2</span>';
    html += '</div>';

    panel.innerHTML = html;
}

// ═══════════════════════════════════════════
// 2. LÍNEA DE TIEMPO — Canvas con 4 métricas separadas
// ═══════════════════════════════════════════
function renderDashTimeline() {
    const panel = document.getElementById('dash-timeline');
    const canvas = document.getElementById('dashTimelineCanvas');
    const hotzonesDiv = document.getElementById('dash-timeline-hotzones');
    if (!panel || !canvas) return;
    panel.style.display = 'block';

    if (!canvas._seriesVisible) {
        canvas._seriesVisible = [true, true];
    }
    const seriesVisible = canvas._seriesVisible;

    // ─── Construir arrays de dirección y zona desde history ───
    const pairCount = Math.min(evalTimestamps.length, history.length - 1);
    const hStart = history.length - pairCount;
    const cwArr = [];    // 1 = CW (+1), 0 = CCW
    const ccwArr = [];   // 1 = CCW (-1), 0 = CW
    const bigArr = [];   // 1 = BIG (+1), 0 = SMALL
    const smallArr = []; // 1 = SMALL (-1), 0 = BIG
    for (let i = 0; i < pairCount; i++) {
        const d = calcDist(history[hStart + i - 1], history[hStart + i]);
        cwArr.push(d > 0 ? 1 : 0);
        ccwArr.push(d < 0 ? 1 : 0);
        bigArr.push(Math.abs(d) >= 10 ? 1 : 0);
        smallArr.push(Math.abs(d) < 10 ? 1 : 0);
    }

    const timestamps = evalTimestamps.slice(-pairCount);

    function rollingAvg(arr, window) {
        const result = [];
        for (let i = 0; i < arr.length; i++) {
            const start = Math.max(0, i - window + 1);
            const slice = arr.slice(start, i + 1);
            const sum = slice.reduce((a, b) => a + b, 0);
            result.push(Math.round((sum / slice.length) * 100));
        }
        return result;
    }

    // Calcular acumulados - Solo 2 líneas:
    // Dirección: +1 si CW (der), -1 si CCW (izq)
    // Zona: +1 si BIG, -1 si SMALL
    const dirArr = [0], zoneArr = [0];
    for (let i = 0; i < pairCount; i++) {
        const d = calcDist(history[hStart + i - 1], history[hStart + i]);
        const isCW = d > 0;
        const isBig = Math.abs(d) >= 10;
        
        dirArr.push(dirArr[dirArr.length - 1] + (isCW ? 1 : -1));
        zoneArr.push(zoneArr[zoneArr.length - 1] + (isBig ? 1 : -1));
    }
    
    const maxLen = Math.max(dirArr.length, 2);

    // ─── DIBUJAR CANVAS ───
    const ctx = canvas.getContext('2d');
    const W = canvas.parentElement ? canvas.parentElement.offsetWidth - 16 : 400;
    const H = canvas.height || 200;
    canvas.width = W;
    canvas.style.width = W + 'px';

    const padL = 40, padR = 10, padT = 25, padB = 25;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    // Auto-zoom: encontrar min/max de ambas líneas para escalar
    const allValues = [...dirArr, ...zoneArr];
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    const valueRange = maxVal - minVal;
    // Agregar padding del 10% para que no toquen los bordes
    const paddedRange = valueRange * 1.2;
    const scaleY = paddedRange > 0 ? chartH / paddedRange : chartH;
    // Calcular Y del valor 0 (puede estar fuera del canvas si los valores son muy positivos o negativos)
    const zeroY = padT + chartH - (0 - minVal + valueRange * 0.1) * scaleY;

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, W, H);

    if (maxLen < 2) {
        ctx.fillStyle = '#7a9bb8';
        ctx.font = '10px Inter';
        ctx.fillText('Esperando datos...', W / 2 - 40, H / 2);
        if (hotzonesDiv) hotzonesDiv.innerHTML = '<span style="color:var(--muted);">Se necesitan al menos 10 evaluaciones.</span>';
        return;
    }

    // Grid y labels - mostrar min, max y puntos intermedios
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    const gridSteps = 5;
    for (let i = 0; i <= gridSteps; i++) {
        const val = minVal + (valueRange * i / gridSteps);
        const y = padT + chartH - (val - minVal + valueRange * 0.1) * scaleY;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(W - padR, y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '8px Inter';
        ctx.fillText(String(Math.round(val)), 2, y + 3);
    }

    // Línea de equilibrio en 0 (solo si está dentro del rango visible)
    if (minVal <= 0 && maxVal >= 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, zeroY);
        ctx.lineTo(W - padR, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Dibujar series: 2 líneas acumulativas con auto-zoom
    const seriesConfig = [
        { data: dirArr, color: '#30e090', label: 'Dirección (+/-)' },
        { data: zoneArr, color: '#60c0ff', label: 'Zona (+/-)' }
    ];

    seriesConfig.forEach((sc, idx) => {
        if (sc.data.length < 2) return;
        if (!seriesVisible[idx]) return;
        ctx.strokeStyle = sc.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let i = 0; i < sc.data.length; i++) {
            const x = padL + (i / (maxLen - 1)) * chartW;
            const y = padT + chartH - (sc.data[i] - minVal + valueRange * 0.1) * scaleY;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    });

    // Etiquetas eje X
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '7px Inter';
    const xSteps = Math.min(5, maxLen);
    for (let i = 0; i <= xSteps; i++) {
        const idx = Math.round((i / xSteps) * (maxLen - 1));
        const x = padL + (idx / (maxLen - 1)) * chartW;
        let label;
        if (timestamps.length > idx && timestamps[idx]) {
            const d = new Date(timestamps[idx]);
            label = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        } else {
            label = '#' + (idx + 1);
        }
        ctx.fillText(label, x - 10, H - 4);
    }

    // Leyenda
    const legendY = padT + 2;
    let legendX = padL + 4;
    canvas._legendRects = [];
    seriesConfig.forEach((sc, idx) => {
        if (sc.data.length < 2) return;
        const visible = seriesVisible[idx];
        ctx.fillStyle = visible ? sc.color : 'rgba(255,255,255,0.15)';
        ctx.fillRect(legendX, legendY, 8, 2);
        ctx.fillStyle = visible ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)';
        ctx.font = '7px Inter';
        const labelText = sc.label + (visible ? '' : ' (off)');
        ctx.fillText(labelText, legendX + 10, legendY + 6);
        const textW = ctx.measureText(labelText).width;
        canvas._legendRects.push({
            x: legendX - 2, y: legendY - 4,
            w: textW + 16, h: 14,
            index: idx
        });
        legendX += textW + 22;
    });

    // Info de rango de tiempo
    let timeRangeHtml = '';
    if (timestamps.length > 0) {
        const first = new Date(timestamps[0]);
        const last = new Date(timestamps[timestamps.length - 1]);
        const fmt = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        const diffMin = Math.round((last - first) / 60000);
        timeRangeHtml = '<span style="font-size:7px;color:var(--muted);">' + timestamps.length + ' giros en ' + diffMin + 'min (' + fmt(first) + ' — ' + fmt(last) + ')</span>';
    }

    if (hotzonesDiv) {
        const lastDir = dirArr[dirArr.length - 1];
        const lastZone = zoneArr[zoneArr.length - 1];
        
        hotzonesDiv.innerHTML = '<div style="font-size:8px;color:var(--gold);font-weight:700;margin-bottom:3px;">&#128200; LÍNEA DE TIEMPO ' + timeRangeHtml + '</div>';
        hotzonesDiv.innerHTML += '<div style="margin-top:4px;display:flex;gap:8px;font-size:7px;color:var(--text-dim);flex-wrap:wrap;">';
        hotzonesDiv.innerHTML += '<span>Dirección: <b style="color:#30e090;">' + (lastDir >= 0 ? '+' : '') + lastDir + '</b></span>';
        hotzonesDiv.innerHTML += '<span>Zona: <b style="color:#60c0ff;">' + (lastZone >= 0 ? '+' : '') + lastZone + '</b></span>';
        hotzonesDiv.innerHTML += '<span>Total: <b>' + cwArr.length + '</b></span>';
        hotzonesDiv.innerHTML += '</div>';
    }

    // Click en leyenda
    canvas.style.cursor = 'pointer';
    canvas.onclick = function(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const mx = (e.clientX - rect.left) * scaleX;
        const my = (e.clientY - rect.top) * scaleY;
        const legendRects = canvas._legendRects || [];
        for (const lr of legendRects) {
            if (mx >= lr.x && mx <= lr.x + lr.w && my >= lr.y && my <= lr.y + lr.h) {
                canvas._seriesVisible[lr.index] = !canvas._seriesVisible[lr.index];
                renderDashTimeline();
                return;
            }
        }
    };
}

// ═══════════════════════════════════════════
// 2b. MEJORES HORAS — Análisis por franjas de 30min
// ═══════════════════════════════════════════
function renderDashBestHours() {
    const panel = document.getElementById('dash-besthours');
    if (!panel) return;
    panel.style.display = 'block';

    // Construir arrays base igual que en timeline
    const pairCount = Math.min(evalTimestamps.length, history.length - 1);
    const hStart = history.length - pairCount;
    const cwArr = [], ccwArr = [], bigArr = [], smallArr = [];
    for (let i = 0; i < pairCount; i++) {
        const d = calcDist(history[hStart + i - 1], history[hStart + i]);
        cwArr.push(d > 0 ? 1 : 0);
        ccwArr.push(d < 0 ? 1 : 0);
        bigArr.push(Math.abs(d) >= 10 ? 1 : 0);
        smallArr.push(Math.abs(d) < 10 ? 1 : 0);
    }
    const timestamps = evalTimestamps.slice(-pairCount);

    if (timestamps.length < 10) {
        panel.innerHTML = '<div style="padding:10px;text-align:center;color:var(--muted);">Se necesitan al menos 10 giros para generar el análisis de mejores horas.</div>';
        return;
    }

    // Agrupar por franja de 30 minutos
    const binKey = function(ts) {
        const d = new Date(ts);
        const h = d.getHours();
        const m = d.getMinutes() < 30 ? 0 : 30;
        return h * 100 + m;
    };
    const formatBin = function(key) {
        const h = Math.floor(key / 100);
        const m = key % 100;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    };

    const bins = {};
    for (let i = 0; i < timestamps.length; i++) {
        const key = binKey(timestamps[i]);
        if (!bins[key]) bins[key] = { cw: 0, ccw: 0, big: 0, small: 0, total: 0 };
        bins[key].cw += cwArr[i] || 0;
        bins[key].ccw += ccwArr[i] || 0;
        bins[key].big += bigArr[i] || 0;
        bins[key].small += smallArr[i] || 0;
        bins[key].total++;
    }

    const entries = Object.entries(bins).map(function(_ref) {
        var key = _ref[0], data = _ref[1];
        key = parseInt(key);
        return {
            key: key,
            label: formatBin(key),
            cwPct: Math.round(data.cw / data.total * 100),
            ccwPct: Math.round(data.ccw / data.total * 100),
            bigPct: Math.round(data.big / data.total * 100),
            smallPct: Math.round(data.small / data.total * 100),
            total: data.total,
            sortKey: key
        };
    }).sort(function(a, b) { return a.sortKey - b.sortKey; });

    // Rangos para color
    var fmtTimeRange = '';
    if (timestamps.length > 0) {
        var first = new Date(timestamps[0]);
        var last = new Date(timestamps[timestamps.length - 1]);
        var fmt = function(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
        var diffMin = Math.round((last.getTime() - first.getTime()) / 60000);
        fmtTimeRange = '<span style="font-size:7px;color:var(--muted);">' + timestamps.length + ' giros en ' + diffMin + 'min (' + fmt(first) + ' — ' + fmt(last) + ')</span>';
    }

    var html = '';

    // Título
    html += '<div style="font-size:9px;font-weight:700;color:var(--gold);margin-bottom:6px;">&#128293; MEJORES HORAS — Franjas de 30 min ' + fmtTimeRange + '</div>';

    // ── SECCIÓN 1: Tabla completa por franja ──
    html += '<div style="font-size:7px;color:var(--muted);margin-bottom:3px;">&#128197; REGISTRO COMPLETO POR FRANJA</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:8px;margin-bottom:8px;">';
    html += '<tr style="color:var(--muted);border-bottom:1px solid var(--border);">';
    html += '<th style="text-align:left;padding:3px 4px;">Franja</th>';
    html += '<th style="text-align:center;padding:3px 4px;color:#30e090;">Der +1</th>';
    html += '<th style="text-align:center;padding:3px 4px;color:#f06040;">Izq -1</th>';
    html += '<th style="text-align:center;padding:3px 4px;color:#60c0ff;">Big +1</th>';
    html += '<th style="text-align:center;padding:3px 4px;color:#f0c040;">Small -1</th>';
    html += '<th style="text-align:center;padding:3px 4px;">Giros</th>';
    html += '</tr>';

    entries.forEach(function(e) {
        var dirDominante = e.cwPct >= 66 ? 'CW' : e.ccwPct >= 66 ? 'CCW' : null;
        var zoneDominante = e.bigPct >= 66 ? 'BIG' : e.smallPct >= 66 ? 'SMALL' : null;
        var isGreen = dirDominante && zoneDominante;

        var rowBg = isGreen ? 'rgba(48,224,144,0.08)' : (dirDominante || zoneDominante) ? 'rgba(255,255,255,0.02)' : 'transparent';

        html += '<tr style="background:' + rowBg + ';border-bottom:1px solid rgba(255,255,255,0.02);">';
        html += '<td style="padding:3px 4px;font-weight:600;color:var(--text);">' + e.label + (isGreen ? ' &#9989;' : '') + '</td>';
        html += '<td style="padding:3px 4px;text-align:center;color:' + (e.cwPct >= 60 ? '#30e090' : e.cwPct >= 50 ? 'var(--muted)' : 'rgba(48,224,144,0.3)') + ';font-weight:' + (e.cwPct >= 60 ? '700' : '400') + ';">' + e.cwPct + '%</td>';
        html += '<td style="padding:3px 4px;text-align:center;color:' + (e.ccwPct >= 60 ? '#f06040' : e.ccwPct >= 50 ? 'var(--muted)' : 'rgba(240,96,64,0.3)') + ';font-weight:' + (e.ccwPct >= 60 ? '700' : '400') + ';">' + e.ccwPct + '%</td>';
        html += '<td style="padding:3px 4px;text-align:center;color:' + (e.bigPct >= 60 ? '#60c0ff' : e.bigPct >= 50 ? 'var(--muted)' : 'rgba(96,192,255,0.3)') + ';font-weight:' + (e.bigPct >= 60 ? '700' : '400') + ';">' + e.bigPct + '%</td>';
        html += '<td style="padding:3px 4px;text-align:center;color:' + (e.smallPct >= 60 ? '#f0c040' : e.smallPct >= 50 ? 'var(--muted)' : 'rgba(240,192,64,0.3)') + ';font-weight:' + (e.smallPct >= 60 ? '700' : '400') + ';">' + e.smallPct + '%</td>';
        html += '<td style="padding:3px 4px;text-align:center;color:var(--muted);">' + e.total + '</td>';
        html += '</tr>';
    });
    html += '</table>';

    // ── SECCIÓN 2: Mejores horas de dominancia total (FONDO VERDE) ──
    html += '<div style="font-size:7px;color:var(--muted);margin-bottom:3px;">&#9989; FRANJAS DE FONDO VERDE (Dirección + Zona coinciden &gt;66%)</div>';
    var greenEntries = entries.filter(function(e) {
        return (e.cwPct >= 66 || e.ccwPct >= 66) && (e.bigPct >= 66 || e.smallPct >= 66);
    });

    if (greenEntries.length === 0) {
        html += '<div style="font-size:7px;color:var(--muted);padding:6px;background:rgba(0,0,0,0.1);border-radius:4px;">Aún no hay franjas con dominancia clara en ambas dimensiones. Se necesita &gt;66% en dirección Y zona.</div>';
    } else {
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">';
        greenEntries.forEach(function(e) {
            var domDir = e.cwPct >= 66 ? 'Der(+1)' : 'Izq(-1)';
            var domZone = e.bigPct >= 66 ? 'Big(+1)' : 'Small(-1)';
            var dirC = e.cwPct >= 66 ? '#30e090' : '#f06040';
            var zoneC = e.bigPct >= 66 ? '#60c0ff' : '#f0c040';
            html += '<span style="display:inline-block;padding:4px 8px;background:rgba(48,224,144,0.12);border:1px solid rgba(48,224,144,0.2);border-radius:4px;font-size:8px;">';
            html += '<b style="color:var(--text);">' + e.label + '</b> ';
            html += '<span style="color:' + dirC + ';">' + domDir + '</span> ';
            html += '<span style="color:' + zoneC + ';">' + domZone + '</span> ';
            html += '<span style="color:var(--muted);">(' + e.total + 'g)</span>';
            html += '</span>';
        });
        html += '</div>';
    }

    // ── SECCIÓN 3: Franjas de mejor dominio de dirección ──
    html += '<div style="font-size:7px;color:var(--muted);margin-bottom:3px;">&#10145; MEJOR DOMINANCIA DE DIRECCIÓN (Der+1 / Izq-1 &gt;66%)</div>';
    var dirEntries = entries.filter(function(e) { return e.cwPct >= 66 || e.ccwPct >= 66; });
    if (dirEntries.length === 0) {
        html += '<div style="font-size:7px;color:var(--muted);padding:6px;margin-bottom:6px;">Sin franjas de alta dominancia direccional.</div>';
    } else {
        html += '<table style="width:100%;border-collapse:collapse;font-size:8px;margin-bottom:8px;">';
        html += '<tr style="color:var(--muted);border-bottom:1px solid var(--border);">';
        html += '<th style="text-align:left;padding:2px 4px;">Franja</th>';
        html += '<th style="text-align:center;padding:2px 4px;">Dominancia</th>';
        html += '<th style="text-align:center;padding:2px 4px;">%</th>';
        html += '<th style="text-align:center;padding:2px 4px;">Giros</th>';
        html += '</tr>';
        dirEntries.forEach(function(e) {
            var isCW = e.cwPct > e.ccwPct;
            var domLabel = isCW ? 'Der +1' : 'Izq -1';
            var domPct = isCW ? e.cwPct : e.ccwPct;
            var domC = isCW ? '#30e090' : '#f06040';
            html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.02);">';
            html += '<td style="padding:2px 4px;font-weight:600;">' + e.label + '</td>';
            html += '<td style="padding:2px 4px;text-align:center;color:' + domC + ';font-weight:700;">' + domLabel + '</td>';
            html += '<td style="padding:2px 4px;text-align:center;color:' + domC + ';">' + domPct + '%</td>';
            html += '<td style="padding:2px 4px;text-align:center;color:var(--muted);">' + e.total + '</td>';
            html += '</tr>';
        });
        html += '</table>';
    }

    // ── SECCIÓN 4: Franjas de mejor dominio de zona ──
    html += '<div style="font-size:7px;color:var(--muted);margin-bottom:3px;">&#128201; MEJOR DOMINANCIA DE ZONA (Big+1 / Small-1 &gt;66%)</div>';
    var zoneEntries = entries.filter(function(e) { return e.bigPct >= 66 || e.smallPct >= 66; });
    if (zoneEntries.length === 0) {
        html += '<div style="font-size:7px;color:var(--muted);padding:6px;">Sin franjas de alta dominancia de zona.</div>';
    } else {
        html += '<table style="width:100%;border-collapse:collapse;font-size:8px;margin-bottom:8px;">';
        html += '<tr style="color:var(--muted);border-bottom:1px solid var(--border);">';
        html += '<th style="text-align:left;padding:2px 4px;">Franja</th>';
        html += '<th style="text-align:center;padding:2px 4px;">Dominancia</th>';
        html += '<th style="text-align:center;padding:2px 4px;">%</th>';
        html += '<th style="text-align:center;padding:2px 4px;">Giros</th>';
        html += '</tr>';
        zoneEntries.forEach(function(e) {
            var isBig = e.bigPct > e.smallPct;
            var domLabel = isBig ? 'Big +1' : 'Small -1';
            var domPct = isBig ? e.bigPct : e.smallPct;
            var domC = isBig ? '#60c0ff' : '#f0c040';
            html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.02);">';
            html += '<td style="padding:2px 4px;font-weight:600;">' + e.label + '</td>';
            html += '<td style="padding:2px 4px;text-align:center;color:' + domC + ';font-weight:700;">' + domLabel + '</td>';
            html += '<td style="padding:2px 4px;text-align:center;color:' + domC + ';">' + domPct + '%</td>';
            html += '<td style="padding:2px 4px;text-align:center;color:var(--muted);">' + e.total + '</td>';
            html += '</tr>';
        });
        html += '</table>';
    }

    // ── SECCIÓN 5: Resumen global ──
    var globalCW = cwArr.length > 0 ? Math.round(cwArr.reduce(function(a, b) { return a + b; }, 0) / cwArr.length * 100) : 0;
    var globalCCW = ccwArr.length > 0 ? Math.round(ccwArr.reduce(function(a, b) { return a + b; }, 0) / ccwArr.length * 100) : 0;
    var globalBIG = bigArr.length > 0 ? Math.round(bigArr.reduce(function(a, b) { return a + b; }, 0) / bigArr.length * 100) : 0;
    var globalSMALL = smallArr.length > 0 ? Math.round(smallArr.reduce(function(a, b) { return a + b; }, 0) / smallArr.length * 100) : 0;

    html += '<div style="margin-top:6px;padding:6px 8px;background:rgba(0,0,0,0.1);border:1px solid var(--border);border-radius:5px;">';
    html += '<div style="font-size:7px;color:var(--muted);margin-bottom:4px;">&#128202; DOMINANCIA GLOBAL (Todos los giros)</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:8px;">';
    html += '<span>Der +1: <b style="color:#30e090;">' + globalCW + '%</b></span>';
    html += '<span>Izq -1: <b style="color:#f06040;">' + globalCCW + '%</b></span>';
    html += '<span>Big +1: <b style="color:#60c0ff;">' + globalBIG + '%</b></span>';
    html += '<span>Small -1: <b style="color:#f0c040;">' + globalSMALL + '%</b></span>';
    html += '<span>Total: <b>' + cwArr.length + ' giros</b></span>';
    html += '</div></div>';

    panel.innerHTML = html;
}

// ═══════════════════════════════════════════
// 3. COMPARATIVA — V1 vs V2 detallada
// ═══════════════════════════════════════════
function renderDashCompare() {
    const panel = document.getElementById('dash-compare');
    if (!panel) return;
    panel.style.display = 'block';

    const { a1, a2, s1, s2, aDelta, sDelta } = getDashStats();
    let html = '';

    html += '<div style="font-size:9px;font-weight:700;color:var(--text);margin-bottom:6px;">&#9878; COMPARATIVA V1 vs V2 +DB</div>';

    // ANALYST
    html += '<div style="padding:5px;background:rgba(255,255,255,0.01);border:1px solid rgba(255,255,255,0.04);border-radius:5px;margin-bottom:5px;">';
    html += '<div style="font-size:7px;color:var(--accent);font-weight:700;margin-bottom:3px;">&#128202; COMPARATIVA ANALYST ' + delta(a1.r, a2.r) + '</div>';
    html += '<div style="display:flex;gap:4px;">';
    html += '<div style="flex:1;font-size:7px;padding:4px;background:rgba(0,0,0,0.15);border-radius:3px;text-align:center;">';
    html += '<div style="color:var(--muted);">V1 (Wave Analysis)</div>';
    html += '<div style="font-weight:700;color:' + clr(a1.r) + ';font-size:12px;">' + a1.r + '%</div>';
    html += '<div style="color:var(--text-dim);">' + a1.w + 'W/' + a1.l + 'L de ' + a1.t + '</div>';
    html += '<div style="margin-top:2px;font-family:var(--mono);">' + winLossStr(analystHistory, 10) + '</div>';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;font-size:8px;color:var(--gold);font-weight:700;">vs</div>';
    html += '<div style="flex:1;font-size:7px;padding:4px;background:rgba(0,229,200,0.04);border-radius:3px;text-align:center;">';
    html += '<div style="color:var(--accent);">V2 +DB Patterns</div>';
    html += '<div style="font-weight:700;color:' + clr(a2.r) + ';font-size:12px;">' + a2.r + '% ' + (aDelta >= 0 ? '&#9650;' : '&#9660;') + '</div>';
    html += '<div style="color:var(--text-dim);">' + a2.w + 'W/' + a2.l + 'L de ' + a2.t + '</div>';
    html += '<div style="margin-top:2px;font-family:var(--mono);">' + winLossStr(analystV2History, 10) + '</div>';
    html += '</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:4px;margin-top:3px;font-size:7px;">';
    html += '<div style="flex:1;color:var(--text-dim);">Señal actual: <span style="color:var(--text);">' + (analystView.signal || '--') + '</span></div>';
    html += '<div style="flex:1;color:var(--text-dim);">V2 Dir: <span style="color:' + (lastAnalystV2Dir === 'CW' ? 'var(--green)' : lastAnalystV2Dir === 'CCW' ? '#d1abff' : 'var(--muted)') + ';">' + (lastAnalystV2Dir || '--') + '</span></div>';
    html += '</div>';
    html += '</div>';

    // SNIPER
    html += '<div style="padding:5px;background:rgba(255,255,255,0.01);border:1px solid rgba(255,255,255,0.04);border-radius:5px;">';
    html += '<div style="font-size:7px;color:#f55;font-weight:700;margin-bottom:3px;">&#127919; COMPARATIVA SNIPER ' + delta(s1.r, s2.r) + '</div>';
    html += '<div style="display:flex;gap:4px;">';
    html += '<div style="flex:1;font-size:7px;padding:4px;background:rgba(0,0,0,0.15);border-radius:3px;text-align:center;">';
    html += '<div style="color:var(--muted);">V1 (Master AI)</div>';
    html += '<div style="font-weight:700;color:' + clr(s1.r) + ';font-size:12px;">' + s1.r + '%</div>';
    html += '<div style="color:var(--text-dim);">' + s1.w + 'W/' + s1.l + 'L de ' + s1.t + '</div>';
    html += '<div style="margin-top:2px;font-family:var(--mono);">' + winLossStr(masterHistory, 10) + '</div>';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;font-size:8px;color:var(--gold);font-weight:700;">vs</div>';
    html += '<div style="flex:1;font-size:7px;padding:4px;background:rgba(255,100,100,0.04);border-radius:3px;text-align:center;">';
    html += '<div style="color:#f55;">V2 +DB +Turb</div>';
    html += '<div style="font-weight:700;color:' + clr(s2.r) + ';font-size:12px;">' + s2.r + '% ' + (sDelta >= 0 ? '&#9650;' : '&#9660;') + '</div>';
    html += '<div style="color:var(--text-dim);">' + s2.w + 'W/' + s2.l + 'L de ' + s2.t + '</div>';
    html += '<div style="margin-top:2px;font-family:var(--mono);">' + winLossStr(sniperV2History, 10) + '</div>';
    html += '</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:4px;margin-top:3px;font-size:7px;">';
    html += '<div style="flex:1;color:var(--text-dim);">Confianza: <span style="color:var(--text);">' + (masterView.confidence || 0) + '%</span></div>';
    html += '<div style="flex:1;color:var(--text-dim);">V2 Dir: <span style="color:' + (lastSniperV2Dir === 'CW' ? 'var(--green)' : lastSniperV2Dir === 'CCW' ? '#d1abff' : 'var(--muted)') + ';">' + (lastSniperV2Dir || '--') + '</span></div>';
    html += '</div>';
    html += '</div>';

    // Resumen de delta
    html += '<div style="margin-top:5px;padding:4px 6px;background:rgba(0,0,0,0.1);border-radius:4px;font-size:7px;color:var(--text-dim);">';
    html += '<span>Delta Analyst: <b style="color:' + (aDelta >= 0 ? 'var(--green)' : 'var(--red)') + ';">' + (aDelta >= 0 ? '+' : '') + aDelta + '%</b></span> &nbsp;|&nbsp; ';
    html += '<span>Delta Sniper: <b style="color:' + (sDelta >= 0 ? 'var(--green)' : 'var(--red)') + ';">' + (sDelta >= 0 ? '+' : '') + sDelta + '%</b></span>';
    html += '</div>';

    panel.innerHTML = html;
}

// ═══════════════════════════════════════════
// 4. PATRONES — Librería de patrones DB
// ═══════════════════════════════════════════
function renderDashPatterns() {
    const panel = document.getElementById('dash-patterns');
    if (!panel) return;
    panel.style.display = 'block';

    let html = '';
    html += '<div style="font-size:9px;font-weight:700;color:var(--text);margin-bottom:6px;">&#128300; LIBRERÍA DE PATRONES</div>';

    // Stats header
    html += '<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:7px;color:var(--muted);">';
    html += '<span>Dir+Mag: <b style="color:var(--accent);">' + patternMemory.length + '</b></span>';
    html += '<span>Solo-Dir: <b style="color:#ff9800;">' + dirOnlyMemory.length + '</b></span>';
    html += '<span>Macro: <b style="color:#f5c842;">' + macroPatterns.length + '</b></span>';
    html += '<span>Sesión: <b style="color:var(--gold);">' + patternSession.length + '</b> spins</span>';
    html += '</div>';

    if (patternMemory.length === 0 && dirOnlyMemory.length === 0 && macroPatterns.length === 0) {
        html += '<div style="text-align:center;padding:10px;color:var(--muted);font-size:8px;">';
        html += 'No hay patrones aún. Se generan automáticamente al detectar secuencias que se repiten >=5 veces (umbral de patrón).';
        html += '</div>';
        panel.innerHTML = html;
        return;
    }

    // ─── MACRO PATTERNS (Transiciones de estado: Turbulencia / Dominancia) ───
    if (macroPatterns.length > 0) {
        html += '<div style="font-size:8px;color:#f5c842;font-weight:700;margin:6px 0 3px;">&#127744; Patrones Macro (Transiciones de Estado) — ' + macroPatterns.length + ' patrones</div>';
        html += '<div style="font-size:7px;color:var(--muted);margin-bottom:4px;">Secuencias de cambio de estado: turbulencia, dominancia CW/CCW, neutral. No usan ventanas fijas.</div>';
        html += '<div style="max-height:120px;overflow-y:auto;margin-bottom:6px;">';
        macroPatterns.forEach(p => {
            html += '<div class="dash-pattern-card" style="border-left:2px solid #f5c842;">';
            html += '<div>';
            html += '<span style="color:#f5c842;font-size:8px;">' + (p.name || p.key) + '</span>';
            html += '<span style="color:var(--muted);margin-left:6px;">' + p.count + ' transiciones</span>';
            if (p.avgFromLen) { html += '<span style="color:rgba(255,255,255,0.25);margin-left:4px;">~' + p.avgFromLen + 'sp</span>'; }
            html += '</div>';
            if (p.examples && p.examples.length > 0) {
                html += '<div style="font-size:7px;color:rgba(255,255,255,0.3);">ej: ' + p.examples.slice(0, 2).join(', ') + '</div>';
            }
            html += '</div>';
        });
        html += '</div>';
    }

    // Estado macro actual
    if (macroCurrentState) {
        const stateColor = { TURBULENCIA: '#f55', DOMINANCIA_CW: 'var(--green)', DOMINANCIA_CCW: '#d1abff', DOM_CW_LEVE: 'rgba(48,224,144,0.5)', DOM_CCW_LEVE: 'rgba(209,171,255,0.5)', NEUTRAL: 'var(--muted)' }[macroCurrentState] || 'var(--muted)';
        html += '<div style="margin-top:4px;padding:3px 6px;background:rgba(245,200,66,0.04);border:1px solid rgba(245,200,66,0.1);border-radius:4px;font-size:7px;">';
        html += '<span style="color:var(--muted);">Estado macro actual: </span>';
        html += '<span style="color:' + stateColor + ';font-weight:700;">' + formatMacroState(macroCurrentState) + '</span>';
        html += '<span style="color:var(--muted);margin-left:6px;">(' + (history.length - macroStateStartIdx) + ' spins)</span>';
        html += '</div>';
    }

    // ─── DIR-ONLY PATTERNS (más fáciles de matchear) ───
    if (dirOnlyMemory.length > 0) {
        html += '<div style="font-size:8px;color:#ff9800;font-weight:700;margin:6px 0 3px;">&#128206; Patrones Solo Dirección (R/L) — ' + dirOnlyMemory.length + ' patrones</div>';
        html += '<div style="font-size:7px;color:var(--muted);margin-bottom:4px;">Solo dirección, sin magnitud. Más probabilidad de match. Ventanas 5+, umbral >=5 repeticiones.</div>';

        const dirSorted = dirOnlyMemory.slice().sort((a, b) => (b.outcomes?.total || 0) - (a.outcomes?.total || 0));

        html += '<div style="max-height:180px;overflow-y:auto;margin-bottom:6px;">';
        dirSorted.forEach(p => {
            const total = p.outcomes?.total || 0;
            const rCount = p.outcomes?.next_R || 0;
            const lCount = p.outcomes?.next_L || 0;
            const bias = total > 0 ? Math.round((Math.max(rCount, lCount) / total) * 100) : 0;
            const biasDir = rCount >= lCount ? 'CW' : 'CCW';
            const biasColor = biasDir === 'CW' ? 'var(--green)' : '#d1abff';

            html += '<div class="dash-pattern-card" style="border-left:2px solid #ff9800;">';
            html += '<div>';
            html += '<span style="font-family:var(--mono);color:#ff9800;font-size:9px;">' + (p.key || '?') + '</span>';
            html += '<span style="color:var(--muted);margin-left:6px;">' + total + ' ocurrencias</span>';
            if (p.length) { html += '<span style="color:rgba(255,255,255,0.25);margin-left:4px;">l=' + p.length + '</span>'; }
            html += '</div>';
            html += '<div>';
            html += '<span style="color:' + biasColor + ';font-weight:700;">' + biasDir + ' ' + bias + '%</span>';
            html += '</div>';
            html += '</div>';
        });
        html += '</div>';
    }

    // ─── DIR+MAG PATTERNS ───
    if (patternMemory.length > 0) {
        html += '<div style="font-size:8px;color:var(--accent);font-weight:700;margin:6px 0 3px;">&#128300; Patrones Dirección+Magnitud (R/L + B/S) — ' + patternMemory.length + ' patrones</div>';
        html += '<div style="font-size:7px;color:var(--muted);margin-bottom:4px;">Incluyen magnitud. Más específicos, menos matches. Ventanas 5+, umbral >=5 repeticiones.</div>';

        const sorted = patternMemory.slice().sort((a, b) => (b.outcomes?.total || 0) - (a.outcomes?.total || 0));

        html += '<div style="max-height:180px;overflow-y:auto;">';
        sorted.forEach(p => {
            const total = p.outcomes?.total || 0;
            const cwCount = p.outcomes?.next_dir?.CW || p.outcomes?.next_dir?.R || 0;
            const ccwCount = p.outcomes?.next_dir?.CCW || p.outcomes?.next_dir?.L || 0;
            const bias = total > 0 ? Math.round((Math.max(cwCount, ccwCount) / total) * 100) : 0;
            const biasDir = cwCount >= ccwCount ? 'CW' : 'CCW';
            const biasColor = biasDir === 'CW' ? 'var(--green)' : '#d1abff';

            html += '<div class="dash-pattern-card">';
            html += '<div>';
            html += '<span style="font-family:var(--mono);color:var(--accent);font-size:8px;">' + (p.key || '?') + '</span>';
            html += '<span style="color:var(--muted);margin-left:6px;">' + total + ' ocurrencias</span>';
            if (p.length) { html += '<span style="color:rgba(255,255,255,0.25);margin-left:4px;">l=' + p.length + '</span>'; }
            html += '</div>';
            html += '<div>';
            html += '<span style="color:' + biasColor + ';font-weight:700;">' + biasDir + ' ' + bias + '%</span>';
            html += '</div>';
            html += '</div>';
        });
        html += '</div>';
    }

    // Última secuencia detectada
    if (patternLastSeq) {
        html += '<div style="margin-top:6px;padding:4px 6px;background:rgba(0,229,200,0.04);border:1px solid rgba(0,229,200,0.1);border-radius:4px;font-size:7px;">';
        html += '<span style="color:var(--muted);">Última secuencia dir+mag: </span>';
        html += '<span style="font-family:var(--mono);color:var(--accent);">' + patternLastSeq + '</span>';
        html += '</div>';
    }

    panel.innerHTML = html;
}

// ═══════════════════════════════════════════
// 5. INSIGHTS — Análisis automático
// ═══════════════════════════════════════════
function renderDashInsights() {
    const panel = document.getElementById('dash-insights');
    if (!panel) return;
    panel.style.display = 'block';

    const { a1, a2, s1, s2, aDelta, sDelta } = getDashStats();
    let html = '';

    html += '<div style="font-size:9px;font-weight:700;color:var(--text);margin-bottom:6px;">&#128161; INSIGHTS AUTOMATIZADOS</div>';

    const insights = [];

    // Analyst comparison
    if (a1.t >= 5 && a2.t >= 5) {
        if (aDelta > 3) insights.push({ t: 'ok', m: 'Analyst V2 supera a V1 por +' + aDelta + '% con DB patterns.' });
        else if (aDelta < -3) insights.push({ t: 'warn', m: 'Analyst V2 cae ' + Math.abs(aDelta) + '% vs V1. Revisar DB patterns.' });
        else insights.push({ t: 'neutral', m: 'Analyst V1 y V2 rinden similar (dif ' + aDelta + '%).' });
    }

    // Sniper comparison
    if (s1.t >= 5 && s2.t >= 5) {
        if (sDelta > 3) insights.push({ t: 'ok', m: 'Sniper V2 supera a V1 por +' + sDelta + '%. DB potencia bien.' });
        else if (sDelta < -3) insights.push({ t: 'warn', m: 'Sniper V2 cae ' + Math.abs(sDelta) + '% vs V1. Ruido en DB?' });
        else insights.push({ t: 'neutral', m: 'Sniper V1 y V2 rinden similar (dif ' + sDelta + '%).' });
    }

    // Trends
    if (a2.tr === 1) insights.push({ t: 'ok', m: 'Analyst V2 en tendencia alcista (+' + (a2.rr - a2.r) + '% últ 10).' });
    if (a2.tr === -1) insights.push({ t: 'warn', m: 'Analyst V2 en tendencia bajista (' + (a2.rr - a2.r) + '% últ 10).' });
    if (s2.tr === 1) insights.push({ t: 'ok', m: 'Sniper V2 en tendencia alcista (+' + (s2.rr - s2.r) + '% últ 10).' });
    if (s2.tr === -1) insights.push({ t: 'warn', m: 'Sniper V2 en tendencia bajista (' + (s2.rr - s2.r) + '% últ 10).' });

    // V1 vs V2 delta total
    const totalV1 = a1.r + s1.r;
    const totalV2 = a2.r + s2.r;
    if (a1.t + s1.t >= 10) {
        if (totalV2 > totalV1 + 5) insights.push({ t: 'star', m: 'V2 globalmente superior: +' + (totalV2 - totalV1) + ' puntos acumulados sobre V1.' });
        else if (totalV1 > totalV2 + 5) insights.push({ t: 'warn', m: 'V1 supera a V2 globalmente. La DB podría estar introduciendo ruido.' });
    }

    // Best agent
    const all = [{ n: 'Analyst V1', r: a1.r, t: a1.t }, { n: 'Analyst V2', r: a2.r, t: a2.t }, { n: 'Sniper V1', r: s1.r, t: s1.t }, { n: 'Sniper V2', r: s2.r, t: s2.t }];
    all.sort((a, b) => b.r - a.r);
    if (all[0].t > 0) insights.push({ t: 'star', m: 'Mejor agente: ' + all[0].n + ' (' + all[0].r + '%). Peor: ' + all[3].n + ' (' + all[3].r + '%).' });

    // Stability insight
    const rates = [a1.r, a2.r, s1.r, s2.r].filter(r => r > 0);
    if (rates.length >= 3) {
        const avg = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
        const dispersion = Math.round(Math.sqrt(rates.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / rates.length));
        if (dispersion <= 10) insights.push({ t: 'ok', m: 'Alta estabilidad entre agentes (dispersión ' + dispersion + '%). Sistema consistente.' });
        else if (dispersion >= 20) insights.push({ t: 'warn', m: 'Alta dispersión entre agentes (' + dispersion + '%). Hay divergencia en las señales.' });
    }

    // Pattern library insights
    const totalPatterns = patternMemory.length + dirOnlyMemory.length;
    if (totalPatterns >= 20) {
        insights.push({ t: 'ok', m: 'Librería de patrones robusta: ' + totalPatterns + ' patrones (' + patternMemory.length + ' dir+mag, ' + dirOnlyMemory.length + ' solo-dir).' });
    } else if (totalPatterns >= 10) {
        insights.push({ t: 'ok', m: 'Librería de patrones activa: ' + totalPatterns + ' patrones (' + patternMemory.length + ' dir+mag, ' + dirOnlyMemory.length + ' solo-dir).' });
    } else if (totalPatterns > 0) {
        insights.push({ t: 'neutral', m: 'Librería de patrones en crecimiento: ' + totalPatterns + ' patrones. Necesita más datos.' });
    } else if (history.length >= 10) {
        insights.push({ t: 'warn', m: 'No hay patrones detectados aún con ' + history.length + ' spins.' });
    }

    // Dir-only specific insight
    if (dirOnlyMemory.length > 0 && dirOnlyMemory.length > patternMemory.length) {
        insights.push({ t: 'star', m: 'Patrones solo-dir (R/L) dominan: ' + dirOnlyMemory.length + ' vs ' + patternMemory.length + ' dir+mag. Mayor probabilidad de match.' });
    }

    if (insights.length === 0) {
        html += '<div style="color:var(--muted);padding:10px;text-align:center;">Esperando suficientes datos para generar insights...</div>';
    } else {
        html += '<div style="padding:5px;background:rgba(240,192,64,0.03);border:1px solid rgba(240,192,64,0.1);border-radius:5px;">';
        insights.forEach(ins => {
            const icon = ins.t === 'ok' ? '&#9989;' : ins.t === 'warn' ? '&#9888;&#65039;' : ins.t === 'star' ? '&#11088;' : '&#8505;&#65039;';
            const cl = ins.t === 'ok' ? 'var(--green)' : ins.t === 'warn' ? 'var(--gold)' : ins.t === 'star' ? 'var(--accent)' : 'var(--muted)';
            html += '<div style="margin-bottom:3px;font-size:7px;color:' + cl + ';">' + icon + ' ' + ins.m + '</div>';
        });
        html += '</div>';
    }

    // DB status
    html += '<div style="margin-top:5px;padding:4px 6px;background:rgba(0,0,0,0.1);border-radius:4px;font-size:7px;color:var(--text-dim);">';
    html += '<span>Spins totales: <b style="color:var(--text);">' + history.length + '</b></span> &nbsp;|&nbsp; ';
    html += '<span>Evaluaciones: <b style="color:var(--text);">' + (a1.t + s1.t) + '</b></span> &nbsp;|&nbsp; ';
    html += '<span>Patrones: <b style="color:var(--accent);">' + patternMemory.length + '</b> dir+mag | <b style="color:#ff9800;">' + dirOnlyMemory.length + '</b> solo-dir</span>';
    html += '</div>';

    panel.innerHTML = html;
}

// === PATTERN MATCHING SYSTEM ===
// Nuevo sistema de reconocimiento de patrones históricos

function getSequenceFromHistory(len = 4) {
    if (history.length < len + 1) return null;
    const seq = [];
    for (let i = history.length - len; i < history.length; i++) {
        const dist = calcDist(history[i-1], history[i]);
        const dir = dist >= 0 ? 'R' : 'L';
        const mag = Math.abs(dist) >= 10 ? 'B' : 'S';
        seq.push({ dir, mag, dist });
    }
    return seq;
}

function sequenceToKey(seq) {
    if (!seq || seq.length === 0) return '';
    return seq.map(s => s.dir + s.mag).join('');
}

// Extraer patrones del historial LOCAL y guardar en DB
function extractLocalPatterns() {
    if (history.length < 10) return;

    // Dynamic window sizes: from 5 to history capacity (no fixed upper limit)
    // A pattern is a sequence that repeats >= 5 times
    const maxWindow = Math.min(history.length - 5, 30);
    const windowSizes = [];
    for (let w = 5; w <= maxWindow; w++) windowSizes.push(w);

    let addedCount = 0;

    windowSizes.forEach(windowSize => {
        if (history.length <= windowSize) return;
        const patterns = {};

        for (let i = windowSize; i < history.length; i++) {
            const seq = [];
            const numbers = [];
            const distances = [];

            for (let j = 0; j < windowSize; j++) {
                const idx = i - windowSize + j;
                const dist = calcDist(history[idx], history[idx + 1]);
                const dir = dist >= 0 ? 'R' : 'L';
                const mag = Math.abs(dist) >= 10 ? 'B' : 'S';
                seq.push({ dir, mag, dist });
                numbers.push(history[idx + 1]);
                distances.push(dist);
            }
            const key = sequenceToKey(seq);

            if (i + 1 < history.length) {
                const nextDist = calcDist(history[i], history[i + 1]);
                const nextDir = nextDist >= 0 ? 'R' : 'L';
                const nextMag = Math.abs(nextDist) >= 10 ? 'B' : 'S';

                if (!patterns[key]) {
                    patterns[key] = {
                        pattern_id: 'local_' + key + '_' + Date.now(),
                        key: key,
                        sequence: seq,
                        dir_sequence: key,
                        outcomes: { total: 0, hits: 0, next_dir: { CW: 0, CCW: 0 }, next_mag: { B: 0, S: 0 } },
                        next_dir: nextDir,
                        next_mag: nextMag,
                        numbers: numbers,
                        distances: distances,
                        length: windowSize
                    };
                }

                patterns[key].outcomes.total++;
                patterns[key].outcomes.next_dir[nextDist >= 0 ? 'CW' : 'CCW']++;
                patterns[key].outcomes.next_mag[nextMag]++;
            }
        }

        // Only save patterns that repeat >= 5 times (threshold for true patterns)
        Object.values(patterns).forEach(p => {
            if (p.outcomes.total < 5) return; // skip sequences, only save true patterns
            const exists = patternMemory.find(mp => mp.key === p.key);
            if (!exists) {
                patternMemory.push(p);
                addedCount++;
                saveDirectionPatternToDB(p.dir_sequence, p.next_dir, p.next_mag, p.numbers, p.distances);
            }
        });
    });

    if (addedCount > 0) {
        console.log(`[Pattern Machine] +${addedCount} patrones dir+mag (ventanas 5-${maxWindow}, umbral >=5 repeticiones)`);
        const memEl = document.getElementById('pattern-memory-count');
        if (memEl) memEl.innerText = patternMemory.length;
    }
}

// ─── DIRECTION-ONLY PATTERN EXTRACTION (independiente, corre siempre) ───
function extractDirOnlyPatterns() {
    if (history.length < 10) return;

    // Dynamic window sizes: from 5 to history capacity (no fixed upper limit)
    const maxWindow = Math.min(history.length - 5, 30);
    const windowSizes = [];
    for (let w = 5; w <= maxWindow; w++) windowSizes.push(w);

    let dirAdded = 0;

    windowSizes.forEach(windowSize => {
        if (history.length <= windowSize) return;
        const dirPatterns = {};

        for (let i = windowSize; i < history.length; i++) {
            const dirSeq = [];
            for (let j = 0; j < windowSize; j++) {
                const idx = i - windowSize + j;
                const dist = calcDist(history[idx], history[idx + 1]);
                dirSeq.push(dist >= 0 ? 'R' : 'L');
            }
            const dirKey = dirSeq.join('');

            if (i + 1 < history.length) {
                const nextDist = calcDist(history[i], history[i + 1]);
                const nextDir = nextDist >= 0 ? 'R' : 'L';

                if (!dirPatterns[dirKey]) {
                    dirPatterns[dirKey] = {
                        key: dirKey,
                        type: 'dir-only',
                        length: windowSize,
                        outcomes: { total: 0, next_R: 0, next_L: 0 }
                    };
                }
                dirPatterns[dirKey].outcomes.total++;
                dirPatterns[dirKey].outcomes[nextDir === 'R' ? 'next_R' : 'next_L']++;
            }
        }

        // Only save direction patterns that repeat >= 5 times
        Object.values(dirPatterns).forEach(p => {
            if (p.outcomes.total < 5) return; // skip sequences, only save true patterns
            const exists = dirOnlyMemory.find(m => m.key === p.key);
            if (!exists) {
                dirOnlyMemory.push(p);
                dirAdded++;
            }
        });
    });

    if (dirAdded > 0) {
        console.log(`[Dir-Only] +${dirAdded} patrones solo-dir (ventanas 5-${maxWindow}, umbral >=5, total: ${dirOnlyMemory.length})`);
    }
}

// Guardar patrón direccional en DB
async function saveDirectionPatternToDB(sequence, nextDir, nextMag, numbers, distances) {
    if (!currentTableId) return;
    
    try {
        await fetch(`/api/direction-patterns/${currentTableId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sequence: sequence,
                next_direction: nextDir,
                next_magnitude: nextMag,
                numbers: numbers,
                distances: distances
            })
        });
        console.log(`[DB] Patrón direccional guardado: ${sequence} -> ${nextDir}`);
    } catch(e) {
        // Silencioso - si falla la DB, seguimos funcionando local
    }
}

// Buscar estadísticas de un patrón direccional
async function getDirectionPatternStatsFromDB(sequence) {
    if (!currentTableId) return { total: 0, next_r: 0, next_l: 0, next_b: 0, next_s: 0 };
    
    try {
        const resp = await fetch(`/api/direction-patterns/${currentTableId}/stats?sequence=${sequence}`);
        if (resp.ok) {
            return await resp.json();
        }
    } catch(e) {
        // Fallback: calcular desde memoria local
        const matches = patternMemory.filter(p => p.key === sequence || p.key === sequence.split('').reverse().join(''));
        const stats = { total: 0, next_r: 0, next_l: 0, next_b: 0, next_s: 0 };
        matches.forEach(m => {
            stats.total++;
            if (m.next_dir === 'R') stats.next_r++;
            if (m.next_dir === 'L') stats.next_l++;
            if (m.next_mag === 'B') stats.next_b++;
            if (m.next_mag === 'S') stats.next_s++;
        });
        return stats;
    }
    return { total: 0, next_r: 0, next_l: 0, next_b: 0, next_s: 0 };
}

async function analyzePatternSequence() {
    // Extraer patrones dir-only SIEMPRE (independiente de dir+mag)
    extractDirOnlyPatterns();
    
    // Extraer patrones dir+mag siempre que haya datos suficientes
    if (history.length >= 10) {
        extractLocalPatterns();
    }
    
    const seq = getSequenceFromHistory(4);
    if (!seq) return;
    
    const key = sequenceToKey(seq);
    patternLastSeq = key;
    patternSession.push({ key, timestamp: Date.now() });
    
    // Actualizar UI
    const seqEl = document.getElementById('pattern-current-seq');
    if (seqEl) seqEl.innerText = 'Secuencia: ' + key;
    
    const sessionEl = document.getElementById('pattern-session-count');
    if (sessionEl) sessionEl.innerText = patternSession.length;
    
    // Buscar en memoria local primero
    const matches = patternMemory.filter(p => p.key === key);
    
    // Guardar matches en memoria (lista oculta - solo debug)
    const listEl = document.getElementById('pattern-list');
    if (listEl) {
        // Solo mostrar en modo debug (si existe param ?debug=1)
        const isDebug = window.location.search.includes('debug=1');
        if (isDebug && matches.length > 0) {
            let html = '<div style="font-size: 8px; color: var(--accent); margin-bottom: 4px;">[DEBUG] Patrones internos:</div>';
            matches.slice(0, 3).forEach(m => {
                const conf = Math.round((m.outcomes?.hits || 0) / (m.outcomes?.total || 1) * 100);
                html += '<div style="padding: 2px 4px; margin: 1px 0; background: rgba(0,0,0,0.2); border-radius: 2px; font-size: 7px; color: #666;">';
                html += m.pattern_id?.slice(-6) + ' : ' + conf + '%</div>';
            });
            listEl.innerHTML = html;
            listEl.parentElement.style.display = 'block';
        } else {
            listEl.innerHTML = '';
        }
    }
    
    // Calcular datos de pattern matching (dir+mag)
    let patternBoost = 0;
    let patternDir = null;
    let patternConf = 0;
    
    if (matches.length > 0) {
        const total = matches.reduce((sum, m) => sum + (m.outcomes?.total || 0), 0);
        const cwHits = matches.reduce((sum, m) => sum + (m.outcomes?.next_dir?.CW || 0), 0);
        const ccwHits = matches.reduce((sum, m) => sum + (m.outcomes?.next_dir?.CCW || 0), 0);
        
        const cwPct = total > 0 ? Math.round(cwHits / total * 100) : 50;
        const ccwPct = total > 0 ? Math.round(ccwHits / total * 100) : 50;
        
        patternDir = cwPct >= ccwPct ? 'CW' : 'CCW';
        patternConf = Math.abs(cwPct - ccwPct);
        patternBoost = Math.min(patternConf, 20); // Máximo +20% boost
        
        patternStats.matches++;
    }

    // ─── DIRECTION-ONLY MATCHING (solo R/L, más probabilidad de match) ───
    const dirOnlyKey = seq.map(s => s.dir).join('');
    dirOnlySession.push({ key: dirOnlyKey, timestamp: Date.now() });
    const dirMatches = dirOnlyMemory.filter(p => p.key === dirOnlyKey);

    let dirBoost = 0;
    let dirOnlyDir = null;
    let dirOnlyConf = 0;

    if (dirMatches.length > 0) {
        const total = dirMatches.reduce((sum, m) => sum + (m.outcomes?.total || 0), 0);
        const rHits = dirMatches.reduce((sum, m) => sum + (m.outcomes?.next_R || 0), 0);
        const lHits = dirMatches.reduce((sum, m) => sum + (m.outcomes?.next_L || 0), 0);

        if (total > 0) {
            dirOnlyDir = rHits >= lHits ? 'CW' : 'CCW';
            dirOnlyConf = Math.abs(Math.round((rHits / total) * 100) - Math.round((lHits / total) * 100));
            dirBoost = Math.min(dirOnlyConf, 15); // Máximo +15% boost dir-only

            // Si dir-only coincide con dir+mag, aumentar boost combinado
            if (dirOnlyDir === patternDir && patternDir) {
                patternBoost = Math.min(patternBoost + dirBoost, 30);
                patternConf = Math.max(patternConf, dirOnlyConf);
            }
            // Si no hay match dir+mag pero sí dir-only, usar dir-only
            if (!patternDir && dirOnlyDir) {
                patternDir = dirOnlyDir;
                patternConf = dirOnlyConf;
                patternBoost = dirBoost;
            }

            console.log(`[Dir-Only] Secuencia "${dirOnlyKey}" -> ${dirOnlyDir} (${dirOnlyConf}% conf, ${total} ocurrencias, +${dirBoost}% boost)`);
        }
    }

    // === ANALYST V2: Pattern + Fractales/Canales ===
    updateAnalystV2(seq, matches, patternBoost, patternDir, patternConf);

    // === SNIPER V2: Pattern + Ritmo + Confluencia ===
    updateSniperV2(seq, matches, patternDir, patternConf);
    
    // Buscar en servidor (opcional, para cargar más patrones)
    fetchPatternsFromServer(key);
}

// === DETECTOR AVANZADO DE TURBULENCIA (R/L) ===
// Análisis granular: micro-turbulencia, post-secuencias, zigzag de dominancias
function detectDirectionTurbulence() {
    if (history.length < 8) return null;
    
    // Extraer últimas 10 direcciones para análisis profundo
    const dirs = [];
    const dists = [];
    for (let i = history.length - 10; i < history.length; i++) {
        if (i > 0) {
            const dist = calcDist(history[i-1], history[i]);
            dirs.push(dist >= 0 ? 'R' : 'L');
            dists.push(Math.abs(dist));
        }
    }
    
    if (dirs.length < 6) return null;
    
    const last10 = dirs.slice(-10).join('');
    const last8 = dirs.slice(-8).join('');
    const last6 = dirs.slice(-6).join('');
    const last5 = dirs.slice(-5).join('');
    const last4 = dirs.slice(-4).join('');
    
    // === MÉTRICAS DE TURBULENCIA ===
    
    // 1. Tasa de cambio global (0-1)
    let changes = 0;
    for (let i = 1; i < dirs.length; i++) {
        if (dirs[i] !== dirs[i-1]) changes++;
    }
    const turbulenceLevel = changes / (dirs.length - 1);
    
    // 2. Longitud de racha actual
    let currentStreak = 1;
    let streakType = dirs[dirs.length - 1];
    for (let i = dirs.length - 2; i >= 0; i--) {
        if (dirs[i] === streakType) {
            currentStreak++;
        } else {
            break;
        }
    }
    
    // 3. Detectar rachas previas (para zigzag de dominancias)
    const streaks = [];
    let currentStreakType = dirs[0];
    let currentStreakLen = 1;
    for (let i = 1; i < dirs.length; i++) {
        if (dirs[i] === currentStreakType) {
            currentStreakLen++;
        } else {
            streaks.push({ type: currentStreakType, len: currentStreakLen });
            currentStreakType = dirs[i];
            currentStreakLen = 1;
        }
    }
    streaks.push({ type: currentStreakType, len: currentStreakLen });
    
    // 4. Detectar zigzag de dominancias (rachas cortas alternadas)
    let zigzagCount = 0;
    for (let i = 1; i < streaks.length; i++) {
        if (streaks[i].len <= 2 && streaks[i-1].len <= 2 && streaks[i].type !== streaks[i-1].type) {
            zigzagCount++;
        }
    }
    
    // === DETECCIÓN DE PATRONES ESPECÍFICOS ===
    
    // 1. MICRO-TURBULENCIA: RLR o LRL (3 cambios en 3 viajes)
    if (last4 === 'RLRL' || last4 === 'LRLR') {
        return {
            name: '⚡ MICRO-TURBULENCIA',
            type: 'micro_turbulence',
            level: 'high',
            desc: 'Alternancia perfecta - Caos máximo',
            action: 'AVOID',
            confidence: 90,
            streakInfo: { current: currentStreak, type: streakType }
        };
    }
    
    // 2. POST-SECUENCIA LARGA: Después de 5+ iguales, viene cambio
    if (streaks.length >= 2) {
        const prevStreak = streaks[streaks.length - 2];
        if (prevStreak.len >= 5 && currentStreak <= 2) {
            return {
                name: '🔄 RUPTURA POST-DOMINANCIA',
                type: 'post_sequence',
                level: 'high',
                desc: `Racha de ${prevStreak.len} ${prevStreak.type} rota - Nueva tendencia`,
                action: 'FOLLOW_NEW',
                confidence: 75,
                streakInfo: { previous: prevStreak.len, current: currentStreak }
            };
        }
    }
    
    // 3. ZIGZAG DE DOMINANCIAS: DER-DER-IZQ-IZQ-DER-DER (rachas de 2)
    if (zigzagCount >= 3) {
        return {
            name: '🔀 ZIGZAG DE DOMINANCIAS',
            type: 'zigzag_dominance',
            level: 'medium',
            desc: 'Rachas cortas alternando - Inestabilidad crónica',
            action: 'REDUCE',
            confidence: 70,
            streakInfo: { zigzagCount: zigzagCount }
        };
    }
    
    // 4. OLA COMPLETA: RRLLWW (2+2+2)
    if (last6.match(/^(RRLL|LLRR|RRLLEE|LLRREE)$/)) {
        return {
            name: '🌊 OLA COMPLETA',
            type: 'wave',
            level: 'medium',
            desc: 'Patrón 2+2 - Ciclo completado',
            action: 'EXPECT_REVERSAL',
            confidence: 65
        };
    }
    
    // 5. SEMI-TURBULENCIA: RRRLL (3+2) - Punto de inflexión
    if (last5 === 'RRRLL' || last5 === 'LLLRR') {
        return {
            name: '⛰️ PUNTO DE INFLEXIÓN',
            type: 'inflection',
            level: 'medium',
            desc: '3 iguales + 2 cambios - Decisión crítica',
            action: 'WATCH',
            confidence: 60
        };
    }
    
    // 6. DOMINANCIA EXTREMA: 6+ iguales (viene reversal fuerte)
    if (currentStreak >= 6) {
        return {
            name: '🔥 DOMINANCIA EXTREMA',
            type: 'extreme_dominance',
            level: 'extreme',
            desc: `${currentStreak} ${streakType} seguidos - Reversal inminente`,
            action: 'PREPARE_REVERSAL',
            confidence: 80
        };
    }
    
    // 7. TURBULENCIA MODERADA: 40-60% cambios
    if (turbulenceLevel >= 0.4 && turbulenceLevel < 0.7) {
        return {
            name: '💨 TURBULENCIA MODERADA',
            type: 'moderate_turbulence',
            level: 'medium',
            desc: `${Math.round(turbulenceLevel*100)}% cambios - Cautela`,
            action: 'CAUTION',
            confidence: 55
        };
    }
    
    // 8. CAOS TOTAL: >70% cambios
    if (turbulenceLevel >= 0.7) {
        return {
            name: '🌪️ CAOS TOTAL',
            type: 'total_chaos',
            level: 'extreme',
            desc: `${Math.round(turbulenceLevel*100)}% cambios - Sin dirección clara`,
            action: 'AVOID',
            confidence: 85
        };
    }
    
    return null;
}

function saveMacroPattern(turbulence) {
    if (!turbulence || !turbulence.type) return;
    analyzeMacroState(turbulence);
}

// Estado macro actual y tracker de transiciones
let macroCurrentState = null;
let macroStateStartIdx = 0;
const macroTransitions = []; // [{ from, fromLen, to, toLen, dirSequence }]

function analyzeMacroState(turbulence) {
    if (history.length < 10) return;

    // Clasificar el estado macro actual
    let currentState;
    const last10 = [];
    for (let i = Math.max(0, history.length - 12); i < history.length; i++) {
        if (i > 0) {
            const d = calcDist(history[i-1], history[i]);
            last10.push(d >= 0 ? 'R' : 'L');
        }
    }

    // Calcular tasa de cambio y rachas
    let changes = 0;
    for (let i = 1; i < last10.length; i++) {
        if (last10[i] !== last10[i-1]) changes++;
    }
    const changeRate = changes / (last10.length - 1);

    // Detectar racha actual
    let streak = 1;
    const streakDir = last10[last10.length - 1];
    for (let i = last10.length - 2; i >= 0; i--) {
        if (last10[i] === streakDir) streak++;
        else break;
    }

    if (changeRate >= 0.6) {
        currentState = 'TURBULENCIA';
    } else if (streak >= 5) {
        currentState = streakDir === 'R' ? 'DOMINANCIA_CW' : 'DOMINANCIA_CCW';
    } else if (streak >= 3) {
        currentState = streakDir === 'R' ? 'DOM_CW_LEVE' : 'DOM_CCW_LEVE';
    } else {
        currentState = 'NEUTRAL';
    }

    // Detectar cambio de estado macro
    if (macroCurrentState && macroCurrentState !== currentState) {
        const transitionLen = history.length - macroStateStartIdx;
        // Solo guardar transiciones de al menos 4 spins
        if (transitionLen >= 4 && macroTransitions.length < 50) {
            const seq = last10.length >= 5 ? last10.slice(-8).join('') : '';
            macroTransitions.push({
                from: macroCurrentState,
                fromLen: transitionLen,
                to: currentState,
                toStart: history.length,
                dirSequence: seq,
                timestamp: Date.now()
            });
            // Guardar en DB
            if (seq.length >= 5) {
                saveDirectionPatternToDB(seq, null, null, history.slice(-5), []);
            }
            console.log(`[MacroTrans] ${macroCurrentState}(${transitionLen}) → ${currentState}`);
            updateMacroPatternSummary();
        }
        macroStateStartIdx = history.length;
    } else if (!macroCurrentState) {
        macroStateStartIdx = history.length;
    }

    macroCurrentState = currentState;
}

function updateMacroPatternSummary() {
    // Agrupar transiciones en patrones repetidos
    macroPatterns.length = 0;
    const seen = {};
    for (const t of macroTransitions) {
        const key = t.from + '→' + t.to;
        if (!seen[key]) {
            seen[key] = {
                key: key,
                type: 'macro',
                name: formatMacroState(t.from) + ' → ' + formatMacroState(t.to),
                desc: formatMacroState(t.from) + ' durante ' + t.fromLen + ' spins, luego ' + formatMacroState(t.to),
                count: 0,
                avgFromLen: 0,
                examples: []
            };
        }
        seen[key].count++;
        seen[key].avgFromLen = Math.round((seen[key].avgFromLen * (seen[key].count - 1) + t.fromLen) / seen[key].count);
        if (seen[key].examples.length < 3) seen[key].examples.push(t.dirSequence);
    }
    // Solo guardar patrones con 5+ ocurrencias
    Object.values(seen).forEach(s => {
        if (s.count >= 5) macroPatterns.push(s);
    });
    macroPatterns.sort((a, b) => b.count - a.count);
}

function formatMacroState(state) {
    const map = {
        'TURBULENCIA': '🌪️TURB',
        'DOMINANCIA_CW': '🟢DOM-CW',
        'DOMINANCIA_CCW': '🟣DOM-CCW',
        'DOM_CW_LEVE': '🟢dom-CW',
        'DOM_CCW_LEVE': '🟣dom-CCW',
        'NEUTRAL': '⚪NEUTRO'
    };
    return map[state] || state;
}

// === ANALYST V2: Pattern Machine + Fractales/Canales + Turbulencia ===
// V1 base + boost opcional de patrones DB + detección avanzada de turbulencia
function updateAnalystV2(seq, matches, patternBoost, patternDir, patternConf) {
    const turbulence = detectDirectionTurbulence();

    if (turbulence) {
        saveMacroPattern(turbulence);
    }

    const travels = seq.map(s => s.dist);
    const baseAnalysis = analyzeTravelWave(travels);

    let displaySignal = baseAnalysis.signal || 'ANALIZANDO...';
    let displayType = baseAnalysis.type || 'neutral';
    let displayDir = baseAnalysis.targetDir || null;
    let displaySize = baseAnalysis.size || null;
    let displayReason = baseAnalysis.reason || 'Recopilando datos...';

    // ─── TURBULENCIA: ahora influye en la predicción real ───
    let turbModifier = 0; // ajuste de confianza por turbulencia
    if (turbulence) {
        displayReason = `[${turbulence.name}] ${displayReason}`;

        switch (turbulence.type) {
            case 'total_chaos':
                // Caos >70%: ignorar tendencia, predecir contra-dirección
                if (displayDir) {
                    displayDir = displayDir === 'CW' ? 'CCW' : 'CW';
                    displaySignal = 'CAOS REVERSAL';
                    displayType = displayDir === 'CW' ? 'bullish' : 'bearish';
                    displayReason = `[${turbulence.name}] ${turbulence.desc} - Reversión forzada`;
                }
                turbModifier = -20;
                break;
            case 'moderate_turbulence':
                // 40-70% cambios: reducir confianza
                turbModifier = -15;
                break;
            case 'extreme_dominance':
                // Dominancia extrema: boost a reversal
                turbModifier = 10;
                if (!displayDir) {
                    displayDir = seq[seq.length - 1].dir === 'R' ? 'CCW' : 'CW';
                    displaySignal = 'DOMINANCIA REVERSAL';
                    displayType = displayDir === 'CW' ? 'bullish' : 'bearish';
                    displayReason = `[${turbulence.name}] Esperando quiebre de racha`;
                }
                break;
            case 'zigzag_dominance':
                // Zigzag: alternar dirección respecto al último movimiento
                if (displayDir) {
                    const lastDir = seq[seq.length - 1].dir === 'R' ? 'CW' : 'CCW';
                    if (displayDir === lastDir) {
                        displayDir = lastDir === 'CW' ? 'CCW' : 'CW';
                        displayReason = `[${turbulence.name}] Zigzag: alternando dirección`;
                    }
                }
                turbModifier = -5;
                break;
            default:
                // micro_turbulence y otros: solo info, sin cambio
                break;
        }
    }

    // Fallback a analystView global si V1 no tiene direccion
    if (!displayDir && analystView && analystView.targetDir) {
        displayDir = analystView.targetDir;
        displaySignal = analystView.signal || displaySignal;
        displayType = analystView.type || displayType;
        displaySize = analystView.size || displaySize;
        displayReason = analystView.reason || displayReason;
    }

    // Calcular stats reales de patrones DB
    let analystDbStats = '';
    let dbDominantDir = null;
    let dbDominantPct = 0;

    if (matches.length > 0) {
        let totalOcc = 0;
        let cwCount = 0;
        let ccwCount = 0;

        matches.forEach(m => {
            totalOcc += m.outcomes?.total || 0;
            cwCount += m.outcomes?.next_dir?.CW || 0;
            ccwCount += m.outcomes?.next_dir?.CCW || 0;
        });

        if (totalOcc > 0) {
            const cwPct = Math.round((cwCount / totalOcc) * 100);
            const ccwPct = Math.round((ccwCount / totalOcc) * 100);
            dbDominantDir = cwPct >= ccwPct ? 'CW' : 'CCW';
            dbDominantPct = Math.max(cwPct, ccwPct);

            analystDbStats = `${matches.length}p | ${dbDominantDir} ${dbDominantPct}% (${totalOcc})`;

            // ═══ DB INFLUENCE LOGIC ═══
            // patternConf es la diferencia entre CW% y CCW% (0-100)
            const dbConf = patternConf || Math.abs(cwPct - ccwPct);
            const dbDir = patternDir || dbDominantDir;

            if (displayDir) {
                // V1 tiene direccion. Si DB tiene evidencia FUERTE (>15% diff) y VA EN CONTRA, cambiar
                if (dbDir !== displayDir && dbConf >= 15 && totalOcc >= 10) {
                    displayDir = dbDir;
                    displaySignal = 'DB OVERRIDE';
                    displayReason = `DB: ${dbDominantPct}% ${dbDir} (${totalOcc} casos) vs V1: ${displayDir}`;
                    displayType = dbDir === 'CW' ? 'bullish' : 'bearish';
                } else if (dbDir === displayDir && dbConf >= 10) {
                    // DB confirma V1 - boost
                    displayReason += ` | DB OK: ${dbDominantPct}% ${dbDir}`;
                }
            } else {
                // V1 no tiene direccion - usar DB
                displayDir = dbDir;
                displaySignal = 'PATTERN MATCH';
                displayReason = `DB: ${dbDominantPct}% ${dbDir} en ${totalOcc} casos`;
            }
        }
    }

    // Boost de pattern DB + turbulencia
    let finalConfidence = 50;
    if (displayType !== 'neutral') {
        finalConfidence = 60 + turbModifier;
        if (patternBoost > 0) {
            finalConfidence = Math.min(Math.max(finalConfidence + patternBoost, 25), 95);
            if (!displayReason.includes('DB OK') && !displayReason.includes('DB OVERRIDE') && !displayReason.includes('CAOS') && !displayReason.includes('DOMINANCIA') && !displayReason.includes('Zigzag')) {
                displayReason += ` (+${patternBoost}% DB)`;
            }
        }
        finalConfidence = Math.max(finalConfidence, 25); // nunca bajar de 25%
    }
    
    // Actualizar UI de Analyst V2
    const signalEl = document.getElementById('analyst-v2-signal');
    const dirEl = document.getElementById('analyst-v2-dir');
    const sizeEl = document.getElementById('analyst-v2-size');
    const detailEl = document.getElementById('analyst-v2-detail');
    const boostEl = document.getElementById('analyst-v2-pattern-boost');
    const boostValEl = document.getElementById('analyst-v2-boost-val');
    
    if (signalEl) {
        signalEl.innerText = displaySignal;
        signalEl.style.color = displayType === 'bullish' ? 'var(--green)' : 
                               displayType === 'bearish' ? '#f55' : 'var(--text-dim)';
    }
    
    if (dirEl) {
        dirEl.innerText = displayDir || '--';
        dirEl.style.display = 'inline-block'; // Siempre mostrar
    }
    
    if (sizeEl) {
        sizeEl.innerText = displaySize || '--';
        sizeEl.style.display = 'inline-block'; // Siempre mostrar
    }
    
    if (detailEl) {
        detailEl.innerText = displayReason;
    }
    
    // Mostrar contador W/L (formato igual a V1)
    const rateEl = document.getElementById('analyst-v2-rate');
    const perfEl = document.getElementById('analyst-v2-perf');
    if (rateEl && perfEl) {
        const last10 = analystV2History.slice(-10);
        const wins = last10.filter(x => x === 'win').length;
        const rate = last10.length > 0 ? ((wins / last10.length) * 100).toFixed(0) : 0;
        
        rateEl.innerText = `${rate}%`;
        perfEl.innerHTML = last10.map(r => `<span class="${r==='win'?'perf-w':'perf-l'}">${r==='win'?'W':'L'}</span>`).join('') || '--';
    }
    
    if (boostEl && boostValEl) {
        if (analystDbStats) {
            boostEl.style.display = 'block';
            boostValEl.innerText = analystDbStats;
        } else {
            boostEl.style.display = 'none';
        }
    }
    
    // Guardar predicción para evaluar W/L después
    lastAnalystV2Dir = displayDir;
}

// === SNIPER V2: Pattern Machine + Ritmo + Confluencia + Turbulencia ===
// V1 base + boost opcional de patrones DB + detección local de turbulencia
function updateSniperV2(seq, matches, patternDir, patternConf) {
    // Análisis de ritmo (siempre disponible - no necesita DB)
    const dirs = seq.map(s => s.dir);
    const rhythm = analyzeRhythm(dirs);
    
    // DETECTAR TURBULENCIA AVANZADA
    const turbulence = detectDirectionTurbulence();
    
    // Base
    let finalConf = 50;
    let finalDir = null;
    let reasons = [];
    
    // 0. V2 usa V1 como base, PERO la turbulencia ahora MODULA la predicción real
    let turbulenceBoost = 0;
    let turbulenceNote = '';
    let turbulenceFlip = false; // si debe invertir dirección
    
    if (turbulence) {
        turbulenceNote = `[${turbulence.name}] `;
        
        switch (turbulence.type) {
            case 'total_chaos':
                // Caos >70%: si V1 tiene baja confianza, invertir dirección
                turbulenceBoost = -25;
                if (masterView && (masterView.confidence || 60) < 70) {
                    turbulenceFlip = true;
                    reasons.push('🌪️ CAOS: invirtiendo dirección');
                } else {
                    reasons.push('🌪️ CAOS: confianza reducida');
                }
                break;
            case 'moderate_turbulence':
                // 40-70% cambios: reducir confianza
                turbulenceBoost = -15;
                reasons.push('💨 Turbulencia moderada');
                break;
            case 'extreme_dominance':
                // Dominancia extrema: forzar reversal si V1 no lo ve
                if (masterView?.target) {
                    const lastDir = seq[seq.length - 1].dir;
                    const reversalDir = lastDir === 'R' ? 'CCW' : 'CW';
                    if (masterView.target === reversalDir) {
                        turbulenceBoost = 20;
                        reasons.push('💥 Dominancia + Reversal');
                    } else {
                        // V1 va con la tendencia, pero hay dominancia extrema
                        turbulenceFlip = true;
                        turbulenceBoost = 5;
                        reasons.push('💥 Dominancia extrema: reversal forzado');
                    }
                }
                break;
            case 'zigzag_dominance':
                // Zigzag: alternar respecto al último
                turbulenceBoost = -5;
                if (masterView?.target) {
                    const lastDir = seq[seq.length - 1].dir === 'R' ? 'CW' : 'CCW';
                    if (masterView.target !== lastDir) {
                        turbulenceFlip = true;
                        reasons.push('🔀 Zigzag: alternando');
                    }
                }
                break;
            default:
                // micro_turbulence: solo informativo
                break;
        }
    }
    
    // 1. Prioridad: Master View (Sniper V1) - V2 potencia, pero turbulencia puede flipear
    if (masterView && masterView.target) {
        if (turbulenceFlip) {
            finalDir = masterView.target === 'CW' ? 'CCW' : 'CW';
            finalConf = Math.max((masterView.confidence || 60) + turbulenceBoost, 30);
            reasons.push('Sniper V1 FLIP ' + turbulenceNote);
        } else {
            finalDir = masterView.target;
            finalConf = Math.max((masterView.confidence || 60) + turbulenceBoost, 30);
            reasons.push('Sniper V1' + (turbulenceNote ? ' + ' + turbulenceNote : ''));
        }
    }
    
    // 2. Si hay ritmo fuerte, usarlo como alternativa o confirmación
    if (!finalDir && rhythm.strength === 'strong' && rhythm.dir) {
        finalDir = rhythm.dir;
        finalConf = 55;
        reasons.push('Ritmo fuerte');
    }
    
    // 3. Análisis de patrones DB - calcular stats reales
    let dbStatsText = '';
    if (matches.length > 0) {
        let totalOccurrences = 0;
        let cwHits = 0;
        let ccwHits = 0;

        matches.forEach(m => {
            totalOccurrences += m.outcomes?.total || 0;
            cwHits += m.outcomes?.next_dir?.CW || 0;
            ccwHits += m.outcomes?.next_dir?.CCW || 0;
        });

        if (totalOccurrences > 0) {
            const cwPct = Math.round((cwHits / totalOccurrences) * 100);
            const ccwPct = Math.round((ccwHits / totalOccurrences) * 100);
            const dbDomDir = cwPct >= ccwPct ? 'CW' : 'CCW';
            const dbDomPct = Math.max(cwPct, ccwPct);
            const dbDiff = Math.abs(cwPct - ccwPct);

            dbStatsText = `${matches.length}p | ${dbDomDir} ${dbDomPct}% (${totalOccurrences})`;

            // ═══ DB INFLUENCE LOGIC ═══
            if (finalDir) {
                // V1 tiene direccion
                if (dbDomDir !== finalDir && dbDiff >= 15 && totalOccurrences >= 10) {
                    // DB fuerte en contra de V1 → override
                    finalDir = dbDomDir;
                    finalConf = Math.min(55 + Math.round(dbDiff / 2), 85);
                    reasons = [`DB OVERRIDE: ${dbDomPct}% ${dbDomDir} (${totalOccurrences})`];
                } else if (dbDomDir === finalDir && dbDiff >= 8) {
                    // DB confirma V1 → boost fuerte
                    const boost = Math.min(Math.round(dbDiff), 20);
                    finalConf = Math.min(finalConf + boost, 95);
                    reasons.push(`DB OK: ${dbDomPct}%`);
                }
            } else {
                // V1 no tiene direccion → usar DB
                finalDir = dbDomDir;
                finalConf = Math.min(50 + Math.round(dbDiff / 2), 75);
                reasons.push(`DB: ${dbDomPct}% ${dbDomDir}`);
            }
        } else {
            dbStatsText = `${matches.length} patterns DB (sin stats)`;
        }
    }
    
    // 4. Si no hay nada, mostrar análisis de ritmo
    if (!finalDir && rhythm.dir) {
        finalDir = rhythm.dir;
        finalConf = 45;
        reasons.push('Solo ritmo');
    }
    
    // Actualizar UI de Sniper V2
    const confEl = document.getElementById('sniper-v2-conf');
    const targetEl = document.getElementById('sniper-v2-target');
    const reasonsEl = document.getElementById('sniper-v2-reasons');
    const rhythmEl = document.getElementById('sniper-v2-rhythm');
    const patternsEl = document.getElementById('sniper-v2-patterns');
    
    if (confEl) confEl.innerText = finalConf + '%';
    
    if (targetEl) {
        if (finalDir) {
            targetEl.innerText = finalDir === 'CW' ? 'DERECHA' : 'IZQUIERDA';
            targetEl.style.color = finalDir === 'CW' ? 'var(--green)' : '#d1abff';
        } else {
            targetEl.innerText = 'ESPERANDO...';
            targetEl.style.color = '#fff';
        }
    }
    
    if (reasonsEl) {
        if (reasons.length === 0) {
            reasonsEl.innerText = 'Recopilando datos...';
        } else {
            reasonsEl.innerText = reasons.join(' · ');
        }
    }
    
    // Mostrar contador W/L (formato igual a V1)
    const rateEl = document.getElementById('sniper-v2-rate');
    const perfEl = document.getElementById('sniper-v2-perf');
    if (rateEl && perfEl) {
        const last10 = sniperV2History.slice(-10);
        const wins = last10.filter(x => x === 'win').length;
        const rate = last10.length > 0 ? ((wins / last10.length) * 100).toFixed(0) : 0;
        
        rateEl.innerText = `${rate}%`;
        perfEl.innerHTML = last10.map(r => `<span class="${r==='win'?'perf-w':'perf-l'}">${r==='win'?'W':'L'}</span>`).join('') || '--';
    }
    
    if (rhythmEl) rhythmEl.innerText = rhythm.label || 'Mixto';
    if (patternsEl) {
        if (dbStatsText) {
            patternsEl.innerText = dbStatsText;
            patternsEl.style.color = 'var(--accent)';
        } else {
            patternsEl.innerText = 'Sin datos históricos';
            patternsEl.style.color = '#666';
        }
    }
    
    // Guardar predicción para evaluar W/L después
    lastSniperV2Dir = finalDir;
}

// Helper para análisis de ritmo
function analyzeRhythm(dirs) {
    if (dirs.length < 3) return { strength: 'weak', dir: null, label: 'Insuficiente' };
    
    // Detectar patrones simples
    const last3 = dirs.slice(-3).join('');
    const last4 = dirs.slice(-4).join('');
    
    if (last4 === 'RRRR') return { strength: 'strong', dir: 'CW', label: '🔥 Racha CW' };
    if (last4 === 'LLLL') return { strength: 'strong', dir: 'CCW', label: '🔥 Racha CCW' };
    if (last4 === 'RLRL' || last4 === 'LRLR') return { strength: 'medium', dir: dirs[dirs.length-1] === 'R' ? 'CCW' : 'CW', label: '🔄 Zigzag' };
    if (last3 === 'RRR') return { strength: 'medium', dir: 'CW', label: 'CW Fuerte' };
    if (last3 === 'LLL') return { strength: 'medium', dir: 'CCW', label: 'CCW Fuerte' };
    
    return { strength: 'weak', dir: null, label: 'Mixto' };
}

async function fetchPatternsFromServer(key) {
    try {
        const resp = await fetch('/api/patterns/match?key=' + key + '&tableId=' + currentTableId);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.patterns && data.patterns.length > 0) {
            // Fusionar con memoria local
            data.patterns.forEach(p => {
                if (!patternMemory.find(mp => mp.pattern_id === p.pattern_id)) {
                    patternMemory.push(p);
                }
            });
            // Actualizar contador
            const memEl = document.getElementById('pattern-memory-count');
            if (memEl) memEl.innerText = patternMemory.length;
        }
    } catch(e) { /* Silencioso */ }
}

// === SISTEMA DE META-PATRONES (W/L Tracking) ===

// Registrar resultado del Sniper (llamar cuando llega un número nuevo)
function registerSniperResult(actualNumber) {
    if (!lastSniperPred || !actualNumber) return;
    
    // Calcular si acertó (N9 dentro de vecinos)
    let result = 'L';
    if (typeof wheelNeighbors === 'function' && lastSniperPred.target) {
        const neighbors = wheelNeighbors(Number(lastSniperPred.target), 9);
        if (neighbors.includes(actualNumber)) {
            result = 'W';
        }
    }
    
    // Resolver meta-patrones pendientes con este resultado
    resolvePendingMetaPatterns(result);
    
    // Guardar en historial
    sniperWLHistory.push({
        pred: lastSniperPred.dir,
        target: lastSniperPred.target,
        result: result,
        number: actualNumber,
        timestamp: Date.now()
    });
    
    // Limitar tamaño
    if (sniperWLHistory.length > MAX_WL_HISTORY) {
        sniperWLHistory.shift();
    }
    
    // Actualizar meta-patrones
    updateMetaPatterns();
    
    // Guardar para próxima predicción
    lastSniperPred = null;
}

// Guardar predicción actual del Sniper (llamar antes de que llegue el número)
function saveSniperPrediction(dir, target) {
    lastSniperPred = { dir, target, time: Date.now() };
}

// Detectar y mostrar meta-patrones
function updateMetaPatterns() {
    if (sniperWLHistory.length < 3) return;
    
    const wlSeq = sniperWLHistory.map(h => h.result);
    const seqStr = wlSeq.join('');
    const last6 = wlSeq.slice(-6);
    
    // Detectar meta-patrones
    const metaPattern = detectMetaPattern(wlSeq);
    
    // Guardar en DB si hay un nuevo patrón
    if (metaPattern && currentTableId) {
        const typeMap = {
            '🔥 EL PICO': 'PICO',
            '🌊 LA OLA': 'OLA',
            '🔄 ALTERNANCIA': 'ALTERNADO',
            '⬛ RODILLO': 'RODILLO',
            '🎋 EL BAMBU': 'BAMBU',
            '📈 TENDENCIA ALCISTA': 'TENDENCIA_W',
            '📉 TENDENCIA BAJISTA': 'TENDENCIA_L'
        };
        const type = typeMap[metaPattern.name];
        if (type) {
            const numbersHistory = sniperWLHistory.map(h => h.number);
            saveMetaPatternToDB(type, seqStr.slice(-6), wlSeq, numbersHistory);
        }
    }
    
    // Actualizar UI
    const wlHistoryEl = document.getElementById('meta-wl-history');
    const alertEl = document.getElementById('meta-alert');
    const patternNameEl = document.getElementById('meta-pattern-name');
    const alertTextEl = document.getElementById('meta-alert-text');
    const statusEl = document.getElementById('meta-status');
    
    // Mostrar historial W/L visual
    if (wlHistoryEl) {
        let html = '';
        wlSeq.slice(-12).forEach((r, i) => {
            const color = r === 'W' ? '#0f0' : '#f55';
            const bg = r === 'W' ? 'rgba(0,255,0,0.1)' : 'rgba(255,0,0,0.1)';
            html += `<span style="display:inline-block; width:16px; height:16px; line-height:16px; text-align:center; background:${bg}; color:${color}; font-size:9px; font-weight:700; border-radius:3px; margin:1px;">${r}</span>`;
        });
        wlHistoryEl.innerHTML = html;
    }
    
    // Mostrar alerta si hay patrón
    if (metaPattern && alertEl && patternNameEl && alertTextEl) {
        alertEl.style.display = 'block';
        patternNameEl.innerText = metaPattern.name;
        alertTextEl.innerText = metaPattern.desc;
        
        if (statusEl) {
            statusEl.innerText = metaPattern.alert === 'danger' ? '⚠️ ALERTA' : '💡 SUGERENCIA';
            statusEl.style.color = metaPattern.alert === 'danger' ? '#f55' : 'var(--gold)';
        }
    } else {
        if (alertEl) alertEl.style.display = 'none';
        if (statusEl) {
            statusEl.innerText = 'Sin patrones claros';
            statusEl.style.color = 'var(--text-dim)';
        }
    }
    
    // Detectar patrones largos de dominancia
    detectLongPatterns(last6);
}

// Detector de meta-patrones (basado en tu guía)
function detectMetaPattern(wlSeq) {
    const seq = wlSeq.join('');
    const last6 = wlSeq.slice(-6).join('');
    const last5 = wlSeq.slice(-5).join('');
    const last4 = wlSeq.slice(-4).join('');
    
    // 1. PICO: Larga racha W seguida de L (WWWLL o WWWWL)
    if (seq.includes('WWWWL')) {
        return { name: '🔥 EL PICO', desc: '4+ victorias seguidas, luego L. Esperar próxima L.', alert: 'danger', action: 'WAIT' };
    }
    
    // 2. OLA: WWLL (2 buenas, 2 malas)
    if (last4 === 'WWLL') {
        return { name: '🌊 LA OLA', desc: 'Patrón de 2W+2L. Se repite. Alerta antes de las 2L.', alert: 'warning', action: 'REDUCE' };
    }
    
    // 3. ALTERNADO perfecto: WLWL o LWLW
    if (last4 === 'WLWL' || last4 === 'LWLW') {
        return { name: '🔄 ALTERNANCIA', desc: 'Alternancia perfecta W-L. Alta confianza.', alert: 'info', action: 'FOLLOW' };
    }
    
    // 4. DOBLE VICTORIA: WWL se repite
    if (seq.includes('WWLWWL')) {
        return { name: '⚡ DOBLE W', desc: 'Patrón WWL repetido. Cambiar antes de la L.', alert: 'warning', action: 'REDUCE' };
    }
    
    // 5. EL RODILLO: Largas rachas L (LLLL)
    if (last4 === 'LLLL' || seq.includes('LLLLL')) {
        return { name: '⬛ RODILLO', desc: 'Racha extensa de L. No hay rachas largas, mantener alerta.', alert: 'danger', action: 'WAIT' };
    }
    
    // 6. EL BAMBÚ: WWWLL
    if (last5 === 'WWWLL') {
        return { name: '🎋 EL BAMBU', desc: '3 suben, 2 bajan. Observar siguiente aumento.', alert: 'info', action: 'WATCH' };
    }
    
    // 7. PATRÓN DE 5 PASOS: WWLWL exacto
    if (last5 === 'WWLWL') {
        return { name: '🎯 PASO 5', desc: 'Secuencia exacta WWLWL. Este patrón se repite.', alert: 'info', action: 'FOLLOW' };
    }
    
    // 8. TENDENCIA ASCENDENTE: W aumentan
    const last6W = wlSeq.slice(-6).filter(r => r === 'W').length;
    if (last6W >= 4 && last6W < 6) {
        return { name: '📈 TENDENCIA ALCISTA', desc: 'Victorias aumentando. Buen momento.', alert: 'success', action: 'INCREASE' };
    }
    
    // 9. TENDENCIA DESCENDENTE: L aumentan
    const last6L = wlSeq.slice(-6).filter(r => r === 'L').length;
    if (last6L >= 4 && last6L < 6) {
        return { name: '📉 TENDENCIA BAJISTA', desc: 'Pérdidas aumentando. Reducir exposición.', alert: 'danger', action: 'REDUCE' };
    }
    
    return null;
}

// Detectar patrones largos de dominancia (más de 4 viajes)
function detectLongPatterns(last6WL) {
    const longListEl = document.getElementById('meta-long-list');
    if (!longListEl) return;
    
    const patterns = [];
    
    // Contar W vs L en últimos 6
    const wCount = last6WL.filter(r => r === 'W').length;
    const lCount = last6WL.filter(r => r === 'L').length;
    
    if (wCount >= 4) {
        patterns.push({ name: 'Dominancia W', icon: '🟢', desc: `${wCount}/6 aciertos` });
    }
    if (lCount >= 4) {
        patterns.push({ name: 'Dominancia L', icon: '🔴', desc: `${lCount}/6 fallos` });
    }
    
    // Detectar rachas actuales
    let currentStreak = 1;
    let streakType = last6WL[last6WL.length - 1];
    for (let i = last6WL.length - 2; i >= 0; i--) {
        if (last6WL[i] === streakType) {
            currentStreak++;
        } else {
            break;
        }
    }
    
    if (currentStreak >= 3) {
        patterns.push({ 
            name: `Racha ${streakType}`, 
            icon: streakType === 'W' ? '🔥' : '⚠️', 
            desc: `${currentStreak} seguidos` 
        });
    }
    
    // Renderizar
    if (patterns.length === 0) {
        longListEl.innerHTML = '<span style="font-size: 7px; color: #444;">Sin patrones largos claros</span>';
    } else {
        let html = '';
        patterns.forEach(p => {
            html += `<span style="display:inline-block; padding: 2px 5px; background: rgba(0,0,0,0.2); border-radius: 3px; font-size: 8px; color: var(--text-dim); margin: 1px;">${p.icon} ${p.name}: ${p.desc}</span>`;
        });
        longListEl.innerHTML = html;
    }
}

// Guardar meta-patrón en DB
async function saveMetaPatternToDB(type, wlSequence, fullHistory, numbersHistory) {
    if (!currentTableId) return null;
    
    try {
        const resp = await fetch(`/api/meta-patterns/${currentTableId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: type,
                wl_sequence: wlSequence,
                full_history: fullHistory,
                numbers_history: numbersHistory,
                sniper_prediction: lastSniperPred ? (lastSniperPred.dir === 'CW' ? 'WIN' : 'LOSS') : null
            })
        });
        
        if (resp.ok) {
            const data = await resp.json();
            if (data.success && data.id) {
                pendingMetaPatterns.push({
                    id: data.id,
                    type: type,
                    detectedAt: Date.now()
                });
                console.log(`Meta-patrón ${type} guardado en DB: ${data.id}`);
                return data.id;
            }
        }
    } catch(e) {
        console.error('Error saving meta-pattern:', e);
    }
    return null;
}

// Resolver meta-patrones pendientes con el resultado actual
async function resolvePendingMetaPatterns(actualResult) {
    if (pendingMetaPatterns.length === 0) return;
    
    const toResolve = [...pendingMetaPatterns];
    pendingMetaPatterns.length = 0;
    
    for (const pattern of toResolve) {
        try {
            const accurate = (pattern.type.includes('ALCISTA') && actualResult === 'W') ||
                           (pattern.type.includes('BAJISTA') && actualResult === 'L');
            
            await fetch(`/api/meta-patterns/${pattern.id}/result`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    result: actualResult,
                    accurate: accurate
                })
            });
            console.log(`Meta-patrón ${pattern.id} resuelto: ${actualResult}`);
        } catch(e) {
            console.error('Error resolving meta-pattern:', e);
        }
    }
}

// Obtener estadísticas de meta-patrones desde DB
async function fetchMetaPatternStats(type) {
    if (!currentTableId) return { total: 0, accurate: 0, accuracy: 0 };
    
    try {
        const resp = await fetch(`/api/meta-patterns/${currentTableId}/stats?type=${type || ''}&limit=100`);
        if (resp.ok) {
            return await resp.json();
        }
    } catch(e) {
        console.error('Error fetching meta-pattern stats:', e);
    }
    return { total: 0, accurate: 0, accuracy: 0 };
}

// ===== MODE HOOKS (injected by modes.js) =====
// Hook into live stream: feed tracker when source is 'live'
(function() {
    const originalSubmitNumber = submitNumber;
    submitNumber = function(val, silent, batch, spinId) {
        const historyLength = history.length;
        originalSubmitNumber(val, silent, batch, spinId);
        const n = parseInt(val);
        if (history.length > historyLength && !isNaN(n) && n >= 0 && n <= 36) {
            // Bulk history is copied once by syncTrackerFromLive after sync completes.
            // Forwarding it here prevents that sync from detecting changes and rendering.
            if (!batch && typeof trackerSource !== 'undefined' && trackerSource === 'live') {
                if (typeof submitTrackerNumber === 'function') submitTrackerNumber(n, batch, 'live', spinId);
            }
        }
    };
})();

