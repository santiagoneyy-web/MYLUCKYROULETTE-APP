// ============================================================
// app.js — COMPACT MOBILE UI ENGINE (Phase 30)
// ============================================================

const history      = [];
const iaSignalsHistory = [ [], [], [], [], [] ]; 
let activeIaTab    = 1; // Default to N17
let lastIaSignals = [
    { top: 16, rule: 'READY', radius:'N2/N3', smallSnipe: 5, bigSnipe: 14  }, // Hidden N16
    { top: 17, rule: 'READY', radius:'N9', smallSnipe: 5, bigSnipe: 14 },
    { top: 5,  rule: 'READY', radius:'N9', smallSnipe: 5, bigSnipe: 14  },
    { top: 22, rule: 'READY', radius:'N9', smallSnipe: 5, bigSnipe: 14  },
    { top: 10, rule: 'READY', radius:'N4', smallSnipe: 5, bigSnipe: 14  }
]; 

// Agent names aligned with predictor.js index 0=N16, 1=N17
const AGENT_NAMES   = ['Android N16', 'Android N17', 'Android 1717', 'Android N18', 'CÉLULA'];
const AGENT_KEYS    = ['N16', 'N17', 'N17PLUS', 'N18', 'CELULA'];
const AGENT_MODES   = ['SIX STRATEGIE', 'SOPORTE/HIBRIDO', 'HIBRIDO/ZIGZAG', 'SOPORTE PURO', 'SNIPER'];

const RED_NUMS  = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const WHEEL_NUMS = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];

let currentTableId = null;
let lastKnownSpinId = null;
let isSyncing = false;

function calcDist(from, to) {
    const i1 = WHEEL_NUMS.indexOf(from);
    const i2 = WHEEL_NUMS.indexOf(to);
    if (i1 === -1 || i2 === -1) return 0;
    let d = i2 - i1;
    if (d > 18) d -= 37;
    if (d < -18) d += 37;
    return d;
}

// ─── RENDER: AGENT TABS ────────────────────────────────────
function renderTabs() {
    const strip = document.getElementById('strat-tabs');
    if (!strip) return;
    strip.innerHTML = AGENT_KEYS.map((key, idx) => {
        if (idx === 0) return ''; // HIDDEN N16 (Six Strategie)
        const h = iaSignalsHistory[idx] || [];
        const wins = h.filter(x => x === 'win').length;
        const active = idx === activeIaTab;
        return `<button class="ia-tab ${active ? 'active' : ''}" onclick="setActiveIaTab(${idx})">
            ${key}
            <span class="wl">W-L ${wins}-${h.length - wins}</span>
        </button>`;
    }).join('');
}

// ─── RENDER: AGENT CARD ────────────────────────────────────
function renderAgentCard(signals) {
    const s = signals[activeIaTab];
    if (!s) return;

    const nameEl    = document.getElementById('active-agent-name');
    const confEl    = document.getElementById('agent-confidence');
    const statusMsg = document.getElementById('agent-status-msg');
    const statusEl  = document.getElementById('agent-status');
    const syncEl    = document.getElementById('agent-sync');
    const targetEl  = document.getElementById('target-number');
    const radiusEl  = document.getElementById('pi-radius');
    const tendEl    = document.getElementById('pi-tendency');
    const psSmall   = document.getElementById('psn-small-val');
    const psBig     = document.getElementById('psn-big-val');
    const winsEl    = document.getElementById('agent-wins');
    const lossesEl  = document.getElementById('agent-losses');
    const dotsEl    = document.getElementById('result-dots');

    if (nameEl)   nameEl.innerText   = (AGENT_NAMES[activeIaTab] || 'AGENT').toUpperCase();
    if (confEl)   confEl.innerText   = (s.confidence || '90%') + ' CONF.';
    if (statusMsg) statusMsg.innerText = (s.rule || AGENT_MODES[activeIaTab]) + ' ' + (s.radius || 'N9');
    if (statusEl)  statusEl.innerText  = s.reason || '';
    if (syncEl)    syncEl.innerText    = s.mode ? `MODO: ${s.mode}` : '';
    
    // Support either 'top' or 'number' from predictor.js
    const targetNum = s.top !== undefined ? s.top : (s.number !== undefined ? s.number : '--');
    if (targetEl) targetEl.innerText = targetNum;
    
    if (radiusEl) radiusEl.innerText = s.radius ? s.radius.toLowerCase() : 'n9';
    
    // Tendency from last dist
    if (tendEl && history.length >= 2) {
        const d = calcDist(history[history.length-2], history[history.length-1]);
        tendEl.innerText = `TENDENCIA: ${d >= 0 ? 'Der.' : 'Izq.'} ${d >= 0 ? '↺' : '↻'}`;
    }

    // Secondary snipes (SMALL/BIG)
    if (psSmall) psSmall.innerText = s.smallSnipe !== undefined ? s.smallSnipe : '--';
    if (psBig)   psBig.innerText   = s.bigSnipe !== undefined   ? s.bigSnipe   : '--';

    // W-L
    const h = iaSignalsHistory[activeIaTab] || [];
    const wins = h.filter(x => x === 'win').length;
    const losses = h.length - wins;
    if (winsEl)   winsEl.innerText   = wins;
    if (lossesEl) lossesEl.innerText = losses;

    // Performance string (All WWLL...)
    const perfEl = document.getElementById('agent-performance');
    if (perfEl) {
        perfEl.innerHTML = h.slice(-15).map(r => 
            `<span class="${r === 'win' ? 'perf-w' : 'perf-l'}">${r === 'win' ? 'W' : 'L'}</span>`
        ).join('');
    }

    if (tendEl && s.trend) {
        tendEl.innerText = `TENDENCIA: ${s.trend === 'DER' ? 'Der.' : 'Izq.'} ${s.trend === 'DER' ? '↺' : '↻'}`;
    }
}

