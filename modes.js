// ============================================================
// modes.js â€” 3-Mode Engine for ONEMILLON (Manual / Live / Tracker)
// ============================================================

// === MODE STATE ===
let currentMode = 'landing';

// â”€â”€ MANUAL MODE STATE â”€â”€
const manualHistory = [];
let manualLastSignal = null;
let manualAnalystView = { signal: 'ESPERANDO...', targetDir: null, size: null, reason: '-', type: 'neutral' };
let manualMasterView = { signal: 'ESPERANDO...', target: null, confidence: 0, reasons: '-', type: 'neutral' };
let manualJugView = { magnitude: 'UNDER', direction: 'CW', confidence: 0, isCharging: true };
const manualCwHistory = [];
const manualCcwHistory = [];
const manualCwN4History = [];
const manualCcwN4History = [];
const manualZoneOverHistory = [];
const manualZoneUnderHistory = [];
const manualAnalystHistory = [];
const manualMasterHistory = [];
let manualLastOverHitCW = false;
let manualLastUnderHitCW = false;
let manualLastOverHitCCW = false;
let manualLastUnderHitCCW = false;
let manualLastZoneOverHit = false;
let manualLastZoneUnderHit = false;
let manualPredictorOffset = 0;
let manualCurrentAvgCW = 9;
let manualCurrentAvgCCW = -9;
let manualModeAvgOffset = 0;

// â”€â”€ TRACKER MODE STATE â”€â”€
const trackerManualHistory = [];
const trackerLiveHistory = [];
const trackerLiveSpinIds = new Set();
let trackerLiveIdsTableId = null;
let trackerHistory = trackerManualHistory;
let trackerLastSignal = null;
let trackerAiN4Center = null;
let trackerPredictorOffset = 0;
let trackerCurrentAvgCW = 9;
let trackerCurrentAvgCCW = -9;
let trackerAutoBet = false;

// â”€â”€ Tracker Source â”€â”€
let trackerSource = 'manual'; // 'manual' | 'live'

// â”€â”€ Tracker Config IA â”€â”€
let trackerConfig = {
    provider: 'openrouter',
    model: 'openai/gpt-oss-120b',
    apiKey: '',
    prediction: 'both', // 'n9' | 'n4' | 'both'
    voice: false,
    source: 'manual' // 'manual' | 'live'
};

// â”€â”€ Tracker Chat â”€â”€
const trackerChatHistory = [];
let trackerAiMemory = { summary: '', messages: [], context: {} };
let trackerMemoryLoadId = 0;
let trackerMemoryAvailable = false;
let trackerVoiceEnabled = false;
let trackerTriggerCounter = 0;
let trackerLastDominantDir = null;
let trackerLastDominantZone = null;
let trackerLastZigzag = false;
let trackerManualAvgOffset = 0;
let trackerBankSessions = [];
let trackerBankEntries = [];
let trackerBankSelectedSessionId = null;
let trackerBankEntriesSessionId = null;
let trackerBankLoadedTableId = null;
let trackerBankQueue = Promise.resolve();
const trackerBankPending = [];
const trackerBankPendingKeys = new Set();
let trackerBankLoading = false;
let trackerLiveSyncTimer = null;
let trackerLiveSyncInFlight = false;
let trackerLiveEventRevision = 0;
let trackerAiRequestController = null;
let trackerAiRequestId = 0;
let trackerAiLastRequestedRevision = -1;
let trackerAiDisplayStatus = 'ANALIZANDO...';

// ============================================================
// MODE SWITCHING
// ============================================================
function activateMode(mode) {
    const landing = document.getElementById('landing-overlay');
    const live = document.getElementById('live-mode');
    const manual = document.getElementById('manual-mode');
    const tracker = document.getElementById('tracker-mode');

    if (!landing) return;

    if (mode === 'landing') {
        landing.style.display = 'flex';
        if (live) live.classList.remove('active');
        if (manual) manual.classList.remove('active');
        if (tracker) tracker.classList.remove('active');
        currentMode = 'landing';
        updateTrackerLiveSync();
    } else {
        landing.style.display = 'none';
        if (live) live.classList.remove('active');
        if (manual) manual.classList.remove('active');
        if (tracker) tracker.classList.remove('active');
        const target = document.getElementById(mode + '-mode');
        if (target) target.classList.add('active');
        currentMode = mode;

        if (mode === 'live') {
            if (typeof renderShadowPanel === 'function') renderShadowPanel();
            if (typeof renderWheelAndHistory === 'function') renderWheelAndHistory();
            if (typeof renderTravelPanel === 'function') renderTravelPanel();
        }
        if (mode === 'tracker') {
            renderTracker();
            loadTrackerBankSessions();
            if (trackerSource === 'live' && typeof history !== 'undefined' && history.length > 0) {
                // Ensure tracker is in sync with live data
                syncTrackerFromLive();
            }
        }
        if (mode === 'manual') {
            renderManualPanel();
            renderManualSniper();
            renderManualTravel();
            renderManualDashTimeline();
            renderManualHistoryStrip();
        }
    }
    updateTrackerLiveSync();
}

// ============================================================
// MANUAL MODE
// ============================================================
function showManualTab(tab) {
    const tabs = ['dir','pattern','sniper','panel'];
    tabs.forEach(t => {
        const el = document.getElementById('manual-panel-' + t);
        if (el) el.style.display = (t === tab) ? 'block' : 'none';
    });
}

function processManualNumber() {
    const input = document.getElementById('manual-number-input');
    if (!input) return;
    const raw = input.value.trim();
    const n = parseInt(raw);
    if (isNaN(n) || n < 0 || n > 36) {
        input.style.borderColor = '#f55';
        setTimeout(() => input.style.borderColor = '', 400);
        return;
    }
    input.value = '';
    input.focus();
    submitManualNumber(n);
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('manual-number-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') processManualNumber();
        });
    }
    // Render inicial: el chart de travel necesita dibujarse aunque no haya datos
    renderManualTravel();
});

function submitManualNumber(n) {
    if (manualLastSignal && manualHistory.length > 0) {
        if (manualLastSignal.targetCW !== undefined) {
            const distCW = Math.abs(calcDist(n, manualLastSignal.targetCW));
            manualCwHistory.push(distCW <= 9 ? 'win' : 'loss');
            manualLastUnderHitCW = Math.abs(calcDist(n, manualLastSignal.targetUnderCW)) <= 4;
            manualLastOverHitCW  = Math.abs(calcDist(n, manualLastSignal.targetOverCW)) <= 4;
            manualCwN4History.push((manualLastUnderHitCW || manualLastOverHitCW) ? 'win' : 'loss');
        }
        if (manualLastSignal.targetCCW !== undefined) {
            const distCCW = Math.abs(calcDist(n, manualLastSignal.targetCCW));
            manualCcwHistory.push(distCCW <= 9 ? 'win' : 'loss');
            manualLastUnderHitCCW = Math.abs(calcDist(n, manualLastSignal.targetUnderCCW)) <= 4;
            manualLastOverHitCCW  = Math.abs(calcDist(n, manualLastSignal.targetOverCCW)) <= 4;
            manualCcwN4History.push((manualLastUnderHitCCW || manualLastOverHitCCW) ? 'win' : 'loss');
        }
    }
    if (manualHistory.length >= 1) {
        const prev = manualHistory[manualHistory.length - 1];
        const idxZ = WHEEL_NUMS.indexOf(prev);
        if (idxZ !== -1) {
            const overTarget = manualLastSignal ? manualLastSignal.targetOverCW : WHEEL_ORDER[(idxZ + 14 + 37) % 37];
            manualLastZoneOverHit = (Math.abs(calcDist(n, overTarget)) <= 4);
            manualZoneOverHistory.push(manualLastZoneOverHit ? 'win' : 'loss');
            const underTarget = manualLastSignal ? manualLastSignal.targetUnderCW : WHEEL_ORDER[(idxZ + 4 + 37) % 37];
            manualLastZoneUnderHit = (Math.abs(calcDist(n, underTarget)) <= 4);
            manualZoneUnderHistory.push(manualLastZoneUnderHit ? 'win' : 'loss');
        }
    }
    if (manualHistory.length >= 1 && manualAnalystView.targetDir) {
        const jump = calcDist(manualHistory[manualHistory.length - 1], n);
        const dirHit = (manualAnalystView.targetDir === 'CW' && jump >= 0) || (manualAnalystView.targetDir === 'CCW' && jump < 0);
        manualAnalystHistory.push(dirHit ? 'win' : 'loss');
    }
    if (manualHistory.length >= 1 && manualMasterView.target) {
        const jump = calcDist(manualHistory[manualHistory.length - 1], n);
        const dirHit = (manualMasterView.target === 'CW' && jump >= 0) || (manualMasterView.target === 'CCW' && jump < 0);
        manualMasterHistory.push(dirHit ? 'win' : 'loss');
    }
    manualHistory.push(n);
    if (typeof computeDealerSignature === 'function' && manualHistory.length >= 3) {
        try {
            const sig  = computeDealerSignature(manualHistory);
            const prox = projectNextRound(manualHistory, {});
            const masterSignals = getIAMasterSignals(prox, sig, manualHistory, { cw: manualCurrentAvgCW, ccw: manualCurrentAvgCCW, offset: manualPredictorOffset });
            if (masterSignals && masterSignals.length > 0) manualLastSignal = masterSignals[0];
            if (typeof predictZonePattern === 'function') manualJugView = predictZonePattern(manualHistory, null);
            if (typeof analyzeTravelWave === 'function') {
                const travels = [];
                for (let i = 1; i < manualHistory.length; i++) travels.push(calcDist(manualHistory[i-1], manualHistory[i]));
                manualAnalystView = analyzeTravelWave(travels);
            }
            if (typeof analyzeMasterConfluence === 'function') manualMasterView = analyzeMasterConfluence(manualHistory, manualAnalystView, manualJugView, {});
        } catch(e) { console.error('Manual predict error:', e); }
    }
    renderManualPanel();
    renderManualSniper();
    renderManualTravel();
    renderManualDashTimeline();
    renderManualHistoryStrip();
}

function clearManualHistory() {
    manualHistory.length = 0;
    manualCwHistory.length = 0; manualCcwHistory.length = 0;
    manualCwN4History.length = 0; manualCcwN4History.length = 0;
    manualZoneOverHistory.length = 0; manualZoneUnderHistory.length = 0;
    manualAnalystHistory.length = 0; manualMasterHistory.length = 0;
    manualLastSignal = null;
    manualAnalystView = { signal: 'ESPERANDO...', targetDir: null, size: null, reason: '-', type: 'neutral' };
    manualMasterView = { signal: 'ESPERANDO...', target: null, confidence: 0, reasons: '-', type: 'neutral' };
    manualJugView = { magnitude: 'UNDER', direction: 'CW', confidence: 0, isCharging: true };
    renderManualPanel();
    renderManualSniper();
    renderManualTravel();
    renderManualDashTimeline();
    renderManualHistoryStrip();
}

function renderManualHistoryStrip() {
    const el = document.getElementById('manual-history-strip');
    if (!el) return;
    el.innerHTML = manualHistory.map(n => {
        const color = getBallColor(n);
        return `<div class="ball" style="background:${color.bg};color:${color.text};border:1px solid ${color.border};">${n}</div>`;
    }).join('');
}

function renderManualPanel() {
    if (!manualLastSignal) return;
    const s = manualLastSignal;
    function fillBlock(suffix, targetC, targetL, targetR, wEl, lEl, rateEl, lHit, rHit) {
        const cEl = document.getElementById('manual-dir-' + suffix + '-c-val');
        const lVal = document.getElementById('manual-dir-' + suffix + '-l-val');
        const rVal = document.getElementById('manual-dir-' + suffix + '-r-val');
        const lHitEl = document.getElementById('manual-dir-' + suffix + '-l-hit');
        const rHitEl = document.getElementById('manual-dir-' + suffix + '-r-hit');
        if (cEl) cEl.innerText = targetC;
        if (lVal) lVal.innerText = targetL;
        if (rVal) rVal.innerText = targetR;
        if (lHitEl) lHitEl.innerText = lHit ? 'HIT' : '';
        if (rHitEl) rHitEl.innerText = rHit ? 'HIT' : '';
        if (typeof wheelNeighbors === 'function') {
            const cB = document.getElementById('manual-dir-' + suffix + '-c-balls');
            const lB = document.getElementById('manual-dir-' + suffix + '-l-balls');
            const rB = document.getElementById('manual-dir-' + suffix + '-r-balls');
            if (cB) cB.innerHTML = wheelNeighbors(targetC, 9).map(n => `<span class="nb">${n}</span>`).join('');
            if (lB) lB.innerHTML = wheelNeighbors(targetL, 4).map(n => `<span class="nb">${n}</span>`).join('');
            if (rB) rB.innerHTML = wheelNeighbors(targetR, 4).map(n => `<span class="nb">${n}</span>`).join('');
        }
        const wins = manualHistory.length > 0 ? (suffix.startsWith('cw') ? manualCwHistory.filter(x=>x==='win').length : manualCcwHistory.filter(x=>x==='win').length) : 0;
        const losses = manualHistory.length > 0 ? (suffix.startsWith('cw') ? manualCwHistory.filter(x=>x==='loss').length : manualCcwHistory.filter(x=>x==='loss').length) : 0;
        const total = wins + losses;
        const rate = total > 0 ? (wins / total * 100).toFixed(1) + '%' : '0.0%';
        const wE = document.getElementById('manual-dir-' + suffix + '-w');
        const lE = document.getElementById('manual-dir-' + suffix + '-l');
        const rE = document.getElementById('manual-dir-' + suffix + '-rate');
        if (wE) wE.innerText = wins;
        if (lE) lE.innerText = losses;
        if (rE) rE.innerText = rate;
    }
    fillBlock('cw', s.targetCW, s.targetUnderCW, s.targetOverCW, 'manual-dir-cw-w', 'manual-dir-cw-l', 'manual-dir-cw-rate', manualLastUnderHitCW, manualLastOverHitCW);
    fillBlock('ccw', s.targetCCW, s.targetUnderCCW, s.targetOverCCW, 'manual-dir-ccw-w', 'manual-dir-ccw-l', 'manual-dir-ccw-rate', manualLastUnderHitCCW, manualLastOverHitCCW);
}

function renderManualSniper() {
    const sigEl = document.getElementById('manual-master-signal');
    const tgtEl = document.getElementById('manual-master-target');
    const reaEl = document.getElementById('manual-master-reason');
    const confFill = document.getElementById('manual-master-conf-fill');
    const confTxt = document.getElementById('manual-master-conf-text');
    const rateEl = document.getElementById('manual-master-rate');
    const perfEl = document.getElementById('manual-master-perf');
    if (sigEl) sigEl.innerText = manualMasterView.signal || 'ESPERANDO...';
    if (tgtEl) tgtEl.innerText = manualMasterView.target || '--';
    if (reaEl) reaEl.innerText = manualMasterView.reasons || 'Ingresa nÃºmeros manualmente';
    if (confFill) confFill.style.width = (manualMasterView.confidence || 0) + '%';
    if (confTxt) confTxt.innerText = (manualMasterView.confidence || 0) + '%';
    const mw = manualMasterHistory.filter(x=>x==='win').length;
    const ml = manualMasterHistory.filter(x=>x==='loss').length;
    const mt = mw + ml;
    if (rateEl) rateEl.innerText = mt > 0 ? (mw / mt * 100).toFixed(1) + '%' : '0%';
    if (perfEl) perfEl.innerText = formatPerfString(manualMasterHistory);
    const aSig = document.getElementById('manual-analyst-signal');
    const aDir = document.getElementById('manual-analyst-dir');
    const aSize = document.getElementById('manual-analyst-size');
    const aRea = document.getElementById('manual-analyst-reason');
    const aRate = document.getElementById('manual-analyst-rate');
    const aPerf = document.getElementById('manual-analyst-perf-string');
    if (aSig) aSig.innerText = manualAnalystView.signal || 'ESPERANDO...';
    if (aDir) { aDir.innerText = manualAnalystView.targetDir || '--'; aDir.style.display = manualAnalystView.targetDir ? 'inline-block' : 'none'; }
    if (aSize) { aSize.innerText = manualAnalystView.size || '--'; aSize.style.display = manualAnalystView.size ? 'inline-block' : 'none'; }
    if (aRea) aRea.innerText = manualAnalystView.reason || '-';
    const aw = manualAnalystHistory.filter(x=>x==='win').length;
    const al = manualAnalystHistory.filter(x=>x==='loss').length;
    const at = aw + al;
    if (aRate) aRate.innerText = at > 0 ? (aw / at * 100).toFixed(1) + '%' : '0%';
    if (aPerf) aPerf.innerText = formatPerfString(manualAnalystHistory);
}

function formatPerfString(arr) {
    if (!arr || arr.length === 0) return '--';
    return arr.slice(-12).map(x => {
        if (x === 'win') return '<span style="color:var(--green);">&#x25CF;</span>';
        if (x === 'loss') return '<span style="color:#f55;">&#x25CF;</span>';
        return '<span style="color:var(--muted);">&#x25CB;</span>';
    }).join('');
}

function renderManualTravel() {
    const lastZone = document.getElementById('manual-travel-last-zone');
    if (manualHistory.length < 2) {
        if (lastZone) lastZone.innerText = 'Ãšltimo: --';
    } else if (lastZone) {
        lastZone.innerText = 'Ãšltimo: ' + manualHistory[manualHistory.length - 1];
    }
    // Tabla identica al tracker (misma formula UO: OVER = (derecha && BIG) || (izquierda && SMALL))
    renderTravelTable('manual-travel-tbody', manualHistory, 'Ingresa nÃºmeros para ver el travel.');
    // Chart identico al tracker
    const chartRes = renderModeTravelChart('manualTravelChart', manualHistory,
        manualModeAvgOffset);
    if (chartRes) { manualCurrentAvgCW = chartRes.avgCW; manualCurrentAvgCCW = chartRes.avgCCW; }
}

function renderManualDashTimeline() {
    const canvas = document.getElementById('manualDashTimelineCanvas');
    const content = document.getElementById('manual-dash-content');
    if (!canvas) return;
    if (manualHistory.length < 3) {
        if (content) content.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--muted);">Ingresa nÃºmeros para ver el dashboard.</div>';
        return;
    }
    const dirArr = [0], zoneArr = [0];
    for (let i = 1; i < manualHistory.length; i++) {
        const d = calcDist(manualHistory[i-1], manualHistory[i]);
        dirArr.push(dirArr[dirArr.length - 1] + (d > 0 ? 1 : -1));
        zoneArr.push(zoneArr[zoneArr.length - 1] + (Math.abs(d) >= 10 ? 1 : -1));
    }
    const ctx = canvas.getContext('2d');
    const W = canvas.parentElement ? canvas.parentElement.offsetWidth - 16 : 400;
    const H = canvas.height || 200;
    canvas.width = W; canvas.style.width = W + 'px';
    const padL = 40, padR = 10, padT = 25, padB = 25;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const allValues = [...dirArr, ...zoneArr];
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    const valueRange = maxVal - minVal;
    const paddedRange = valueRange * 1.2 || 2;
    const scaleY = chartH / paddedRange;
    const zeroY = padT + chartH - (0 - minVal + valueRange * 0.1) * scaleY;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(W - padR, zeroY); ctx.stroke();
    ctx.setLineDash([]);
    function drawLine(arr, color, label) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        arr.forEach((v, i) => {
            const x = padL + (i / (arr.length - 1)) * chartW;
            const y = padT + chartH - (v - minVal + valueRange * 0.1) * scaleY;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        const lastY = padT + chartH - (arr[arr.length - 1] - minVal + valueRange * 0.1) * scaleY;
        ctx.fillStyle = color;
        ctx.font = 'bold 10px Inter';
        ctx.fillText(label, W - padR + 2, lastY + 3);
    }
    drawLine(dirArr, '#00e5c8', 'DIR');
    drawLine(zoneArr, '#f0c040', 'ZONE');
    ctx.fillStyle = 'var(--muted)';
    ctx.font = '9px Inter';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal), padL - 4, padT + 8);
    ctx.fillText('0', padL - 4, zeroY + 3);
    ctx.fillText(Math.round(minVal), padL - 4, H - padB - 2);
    if (content) {
        const total = manualHistory.length;
        const cwRate = manualCwHistory.length > 0 ? (manualCwHistory.filter(x=>x==='win').length / manualCwHistory.length * 100).toFixed(1) : '0.0';
        const ccwRate = manualCcwHistory.length > 0 ? (manualCcwHistory.filter(x=>x==='win').length / manualCcwHistory.length * 100).toFixed(1) : '0.0';
        content.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.75rem;"><div style="background:rgba(0,229,200,0.05);border:1px solid rgba(0,229,200,0.1);border-radius:6px;padding:6px;text-align:center;"><div style="color:var(--muted);font-size:0.65rem;">Spins</div><div style="color:#fff;font-weight:900;font-size:1.1rem;">${total}</div></div><div style="background:rgba(48,224,144,0.05);border:1px solid rgba(48,224,144,0.1);border-radius:6px;padding:6px;text-align:center;"><div style="color:var(--muted);font-size:0.65rem;">CW Rate</div><div style="color:var(--green);font-weight:900;font-size:1.1rem;">${cwRate}%</div></div><div style="background:rgba(255,100,100,0.05);border:1px solid rgba(255,100,100,0.1);border-radius:6px;padding:6px;text-align:center;"><div style="color:var(--muted);font-size:0.65rem;">CCW Rate</div><div style="color:#f55;font-weight:900;font-size:1.1rem;">${ccwRate}%</div></div><div style="background:rgba(240,192,64,0.05);border:1px solid rgba(240,192,64,0.1);border-radius:6px;padding:6px;text-align:center;"><div style="color:var(--muted);font-size:0.65rem;">Master</div><div style="color:var(--gold);font-weight:900;font-size:1.1rem;">${manualMasterHistory.length > 0 ? (manualMasterHistory.filter(x=>x==='win').length / manualMasterHistory.length * 100).toFixed(1) : '0.0'}%</div></div></div>`;
    }
}

// ============================================================
// TRACKER MODE â€” AI Enhanced
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    loadTrackerConfig();
    loadTrackerAiMemory();
    const input = document.getElementById('tracker-number-input');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') processTrackerNumber(); });
    const chatInput = document.getElementById('tracker-chat-input');
    if (chatInput) chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTrackerChat(); });
    await closeTrackerBankSessionOnReload();
    loadTrackerBankSessions();
    window.addEventListener('pagehide', closeTrackerBankSessionOnPageHide);
});

function trackerBankTableId() {
    return typeof currentTableId !== 'undefined' && currentTableId ? currentTableId : 1;
}

function trackerBankActiveSession() {
    return trackerBankSessions.find(session => session.status === 'active') || null;
}

function trackerBankSelectedSession() {
    return trackerBankActiveSession() ||
        trackerBankSessions.find(session => String(session._id) === String(trackerBankSelectedSessionId)) ||
        trackerBankSessions.find(session => session.status === 'closed') || null;
}

function trackerBankCloseUrl(sessionId) {
    return `/api/tracker/bankroll/${encodeURIComponent(trackerBankTableId())}/${encodeURIComponent(sessionId)}/close`;
}

function trackerBankMergeSessions(current, incoming) {
    const sessions = new Map(current.map(session => [String(session._id), session]));
    for (const candidate of incoming) {
        const key = String(candidate._id);
        const existing = sessions.get(key);
        if (!existing) {
            sessions.set(key, candidate);
            continue;
        }
        const oldSpins = Number(existing.total_spins || 0);
        const newSpins = Number(candidate.total_spins || 0);
        const oldTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
        const newTime = new Date(candidate.updated_at || candidate.created_at || 0).getTime();
        const newer = newSpins > oldSpins || (newSpins === oldSpins && (
            newTime > oldTime || (newTime === oldTime && candidate.status === 'closed' && existing.status !== 'closed')
        ));
        if (newer) sessions.set(key, candidate);
    }
    return Array.from(sessions.values())
        .sort((a, b) => Number(b.session_no) - Number(a.session_no))
        .slice(0, 100);
}

function trackerBankMergeEntries(current, incoming) {
    const entries = new Map();
    for (const entry of [...incoming, ...current]) entries.set(String(entry.spin_key || entry._id), entry);
    return Array.from(entries.values())
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
        .slice(-30);
}

async function closeTrackerBankSessionOnReload() {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (navigation?.type !== 'reload') return;
    try {
        const response = await fetch(`/api/tracker/bankroll/${encodeURIComponent(trackerBankTableId())}/stop-active`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        console.warn('[Tracker bankroll] No se pudo cerrar la sesión al recargar.', error.message);
    }
}

function closeTrackerBankSessionOnPageHide() {
    if (!trackerBankActiveSession()) return;
    const stop = () => fetch(`/api/tracker/bankroll/${encodeURIComponent(trackerBankTableId())}/stop-active`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true
    }).catch(() => {});
    if (trackerBankPending.length) trackerBankQueue.then(stop, stop);
    else stop();
}

function trackerBankDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
}

function trackerBankMoney(value) {
    return `S/ ${Number(value || 0).toFixed(2)}`;
}

function trackerBankStake(chip, round) {
    return Number((chip * 9 * 2 ** Math.floor((round - 1) / 2)).toFixed(2));
}

function trackerBankPredictionNumbers() {
    const center = trackerBankPredictionCenter();
    if (center === null || typeof wheelNeighbors !== 'function') return [];
    const numbers = wheelNeighbors(center, 4).map(Number);
    return numbers.length === 9 && new Set(numbers).size === 9 ? numbers : [];
}

function trackerBankPredictionCenter() {
    return trackerAiN4Center !== null && Number.isInteger(trackerAiN4Center) ? trackerAiN4Center : null;
}

function trackerBankSetMessage(message) {
    const element = document.getElementById('tracker-bank-message');
    if (element) element.textContent = message || '';
}

async function loadTrackerBankSessions() {
    if (trackerBankLoading) return;
    trackerBankLoading = true;
    try {
        const tableId = trackerBankTableId();
        if (String(tableId) !== String(trackerBankLoadedTableId)) {
            trackerBankSelectedSessionId = null;
            trackerBankSessions = [];
            trackerBankEntries = [];
            trackerBankEntriesSessionId = null;
            trackerBankLoadedTableId = tableId;
        }
        const url = new URL(`/api/tracker/bankroll/${encodeURIComponent(tableId)}`, location.origin);
        const response = await fetch(url, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.storage !== 'mongodb') throw new Error(data.error || `HTTP ${response.status}`);
        trackerBankSessions = trackerBankMergeSessions(
            trackerBankSessions,
            Array.isArray(data.sessions) ? data.sessions : []
        );
        const active = trackerBankSessions.find(item => item.status === 'active') || null;
        const latestClosed = trackerBankSessions.find(item => item.status === 'closed') || null;
        const selected = active || latestClosed;
        trackerBankSelectedSessionId = selected?._id || null;
        if (String(trackerBankEntriesSessionId || '') !== String(selected?._id || '')) trackerBankEntries = [];
        let incomingEntries = selected && String(data.selected_session_id || '') === String(selected._id)
            ? (Array.isArray(data.entries) ? data.entries : [])
            : [];
        if (selected && String(data.selected_session_id || '') !== String(selected._id)) {
            const selectedUrl = new URL(url);
            selectedUrl.searchParams.set('session_id', String(selected._id));
            const selectedResponse = await fetch(selectedUrl, { cache: 'no-store' });
            const selectedData = await selectedResponse.json().catch(() => ({}));
            if (selectedResponse.ok && selectedData.storage === 'mongodb') {
                incomingEntries = Array.isArray(selectedData.entries) ? selectedData.entries : [];
            }
        }
        trackerBankEntries = selected
            ? trackerBankMergeEntries(trackerBankEntries, incomingEntries)
            : [];
        trackerBankEntriesSessionId = selected?._id || null;
        trackerBankSetMessage(active
            ? 'Sesión activa. Las tiradas Live se guardan en MongoDB.'
            : selected
                ? `Última sesión guardada: ${trackerBankOutcomeLabel(selected.final_outcome)}. Detenida hasta iniciar otra.`
                : 'Ingresa capital y ficha para iniciar una sesión.');
        renderTrackerBankroll();
        if (trackerBankPending.length) flushTrackerBankQueue().catch(() => {});
    } catch (error) {
        trackerBankSetMessage(`MongoDB Atlas no conectado: ${error.message}. Reconéctalo para usar la banca.`);
    } finally {
        trackerBankLoading = false;
    }
}

function trackerBankOutcomeLabel(outcome) {
    return ({ won: 'GANADA', lost: 'PERDIDA', break_even: 'EMPATE', pending: 'EN CURSO' })[outcome] || 'EN CURSO';
}

function renderTrackerBankroll() {
    const session = trackerBankSelectedSession();
    const active = session?.status === 'active';
    const canStart = !active;
    const capital = Number(session?.initial_capital || 0);
    const balance = Number(session?.balance || 0);
    const profit = Number((balance - capital).toFixed(2));
    const chipInput = Number(document.getElementById('tracker-bank-chip')?.value);
    const chip = Number(active ? session.chip_value : session?.chip_value || chipInput || 0.5);
    const round = active ? Number(session.current_round || 1) : 1;
    const stake = trackerBankStake(chip, round);
    const cycle = active ? Number(session.cycle_wagered || 0) : 0;
    const roundTotal = Number((cycle + stake).toFixed(2));
    const grossReturn = Number((stake * 4).toFixed(2));
    const possibleProfit = Number((stake * 4 - cycle - stake).toFixed(2));
    const pred = trackerBankPredictionNumbers();
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('tracker-bank-capital-value', session ? trackerBankMoney(capital) : '--');
    set('tracker-bank-balance', session ? trackerBankMoney(balance) : '--');
    set('tracker-bank-profit', session ? `${profit > 0 ? '+' : ''}${trackerBankMoney(profit)}` : '--');
    set('tracker-bank-wins', String(session?.wins || 0));
    set('tracker-bank-losses', String(session?.losses || 0));
    set('tracker-bank-outcome', session ? (session.status === 'closed' ? trackerBankOutcomeLabel(session.final_outcome) : `${trackerBankOutcomeLabel(profit > 0 ? 'won' : profit < 0 ? 'lost' : 'break_even')} · provisional`) : '--');
    set('tracker-bank-round', active ? String(round) : '--');
    set('tracker-bank-stake', active ? trackerBankMoney(stake) : '--');
    set('tracker-bank-cycle', active ? trackerBankMoney(roundTotal) : '--');
    set('tracker-bank-gross-return', active ? trackerBankMoney(grossReturn) : '--');
    set('tracker-bank-win-profit', active ? trackerBankMoney(possibleProfit) : '--');
    set('tracker-bank-prediction', active && trackerSource === 'live' && pred.length ? `N4: ${pred.join(', ')}` : '--');
    set('tracker-bank-totals', session ? `${session.total_spins || 0} / ${trackerBankMoney(session.total_wagered)}` : '0 / --');
    set('tracker-bank-started', session ? trackerBankDate(session.starts_at || session.created_at) : '--');
    set('tracker-bank-ended', session?.closed_at ? trackerBankDate(session.closed_at) : session ? (session.status === 'draft' ? 'Sin iniciar' : 'En curso') : '--');
    const start = document.getElementById('tracker-bank-start');
    if (start) start.style.display = canStart ? 'block' : 'none';
    ['tracker-bank-capital', 'tracker-bank-chip'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.disabled = active;
    });
    const finish = document.getElementById('tracker-bank-finish');
    if (finish) finish.style.display = active ? 'block' : 'none';
    const inline = document.getElementById('tracker-bank-inline');
    if (inline) {
        const center = trackerBankPredictionCenter();
        const hasCenter = center !== null && Number.isInteger(Number(center));
        inline.textContent = active && trackerSource === 'live' && hasCenter
            ? trackerBankMoney(stake)
            : '';
        inline.title = active ? `Apuesta de la ronda ${round}, no el acumulado del ciclo.` : '';
    }
    const ledger = document.getElementById('tracker-bank-ledger');
    if (ledger) ledger.innerHTML = trackerBankEntries.length
        ? trackerBankEntries.slice(-30).reverse().map(entry => {
            const prediction = Array.isArray(entry.prediction_numbers) ? entry.prediction_numbers.join(', ') : '';
            const center = Number.isInteger(Number(entry.prediction_center)) ? Number(entry.prediction_center) : '--';
            return `<tr><td>${entry.cycle_no || 1}</td><td>${entry.round}</td><td title="N4 ${center}: ${prediction}">${center} → ${entry.number} ${entry.won ? '✓' : '×'}</td><td>${trackerBankMoney(entry.stake)}</td><td>${trackerBankMoney(entry.payout)}</td><td>${trackerBankMoney(entry.balance_after)}</td></tr>`;
        }).join('')
        : '<tr><td colspan="6" style="text-align:center">Sin resultados guardados</td></tr>';
}

function toggleTrackerBankPanel(open) {
    const overlay = document.getElementById('tracker-bank-overlay');
    if (!overlay) return;
    overlay.style.display = open ? 'flex' : 'none';
    if (open) loadTrackerBankSessions();
}