// ─── RENDER: WHEEL ──────────────────────────────────────────
function drawWheel(highlightNum = null) {
    const canvas = document.getElementById('wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = 65, cy = 65; // Updated center for 130x130
    ctx.clearRect(0, 0, 130, 130);

    const goldColor = '#f5c842';

    ctx.beginPath(); ctx.arc(cx, cy, 63, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a1a'; ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();

    WHEEL_NUMS.forEach((n, i) => {
        const startAng = (i * (360 / 37) - 90 - (360/74)) * (Math.PI / 180);
        const endAng   = (i * (360 / 37) - 90 + (360/74)) * (Math.PI / 180);
        const midAng   = (i * (360 / 37) - 90) * (Math.PI / 180);

        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(startAng) * 35, cy + Math.sin(startAng) * 35);
        ctx.arc(cx, cy, 60, startAng, endAng);
        ctx.lineTo(cx + Math.cos(endAng) * 35, cy + Math.sin(endAng) * 35);
        ctx.closePath();
        
        ctx.fillStyle = (n === 0) ? '#008b00' : (RED_NUMS.has(n) ? '#c41e3a' : '#000');
        ctx.fill();
        ctx.strokeStyle = '#222'; ctx.lineWidth = 0.5; ctx.stroke();

        const rx = cx + Math.cos(midAng) * 48;
        const ry = cy + Math.sin(midAng) * 48;
        
        ctx.save();
        ctx.translate(rx, ry); ctx.rotate(midAng + Math.PI/2);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 8px Inter';
        ctx.textAlign = 'center'; ctx.fillText(n, 0, 3);
        ctx.restore();

        if (n === highlightNum) {
            ctx.beginPath(); ctx.arc(rx, ry, 9, 0, Math.PI * 2);
            ctx.strokeStyle = goldColor; ctx.lineWidth = 2; ctx.stroke();
            const bx = cx + Math.cos(midAng) * 63;
            const by = cy + Math.sin(midAng) * 63;
            ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI*2);
            ctx.fillStyle = '#fff'; ctx.shadowBlur = 6; ctx.shadowColor = '#fff';
            ctx.fill(); ctx.shadowBlur = 0;
        }
    });

    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, 35);
    gr.addColorStop(0, '#333'); gr.addColorStop(1, '#000');
    ctx.beginPath(); ctx.arc(cx, cy, 35, 0, Math.PI*2);
    ctx.fillStyle = gr; ctx.fill();
}

// ─── RENDER: WHEEL & HISTORY ───────────────────────────────
function renderWheelAndHistory() {
    const strip = document.getElementById('history-strip-mini');
    if (!strip) return;

    // History (Last 15 inside the visual panel)
    const last15 = history.slice(-15).reverse();
    strip.innerHTML = last15.map(n => {
        const cls = (n === 0) ? 'ball-zero' : (RED_NUMS.has(n) ? 'ball-red' : 'ball-black');
        return `<div class="mini-ball ${cls}">${n}</div>`;
    }).join('');

    // Update Wheel
    if (history.length > 0) {
        drawWheel(history[history.length - 1]);
    } else {
        drawWheel();
    }
}

// ─── RENDER: ALL SIGNALS ───────────────────────────────────
function renderSignalsPanel(signals) {
    renderTabs();
    renderAgentCard(signals);
    renderWheelAndHistory();
}