async function startTrackerBankSession() {
    const capital = Number(document.getElementById('tracker-bank-capital')?.value);
    const chip = Number(document.getElementById('tracker-bank-chip')?.value);
    const startButton = document.getElementById('tracker-bank-start');
    if (trackerBankActiveSession()) return;
    if (startButton?.disabled) return;
    if (trackerSource !== 'live') {
        trackerBankSetMessage('Cambia el Tracker a LIVE antes de iniciar una sesión con IA.');
        return;
    }
    if (!trackerMemoryAvailable) {
        trackerBankSetMessage('MongoDB no está conectado; conecta la base antes de activar IA y banca.');
        return;
    }
    if (!Number.isFinite(capital) || capital <= 0 || !Number.isFinite(chip) || chip <= 0) {
        trackerBankSetMessage('Ingresa un capital y un valor de ficha válidos.');
        return;
    }
    if (startButton) startButton.disabled = true;
    trackerBankSetMessage('Iniciando sesión y guardándola en MongoDB...');
    try {
        saveTrackerConfig();
        const createResponse = await fetch(`/api/tracker/bankroll/${encodeURIComponent(trackerBankTableId())}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initial_capital: capital, chip_value: chip })
        });
        const created = await createResponse.json();
        if (!createResponse.ok || created.storage !== 'mongodb') throw new Error(created.error || `HTTP ${createResponse.status}`);
        const session = created.session;
        const response = await fetch(`/api/tracker/bankroll/${encodeURIComponent(trackerBankTableId())}/${encodeURIComponent(session._id)}/activate`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok || data.storage !== 'mongodb') throw new Error(data.error || `HTTP ${response.status}`);
        trackerBankSessions = trackerBankMergeSessions(trackerBankSessions, [data.session]);
        trackerBankSelectedSessionId = session._id;
        await loadTrackerBankSessions();
        trackerAiN4Center = null;
        trackerAiDisplayStatus = 'ANALIZANDO...';
        document.getElementById('tracker-chat-messages')?.replaceChildren();
        const aiStatus = document.getElementById('tracker-ai-status');
        if (aiStatus) aiStatus.innerText = 'ANALIZANDO...';
        trackerLiveEventRevision++;
        setTrackerPredictionMode('n4');
        trackerAutoBet = true;
        const autoButton = document.getElementById('tracker-auto-bet-btn');
        if (autoButton) {
            autoButton.innerHTML = '&#x1F916; IA AUTO: ON';
            autoButton.classList.remove('off');
        }
        localStorage.setItem('tracker_auto_bet', '1');
        renderTrackerBankroll();
        trackerBankSetMessage('');
        askTrackerAIForAnalysisSilent();
    } catch (error) {
        trackerBankSetMessage(`No se pudo iniciar la sesión en MongoDB: ${error.message}`);
    } finally {
        if (startButton) startButton.disabled = false;
    }
}

async function closeTrackerBankSession() {
    const session = trackerBankActiveSession();
    if (!session) return;
    const confirmed = window.confirm('¿Finalizar la sesión y guardar su resultado en MongoDB?');
    if (!confirmed) return;
    const finishButton = document.getElementById('tracker-bank-finish');
    if (finishButton) finishButton.disabled = true;
    try {
        await trackerBankQueue.catch(() => {});
        if (trackerBankPending.length) {
            trackerBankSetMessage('Hay tiradas Live pendientes de guardar en MongoDB. Reconecta antes de finalizar.');
            return;
        }
        const response = await fetch(trackerBankCloseUrl(session._id), { method: 'POST' });
        const data = await response.json();
        if (!response.ok || data.storage !== 'mongodb') throw new Error(data.error || `HTTP ${response.status}`);
        trackerBankSelectedSessionId = session._id;
        await loadTrackerBankSessions();
        trackerBankSetMessage(`Sesión finalizada: ${trackerBankOutcomeLabel(data.session.final_outcome)} · ${trackerBankMoney(data.session.balance - data.session.initial_capital)} netos. Resultado guardado.`);
    } catch (error) {
        trackerBankSetMessage(`No se pudo cerrar la sesión en MongoDB: ${error.message}`);
    } finally {
        if (finishButton) finishButton.disabled = false;
    }
}

function enqueueTrackerBankSpin(spin) {
    const pendingKey = `${spin.sessionId}:${spin.spinId}`;
    if (trackerBankPendingKeys.has(pendingKey)) return;
    trackerBankPendingKeys.add(pendingKey);
    const insertAt = trackerBankPending.findIndex(item =>
        String(item.sessionId) === String(spin.sessionId) && Number(item.spinId) > Number(spin.spinId)
    );
    if (insertAt === -1) trackerBankPending.push(spin);
    else trackerBankPending.splice(insertAt, 0, spin);
    flushTrackerBankQueue().catch(() => {});
}

function flushTrackerBankQueue() {
    trackerBankQueue = trackerBankQueue.catch(() => {}).then(async () => {
        while (trackerBankPending.length) {
            const spin = trackerBankPending[0];
            const pendingKey = `${spin.sessionId}:${spin.spinId}`;
            let response, data;
            try {
                response = await fetch(`/api/tracker/bankroll/${encodeURIComponent(trackerBankTableId())}/${encodeURIComponent(spin.sessionId)}/settle`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spin_id: spin.spinId, number: spin.number, prediction_center: spin.predictionCenter })
                });
                data = await response.json().catch(() => ({}));
            } catch (error) {
                trackerBankSetMessage('No hay conexión con MongoDB. La liquidación Live queda pendiente y se reintentará automáticamente.');
                break;
            }
            if (!response.ok || data.storage !== 'mongodb') {
                const retryable = data.retryable === true || String(data.error || '').includes('no está confirmada');
                if (response.status === 503 || response.status >= 500 || retryable) {
                    spin.retries = Number(spin.retries || 0) + 1;
                    trackerBankSetMessage(`Tirada Live pendiente (${spin.retries} intentos). No se avanzó la ronda; se reintentará.`);
                    break;
                }
                trackerBankSetMessage(`${data.error || 'No se pudo liquidar la tirada Live.'} Se conserva pendiente y se detuvo la banca para no alterar el conteo.`);
                break;
            }
            trackerBankPending.shift();
            trackerBankPendingKeys.delete(pendingKey);
            trackerBankSessions = trackerBankMergeSessions(trackerBankSessions, [data.session]);
            if (String(trackerBankEntriesSessionId || '') !== String(data.session._id)) {
                trackerBankEntries = [];
                trackerBankEntriesSessionId = data.session._id;
            }
            if (!data.duplicate) trackerBankEntries = trackerBankMergeEntries(trackerBankEntries, [data.entry]);
            trackerBankSelectedSessionId = data.session._id;
            renderTrackerBankroll();
            trackerBankSetMessage(data.entry.won
                ? `Acierto en ronda ${data.entry.round}. Ciclo: ${trackerBankMoney(data.entry.cycle_profit)} netos.`
                : `Falló ronda ${data.entry.round}. Próxima ronda ${data.session.current_round}: ${trackerBankMoney(trackerBankStake(data.session.chip_value, data.session.current_round))}.`);
        }
    });
    return trackerBankQueue;
}

async function syncTrackerFromLive() {
    if (trackerLiveSyncInFlight) return;
    trackerLiveSyncInFlight = true;
    const revisionAtStart = trackerLiveEventRevision;
    let liveSpins = null;
    try {
        const tableId = typeof currentTableId !== 'undefined' && currentTableId ? currentTableId : 1;
        const response = await fetch(`/api/history/${encodeURIComponent(tableId)}?limit=400`);
        if (response.ok) {
            const spins = await response.json();
            if (Array.isArray(spins)) {
                liveSpins = spins
                    .filter(spin => spin && (spin.source === 'casino_org_live' || spin.source === 'public_scraper'))
                    .filter(spin => Number.isInteger(Number(spin.id)) && Number(spin.id) > 0 &&
                        Number.isInteger(Number(spin.number)) && Number(spin.number) >= 0 && Number(spin.number) <= 36)
                    .map(spin => ({ id: Number(spin.id), number: Number(spin.number) }));
            }
        } else return;
    } catch (error) {
        console.warn('[Tracker] No se pudo leer historial Live desde MongoDB.', error);
        return;
    } finally {
        trackerLiveSyncInFlight = false;
    }
    if (revisionAtStart !== trackerLiveEventRevision || !Array.isArray(liveSpins)) return;
    const tableId = String(trackerBankTableId());
    if (trackerLiveIdsTableId !== tableId) {
        trackerLiveSpinIds.clear();
        trackerLiveIdsTableId = tableId;
    }
    const unseenSpins = liveSpins
        .filter(spin => !trackerLiveSpinIds.has(spin.id))
        .sort((left, right) => left.id - right.id);
    liveSpins.forEach(spin => trackerLiveSpinIds.add(spin.id));
    const liveNumbers = liveSpins.map(spin => spin.number);
    const changed = liveNumbers.length !== trackerLiveHistory.length || unseenSpins.length > 0 ||
        liveNumbers.some((number, index) => number !== trackerLiveHistory[index]);
    if (changed) {
        const activeSession = trackerBankActiveSession();
        let hasEligibleNewSpin = false;
        if (activeSession && unseenSpins.length) {
            const settledThrough = Number(activeSession.last_settled_spin_id ?? activeSession.start_spin_id ?? 0);
            const firstUnseen = unseenSpins.find(spin => spin.id > settledThrough);
            if (firstUnseen) {
                hasEligibleNewSpin = true;
                const predictionCenter = trackerBankPredictionCenter();
                if (Number.isInteger(predictionCenter)) {
                    enqueueTrackerBankSpin({
                        sessionId: activeSession._id,
                        spinId: firstUnseen.id,
                        number: firstUnseen.number,
                        predictionCenter
                    });
                }
                trackerAiN4Center = null;
                trackerAiDisplayStatus = 'ANALIZANDO...';
                trackerLiveEventRevision++;
            }
        }
        trackerLiveHistory.length = 0;
        for (const number of liveNumbers) trackerLiveHistory.push(number);
        renderTracker();
        console.log('[Tracker] Synced ' + trackerLiveHistory.length + ' spins from Live mode');
        if (activeSession && hasEligibleNewSpin && trackerAutoBet) {
            if (trackerAutoAnalysisTimer) clearTimeout(trackerAutoAnalysisTimer);
            trackerAutoAnalysisTimer = setTimeout(askTrackerAIForAnalysisSilent, 500);
        }
    }
    if (trackerBankPending.length) flushTrackerBankQueue().catch(() => {});
}

async function loadTrackerAiMemory() {
    const loadId = ++trackerMemoryLoadId;
    const tableId = typeof currentTableId !== 'undefined' && currentTableId ? currentTableId : 1;
    const source = 'live';
    try {
        const response = await fetch(`/api/tracker/memory/${encodeURIComponent(tableId)}/${source}`);
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        const memory = await response.json();
        if (loadId !== trackerMemoryLoadId) return;
        if (memory.storage !== 'mongodb') throw new Error('El backend no confirmó conexión con MongoDB Atlas.');
        trackerMemoryAvailable = true;
        trackerAiMemory = {
            summary: String(memory.summary || ''),
            messages: Array.isArray(memory.messages) ? memory.messages.slice(-20) : [],
            context: memory.context && typeof memory.context === 'object' ? memory.context : {}
        };
        const box = document.getElementById('tracker-chat-messages');
        if (box) {
            box.replaceChildren();
            const showHistory = !(trackerSource === 'live' && trackerBankActiveSession());
            (showHistory ? trackerAiMemory.messages.slice(-10) : []).forEach(message => {
                const div = document.createElement('div');
                div.className = 'tracker-msg ' + (message.role === 'user' ? 'user-msg' : 'ai-msg');
                div.textContent = String(message.content || '');
                box.appendChild(div);
            });
            box.scrollTop = box.scrollHeight;
        }
        const status = document.getElementById('tracker-ai-status');
        if (status) {
            status.innerText = trackerBankActiveSession() ? 'ANALIZANDO...' : trackerSource === 'manual'
                ? 'MongoDB conectado. Manual usa conocimiento Live; no se guarda.'
                : trackerAiMemory.messages.length
                    ? `Memoria MongoDB restaurada: ${trackerAiMemory.messages.length} mensajes`
                    : 'MongoDB conectado. Memoria IA lista.';
        }
        if (trackerAutoBet && trackerHistory.length >= 3 && (trackerSource !== 'live' || trackerBankActiveSession())) {
            askTrackerAIForAnalysisSilent();
        }
    } catch (error) {
        if (loadId === trackerMemoryLoadId) trackerMemoryAvailable = false;
        console.warn('[Tracker] No se pudo cargar la memoria guardada:', error.message);
        const status = document.getElementById('tracker-ai-status');
        if (status) status.innerText = error.message || 'MongoDB Atlas no conectado. IA pausada.';
    }
}

function pauseTrackerForMongo() {
    trackerMemoryAvailable = false;
    if (trackerAutoAnalysisTimer) {
        clearTimeout(trackerAutoAnalysisTimer);
        trackerAutoAnalysisTimer = null;
    }
    const status = document.getElementById('tracker-ai-status');
    if (status) status.innerText = 'MongoDB Atlas desconectado; Tracker pausado.';
}

async function saveTrackerAiMemory(userText, assistantText, source = trackerSource, baseMemory = trackerAiMemory, context = buildTrackerAIContext()) {
    if (source !== 'live') return;
    const tableId = typeof currentTableId !== 'undefined' && currentTableId ? currentTableId : 1;
    if (source === trackerSource) baseMemory = trackerAiMemory;
    const nextMessages = [
        ...baseMemory.messages,
        { role: 'user', content: String(userText || '').slice(0, 1800) },
        { role: 'assistant', content: String(assistantText || '').slice(0, 1800) }
    ].slice(-20);
    const summary = String(assistantText || baseMemory.summary).slice(-3000);
    const savedContext = {
        totalSpins: context.totalSpins,
        recentNumbers: context.spins.slice(-20),
        savedAt: new Date().toISOString()
    };
    try {
        const response = await fetch(`/api/tracker/memory/${encodeURIComponent(tableId)}/${source}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary, messages: nextMessages, context: savedContext })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (result.storage !== 'mongodb') throw new Error('El servidor no confirmó guardado en MongoDB Atlas.');
        if (source === trackerSource) trackerAiMemory = { summary, messages: nextMessages, context: savedContext };
        const status = document.getElementById('tracker-ai-status');
        if (status) status.innerText = trackerBankActiveSession() ? 'ANALIZANDO...' : 'Análisis y memoria guardados en MongoDB';
    } catch (error) {
        if (source === trackerSource) pauseTrackerForMongo();
        console.error('[Tracker] No se pudo guardar la memoria de IA:', error.message);
        const status = document.getElementById('tracker-ai-status');
        if (status) status.innerText = 'MongoDB Atlas no disponible; IA pausada y memoria no guardada.';
    }
}

function setTrackerSource(source) {
    if (source !== 'manual' && source !== 'live') return;
    if (trackerBankActiveSession() && source !== 'live') {
        trackerBankSetMessage('La sesión de banca requiere Tracker LIVE y predicción IA.');
        return;
    }
    if (trackerSource === source) return;
    if (trackerSource !== source) trackerLiveEventRevision++;
    trackerSource = source;
    trackerHistory = source === 'live' ? trackerLiveHistory : trackerManualHistory;
    trackerLastSignal = null;
    trackerAiN4Center = null;
    trackerTriggerCounter = 0;
    trackerLastDominantDir = null;
    trackerLastDominantZone = null;
    trackerLastZigzag = false;
    trackerCurrentAvgCW = 9;
    trackerCurrentAvgCCW = -9;
    const manualBtn = document.getElementById('tracker-src-manual');
    const liveBtn = document.getElementById('tracker-src-live');
    const manualInput = document.getElementById('tracker-manual-input');
    const liveInfo = document.getElementById('tracker-live-info');
    if (manualBtn) manualBtn.classList.toggle('active', source === 'manual');
    if (liveBtn) liveBtn.classList.toggle('active', source === 'live');
    if (manualInput) manualInput.style.display = source === 'manual' ? 'flex' : 'none';
    if (liveInfo) liveInfo.style.display = source === 'live' ? 'block' : 'none';
    if (source === 'live') {
        syncTrackerFromLive();
    }
    updateTrackerLiveSync();
    loadTrackerAiMemory();
    trackerConfig.source = source;
    try { localStorage.setItem('tracker_ai_config', JSON.stringify(trackerConfig)); } catch(e) {}
    renderTracker();
}

function updateTrackerLiveSync() {
    if (trackerLiveSyncTimer) {
        clearInterval(trackerLiveSyncTimer);
        trackerLiveSyncTimer = null;
    }
    if (currentMode !== 'tracker' || trackerSource !== 'live') return;
    trackerLiveSyncTimer = setInterval(() => {
        syncTrackerFromLive().finally(() => {
            if (trackerBankPending.length) flushTrackerBankQueue().catch(() => {});
        });
    }, 5000);
}