// ─── RENDER: TRAVEL TABLE ──────────────────────────────────
function renderTravelPanel() {
    try {
        const tbody   = document.getElementById('travel-tbody');
        const patEl   = document.getElementById('travel-pattern');
        const lastZEl = document.getElementById('travel-last-zone');
        if (!tbody) return;

        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="muted">Selecciona una mesa...</td></tr>';
            return;
        }

        // Clear initial "Select Table"
        const domEl = document.getElementById('agent-dominance');
        if (domEl && domEl.innerText.includes('SELECCIONA')) {
            domEl.innerText = '';
        }

        // Unified Dominance & Trend (From IA Master Signals)
        const activeSignal = (lastIaSignals && lastIaSignals[activeIaTab]) || (lastIaSignals && lastIaSignals[0]);
        if (domEl && activeSignal && activeSignal.trend) {
            domEl.innerHTML = `DOMINANCIA: ${activeSignal.dominance || '--'} | TENDENCIA: ${activeSignal.trend}`;
        }

        // Status Badges (Stable / ZigZag etc)
        if (patEl && activeSignal) {
            let pat = 'ESTABLE', patClass = 'badge-stable';
            if (activeSignal.isDirZigZag) { 
                pat = 'ZIG ZAG'; patClass = 'badge-zigzag'; 
            } else if (activeSignal.isUnstable) { 
                pat = 'INESTABLE'; patClass = 'badge-zigzag'; 
            } else if (activeSignal.isWeakening) { 
                pat = 'DEBILITADO'; patClass = 'badge-zone'; 
            }
            patEl.textContent = pat;
            patEl.className = `badge ${patClass}`;
        }

        // Last zone badge
        const lastN = history[history.length - 1];
        if (lastZEl && lastN !== undefined) {
            if (lastN >= 1 && lastN <= 9)        { lastZEl.textContent = 'LAST: SMALL'; lastZEl.style.color = 'var(--green)'; }
            else if (lastN >= 10 && lastN <= 19) { lastZEl.textContent = 'LAST: BIG';   lastZEl.style.color = 'var(--red)'; }
            else                                 { lastZEl.textContent = `LAST: ${lastN}`; lastZEl.style.color = 'var(--muted)'; }
        }

        // Render Table (Max 100)
        tbody.innerHTML = history.slice(-100).reverse().map((n, i) => {
            const idxInHistory = history.length - 1 - i;
            const prev = history[idxInHistory - 1];
            const dist = (prev !== undefined) ? calcDist(prev, n) : 0;
            const absDist = Math.abs(dist);
            const dir  = dist > 0 ? 'DER.' : (dist < 0 ? 'IZQ.' : '--');
            
            const numClass = (n === 0) ? 'num-zero' : (RED_NUMS.has(n) ? 'num-red' : 'num-black');
            const dirClass = dist >= 0 ? 'dir-der' : 'dir-izq';
            
            let phaseHtml = '';
            if (absDist >= 1 && absDist <= 9)        phaseHtml = `<span class="phase-pill pill-small">SMALL</span>`;
            else if (absDist >= 10 && absDist <= 19) phaseHtml = `<span class="phase-pill pill-big">BIG</span>`;

            const isLast = (i === 0);
            return `<tr>
                <td class="row-n">${idxInHistory + 1}${isLast ? '<span style="font-size:8px;color:var(--accent)"> ★</span>' : ''}</td>
                <td class="${numClass}">${n}</td>
                <td style="color:var(--text2)">${absDist}p</td>
                <td class="${dirClass}">${dir} <span style="font-size:9px;opacity:0.6">${dist >= 0 ? '↺' : '↻'}</span></td>
                <td>${phaseHtml}</td>
            </tr>`;
        }).join('');
    } catch(err) {
        console.error('Render error:', err);
    }
}

// ─── SUBMIT NUMBER ─────────────────────────────────────────
function submitNumber(val) {
    const inputEl = document.getElementById('spin-number');
    const raw = val !== undefined ? val : (inputEl ? inputEl.value : '');
    const n = parseInt(raw);
    
    if (!isNaN(n) && n >= 0 && n <= 36) {
        if (inputEl) inputEl.value = '';
        if (currentTableId) {
            fetch('/api/spin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table_id: currentTableId, number: n, source: 'manual' })
            }).catch(() => {});
        }
    }
}

// ─── SYNC FROM SERVER (REAL-TIME W-L TRACKING) ───────────────────
let pendingPredictions = null; // Snapshot of predictions awaiting evaluation

function evaluatePredictionLocal(realNumber, predictedNumber, radius = 9) {
    if (predictedNumber === null || realNumber === null || predictedNumber === undefined) return null;
    if (realNumber === predictedNumber) return 'Direct';
    
    const iReal = WHEEL_NUMS.indexOf(realNumber);
    const iPred = WHEEL_NUMS.indexOf(predictedNumber);
    if (iReal === -1 || iPred === -1) return 'Loss';
    
    let dist = Math.abs(iReal - iPred);
    dist = Math.min(dist, 37 - dist);
    
    if (dist <= radius) return 'Neighbor';
    return 'Loss';
}

function evaluateAndTrackWL(newNumber) {
    if (!pendingPredictions) return;
    const radii = [9, 3, 9, 9, 9];
    pendingPredictions.forEach((sig, idx) => {
        const pTop = sig ? (sig.top !== undefined ? sig.top : sig.number) : null;
        if (pTop !== null && pTop !== undefined) {
            const out = evaluatePredictionLocal(newNumber, pTop, radii[idx]);
            if (out === 'Direct' || out === 'Neighbor') iaSignalsHistory[idx].push('win');
            else if (out === 'Loss') iaSignalsHistory[idx].push('loss');
        }
    });
    pendingPredictions = null; // consumed
}

async function syncData() {
    if (!currentTableId || isSyncing) return;
    isSyncing = true;
    try {
        const r = await fetch(`/api/history/${currentTableId}?limit=100&_=${Date.now()}`);
        if (!r.ok) return; 
        const spins = await r.json();
        
        if (spins.length === 0) {
            if (history.length > 0) {
                history.length = 0;
                iaSignalsHistory.forEach(h => h.length = 0);
                lastKnownSpinId = null;
                pendingPredictions = null;
                renderWheelAndHistory();
                renderSignalsPanel(lastIaSignals || []);
                renderTravelPanel();
            }
        } else {
            const latestS = spins[spins.length - 1];
            
            // DB RESET DETECTION
            if (lastKnownSpinId !== null && latestS.id < lastKnownSpinId) {
                history.length = 0;
                iaSignalsHistory.forEach(h => h.length = 0);
                lastKnownSpinId = null;
                pendingPredictions = null;
            }

            if (latestS.id !== lastKnownSpinId) {
                // Get only new spins (incremental, no full reload)
                const newSpins = spins.filter(s => s.id > (lastKnownSpinId || -1));
                
                for (let i = 0; i < newSpins.length; i++) {
                    const s = newSpins[i];
                    const n = parseInt(s.number);
                    if (!isNaN(n)) {
                        // Evaluate the PREVIOUS predictions against this new number
                        evaluateAndTrackWL(n);
                        
                        history.push(n);
                        lastKnownSpinId = s.id;
                        
                        // Generate and snapshot NEW predictions for next spin
                        try {
                            if (history.length >= 3 && typeof computeDealerSignature === 'function') {
                                const sig  = computeDealerSignature(history);
                                const prox = projectNextRound(history, {});
                                const master = getIAMasterSignals(prox, sig, history);
                                if (master && master.length > 0) {
                                    lastIaSignals = master;
                                    pendingPredictions = master.map(m => ({ ...m }));
                                }
                            }
                        } catch(aiErr) { console.error("AI Sync Error:", aiErr); }
                    }
                }
                
                renderWheelAndHistory();
                renderSignalsPanel(lastIaSignals);
                renderTravelPanel();
            }
        }
    } catch(e) {
        console.error('Global Sync error:', e);
    } finally {
        isSyncing = false;
    }
}

// ─── TAB SWITCH ───────────────────────────────────────────
window.setActiveIaTab = (idx) => {
    activeIaTab = idx;
    renderSignalsPanel(lastIaSignals);
    renderTravelPanel();
};

// ─── WIPE DATA ────────────────────────────────────────────
window.wipeAllData = async () => {
    if (!confirm('⚠️ WIPE ALL DATA?\n¿Estás seguro?')) return;
    try {
        const r = await fetch('/api/wipe-all', { method: 'DELETE' });
        const data = await r.json();
        if (data.success) {
            history.length = 0;
            lastKnownSpinId = null;
            iaSignalsHistory.forEach(h => h.length = 0);
            renderSignalsPanel(lastIaSignals);
            renderTravelPanel();
            alert(`✅ Wipe completado.`);
        }
    } catch(e) { alert('Error: ' + e.message); }
};

// ─── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    setInterval(() => {
        const el = document.getElementById('live-clock');
        if (el) el.innerText = new Date().toLocaleTimeString();
    }, 1000);

    renderSignalsPanel(lastIaSignals);
    renderTravelPanel();

    try {
        const r = await fetch('/api/tables');
        if (r.ok) {
            const ts = await r.json();
            const tableSelect = document.getElementById('table-select');
            if (tableSelect && ts.length > 0) {
                tableSelect.innerHTML = ts.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
                tableSelect.addEventListener('change', () => {
                    currentTableId = tableSelect.value;
                    history.length = 0;
                    lastKnownSpinId = null;
                    iaSignalsHistory.forEach(h => h.length = 0);
                    syncData();
                });
                currentTableId = ts[0].id;
                syncData();
            }
        }
    } catch (e) {}

    setInterval(syncData, 1000);
});