function toggleTrackerConfig() {
    const panel = document.getElementById('tracker-config-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function onTrackerProviderChange() {
    const prov = document.getElementById('tracker-ai-provider')?.value || 'ollama';
    const modelSelect = document.getElementById('tracker-ai-model');
    const keyInput = document.getElementById('tracker-ai-key');
    if (modelSelect) {
        const optionsByProvider = {
            openrouter: [
                ['openai/gpt-oss-120b', 'GPT OSS 120B'],
                ['openai/gpt-5.5', 'GPT 5.5']
            ]
        };
        const options = optionsByProvider[prov] || optionsByProvider.openrouter;
        modelSelect.innerHTML = options.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
    }
    if (keyInput) {
        keyInput.placeholder = 'API key de OpenRouter (https://openrouter.ai/keys)';
    }
    if (keyInput) {
        if (prov === 'ollama') keyInput.placeholder = 'VacÃ­o = localhost:11434 | Con key = Ollama Cloud';
        else if (prov === 'groq') keyInput.placeholder = 'Key de Groq (console.groq.com/keys)';
        else if (prov === 'gemini') keyInput.placeholder = 'Key de Google AI Studio (gratis)';
        else if (prov === 'openai') keyInput.placeholder = 'Key de OpenAI (pago)';
        else if (prov === 'openrouter') keyInput.placeholder = 'Key de OpenRouter (openrouter.ai/keys)';
    }
}

const DEPRECATED_GROQ_MODELS = {
    'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
    'mixtral-8x7b-32768': 'openai/gpt-oss-20b',
    'gemma2-9b-it': 'openai/gpt-oss-20b',
    'qwen-2.5-32b': 'qwen/qwen3.6-27b',
    'deepseek-r1-distill-llama-70b': 'openai/gpt-oss-120b'
};

function migrateGroqModel(model) {
    if (!model) return 'openai/gpt-oss-120b';
    return DEPRECATED_GROQ_MODELS[model] || model;
}

function saveTrackerConfig() {
    trackerConfig.provider = document.getElementById('tracker-ai-provider')?.value || 'ollama';
    let model = document.getElementById('tracker-ai-model')?.value || '';
    // Auto-fix model if empty
    if (!model) model = 'openai/gpt-oss-120b';
    model = model.trim();
    if (trackerConfig.provider === 'groq') model = migrateGroqModel(model);
    trackerConfig.model = model.trim();
    trackerConfig.apiKey = (document.getElementById('tracker-ai-key')?.value || '').trim();
    trackerConfig.prediction = document.getElementById('tracker-ai-pred')?.value || 'both';
    trackerConfig.voice = trackerVoiceEnabled;
    trackerConfig.source = trackerSource;
    // Force fast model if user tries to save the slow one
    if (trackerConfig.provider === 'ollama' && trackerConfig.model && String(trackerConfig.model).includes('qwen3:8b')) {
        trackerConfig.model = 'qwen2.5:0.5b';
    }
    localStorage.setItem('tracker_ai_config', JSON.stringify(trackerConfig));
    // Update select to show corrected model
    const mInput = document.getElementById('tracker-ai-model');
    if (mInput) mInput.value = trackerConfig.model;
    const keyLen = trackerConfig.apiKey.length;
    const keyStatus = keyLen > 10 ? 'OK (' + keyLen + ' chars)' : 'vacÃ­a o muy corta (' + keyLen + ')';
    console.log('[Tracker] Config guardada:', trackerConfig.provider, trackerConfig.model, keyStatus);
}

async function testTrackerAIConnection() {
    const prompt = buildTrackerPrompt({
        spins: [0], travels: [0], stats: { cw: 50, big: 50, zigzag: false },
        prediction: null, source: 'test', totalSpins: 1
    }, 'RespondÃ© con una frase corta confirmando que estÃ¡s lista.');
    await callTrackerAI(prompt, false);
}

function loadTrackerConfig() {
    try {
        const raw = localStorage.getItem('tracker_ai_config');
        if (raw) {
            const cfg = JSON.parse(raw);
            trackerConfig = { ...trackerConfig, ...cfg };
            // Force model if empty
            if (!trackerConfig.model) trackerConfig.model = 'openai/gpt-oss-120b';
            trackerVoiceEnabled = trackerConfig.voice || false;
            if (cfg.source === 'live' || cfg.source === 'manual') {
                setTrackerSource(cfg.source);
                // Delayed sync to allow app.js to restore history first
                setTimeout(() => {
                    if (trackerSource === 'live') syncTrackerFromLive();
                }, 800);
            }
            onTrackerProviderChange();
            const p = document.getElementById('tracker-ai-provider'); if (p) p.value = trackerConfig.provider;
            const m = document.getElementById('tracker-ai-model'); if (m) m.value = trackerConfig.model;
            const k = document.getElementById('tracker-ai-key'); if (k) k.value = trackerConfig.apiKey;
            const pr = document.getElementById('tracker-ai-pred'); if (pr) pr.value = trackerConfig.prediction;
            // init mode buttons
            ['n9','n4','both'].forEach(m => {
                const btn = document.getElementById('tracker-btn-' + m);
                if (btn) btn.classList.toggle('active', m === trackerConfig.prediction);
            });
            updateNeighborButton();
            const v = document.getElementById('tracker-voice-btn');
            if (v) {
                if (trackerVoiceEnabled) { v.innerHTML = '&#x1F50A; ON'; v.classList.remove('off'); }
                else { v.innerHTML = '&#x1F50A; OFF'; v.classList.add('off'); }
            }
        }
    } catch(e) {}
    // Restaurar estado del análisis automático.
    const savedAutoBet = localStorage.getItem('tracker_auto_bet');
    if (savedAutoBet === '1') {
        trackerAutoBet = true;
        const btn = document.getElementById('tracker-auto-bet-btn');
        if (btn) { btn.innerHTML = '&#x1F916; IA AUTO: ON'; btn.classList.remove('off'); }
    }
}

function toggleTrackerVoice() {
    trackerVoiceEnabled = !trackerVoiceEnabled;
    const btn = document.getElementById('tracker-voice-btn');
    if (btn) {
        if (trackerVoiceEnabled) { btn.innerHTML = '&#x1F50A; ON'; btn.classList.remove('off'); }
        else { btn.innerHTML = '&#x1F50A; OFF'; btn.classList.add('off'); }
    }
}

let trackerAutoAnalysisTimer = null;

function submitTrackerNumber(n, batch = false, source = trackerSource, spinId = null) {
    if (source !== trackerSource || !Number.isInteger(n) || n < 0 || n > 36) return;
    if (source === 'live' && Number.isInteger(Number(spinId)) && Number(spinId) > 0) {
        const normalizedSpinId = Number(spinId);
        if (trackerLiveSpinIds.has(normalizedSpinId)) return;
        trackerLiveSpinIds.add(normalizedSpinId);
        trackerLiveIdsTableId = String(trackerBankTableId());
    }
    if (source === 'manual' && !trackerMemoryAvailable) {
        const status = document.getElementById('tracker-ai-status');
        if (status) status.innerText = 'MongoDB Atlas no conectado; Manual está pausado.';
        return;
    }
    if (source === 'live' && !batch && spinId && trackerBankActiveSession()) {
        const predictionCenter = trackerBankPredictionCenter();
        if (Number.isInteger(predictionCenter) && trackerBankPredictionNumbers().length === 9) enqueueTrackerBankSpin({
            sessionId: trackerBankActiveSession()._id,
            spinId: Number(spinId),
            number: n,
            predictionCenter
        });
    }
    if (source === 'live' && !batch) {
        trackerAiN4Center = null;
        if (trackerBankActiveSession()) trackerAiDisplayStatus = 'ANALIZANDO...';
    }
    if (source === 'live' && !batch) trackerLiveEventRevision++;
    trackerHistory.push(n);
    if (trackerSource === 'live' && !batch) {
        console.log('[Tracker Live] NÃºmero recibido:', n, '| Total:', trackerHistory.length);
        const status = document.getElementById('tracker-ai-status');
        if (status) status.innerText = trackerBankActiveSession() ? 'ANALIZANDO...' : 'Dato live recibido: ' + n;
    }
    if (!batch) {
        renderTracker();
        // El análisis automático solo se ejecuta cuando IA AUTO está activado.
        if (trackerAutoBet && trackerHistory.length > 0 && (trackerSource !== 'live' || trackerBankActiveSession())) {
            if (trackerAutoAnalysisTimer) clearTimeout(trackerAutoAnalysisTimer);
            trackerAutoAnalysisTimer = setTimeout(() => {
                askTrackerAIForAnalysisSilent();
            }, 500);
        }
    }
}

async function askTrackerAIForAnalysisSilent() {
    if (trackerSource === 'live') {
        if (trackerAiLastRequestedRevision === trackerLiveEventRevision) return;
        trackerAiLastRequestedRevision = trackerLiveEventRevision;
    }
    const ctx = buildTrackerAIContext();
    const prompt = buildTrackerPrompt(ctx, null);
    await callTrackerAISilent(prompt);
}

async function callTrackerAISilent(promptObj) {
    const status = document.getElementById('tracker-ai-status');
    const predEl = document.getElementById('tracker-prediction');
    if (!trackerMemoryAvailable) {
        if (status) status.innerText = 'MongoDB Atlas no conectado; IA pausada.';
        if (predEl) predEl.innerText = '--';
        trackerAiDisplayStatus = 'ANALIZANDO...';
        renderTrackerBankroll();
        return;
    }
    saveTrackerConfig();
    const requestId = ++trackerAiRequestId;
    if (trackerAiRequestController) trackerAiRequestController.abort();
    const controller = new AbortController();
    trackerAiRequestController = controller;
    if (status) status.innerText = trackerBankActiveSession() ? 'ANALIZANDO...' : 'Pensando...';
    trackerAiDisplayStatus = 'ANALIZANDO...';
    if (predEl) predEl.innerText = trackerBankActiveSession() ? trackerAiDisplayStatus : 'ANALIZANDO...';
    renderTrackerBankroll();
    const requestSource = trackerSource;
    const requestRevision = trackerLiveEventRevision;
    const requestMemory = trackerAiMemory;
    const requestContext = buildTrackerAIContext();
    const aiOnlyBankroll = requestSource === 'live' && Boolean(trackerBankActiveSession());
    try {
        const memoryContext = aiOnlyBankroll && requestMemory.context
            ? `Referencia MongoDB: últimos números guardados ${(requestMemory.context.recentNumbers || []).slice(-12).join(', ')}; total ${requestMemory.context.totalSpins || 0}.`
            : requestMemory.summary
                ? `CONTEXTO HISTÓRICO DE MONGODB (referencia secundaria; prioriza los datos actuales):\n${requestMemory.summary}\nNúmeros recientes guardados: ${(requestMemory.context?.recentNumbers || []).join(', ')}. Total guardado: ${requestMemory.context?.totalSpins || 0}.`
                : '';
        const payload = {
            provider: trackerConfig.provider,
            model: trackerConfig.model,
            apiKey: trackerConfig.apiKey,
            messages: [...(requestSource === 'live' && !aiOnlyBankroll ? requestMemory.messages.slice(-8) : []), ...promptObj.messages],
            system: aiOnlyBankroll
                ? [memoryContext, promptObj.system].filter(Boolean).join('\n\n')
                : memoryContext
                    ? `${promptObj.system}\n\n${memoryContext}`
                    : promptObj.system
        };
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        let res;
        try {
            res = await fetch('/api/ai/tracker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }
        if (requestId !== trackerAiRequestId) return;
        if (!res.ok) {
            if (res.status === 503) pauseTrackerForMongo();
            throw new Error('HTTP ' + res.status);
        }
        const data = await res.json();
        if (data.success && data.response) {
            if (requestSource === trackerSource && requestRevision === trackerLiveEventRevision) {
                syncPredictionFromAI(data.response);
            } else if (status) {
                status.innerText = trackerBankActiveSession() ? 'ANALIZANDO...' : 'Análisis anterior descartado; hay tiradas más recientes.';
                trackerAiDisplayStatus = 'ANALIZANDO...';
                if (trackerAutoBet) {
                    if (trackerAutoAnalysisTimer) clearTimeout(trackerAutoAnalysisTimer);
                    trackerAutoAnalysisTimer = setTimeout(askTrackerAIForAnalysisSilent, 300);
                }
            }
            const finalUserMessage = promptObj.memoryText || 'Análisis automático del Tracker.';
            if (requestSource === 'live') {
                await saveTrackerAiMemory(finalUserMessage, data.response, requestSource, requestMemory, requestContext);
            } else if (status) {
                status.innerText = 'Análisis Manual listo; los datos no se guardaron.';
            }
        } else {
            console.warn('[Tracker AI Silent] Empty/error response:', data.error || 'empty response');
            trackerAiDisplayStatus = 'ANALIZANDO...';
            if (predEl && trackerBankActiveSession()) predEl.innerText = trackerAiDisplayStatus;
        }
    } catch (err) {
        if (requestId !== trackerAiRequestId) return;
        console.error('[Tracker AI Silent] ERROR:', err.name, err.message);
        trackerAiDisplayStatus = 'ANALIZANDO...';
        if (predEl) predEl.innerText = trackerBankActiveSession() ? trackerAiDisplayStatus : '--';
    }
    if (requestId === trackerAiRequestId) trackerAiRequestController = null;
    if (status && status.innerText === 'Pensando...') status.innerText = 'Esperando datos...';
    renderTrackerBankroll();
}

function processTrackerNumber() {
    if (trackerSource !== 'manual') return;
    const input = document.getElementById('tracker-number-input');
    if (!input) return;
    const raw = input.value.trim();
    const n = parseInt(raw);
    if (isNaN(n) || n < 0 || n > 36) {
        input.style.borderColor = '#f55';
        setTimeout(() => input.style.borderColor = '', 400);
        return;
    }
    input.value = '';
    input.focus();
    submitTrackerNumber(n, false, 'manual');
}

let isWiping = false;

function undoTrackerNumber() {
    if (trackerSource !== 'manual' || trackerHistory.length === 0 || !trackerMemoryAvailable) return;
    trackerHistory.pop();
    renderTracker();
}

function clearTrackerData() {
    if (isWiping || trackerSource !== 'manual' || !trackerMemoryAvailable) return;
    isWiping = true;
    trackerManualHistory.length = 0;
    trackerLastSignal = null;
    trackerTriggerCounter = 0;
    trackerLastDominantDir = null;
    trackerLastDominantZone = null;
    trackerLastZigzag = false;
    trackerCurrentAvgCW = 9;
    trackerCurrentAvgCCW = -9;
    renderTracker();
    isWiping = false;
}

function toggleTrackerAutoBet() {
    if (trackerBankActiveSession() && trackerAutoBet) {
        trackerBankSetMessage('La IA N4 debe permanecer activa durante la sesión de banca.');
        return;
    }
    if (!trackerAutoBet && !trackerMemoryAvailable) {
        const status = document.getElementById('tracker-ai-status');
        if (status) status.innerText = 'Conecta MongoDB Atlas para activar la IA del Tracker.';
        return;
    }
    trackerAutoBet = !trackerAutoBet;
    const btn = document.getElementById('tracker-auto-bet-btn');
    if (btn) {
        if (trackerAutoBet) { btn.innerHTML = '&#x1F916; IA AUTO: ON'; btn.classList.remove('off'); }
        else { btn.innerHTML = '&#x1F916; IA AUTO: OFF'; btn.classList.add('off'); }
    }
    localStorage.setItem('tracker_auto_bet', trackerAutoBet ? '1' : '0');
    console.log('[Tracker] IA AUTO:', trackerAutoBet ? 'ON (analiza cada número nuevo)' : 'OFF (análisis automático pausado)');
    if (trackerAutoBet && trackerHistory.length >= 3) {
        const status = document.getElementById('tracker-ai-status');
        if (status) status.innerText = 'IA AUTO ON: analizando...';
        askTrackerAIForAnalysisSilent();
    } else if (trackerAutoBet) {
        const status = document.getElementById('tracker-ai-status');
        if (status) status.innerText = 'IA AUTO ON: esperando 3+ números...';
    } else {
        if (trackerAutoAnalysisTimer) { clearTimeout(trackerAutoAnalysisTimer); trackerAutoAnalysisTimer = null; }
        const status = document.getElementById('tracker-ai-status');
        if (status) status.innerText = 'IA AUTO OFF: análisis automático pausado';
    }
}

function trackerBet9Neighbors() {
    const center = trackerSource === 'live'
        ? trackerAiN4Center
        : trackerLastSignal?.[trackerLastSignal.mainDir === 'CW' ? 'targetCW' : 'targetCCW'];
    if (!Number.isInteger(Number(center))) return;
    const neighbors = wheelNeighbors(center, 9);
    addTrackerChatMessage('ai', '&#x1F3B2; Apuesta sugerida: <strong>' + center + '</strong> + 9 vecinos ' + neighbors.join(', '));
}

function setTrackerPredictionMode(mode) {
    if (trackerBankActiveSession() && mode !== 'n4') {
        mode = 'n4';
        trackerBankSetMessage('La sesión de banca usa exclusivamente predicciones N4 de la IA.');
    }
    trackerConfig.prediction = mode;
    localStorage.setItem('tracker_ai_config', JSON.stringify(trackerConfig));
    ['n9','n4','both'].forEach(m => {
        const btn = document.getElementById('tracker-btn-' + m);
        if (btn) btn.classList.toggle('active', m === mode);
    });
    const pr = document.getElementById('tracker-ai-pred'); if (pr) pr.value = mode;
    updateNeighborButton();
    renderTracker();
}

function updateNeighborButton() {
    const btn = document.getElementById('tracker-neigh-btn');
    if (!btn) return;
    if (trackerConfig.prediction === 'n4') {
        btn.innerHTML = '&#x1F3B2; 4 NEIGHBOURS';
    } else {
        btn.innerHTML = '&#x1F3B2; 9 NEIGHBOURS';
    }
}

function trackerBetNeighbors() {
    let center;
    if (trackerSource === 'live') center = trackerAiN4Center;
    else {
        if (!trackerLastSignal) return;
        const dir = trackerLastSignal.mainDir || (trackerLastSignal.confidenceCW >= trackerLastSignal.confidenceCCW ? 'CW' : 'CCW');
        center = dir === 'CW' ? trackerLastSignal.targetCW : trackerLastSignal.targetCCW;
    }
    if (!Number.isInteger(Number(center))) return;
    const count = trackerConfig.prediction === 'n4' ? 4 : 9;
    const neighbors = wheelNeighbors(center, count);
    addTrackerChatMessage('ai', '&#x1F3B2; Apuesta sugerida: <strong>' + center + '</strong> + ' + count + ' vecinos ' + neighbors.join(', '));
}

function ordinalSuffix(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'th';
    switch (n % 10) {
        case 1: return n + 'st';
        case 2: return n + 'nd';
        case 3: return n + 'rd';
        default: return n + 'th';
    }
}

function renderTracker() {
    const spinsEl = document.getElementById('tracker-last-spins');
    if (spinsEl) {
        spinsEl.innerHTML = trackerHistory.slice(-10).map(n => {
            const c = getBallColor(n);
            return `<span class="tracker-spin-chip" style="background:${c.bg};color:${c.text};border-color:${c.border};">${n}</span>`;
        }).join('');
    }
    const statusText = document.getElementById('tracker-status-text');
    const placedBadge = document.getElementById('tracker-placed-badge');
    if (statusText) statusText.innerText = trackerHistory.length > 2 ? 'Active' : 'Waiting';
    if (placedBadge) {
        const hasPlacedPrediction = trackerSource === 'live' ? trackerAiN4Center !== null : Boolean(trackerLastSignal);
        if (trackerAutoBet && hasPlacedPrediction) { placedBadge.innerText = 'Placed'; placedBadge.className = 'tracker-status-badge status-placed'; }
        else { placedBadge.innerText = 'Waiting'; placedBadge.className = 'tracker-status-badge status-wait'; }
    }
    let predText = '--';
    if (trackerHistory.length >= 3 && trackerSource !== 'live') {
        try {
            // â”€â”€ CALCULAR PROMEDIOS REALES DEL TRACKER â”€â”€
            const travels = [];
            for (let i = 1; i < trackerHistory.length; i++) travels.push(calcDist(trackerHistory[i-1], trackerHistory[i]));
            const cwTravels = travels.filter(d => d > 0);
            const ccwTravels = travels.filter(d => d < 0);
            trackerCurrentAvgCW = cwTravels.length > 0 ? cwTravels.reduce((a,b) => a+b, 0) / cwTravels.length : 9;
            trackerCurrentAvgCCW = ccwTravels.length > 0 ? ccwTravels.reduce((a,b) => a+b, 0) / ccwTravels.length : -9;

            const sig = computeDealerSignature(trackerHistory);
            const prox = projectNextRound(trackerHistory, {});
            const signals = getIAMasterSignals(prox, sig, trackerHistory, { cw: trackerCurrentAvgCW, ccw: trackerCurrentAvgCCW, offset: trackerPredictorOffset });
            if (signals && signals.length > 0) trackerLastSignal = signals[0];

            // â”€â”€ ONDA / TRADING â”€â”€
            const wave = (typeof analyzeTravelWave === 'function' && travels.length >= 8) ? analyzeTravelWave(travels.slice(-12)) : null;

            // â”€â”€ CONSENSO DIRECCIONAL â”€â”€
            // Votes from each signal source
            let cwVotes = 0, ccwVotes = 0, voteCount = 0;
            if (trackerLastSignal) {
                const dir = trackerLastSignal.mainDir || (trackerLastSignal.confidenceCW > trackerLastSignal.confidenceCCW ? 'CW' : 'CCW');
                if (dir === 'CW') { cwVotes += 2; voteCount += 2; } else { ccwVotes += 2; voteCount += 2; }
            }
            if (wave && wave.targetDir) {
                if (wave.targetDir === 'CW') { cwVotes += 1; voteCount += 1; } else { ccwVotes += 1; voteCount += 1; }
            }
            if (sig && sig.avgTravel !== undefined) {
                if (sig.avgTravel > 1) { cwVotes += 1; voteCount += 1; }
                else if (sig.avgTravel < -1) { ccwVotes += 1; voteCount += 1; }
            }

            const finalDir = cwVotes >= ccwVotes ? 'CW' : 'CCW';
            let confidence = voteCount > 0 ? Math.round((Math.max(cwVotes, ccwVotes) / voteCount) * 100) : 50;
            // Cap confidence unless we have strong confirming sources
            if (voteCount < 5) confidence = Math.min(confidence, 85);
            if (trackerHistory.length < 15) confidence = Math.min(confidence, 75);

            if (trackerLastSignal) {
                trackerLastSignal.mainDir = finalDir;
                trackerLastSignal.confidence = confidence;
                if (wave && wave.signal) trackerLastSignal.waveSignal = wave.signal;
            }
        } catch(e) {}
    }
    const predEl = document.getElementById('tracker-prediction');
    if (trackerSource === 'live' && trackerBankActiveSession()) {
        const center = trackerBankPredictionCenter();
        if (predEl) predEl.innerText = center === null ? trackerAiDisplayStatus : `N4: ${center}`;
    } else {
        if (predEl) predEl.innerText = 'ANALIZANDO...';
    }
    updateNeighborButton();
    const chartRes = renderModeTravelChart('trackerChart', trackerHistory, trackerManualAvgOffset);
    if (chartRes) { trackerCurrentAvgCW = chartRes.avgCW; trackerCurrentAvgCCW = chartRes.avgCCW; }
    renderTravelTable('tracker-travel-tbody', trackerHistory, 'Esperando datos...');
    renderTrackerBankroll();
}

// â”€â”€ Render Travel Chart (identical visual style for Tracker and Manual) â”€â”€
function renderModeTravelChart(canvasId, history, avgOffset) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const H = canvas.height || 140;
    const parentW = (canvas.parentElement && canvas.parentElement.offsetWidth) || canvas.clientWidth || 420;
    const W = Math.max(120, Math.floor(parentW));
    canvas.width = W;
    canvas.style.width = W + 'px';
    ctx.clearRect(0, 0, W, H);
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    const padL = isMobile ? 24 : 30, padR = isMobile ? 34 : 50, padT = 20, padB = 20;
    const travels = [];
    for (let i = 1; i < history.length; i++) travels.push(calcDist(history[i-1], history[i]));
    if (history.length < 2 || travels.length < 1) {
        ctx.strokeStyle = '#2a3a5d'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.stroke();
        ctx.fillStyle = '#7a9bb8'; ctx.font = '10px Inter';
        ctx.fillText('Sin datos', W/2 - 20, H/2);
        return null;
    }
    const evts = [];
    for (let i = 1; i < history.length; i++) {
        const d = calcDist(history[i-1], history[i]);
        evts.push({ dir: d >= 0 ? 'DER' : 'IZQ', zone: Math.abs(d) >= 10 ? 'BIG' : 'SMALL' });
    }
    const pat = (typeof analyzeTravelPattern === 'function') ? analyzeTravelPattern(history) : { label: '', tiradas: 0 };
    const lvl = (typeof getStabilityLevel === 'function') ? getStabilityLevel(pat, evts) : 'red';
    const bgMap = { green: '#0C3824', yellow: '#3C3010', red: '#3C1018' };
    ctx.fillStyle = bgMap[lvl] || bgMap.red;
    ctx.fillRect(padL, padT, W - padL - padR, H - padT - padB);
    const windowSize = isMobile ? 16 : 22;
    const dataStart = Math.max(0, travels.length - windowSize);
    const data = travels.slice(dataStart);
    const numPoints = data.length;
    const cwVals = data.filter(d => d > 0);
    const ccwVals = data.filter(d => d < 0);
    let avgCW = cwVals.length > 0 ? cwVals.reduce((a,b)=>a+b,0)/cwVals.length : 10;
    let avgCCW = ccwVals.length > 0 ? ccwVals.reduce((a,b)=>a+b,0)/ccwVals.length : -10;
    avgCW += avgOffset;
    if (avgCCW < 0) avgCCW -= avgOffset; else avgCCW += avgOffset;
    const allAbs = data.map(d => Math.abs(d));
    const avgAbs = allAbs.reduce((a,b)=>a+b,0)/allAbs.length;
    const stdDev = Math.sqrt(allAbs.reduce((a,b)=>a+Math.pow(b-avgAbs,2),0)/allAbs.length);
    const upperRange = avgCW + stdDev;
    const lowerRange = avgCCW - stdDev;
    const chartW = W - padL - padR, chartH = H - padT - padB;
    const midY = padT + chartH/2;
    const maxVal = 18;
    const scaleY = v => midY - (v/maxVal)*(chartH/2);
    const pxPerPoint = (windowSize > 1) ? (chartW / (windowSize - 1)) : chartW;
    const scaleX = i => padL + i * pxPerPoint;
    ctx.strokeStyle = 'rgba(255, 100, 0, 0.4)'; ctx.lineWidth = 1;
    [18, 10, -10, -18].forEach(v => {
        ctx.beginPath(); ctx.moveTo(padL, scaleY(v)); ctx.lineTo(W - padR, scaleY(v)); ctx.stroke();
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, midY); ctx.lineTo(W - padR, midY); ctx.stroke();
    ctx.fillStyle = '#4a6080'; ctx.font = '9px Inter'; ctx.textAlign = 'right';
    [18, 10, -10, -18].forEach(v => { ctx.fillText(v > 0 ? '+' + v : '' + v, padL - 4, scaleY(v) + 3); });
    ctx.fillText('0', padL - 4, midY + 3);
    ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let i = 0; i < numPoints - 1; i++) {
        const x1 = scaleX(i), y1 = scaleY(data[i]);
        const x2 = scaleX(i+1), y2 = scaleY(data[i+1]);
        const cpX = (x1 + x2) / 2;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.bezierCurveTo(cpX, y1, cpX, y2, x2, y2);
        const val = data[i+1];
        if (val > upperRange || val < lowerRange) ctx.strokeStyle = '#ffe600';
        else ctx.strokeStyle = val >= 0 ? '#00ffa2' : '#ff2a4b';
        ctx.shadowBlur = 10; ctx.shadowColor = ctx.strokeStyle;
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
    for (let i = 0; i < numPoints; i++) {
        const x = scaleX(i), y = scaleY(data[i]);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.strokeStyle = '#0d1520'; ctx.lineWidth = 1; ctx.stroke();
    }
    if (numPoints > 0) {
        const lx = scaleX(numPoints - 1), ly = scaleY(data[numPoints - 1]);
        ctx.beginPath(); ctx.arc(lx, ly, 6, 0, Math.PI*2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.shadowBlur = 8; ctx.shadowColor = data[numPoints-1] >= 0 ? '#00ffa2' : '#ff2a4b';
        ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px JetBrains Mono'; ctx.textAlign = 'center';
        const v = data[numPoints-1];
        ctx.fillText((v > 0 ? '+' : '') + v, lx, ly - 10);
    }
    const leg = [['#30e090','Travel'],['#f04060','Avg CW'],['#ff8c40','Avg CCW'],['#f5c842','Range']];
    let lx2 = padL;
    ctx.font = '8px Inter';
    leg.forEach(([color, label]) => {
        ctx.fillStyle = color; ctx.fillRect(lx2, 5, 8, 8);
        ctx.fillStyle = '#7a9bb8'; ctx.textAlign = 'left';
        ctx.fillText(label, lx2 + 10, 13);
        lx2 += ctx.measureText(label).width + 22;
    });
    return { avgCW, avgCCW };
}

function renderTravelTable(tbodyId, history, emptyMsg) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (history.length < 2) {
        tbody.innerHTML = `<tr><td colspan="5" style="padding: 8px; font-size: 9px; text-align: center; color: var(--muted);">${emptyMsg}</td></tr>`;
        return;
    }
    let html = '';
    for (let i = history.length - 1; i >= 1; i--) {
        const d = calcDist(history[i-1], history[i]);
        const dir = d >= 0 ? 'DER' : 'IZQ';
        const absD = Math.abs(d);
        const zon = absD >= 10 ? 'BIG' : 'SMALL';
        // OVER = (derecha && BIG) || (izquierda && SMALL)
        // UNDER = (derecha && SMALL) || (izquierda && BIG)
        const isOver = (d >= 0 && absD >= 10) || (d < 0 && absD < 10);
        const uo = isOver ? 'OVER' : 'UNDER';
        const uoColor = isOver ? '#00e5c8' : '#ff5555';
        html += `<tr><td style="padding:2px 4px;font-size:9px;text-align:center;border-bottom:1px solid var(--border);color:#fff;">${history[i]}</td><td style="padding:2px 4px;font-size:9px;text-align:center;border-bottom:1px solid var(--border);color:var(--accent);">${absD}</td><td style="padding:2px 4px;font-size:9px;text-align:center;border-bottom:1px solid var(--border);color:${d>=0?'var(--green)':'#f55'};">${dir}</td><td style="padding:2px 4px;font-size:9px;text-align:center;border-bottom:1px solid var(--border);color:var(--gold);">${zon}</td><td style="padding:2px 4px;font-size:9px;text-align:center;border-bottom:1px solid var(--border);color:${uoColor};font-weight:700;">${uo}</td></tr>`;
    }
    tbody.innerHTML = html;
}

// â”€â”€ Chat â”€â”€
function addTrackerChatMessage(role, text) {
    trackerChatHistory.push({ role, text, ts: Date.now() });
    const box = document.getElementById('tracker-chat-messages');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'tracker-msg ' + (role === 'user' ? 'user-msg' : 'ai-msg');
    div.innerHTML = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    if (role === 'ai' && trackerVoiceEnabled) speakTrackerAI(stripHtml(text));
}

function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

function sendTrackerChat() {
    const input = document.getElementById('tracker-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addTrackerChatMessage('user', text);
    askTrackerAI(text);
}

// â”€â”€ AI Calls â”€â”€
async function askTrackerAIForAnalysis() {
    const ctx = buildTrackerAIContext();
    const prompt = buildTrackerPrompt(ctx, null);
    await callTrackerAI(prompt, true);
}

async function askTrackerAI(userMessage) {
    const ctx = buildTrackerAIContext();
    const prompt = buildTrackerPrompt(ctx, userMessage);
    await callTrackerAI(prompt, false);
}

function buildTrackerAIContext() {
    const last = trackerHistory.slice(-20);
    const travels = [];
    for (let i = 1; i < trackerHistory.length; i++) travels.push(calcDist(trackerHistory[i-1], trackerHistory[i]));
    const lastTravels = travels.slice(-15);
    const cwCount = lastTravels.filter(d => d > 0).length;
    const ccwCount = lastTravels.filter(d => d < 0).length;
    const totalDir = cwCount + ccwCount;

    // â”€â”€ FIRMA DEL DEALER â”€â”€
    let sig = null;
    if (typeof computeDealerSignature === 'function' && trackerHistory.length >= 12) {
        try { sig = computeDealerSignature(trackerHistory); } catch(e) {}
    }

    // â”€â”€ PATRÃ“N / ESTABILIDAD â”€â”€
    let pat = null, stability = null;
    if (typeof analyzeTravelPattern === 'function' && trackerHistory.length >= 4) {
        try {
            pat = analyzeTravelPattern(trackerHistory);
            const evts = [];
            for (let i = 1; i < trackerHistory.length; i++) {
                const d = calcDist(trackerHistory[i-1], trackerHistory[i]);
                evts.push({ dir: d >= 0 ? 'DER' : 'IZQ', zone: Math.abs(d) >= 10 ? 'BIG' : 'SMALL' });
            }
            if (typeof getStabilityLevel === 'function') stability = getStabilityLevel(pat, evts);
        } catch(e) {}
    }

    // â”€â”€ DOMINANCIAS â”€â”€
    const allTravels = travels.slice(-30);
    const allCW = allTravels.filter(d => d > 0).length;
    const allCCW = allTravels.filter(d => d < 0).length;
    const allTotal = allCW + allCCW;
    const domDir = allTotal > 0 ? Math.round((Math.max(allCW, allCCW) / allTotal) * 100) : 50;

    const bigCount = allTravels.filter(d => Math.abs(d) >= 10).length;
    const smallCount = allTravels.filter(d => Math.abs(d) < 10).length;
    const zoneTotal = bigCount + smallCount;
    const domZone = zoneTotal > 0 ? Math.round((Math.max(bigCount, smallCount) / zoneTotal) * 100) : 50;

    // â”€â”€ TURBULENCIA / ZIGZAG / RACHA / MACRO â”€â”€
    let zigzag = false, changes = 0;
    if (lastTravels.length >= 4) {
        for (let i = 1; i < lastTravels.length; i++) {
            if ((lastTravels[i] > 0) !== (lastTravels[i-1] > 0)) changes++;
        }
        zigzag = changes >= 3;
    }
    const turbulence = changes;

    let streakDir = '-', streakLen = 0;
    if (lastTravels.length > 0) {
        const lastD = lastTravels[lastTravels.length - 1] > 0 ? 'CW' : 'CCW';
        streakDir = lastD;
        for (let i = lastTravels.length - 1; i >= 0; i--) {
            const d = lastTravels[i] > 0 ? 'CW' : 'CCW';
            if (d === lastD) streakLen++; else break;
        }
    }

    // â”€â”€ BLOQUES DE DIRECCIÃ“N â”€â”€
    // e.g. CW:4, CCW:1, CW:3, CCW:2
    const dirBlocks = [];
    if (lastTravels.length > 0) {
        let curDir = lastTravels[0] > 0 ? 'CW' : 'CCW';
        let curCount = 1;
        for (let i = 1; i < lastTravels.length; i++) {
            const d = lastTravels[i] > 0 ? 'CW' : 'CCW';
            if (d === curDir) curCount++;
            else { dirBlocks.push(curDir + ':' + curCount); curDir = d; curCount = 1; }
        }
        dirBlocks.push(curDir + ':' + curCount);
    }
    const hasDirBlocks = dirBlocks.length >= 2 && dirBlocks.some(b => parseInt(b.split(':')[1]) >= 2);

    // â”€â”€ HISTORIAL DE CAMBIOS DE DOMINANCIA â”€â”€
    let lastChangeSpin = 0;
    let prevDominantDir = '-';
    if (allTravels.length > 0) {
        const lastDir = allTravels[allTravels.length - 1] > 0 ? 'CW' : 'CCW';
        for (let i = allTravels.length - 2; i >= 0; i--) {
            const d = allTravels[i] > 0 ? 'CW' : 'CCW';
            if (d !== lastDir) { lastChangeSpin = allTravels.length - 1 - i; prevDominantDir = d; break; }
        }
    }

    // â”€â”€ PATRONES DE RODILLO / TURBULENCIA â”€â”€
    const dirTurbulencePattern = detectTrackerTurbulence(allTravels, 'dir');
    const zoneTurbulencePattern = detectTrackerTurbulence(lastTravels.map(t => Math.abs(t)), 'zone');
    const uoTurbulencePattern = detectTrackerTurbulence(allTravels, 'nivel');

    // â”€â”€ REGIMEN DE DOMINANCIA Y TURBULENCIA DE BLOQUES â”€â”€
    const dominanceRegime = analyzeDominanceRegime(allTravels, lastTravels);

    // â”€â”€ ANALISIS UNDER/OVER â”€â”€
    const uoData = analyzeUnderOver(lastTravels);

    // â”€â”€ BLOQUES DE ZONA â”€â”€
    const zoneBlocks = [];
    if (lastTravels.length > 0) {
        let curZone = Math.abs(lastTravels[0]) >= 10 ? 'BIG' : 'SMALL';
        let curCount = 1;
        for (let i = 1; i < lastTravels.length; i++) {
            const z = Math.abs(lastTravels[i]) >= 10 ? 'BIG' : 'SMALL';
            if (z === curZone) curCount++;
            else { zoneBlocks.push(curZone + ':' + curCount); curZone = z; curCount = 1; }
        }
        zoneBlocks.push(curZone + ':' + curCount);
    }

    // â”€â”€ PROBABILIDADES DE SALTO â”€â”€
    const jumpDist = {};
    const absTravels = allTravels.map(d => Math.abs(d));
    for (const d of absTravels) {
        const bucket = d <= 4 ? '0-4' : d <= 9 ? '5-9' : d <= 14 ? '10-14' : '15+';
        jumpDist[bucket] = (jumpDist[bucket] || 0) + 1;
    }
    const totalJumps = absTravels.length;
    const jumpProb = {};
    for (const k in jumpDist) jumpProb[k] = Math.round((jumpDist[k] / totalJumps) * 100);

    // â”€â”€ MACRO STATE â”€â”€
    let macroState = '-';
    if (lastTravels.length >= 10) {
        const changeRate = lastTravels.length > 1 ? changes / (lastTravels.length - 1) : 0;
        if (changeRate >= 0.6) macroState = 'TURBULENCIA';
        else if (streakLen >= 5) macroState = streakDir === 'CW' ? 'DOMINANCIA_CW' : 'DOMINANCIA_CCW';
        else if (streakLen >= 3) macroState = streakDir === 'CW' ? 'DOM_CW_LEVE' : 'DOM_CCW_LEVE';
        else macroState = 'NEUTRAL';
    }

    return {
        spins: last, travels: lastTravels,
        stats: {
            cw: totalDir > 0 ? Math.round((cwCount / totalDir) * 100) : 50,
            domDir, domZone, zigzag, turbulence, streakDir, streakLen, macroState,
            dirBlocks: dirBlocks.slice(-8).join(' '),
            zoneBlocks: zoneBlocks.slice(-8).join(' '),
            hasDirBlocks,
            jumpProb,
            lastChangeSpin,
            prevDominantDir
        },
        prediction: null,
        source: trackerSource,
        totalSpins: trackerHistory.length,
        sig, pat, stability,
        dirTurbulencePattern,
        zoneTurbulencePattern,
        uoTurbulencePattern,
        dominanceRegime,
        uoData
    };
}

function detectTrackerTurbulence(travels, kind = 'dir') {
    if (travels.length < 6) return null;
    const symbols = [];
    for (let i = Math.max(0, travels.length - 12); i < travels.length; i++) {
        if (kind === 'dir') symbols.push(travels[i] >= 0 ? 'R' : 'L');
        else if (kind === 'nivel') symbols.push(((travels[i] >= 0 && Math.abs(travels[i]) >= 10) || (travels[i] < 0 && Math.abs(travels[i]) < 10)) ? 'O' : 'U'); // OVER / UNDER
        else symbols.push(Math.abs(travels[i]) >= 10 ? 'B' : 'S'); // BIG / SMALL
    }
    if (symbols.length < 6) return null;

    const last4 = symbols.slice(-4).join('');
    const last5 = symbols.slice(-5).join('');
    const last6 = symbols.slice(-6).join('');

    let changes = 0;
    for (let i = 1; i < symbols.length; i++) if (symbols[i] !== symbols[i-1]) changes++;
    const turbulenceLevel = changes / (symbols.length - 1);

    let currentStreak = 1;
    let streakType = symbols[symbols.length - 1];
    for (let i = symbols.length - 2; i >= 0; i--) {
        if (symbols[i] === streakType) currentStreak++; else break;
    }

    const streaks = [];
    let curType = symbols[0], curLen = 1;
    for (let i = 1; i < symbols.length; i++) {
        if (symbols[i] === curType) curLen++;
        else { streaks.push({ type: curType, len: curLen }); curType = symbols[i]; curLen = 1; }
    }
    streaks.push({ type: curType, len: curLen });

    const runLens = streaks.slice(-6).map(s => s.len);
    const runSeq = runLens.join('');
    const label = kind === 'dir' ? 'dir' : kind === 'nivel' ? 'nivel' : 'zona';

    // --- RUPTURA: aparicion de 3+ seguidos rompe la turbulencia base ---
    if (currentStreak >= 3) {
        return { name: `RUPTURA ${label.toUpperCase()}`, type: 'breakout', desc: `${currentStreak} ${streakType} seguidos: fin turbulencia`, action: 'FOLLOW_STREAK', next: `seguir la racha de ${streakType}`, confidence: 75 };
    }

    // --- BLOQUES DE TAMANO VARIABLE (2-5, 3-1, 4-2, etc.) ---
    // Razonamiento: los bloques alternan tipos. Si el bloque actual es MAS CORTO
    // que el anterior del mismo tipo, se COMPLETA (sigue el mismo tipo).
    // Si el bloque actual ya llego o supero al anterior, el bloque esta COMPLETO: cambia al opuesto.
    const lastStreaks = streaks.slice(-6);
    if (lastStreaks.length >= 3) {
        let altCount = 0;
        for (let i = 1; i < lastStreaks.length; i++) {
            if (lastStreaks[i].type !== lastStreaks[i-1].type) altCount++;
        }
        const cur = lastStreaks[lastStreaks.length - 1];
        let prevSame = null;
        for (let i = lastStreaks.length - 2; i >= 0; i--) {
            if (lastStreaks[i].type === cur.type) { prevSame = lastStreaks[i]; break; }
        }
        const hasRealBlock = lastStreaks.some(s => s.len >= 2);
        if (altCount >= 2 && prevSame && hasRealBlock && cur.len < 3) {
            const blockSeq = lastStreaks.map(s => s.type + s.len).join(' ');
            const opposite = cur.type === 'R' ? 'L' : cur.type === 'L' ? 'R' : cur.type === 'B' ? 'S' : cur.type === 'S' ? 'B' : cur.type === 'O' ? 'U' : 'O';
            // ANTICIPACION: ningun patron dura para siempre. Si el mismo tipo ya aparecio
            // 3+ veces como bloque (ciclo repetido) y el tipo opuesto viene apareciendo
            // como singleton suelto, el patron ENVEJECE: el singleton puede crecer y
            // romper hacia el tipo opuesto (ej: U3 O1 U2 O1 U1 => el O suelto crece => O).
            const sameTypeCount = lastStreaks.filter(s => s.type === cur.type).length;
            const oppSingletons = lastStreaks.filter(s => s.type === opposite && s.len === 1).length;
            const aging = sameTypeCount >= 3 && oppSingletons >= 1;
            const anticipation = aging
                ? ` | ANTICIPAR: patron envejeciendo (${sameTypeCount} bloques ${cur.type}, ${oppSingletons} singleton ${opposite} suelto): el ${opposite} puede empezar a crecer`
                : '';
            if (cur.len < prevSame.len) {
                const conf = cur.len === prevSame.len - 1 ? 74 : 68;
                return { name: `BLOQUES ${label.toUpperCase()} (completar)`, type: 'block_complete', desc: `bloques alternos [${blockSeq}]: el bloque ${cur.type}${cur.len} es menor al previo ${cur.type}${prevSame.len}, se completa${anticipation}`, action: 'FOLLOW_STREAK', next: `completar bloque: sigue ${cur.type}${anticipation}`, confidence: conf, anticipation: aging ? `el patron envejece: ${opposite} puede romper` : null };
            } else {
                return { name: `BLOQUES ${label.toUpperCase()} (cambio)`, type: 'block_switch', desc: `bloques alternos [${blockSeq}]: el bloque ${cur.type}${cur.len} ya completo el ciclo del previo ${cur.type}${prevSame.len}, cambia${anticipation}`, action: 'SWITCH', next: `bloque completo: sigue ${opposite}${anticipation}`, confidence: 68, anticipation: aging ? `el patron envejece: ${opposite} puede romper` : null };
            }
        }
    }

    // --- PATRONES DE RODILLO / TURBULENCIA ---
    if (runSeq.endsWith('1212') || runSeq.endsWith('2121') || /(12){3,}$/.test(runSeq) || /(21){3,}$/.test(runSeq)) {
        return { name: `ALT 1-2 ${label.toUpperCase()}`, type: 'alt_1_2', desc: 'Rebote alternado 1-2', action: 'ALTERNATE', next: 'alternar al lado opuesto', confidence: 70 };
    }
    if (runSeq.endsWith('112112') || runSeq.endsWith('221221') || /(112){2,}$/.test(runSeq) || /(221){2,}$/.test(runSeq)) {
        return { name: `PAIRS-1+2 ${label.toUpperCase()}`, type: 'pairs_1_2', desc: 'Pares 1 con singleton 2', action: 'EXPECT_PAIR', next: 'par 1 + singleton 2', confidence: 68 };
    }
    if (runSeq.endsWith('222') || /22[12]22/.test(runSeq)) {
        return { name: `TRIPLE/PARES-2 ${label.toUpperCase()}`, type: 'pairs_2', desc: 'Pares de 2 dominando', action: 'EXPECT_2', next: 'esperar racha de 2', confidence: 72 };
    }
    if (runSeq.endsWith('111') || /11[12]11/.test(runSeq)) {
        return { name: `PARES-1 ${label.toUpperCase()}`, type: 'pairs_1', desc: 'Pares de 1 dominando', action: 'EXPECT_1', next: 'esperar racha de 1', confidence: 68 };
    }
    if (runSeq.endsWith('22') && runSeq.slice(-4, -2) === '11') {
        return { name: `BLOQUES 2-2 ${label.toUpperCase()}`, type: 'blocks_2_2', desc: 'Bloques de 2 alternados 2-2', action: 'ALTERNATE_BLOCKS', next: 'completar bloque de 2 del mismo lado', confidence: 72 };
    }
    if (runSeq.endsWith('222') && runSeq.slice(-6, -3) === '111') {
        return { name: `BLOQUES 3-3 ${label.toUpperCase()}`, type: 'three_three', desc: 'Bloques de 3 alternados 3-3', action: 'ALTERNATE_BLOCKS', next: 'completar bloque de 3 del mismo lado', confidence: 74 };
    }
    if (/^(33|33[123]33|333|33[123]33[123]33)/.test(runSeq) || runSeq.endsWith('33') || /33/.test(runSeq.slice(-6))) {
        return { name: `PATRON 3-3 ${label.toUpperCase()}`, type: 'three_three', desc: 'Bloques de 3 alternados', action: 'ALTERNATE_BLOCKS', next: 'siguiente bloque alternado', confidence: 74 };
    }
    if (runSeq.endsWith('31') || runSeq.endsWith('131') || /(31){2,}$/.test(runSeq)) {
        return { name: `BLOQUE+SINGLETON ${label.toUpperCase()}`, type: 'three_one', desc: 'Bloque de 3 + singleton 1', action: 'EXPECT_1', next: 'esperar singleton tras bloque de 3', confidence: 70 };
    }
    if (last4 === 'RLRL' || last4 === 'LRLR' || last4 === 'BSBS' || last4 === 'SBSB' || last4 === 'OUOU' || last4 === 'UOUO') {
        return { name: `MICRO-TURBULENCIA ${label.toUpperCase()}`, type: 'micro_turbulence', desc: 'Alternancia perfecta - caos', action: 'AVOID', next: 'sin seÃ±al: alternancia pura', confidence: 85 };
    }

    // --- ESTADOS GENERALES ---
    let zigzagCount = 0;
    for (let i = 1; i < streaks.length; i++) {
        if (streaks[i].len <= 2 && streaks[i-1].len <= 2 && streaks[i].type !== streaks[i-1].type) zigzagCount++;
    }
    if (zigzagCount >= 3) {
        return { name: `ZIGZAG ${label.toUpperCase()}`, type: 'zigzag', desc: 'Rachas cortas alternando', action: 'REDUCE', next: 'alternar, cautela', confidence: 65 };
    }
    if (turbulenceLevel >= 0.7) {
        return { name: `CAOS ${label.toUpperCase()}`, type: 'total_chaos', desc: `${Math.round(turbulenceLevel*100)}% cambios`, action: 'AVOID', next: 'sin seÃ±al: caos total', confidence: 80 };
    }
    if (turbulenceLevel >= 0.4) {
        return { name: `TURBULENCIA ${label.toUpperCase()}`, type: 'turbulence', desc: `${Math.round(turbulenceLevel*100)}% cambios`, action: 'CAUTION', next: 'cautela, patrÃ³n incierto', confidence: 55 };
    }
    return { name: `REBOTE ${label.toUpperCase()}`, type: 'bounce', desc: 'Sin turbulencia marcada', action: 'WATCH', next: 'observar, sin patrÃ³n', confidence: 50 };
}

function extractStreaks(arr) {
    if (!arr || arr.length === 0) return [];
    const streaks = [];
    let curType = arr[0], curLen = 1;
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] === curType) curLen++;
        else { streaks.push({ type: curType, len: curLen }); curType = arr[i]; curLen = 1; }
    }
    streaks.push({ type: curType, len: curLen });
    return streaks;
}

function analyzeDominanceRegime(allTravels, lastTravels) {
    const MIN_DOM = 3;
    if (allTravels.length < MIN_DOM + 1) return null;

    const dirSymbols = allTravels.map(t => t >= 0 ? 'CW' : 'CCW');
    const zoneSymbols = allTravels.map(t => Math.abs(t) >= 10 ? 'BIG' : 'SMALL');

    const dirStreaks = extractStreaks(dirSymbols);
    const zoneStreaks = extractStreaks(zoneSymbols);

    const dirDoms = dirStreaks.filter(s => s.len >= MIN_DOM);
    const zoneDoms = zoneStreaks.filter(s => s.len >= MIN_DOM);

    const currentDirDom = dirDoms.length ? dirDoms[dirDoms.length - 1] : null;
    const currentZoneDom = zoneDoms.length ? zoneDoms[zoneDoms.length - 1] : null;

    function transitions(doms) {
        if (doms.length < 2) return { total: 0, same: 0, switch: 0, sameAfterLen: {}, switchAfterLen: {} };
        let same = 0, switchCount = 0;
        const sameAfterLen = {}, switchAfterLen = {};
        for (let i = 1; i < doms.length; i++) {
            const prev = doms[i-1];
            const cur = doms[i];
            const prevLen = Math.min(prev.len, 8);
            if (cur.type === prev.type) { same++; sameAfterLen[prevLen] = (sameAfterLen[prevLen] || 0) + 1; }
            else { switchCount++; switchAfterLen[prevLen] = (switchAfterLen[prevLen] || 0) + 1; }
        }
        return { total: doms.length - 1, same, switch: switchCount, sameAfterLen, switchAfterLen };
    }

    function blockTurbulence(doms) {
        if (doms.length < 4) return false;
        let alternations = 0;
        for (let i = 1; i < doms.length; i++) {
            if (doms[i].type !== doms[i-1].type && doms[i].len >= 3 && doms[i-1].len >= 3) alternations++;
        }
        return alternations >= 2;
    }

    function historyPattern(doms, current) {
        if (!current || doms.length < 3) return null;
        const sameLen = doms.filter(d => Math.abs(d.len - current.len) <= 1 && d.type === current.type).length;
        const totalSimilar = doms.filter(d => Math.abs(d.len - current.len) <= 1).length;
        if (totalSimilar < 2) return null;
        return {
            repeats: sameLen,
            similar: totalSimilar,
            note: sameLen >= 4 ? 'PATRON UNIVERSAL: continua con alta recurrencia' : `Repite ${sameLen}/${totalSimilar} veces`
        };
    }

    const dirTrans = transitions(dirDoms);
    const zoneTrans = transitions(zoneDoms);
    const dirBlock = blockTurbulence(dirDoms);
    const zoneBlock = blockTurbulence(zoneDoms);

    const dirPattern = historyPattern(dirDoms, currentDirDom);
    const zonePattern = historyPattern(zoneDoms, currentZoneDom);

    function continueProb(trans, currentDom) {
        if (!currentDom || trans.total === 0) return null;
        const len = Math.min(currentDom.len, 8);
        const bucket = [len - 1, len, len + 1].filter(k => k >= 1 && k <= 8);
        const sameAtLen = bucket.reduce((s, k) => s + (trans.sameAfterLen[k] || 0), 0);
        const switchAtLen = bucket.reduce((s, k) => s + (trans.switchAfterLen[k] || 0), 0);
        const totalAtLen = sameAtLen + switchAtLen;
        let prob;
        if (totalAtLen < 2) {
            prob = Math.round((trans.same / trans.total) * 100);
        } else {
            // Suavizado bayesiano: nunca 0% ni 100% con pocas muestras
            prob = Math.round(((sameAtLen + 2) / (totalAtLen + 4)) * 100);
        }
        const conf = totalAtLen >= 6 ? 'alta' : totalAtLen >= 2 ? 'media' : 'baja';
        return { prob, conf, samples: totalAtLen };
    }

    const dirContinueProb = continueProb(dirTrans, currentDirDom);
    const zoneContinueProb = continueProb(zoneTrans, currentZoneDom);

    return {
        currentDirDom,
        currentZoneDom,
        dirTrans,
        zoneTrans,
        dirBlock,
        zoneBlock,
        dirPattern,
        zonePattern,
        dirContinueProb,
        zoneContinueProb,
        lastDirDominances: dirDoms.slice(-5),
        lastZoneDominances: zoneDoms.slice(-5)
    };
}

function analyzeUnderOver(travels) {
    if (!travels || travels.length < 4) return null;
    const symbols = travels.map(d => {
        const absD = Math.abs(d);
        return ((d >= 0 && absD >= 10) || (d < 0 && absD < 10)) ? 'OVER' : 'UNDER';
    });
    const streaks = extractStreaks(symbols);
    const last = streaks.slice(-6);

    // detectar patrones UO
    let overCount = 0, underCount = 0;
    for (const s of last) { if (s.type === 'OVER') overCount += s.len; else underCount += s.len; }
    const total = overCount + underCount;
    const domPct = total > 0 ? Math.round((Math.max(overCount, underCount) / total) * 100) : 50;
    const domType = overCount >= underCount ? 'OVER' : 'UNDER';

    // racha actual
    let curStreak = 1, curType = symbols[symbols.length - 1];
    for (let i = symbols.length - 2; i >= 0; i--) {
        if (symbols[i] === curType) curStreak++; else break;
    }

    // detectar ruptura: si la ultima racha cambio
    let ruptura = false;
    if (streaks.length >= 2) {
        const prev = streaks[streaks.length - 2];
        if (prev.len >= 3 && curStreak <= 2 && prev.type !== curType) ruptura = true;
    }

    return {
        domType, domPct, curStreak, curType, ruptura,
        last6: last.map(s => s.type[0] + s.len).join(' '),
        overCount, underCount
    };
}

function analyzeThreeVariables(ctx) {
    const dr = ctx.dominanceRegime || null;
    const uo = ctx.uoData || null;

    // PESO DE SEÃ‘AL: patron detectado > dominancia > continuacion (factor menor).
    // El score NO es estadistica pura: es la suma de las senales concretas.
    const patternScore = (pat) => {
        if (!pat) return 0;
        switch (pat.type) {
            case 'breakout': return 30;         // ruptura: seguir la nueva racha
            case 'block_complete': return 33;   // bloques variables: completar el bloque actual
            case 'block_switch': return 28;     // bloques variables: bloque completo, cambia
            case 'three_three': return 32;      // bloques 3-3: alternancia clara
            case 'blocks_2_2': return 30;       // bloques 2-2: completar par
            case 'three_one': return 28;        // bloque 3 + singleton
            case 'alt_1_2': return 26;          // rebote alternado 1-2
            case 'pairs_1_2': return 24;        // pares 1 + singleton 2
            case 'pairs_2': return 22;          // pares de 2
            case 'pairs_1': return 22;          // pares de 1
            case 'zigzag': return 8;            // zigzag: alternar, seÃ±al debil
            case 'micro_turbulence': return 5;  // caos perfecto
            case 'total_chaos': return 0;       // sin seÃ±al
            case 'turbulence': return 10;       // cautela
            default: return 15;                 // rebote/watch
        }
    };

    const dir = { name: 'DIRECCION', value: null, score: 45, note: 'sin seÃ±al', patron: null };
    if (ctx.dirTurbulencePattern) {
        dir.patron = ctx.dirTurbulencePattern;
        dir.score = 45 + patternScore(ctx.dirTurbulencePattern);
        dir.note = `patron: ${ctx.dirTurbulencePattern.name} (${ctx.dirTurbulencePattern.next})`;
    }
    if (dr && dr.currentDirDom) {
        const c = dr.currentDirDom;
        dir.value = c.type === 'CW' ? 'derecha' : 'izquierda';
        dir.score += Math.min(c.len, 8) * 2; // dominancia: factor medio
        dir.note += `${dir.note ? ' | ' : ''}dominancia ${c.len} ${dir.value}`;
        if (dr.dirPattern) dir.note += ` | historial: ${dr.dirPattern.note}`;
        if (!ctx.dirTurbulencePattern) {
            dir.score += 15; // sin patron, la dominancia es la senal principal
            dir.note += ' (sin patron: pura dominancia)';
        }
    }
    if (dr && dr.dirContinueProb && dr.dirContinueProb.conf === 'alta') {
        dir.score += 5; // continuacion: factor menor, solo refuerza
        dir.note += ` | continuacion ${dr.dirContinueProb.prob}% (alta)`;
    }

    const zone = { name: 'ZONA', value: null, score: 45, note: 'sin seÃ±al', patron: null };
    if (ctx.zoneTurbulencePattern) {
        zone.patron = ctx.zoneTurbulencePattern;
        zone.score = 45 + patternScore(ctx.zoneTurbulencePattern);
        zone.note = `patron: ${ctx.zoneTurbulencePattern.name} (${ctx.zoneTurbulencePattern.next})`;
    }
    if (dr && dr.currentZoneDom) {
        const c = dr.currentZoneDom;
        zone.value = c.type === 'BIG' ? 'BIG' : 'SMALL';
        zone.score += Math.min(c.len, 8) * 2;
        zone.note += `${zone.note ? ' | ' : ''}dominancia ${c.len} ${zone.value}`;
        if (dr.zonePattern) zone.note += ` | historial: ${dr.zonePattern.note}`;
        if (!ctx.zoneTurbulencePattern) {
            zone.score += 15;
            zone.note += ' (sin patron: pura dominancia)';
        }
    }
    if (dr && dr.zoneContinueProb && dr.zoneContinueProb.conf === 'alta') {
        zone.score += 5;
        zone.note += ` | continuacion ${dr.zoneContinueProb.prob}% (alta)`;
    }

    const level = { name: 'NIVEL', value: null, score: 45, note: 'sin seÃ±al', patron: null };
    if (ctx.uoTurbulencePattern) {
        level.patron = ctx.uoTurbulencePattern;
        level.score = 45 + patternScore(ctx.uoTurbulencePattern);
        level.note = `patron: ${ctx.uoTurbulencePattern.name} (${ctx.uoTurbulencePattern.next})`;
    }
    if (uo) {
        level.value = uo.domType;
        level.note += `${level.note ? ' | ' : ''}dominante ${uo.domType} ${uo.domPct}% racha ${uo.curType} x${uo.curStreak}`;
        if (uo.ruptura) { level.score += 12; level.note += ' | RUPTURA UO: cambio inminente'; }
        if (uo.curStreak >= 5) level.score += 8;
        if (!ctx.uoTurbulencePattern) {
            if (uo.curStreak >= 3) { level.score += 15; level.note += ' (sin patron: pura dominancia)'; }
            else if (uo.domPct < 55) { level.score -= 5; level.note += ' (sin patron ni dominancia clara)'; }
        }
    }

    const vars = [dir, zone, level];
    vars.sort((a, b) => b.score - a.score);
    const top2 = vars.slice(0, 2);
    const third = vars[2];

    const d = dir.value, z = zone.value, l = level.value;
    let derived = null;
    if (d && z && !l) derived = { var: 'NIVEL', value: ((d === 'derecha' && z === 'SMALL') || (d === 'izquierda' && z === 'BIG')) ? 'UNDER' : 'OVER', eq: `${d} + ${z}` };
    else if (d && l && !z) derived = { var: 'ZONA', value: ((d === 'derecha' && l === 'UNDER') || (d === 'izquierda' && l === 'OVER')) ? 'SMALL' : 'BIG', eq: `${d} + ${l}` };
    else if (z && l && !d) derived = { var: 'DIRECCION', value: ((z === 'SMALL' && l === 'UNDER') || (z === 'BIG' && l === 'OVER')) ? 'derecha' : 'izquierda', eq: `${z} + ${l}` };

    return { dir, zone, level, vars, top2, third, derived };
}

function checkTripleConsistency(dir, zone, level) {
    if (!dir || !zone || !level) return false;
    const over = (dir === 'derecha' && zone === 'BIG') || (dir === 'izquierda' && zone === 'SMALL');
    return over ? level === 'OVER' : level === 'UNDER';
}

function buildTrackerPrompt(ctx, userMessage) {
    // Pattern-focused data block
    const lines = [
        `DATOS:`,
        `Eventos: ${ctx.totalSpins}`,
        `Sectores: ${ctx.spins.join(', ')}`,
        `Saltos: ${ctx.travels.map(t => (t>0?'+':'')+t).join(', ')}`,
        `Derecha: ${ctx.stats.cw}% / Izquierda: ${100 - ctx.stats.cw}%`
    ];
    if (ctx.pat) {
        lines.push(`Patron activo: ${ctx.pat.label}`);
    }
    if (ctx.stability) {
        lines.push(`Estabilidad: ${ctx.stability}`);
    }
    if (ctx.stats.macroState && ctx.stats.macroState !== '-') {
        lines.push(`Macro: ${ctx.stats.macroState}`);
    }
    lines.push(`Dominancia dir: ${ctx.stats.domDir}%`);
    lines.push(`Dominancia amp: ${ctx.stats.domZone}%`);
    if (ctx.stats.zigzag) lines.push(`Zigzag: SI`);
    if (ctx.stats.streakLen > 1) lines.push(`Racha actual: ${ctx.stats.streakLen} ${ctx.stats.streakDir}`);
    if (ctx.stats.dirBlocks) lines.push(`Bloques dir: ${ctx.stats.dirBlocks}`);
    if (ctx.stats.zoneBlocks) lines.push(`Bloques amp: ${ctx.stats.zoneBlocks}`);
    if (ctx.stats.lastChangeSpin > 0) lines.push(`Ultimo cambio direccion: hace ${ctx.stats.lastChangeSpin} eventos (antes ${ctx.stats.prevDominantDir})`);
    if (ctx.dirTurbulencePattern) lines.push(`Patron rodillo dir: ${ctx.dirTurbulencePattern.name} -> ${ctx.dirTurbulencePattern.next}`);
    if (ctx.zoneTurbulencePattern) lines.push(`Patron rodillo zona: ${ctx.zoneTurbulencePattern.name} -> ${ctx.zoneTurbulencePattern.next}`);
    if (ctx.uoTurbulencePattern) lines.push(`Patron rodillo nivel: ${ctx.uoTurbulencePattern.name} -> ${ctx.uoTurbulencePattern.next}`);
    if (ctx.stats.dirBlocks) lines.push(`Bloques dir: ${ctx.stats.dirBlocks}`);
    if (ctx.stats.zoneBlocks) lines.push(`Bloques zona: ${ctx.stats.zoneBlocks}`);
    if (ctx.dominanceRegime) {
        const dr = ctx.dominanceRegime;
        if (dr.currentDirDom) lines.push(`Dominancia dir actual: ${dr.currentDirDom.type} x${dr.currentDirDom.len}`);
        if (dr.currentZoneDom) lines.push(`Dominancia zona actual: ${dr.currentZoneDom.type} x${dr.currentZoneDom.len}`);
        if (dr.dirTrans.total > 0) lines.push(`Historial dir: continua ${dr.dirTrans.same}/${dr.dirTrans.total} - cambia ${dr.dirTrans.switch}/${dr.dirTrans.total}`);
        if (dr.zoneTrans.total > 0) lines.push(`Historial zona: continua ${dr.zoneTrans.same}/${dr.zoneTrans.total} - cambia ${dr.zoneTrans.switch}/${dr.zoneTrans.total}`);
        if (dr.dirBlock) lines.push(`Turbulencia de bloques dir: SI`);
        if (dr.zoneBlock) lines.push(`Turbulencia de bloques zona: SI`);
        if (dr.dirPattern) lines.push(`Patron dir: ${dr.dirPattern.note}`);
        if (dr.zonePattern) lines.push(`Patron zona: ${dr.zonePattern.note}`);
        if (dr.dirContinueProb !== null) lines.push(`Filtro historial dir: ${dr.dirContinueProb.prob}% de continuar (confianza ${dr.dirContinueProb.conf}, ${dr.dirContinueProb.samples} muestras) - factor MENOR, no determinante`);
        if (dr.zoneContinueProb !== null) lines.push(`Filtro historial zona: ${dr.zoneContinueProb.prob}% de continuar (confianza ${dr.zoneContinueProb.conf}, ${dr.zoneContinueProb.samples} muestras) - factor MENOR, no determinante`);
    }
    if (ctx.uoData) {
        const uo = ctx.uoData;
        lines.push(`UNDER/OVER dominante: ${uo.domType} ${uo.domPct}% | Racha: ${uo.curType} x${uo.curStreak}`);
        lines.push(`UO ultimos: ${uo.last6}`);
        if (uo.ruptura) lines.push(`RUPTURA UO: SI`);
    }
    if (ctx.stats.jumpProb) {
        const jp = ctx.stats.jumpProb;
        const parts = [];
        if (jp['0-4']) parts.push('corto ' + jp['0-4'] + '%');
        if (jp['5-9']) parts.push('medio ' + jp['5-9'] + '%');
        if (jp['10-14']) parts.push('largo ' + jp['10-14'] + '%');
        if (jp['15+']) parts.push('muyLargo ' + jp['15+'] + '%');
        if (parts.length) lines.push(`Prob salto: ${parts.join(' / ')}`);
    }
    if (ctx.sig) {
        lines.push(`Media salto: ${ctx.sig.avgTravel} | Desviacion: ${ctx.sig.stdDev}`);
    }
    const aiOnlyBankroll = trackerSource === 'live' && trackerBankActiveSession();
    const dataBlock = aiOnlyBankroll
        ? [
            `Live reciente (${ctx.totalSpins} tiradas): ${ctx.spins.slice(-20).join(', ')}`,
            `Saltos recientes: ${ctx.travels.slice(-15).map(t => (t > 0 ? '+' : '') + t).join(', ')}`,
            `Dirección derecha: ${ctx.stats.cw}% / izquierda: ${100 - ctx.stats.cw}%`,
            `Dominancia dirección: ${ctx.stats.domDir}% / zona: ${ctx.stats.domZone}%`
        ].join('\n')
        : lines.join('\n');

    const systemPrompt = `Sos experta en sistemas cilindricos rotacionales. Analiza con criterio propio y proyecta. No solo mires la dominancia: analiza DIRECCION y ZONA como dos sistemas separados que pueden estar en distintos regimenes. Habla SOLO de direccion (derecha/izquierda) y zona (BIG/SMALL). No uses la palabra "sector".

REGLAS DE TURBULENCIA (patrones de rodillo):
- Turbulencia base = rebotes con rachas de 1 o 2, sin 3 seguidos.
- Patrones validos: 1-2-1-2 (alt), 1-1-2-1-1-2 (pares-1+2), 2-2-1-2-2-1 (pares-2+1), 2-2-2 (transicion a bloque), 3-3 (bloques alternados de 3).
- Si aparece 3 seguidos en una direccion o zona, es RUPTURA: fin de la turbulencia, segui la nueva racha.
- En turbulencia pura sin dominancia, anticipa el siguiente rebote (1 o 2) segun el patron activo.

REGLAS DE BLOQUES DE TAMANO VARIABLE (lo mas importante):
- Los bloques pueden ser de cualquier tamano: 2-2, 3-3, 4-4, 2-5, 3-1, 5-2, etc. No solo 2 o 3.
- Razonamiento clave: si los bloques alternan tipos y el bloque actual es MAS CORTO que el anterior del mismo tipo, el bloque se COMPLETA: sigue el mismo tipo.
  Ej: under-under + over-over-over-over-over + under => el bloque de under (1) es menor al previo (2): sigue UNDER.
- Si el bloque actual ya llego o supero al tamano del anterior del mismo tipo, el bloque esta COMPLETO: cambia al tipo opuesto.
  Ej: big-big-big + small + big-big + small => los SMALL son singleton (1 = 1, ya completo): sigue BIG.
- Los singletons (bloques de 1) suelen indicar el siguiente bloque grande del tipo opuesto. Ej: un solo SMALL suelto entre bloques BIG => lo que sigue es BIG.
- Aplica este razonamiento en las 3 variables: direccion, zona y NIVEL (under/over).

REGLAS DE ANTICIPACION (ningun patron dura para siempre):
- Ningun patron de bloques es eterno: si el mismo tipo ya aparecio 3+ veces como bloque en la ventana (ciclo repetido 2+ veces) y el tipo opuesto viene apareciendo como singleton suelto, el patron ENVEJECE: el singleton puede empezar a crecer y romper hacia el tipo opuesto.
- Ej: under-under-under + over + under-under + over + under => el OVER suelto ya aparecio 2 veces: puede llegar OVER. NO siempre sigue UNDER.
- Si el bloque "Patron rodillo" de una variable dice ANTICIPAR, el cambio hacia el tipo opuesto es una opcion REAL: evaluala en serio, no la descartes solo porque el bloque actual parece incompleto. El patron envejecido se rompe antes o despues: cuando se repite mucho, la ruptura gana.
- Anticipar NO es inventar: solo aplica cuando el patron ya se repitio (el mismo tipo aparecio 3+ veces) y el opuesto viene suelto. Si el patron es fresco (1-2 ciclos), segui la regla de completar el bloque.

REGLAS DE CONFLICTO ENTRE VARIABLES (elegi la mejor senal, NO fuerces el encaje):
- Las 3 variables a veces chocan: una dice que sigue (bloque incompleto), otra dice que cambia (direccion/ruptura/anticipacion). NO acomodes la idea para que "cuadre todo bonito".
- Cuando chocan, NINGUNA variable es la "que debe cambiar": en un sistema aleatorio cualquiera de las 3 puede romper, incluso la dominante. No asumas que la dominancia se anula ni que la variable que choca es la que cambia.
- Observa las 3 variables y busca CUAL tiene senales de debilidad: patron envejecido (ANTICIPAR), bloque ya completo, racha agotada sin patron de soporte, dominancia vieja que viene alternando, cambios recientes frecuentes. ESA es la candidata a cambiar: puede ser la dominancia, la direccion, la zona o el nivel.
- La ecuacion x = a + b describe la RELACION entre variables, no quien cambia: si la direccion cambia y la zona se mantiene, el NIVEL derivado cambia (es matematica). Pero quien REALMENTE va a cambiar lo decide la evidencia de cada variable, no la ecuacion. Ej: dominancia UNDER vieja + direccion en bloque que apunta a izquierda + zona SMALL firme => la candidata a cambiar es la dominancia UNDER (la direccion ya venia cambiando), no la zona.
- Jerarquia flexible de senales: anticipacion/ruptura/bloque completo pesan mas que dominancia y continuacion, PERO solo si estan bien fundamentadas. Si las senales estan balanceadas (una dice si, otra dice no, sin clara ventaja), reconoce la duda y elegi la combinacion con mejor evidencia.
- NUNCA modifiques el razonamiento para justificar un resultado previo: si no hay evidencia clara de cual variable cambiara, elegi la que tenga el patron mas concreto y menciona la duda brevemente.

REGLAS DE UNDER/OVER:
- OVER = (derecha && BIG) || (izquierda && SMALL). UNDER = (derecha && SMALL) || (izquierda && BIG).
- Analiza dominancia UNDER/OVER, rachas, patrones y rupturas igual que direccion y zona.
- Si hay RUPTURA de OVER/UNDER y la direccion es clara, proyecta el cambio de UO con la direccion. Ej: ruptura de OVER + direccion derecha clara = prediccion UNDER derecha.
- UNDER/OVER puede tener sus propios patrones independientes de direccion y zona.
- Las rachas UO funcionan igual que las de direccion: "under over over over over under over over over" = un UNDER suelto seguido de rachas OVER = el OVER es dominante, anticipa OVER hasta ruptura.

ECUACION DE 3 VARIABLES (x = a + b, la base de todo):
- Tenes 3 variables: DIRECCION (derecha/izquierda), ZONA (BIG/SMALL) y NIVEL (OVER/UNDER).
- Con 2 variables detectadas derivas la tercera. La ecuacion es:
  - derecha + SMALL = UNDER | derecha + BIG = OVER
  - izquierda + SMALL = OVER | izquierda + BIG = UNDER
- Formas de resolver (elegi las 2 variables MAS PREDECIBLES, las de patron o dominancia mas claro):
  1) Si detectas ZONA y NIVEL, derivas DIRECCION. Ej: SMALL + UNDER => derecha. Prediccion: derecha UNDER.
  2) Si detectas DIRECCION y NIVEL, derivas ZONA. Ej: derecha + (zigzag UO, sale UNDER probable OVER) => BIG. Prediccion: derecha BIG (OVER derecha).
  3) Si detectas DIRECCION y ZONA, derivas NIVEL y tenes la prediccion completa.
- Lo determinante es la SUMA de las senales de cada variable: patrones de rodillo (1-2, 2-1, 2-2, 3-1, 3-3, bloques, zigzag), dominancias y rachas. Los porcentajes y la continuacion son solo UN factor mas de la suma, NUNCA el unico ni el determinante.
- Ejemplos: si el NIVEL esta en bloques (under-under-over = bloques 2-2 o 3-3), lo que sigue es OVER. Si la ZONA esta en patron 3-3 (BIG BIG BIG / SMALL SMALL SMALL), lo que sigue es BIG. Si la DIRECCION esta en zigzag, alterna. Detecta el patron de cada variable y usa el que diga "que sigue".
- Si una variable tiene patron claro (el bloque "Patron rodillo" de esa variable lo indica con "-> que sigue"), esa variable es de alta confianza: usala.
- Si una variable esta en caos o sin patron, no la fuerces: usa las otras 2. A veces NO hay patrones y es pura dominancia: ahi la dominancia es la senal.
- Los scores del bloque "ECUACION 3 VARIABLES" ya suman estas senales: elegi las 2 con score mas alto. Si las 3 son claras (consistencia OK), confirma con la ecuacion completa.
- El bloque "ECUACION 3 VARIABLES" ya te da las 2 mejores y la derivada: usala como base de tu prediccion final.

REGLAS DE DOMINANCIA Y BLOQUES:
- Una dominancia es una racha de 3+ en la misma direccion o zona.
- Puede: (a) continuar, (b) saltar a la dominancia opuesta, (c) hacer una pequena transicion y volver, (d) convertirse en turbulencia de bloques (bloques 3+ alternados CW/CCW o BIG/SMALL).
- El historial de continuacion/cambio es UN factor mas de la suma, no es determinante: si una dominancia de longitud similar repitio muchas veces el mismo comportamiento, sumale un poco de peso. Si ya se repitio 8+ veces igual, es un patron universal: avisalo.
- La continuacion (porcentajes del filtro historial) es SOLO REFUERZO: cuando un patron concreto ya te dice que sigue, el porcentaje no lo contradice.
- Las zonas pueden estar en bloques mientras las direcciones estan en turbulencia, y viceversa: combina ambas senales. Lo mismo aplica al NIVEL.

OJO: la dominancia puede persistir mucho tiempo, pero tambien puede cambiar de golpe. No te dejes llevar ciegamente por la dominancia actual: primero busca patrones concretos en las 3 variables.

Antes de responder, razona internamente en este orden: 1) detecta el patron de cada variable (rodillo/bloques/zigzag/dominancia), 2) suma las senales de las 3 variables, 3) elegi las 2 mas claras y deriva la tercera con la ecuacion x = a + b, 4) contradicciones entre seÃ±ales: identifica CUAL variable muestra senales de debilidad (patron envejecido, bloque completo, dominancia agotada): esa es la candidata a cambiar, sea cual sea, 5) prediccion final. No escribas el razonamiento interno, solo la conclusion final. Elige UNO de los targets listados en "Targets disponibles". Tu respuesta DEBE incluir el numero especifico del target elegido. NO inventes numeros ni elijas numeros fuera de esa lista. Responde MUY CORTO: maximo 2 oraciones cortas. Preferible 1 prediccion + 1 justificacion (menciona el patron o ecuacion usada). Podes ser conversacional y natural, pero sin salirte del analisis. Nunca hables de soporte, resistencia, juegos, apuestas ni azar. Nunca uses la palabra "sector".`;

    const finalSystemPrompt = aiOnlyBankroll
        ? 'Analiza internamente los números Live y sus saltos para elegir una predicción propia. No uses predicciones heurísticas, targets ni candidatos generados por el sistema. Devuelve únicamente una línea con este formato exacto: N4: NN, donde NN es un entero de 0 a 36. No incluyas explicación, etiquetas adicionales ni bloques de texto.'
        : systemPrompt;
    const predictionRequest = aiOnlyBankroll
        ? 'Analiza solo estos datos y devuelve únicamente N4: NN.'
        : 'Proyecta UN target específico con su número. Justifica en una oración.';
    if (userMessage) {
        return {
            system: finalSystemPrompt,
            memoryText: userMessage,
            messages: [{ role: 'user', content: dataBlock + '\n\n' + userMessage + '\n' + predictionRequest }]
        };
    }
    return {
        system: finalSystemPrompt,
        memoryText: 'Análisis automático del Tracker.',
        messages: [{ role: 'user', content: dataBlock + '\n\n' + predictionRequest }]
    };
}

async function callTrackerAI(promptObj, isAuto) {
    const status = document.getElementById('tracker-ai-status');
    const predEl = document.getElementById('tracker-prediction');
    if (!trackerMemoryAvailable) {
        if (status) status.innerText = 'MongoDB Atlas no conectado; IA pausada.';
        if (predEl) predEl.innerText = '--';
        return;
    }
    if (status) status.innerText = 'Pensando...';
    if (predEl) predEl.innerText = 'ANALIZANDO...';
    const requestSource = trackerSource;
    const requestRevision = trackerLiveEventRevision;
    const requestMemory = trackerAiMemory;
    const requestContext = buildTrackerAIContext();
    console.log('[Tracker AI] Sending request:', trackerConfig.provider, trackerConfig.model);
    try {
        const payload = {
            provider: trackerConfig.provider,
            model: trackerConfig.model,
            apiKey: trackerConfig.apiKey,
            messages: [...(requestSource === 'live' ? requestMemory.messages.slice(-8) : []), ...promptObj.messages],
            system: requestMemory.summary
                ? `${promptObj.system}\n\nCONTEXTO DE SESIONES ANTERIORES (úsalo como referencia y prioriza los datos actuales):\n${requestMemory.summary}\nNúmeros recientes guardados: ${(requestMemory.context?.recentNumbers || []).join(', ')}. Total guardado: ${requestMemory.context?.totalSpins || 0}.`
                : promptObj.system
        };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const res = await fetch('/api/ai/tracker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
            if (res.status === 503) pauseTrackerForMongo();
            throw new Error('HTTP ' + res.status);
        }
        const data = await res.json();
        console.log('[Tracker AI] Response:', data.success, data.response ? data.response.substring(0, 50) : 'no response');
        if (data.success && data.response) {
            addTrackerChatMessage('ai', '&#x1F916; ' + data.response);
            if (requestSource === trackerSource && requestRevision === trackerLiveEventRevision) {
                syncPredictionFromAI(data.response);
            } else if (status) {
                status.innerText = 'Análisis anterior descartado; hay tiradas más recientes.';
            }
            const finalUserMessage = promptObj.memoryText || 'Análisis automático del Tracker.';
            if (requestSource === 'live') {
                await saveTrackerAiMemory(finalUserMessage, data.response, requestSource, requestMemory, requestContext);
            } else if (status) {
                status.innerText = 'Análisis Manual listo; los datos no se guardaron.';
            }
        } else if (data.error) {
            addTrackerChatMessage('ai', '&#x26A0; Error del servidor: ' + data.error);
        } else {
            addTrackerChatMessage('ai', '&#x26A0; Respuesta vacÃ­a del servidor.');
        }
    } catch (err) {
        console.error('[Tracker AI] ERROR:', err.name, err.message);
        const errMsg = err.name === 'AbortError' ? 'Timeout: el modelo no respondiÃ³ en 30 segundos' : (err.message || 'Error desconocido');
        let displayErr = '&#x26A0; ' + errMsg;
        if (errMsg.includes('API key') || errMsg.includes('invÃ¡lida') || errMsg.includes('invalid')) displayErr = '&#x1F511; API Key invÃ¡lida';
        else if (errMsg.includes('Modelo') || errMsg.includes('not found')) displayErr = '&#x1F4BE; Modelo no encontrado';
        addTrackerChatMessage('ai', displayErr + '<br><small>Provider: <strong>' + trackerConfig.provider + '</strong> | Model: <strong>' + trackerConfig.model + '</strong> | Key: ' + (trackerConfig.apiKey ? '&#x2705;' : '&#x274C;') + '</small>');
    }
    if (status && status.innerText === 'Pensando...') status.innerText = 'Esperando datos...';
}

function syncPredictionFromAI(responseText) {
    const predEl = document.getElementById('tracker-prediction');
    if (!predEl) return;
    const text = responseText;
    const aiOnlyBankroll = trackerSource === 'live' && trackerBankActiveSession();
    if (aiOnlyBankroll) {
        const match = text.match(/\bN4\s*:\s*(3[0-6]|[0-2]?\d)\b/i);
        const center = match ? Number(match[1]) : null;
        trackerAiN4Center = Number.isInteger(center) && center >= 0 && center <= 36 ? center : null;
        predEl.innerText = trackerAiN4Center === null ? 'ANALIZANDO...' : `N4: ${trackerAiN4Center}`;
        if (trackerAiN4Center === null) {
            trackerAiDisplayStatus = 'ANALIZANDO...';
            console.warn('[Tracker AI] Response did not contain a valid N4 center.');
        } else {
            trackerAiDisplayStatus = `N4: ${trackerAiN4Center}`;
        }
        renderTrackerBankroll();
        return;
    }

    // extraer numeros (0-36)
    const numMatches = text.match(/\b(3[0-6]|[0-2]?[0-9])\b/g);
    let nums = [];
    if (numMatches) {
        nums = numMatches.map(n => parseInt(n)).filter(v => v >= 0 && v <= 36);
    }

    // extraer tipo: N9 o N4 (segun la seleccion del usuario y/o el texto)
    const mode = trackerConfig.prediction || 'both';
    let type = null;
    if (mode === 'n9') type = 'N9';
    else if (mode === 'n4') type = 'N4';
    else {
        if (text.toLowerCase().includes('n9')) type = 'N9';
        else if (text.toLowerCase().includes('n4')) type = 'N4';
        if (!type) {
            if (text.toLowerCase().includes('big') || text.toLowerCase().includes('small')) type = 'N4';
            else type = 'N9';
        }
    }

    if (nums.length > 0) {
        predEl.innerText = nums[0] + ' ' + type;
        if (type === 'N4' && trackerSource === 'live') trackerAiN4Center = nums[0];
    } else if (type) {
        predEl.innerText = type;
        if (trackerSource === 'live') trackerAiN4Center = null;
    } else {
        predEl.innerText = '--';
        if (trackerSource === 'live') trackerAiN4Center = null;
    }
    renderTrackerBankroll();
}

// â”€â”€ Auto Triggers â”€â”€ (DISABLED â€” AI only speaks when user asks)
function checkTrackerAutoTriggers() {
    // Auto-triggers completely disabled for user freedom
    // AI will only respond when user sends a message or clicks "Analizar Ahora"
}

// â”€â”€ TTS â”€â”€
function speakTrackerAI(text) {
    if (!window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'es-ES';
    utter.rate = 1.05;
    utter.pitch = 1.15;
    const voices = window.speechSynthesis.getVoices();
    const fem = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Female') || v.name.includes('Mujer') || v.name.includes('Helena') || v.name.includes('Laura') || v.name.includes('Monica')));
    if (fem) utter.voice = fem;
    window.speechSynthesis.speak(utter);
}
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

// â”€â”€ STT (Speech-to-Text) Mic â”€â”€
let trackerMicActive = false;
let trackerRecognition = null;

function toggleTrackerMic() {
    const micBtn = document.getElementById('tracker-chat-mic');
    if (!micBtn) return;
    if (trackerMicActive) {
        stopTrackerMic();
        return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.log('STT: navegador no soporta');
        return;
    }
    trackerRecognition = new SpeechRecognition();
    trackerRecognition.lang = 'es-ES';
    trackerRecognition.continuous = false;
    trackerRecognition.interimResults = false;
    trackerRecognition.onstart = () => {
        trackerMicActive = true;
        micBtn.classList.add('recording');
        micBtn.innerHTML = '&#x1F534;';
    };
    trackerRecognition.onend = () => {
        stopTrackerMic();
    };
    trackerRecognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const input = document.getElementById('tracker-chat-input');
        if (input) input.value = transcript;
        askTrackerAI(transcript);
    };
    trackerRecognition.onerror = (event) => {
        console.error('STT error:', event.error);
        stopTrackerMic();
    };
    try {
        trackerRecognition.start();
    } catch(e) {
        console.error('STT start error:', e.message);
    }
}

function stopTrackerMic() {
    trackerMicActive = false;
    const micBtn = document.getElementById('tracker-chat-mic');
    if (micBtn) {
        micBtn.classList.remove('recording');
        micBtn.innerHTML = '&#x1F3A4;';
    }
    if (trackerRecognition) {
        try { trackerRecognition.stop(); } catch(e) {}
        trackerRecognition = null;
    }
}

// ============================================================
// SHARED UTILS
// ============================================================
function getBallColor(n) {
    if (n === 0) return { bg: '#2d6a4f', text: '#fff', border: '#52b788' };
    const reds = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    if (reds.includes(n)) return { bg: '#c72c2c', text: '#fff', border: '#ff6b6b' };
    return { bg: '#1a1a2e', text: '#fff', border: '#4a4a6a' };
}
