// ============================================================
// app.js — COMPACT MOBILE UI ENGINE (Phase 30)
// ============================================================

const history      = [];
const iaSignalsHistory = [ [], [], [], [], [] ]; 
let activeIaTab    = 0; 
let lastIaSignals = [
    { top: 17, rule: 'READY', radius:'N9', smallSnipe: 5, bigSnipe: 14 },
    { top: 16, rule: 'READY', radius:'N2/N3', smallSnipe: 5, bigSnipe: 14  },
    { top: 5,  rule: 'READY', radius:'N9', smallSnipe: 5, bigSnipe: 14  },
    { top: 22, rule: 'READY', radius:'N9', smallSnipe: 5, bigSnipe: 14  },
    { top: 10, rule: 'READY', radius:'N4', smallSnipe: 5, bigSnipe: 14  }
]; 

// Agent names as per user request
const AGENT_NAMES   = ['Android N17', 'Android N16', 'Android 1717', 'Android N18', 'CÉLULA'];
const AGENT_KEYS    = ['N17', 'N16', 'N17PLUS', 'N18', 'CELULA'];
const AGENT_MODES   = ['SOPORTE/HIBRIDO', 'SIX STRATEGIE', 'HIBRIDO/ZIGZAG', 'SOPORTE PURO', 'SNIPER'];

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
    if (statusEl) statusEl.innerText = s.reason || 'ANALIZANDO PATRONES...';
    if (syncEl)   syncEl.innerText   = s.mode ? `MODO: ${s.mode}` : 'SINCRONIZADO';
    
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

    // Unified Dominance & Trend (V25 Fix)
    const domEl = document.getElementById('agent-dominance');
    if (domEl && s.dominance && s.trend) {
        domEl.innerHTML = `DOMINANCIA: ${s.dominance} | TENDENCIA: ${s.trend}`;
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
    const tbody   = document.getElementById('travel-tbody');
    const patEl   = document.getElementById('travel-pattern');
    const lastZEl = document.getElementById('travel-last-zone');
    if (!tbody) return;

    if (history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">Selecciona una mesa...</td></tr>';
        return;
    }
    
    // Clear initial "Select Table" if we have at least 1 spin
    const domEl = document.getElementById('agent-dominance');
    if (domEl && domEl.innerText.includes('SELECCIONA')) {
        domEl.innerText = 'ANALIZANDO RITMO...';
    }

    // Unified Dominance & Trend (From IA Master Signals)
    const activeSignal = lastIaSignals[activeIaTab] || lastIaSignals[0];
    if (domEl) {
        if (activeSignal && activeSignal.trend) {
            domEl.innerHTML = `DOMINANCIA: ${activeSignal.dominance || '--'} | TENDENCIA: ${activeSignal.trend}`;
        } else if (history.length > 0) {
            domEl.innerText = 'ANALIZANDO RITMO...';
        }
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
    if (lastZEl) {
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
}

// ─── SUBMIT NUMBER ─────────────────────────────────────────
function submitNumber(val, silent = false, batch = false, skipSignals = false) {
    const inputEl = document.getElementById('spin-number');
    const raw = val !== undefined ? val : (inputEl ? inputEl.value : '');
    const n = parseInt(raw);
    
    if (!isNaN(n) && n >= 0 && n <= 36) {
        history.push(n);
        if (inputEl && !batch) inputEl.value = '';

        // Compute new predictions (Only for manual input or newly synced data)
        if (!skipSignals && typeof computeDealerSignature === 'function' && history.length >= 3) {
            try {
                const sig  = computeDealerSignature(history);
                const prox = projectNextRound(history, {});
                const masterSignals = getIAMasterSignals(prox, sig, history);
                
                if (masterSignals && masterSignals.length > 0) {
                    const ag17   = masterSignals.find(s => s.name === 'Android n17');
                    const ag16   = masterSignals.find(s => s.name === 'Android n16');
                    const ag1717 = masterSignals.find(s => s.name === 'Android 1717');
                    const agN18  = masterSignals.find(s => s.name === 'N18');
                    const agCel  = masterSignals.find(s => s.name === 'CELULA');
                    
                    lastIaSignals = [
                        { top: ag17?.number,   confidence: ag17?.confidence,   reason: ag17?.reason,   rule: ag17?.rule,   mode: ag17?.mode,   radius: ag17?.radius   || 'N9', smallSnipe: ag17?.smallSnipe, bigSnipe: ag17?.bigSnipe },
                        { top: ag16?.tp,        confidence: ag16?.confidence,   reason: ag16?.reason,   rule: ag16?.rule,   mode: ag16?.mode,   radius: 'N2/N3',        tp: ag16?.tp, cors: ag16?.cor, smallSnipe: ag16?.smallSnipe, bigSnipe: ag16?.bigSnipe },
                        { top: ag1717?.number, confidence: ag1717?.confidence, reason: ag1717?.reason, rule: ag1717?.rule, mode: ag1717?.mode, radius: ag1717?.radius || 'N9', smallSnipe: ag1717?.smallSnipe, bigSnipe: ag1717?.bigSnipe },
                        { top: agN18?.number,  confidence: agN18?.confidence,  reason: agN18?.reason,  rule: agN18?.rule,  mode: agN18?.mode,  radius: agN18?.radius  || 'N9', smallSnipe: agN18?.smallSnipe, bigSnipe: agN18?.bigSnipe },
                        { top: agCel?.number,  confidence: agCel?.confidence,  reason: agCel?.reason,  rule: agCel?.rule,  mode: agCel?.mode,  radius: agCel?.radius  || 'N4', smallSnipe: agCel?.smallSnipe, bigSnipe: agCel?.bigSnipe }
                    ];
                }
            } catch(e) { console.error('Predict error:', e); }
        }

        // Post to backend (non-blocking)
        if (currentTableId && !batch) {
            fetch('/api/spin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table_id: currentTableId, number: n, source: 'manual' })
            }).catch(() => {});
        }
    }

    if (!batch) {
        renderSignalsPanel(lastIaSignals);
        renderTravelPanel();
    }
}

// ─── SYNC FROM SERVER (OPTIMIZED 100 LIMIT) ───────────────────
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
                renderSignalsPanel(lastIaSignals);
            }
        } else {
            const latestS = spins[spins.length - 1];
            if (latestS.id !== lastKnownSpinId) {
                // DB RESET DETECTION: If server ID is smaller, reset local state
                if (lastKnownSpinId !== null && latestS.id < lastKnownSpinId) {
                    history.length = 0;
                    iaSignalsHistory.forEach(h => h.length = 0);
                    lastKnownSpinId = null;
                }
                
                // Only process new spins since lastKnownSpinId
                for (const s of spins) {
                    if (s.id > (lastKnownSpinId || -1)) {
                        submitNumber(s.number, true, true, true);
                        lastKnownSpinId = s.id;
                        
                        // Populate W-L history from server results (V25 Fix)
                        if (s.results) {
                            const resMap = [
                                s.results.agent1_result, s.results.agent2_result,
                                s.results.agent3_result, s.results.agent4_result,
                                s.results.agent5_result
                            ];
                            resMap.forEach((res, idx) => {
                                if (res === 'Direct' || res === 'Neighbor') {
                                    iaSignalsHistory[idx].push('win');
                                } else if (res === 'Loss') {
                                    iaSignalsHistory[idx].push('loss');
                                }
                            });
                        }
                    }
                }
                
                // Final update UI
                const sig  = computeDealerSignature(history);
                const prox = projectNextRound(history, {});
                lastIaSignals = getIAMasterSignals(prox, sig, history);
                
                renderSignalsPanel(lastIaSignals);
                renderTravelPanel();
            }
        }
    } catch(e) {
        console.error('Sync error:', e);
    } finally {
        isSyncing = false;
    }
}

// ─── TAB SWITCH ───────────────────────────────────────────
window.setActiveIaTab = (idx) => {
    activeIaTab = idx;
    renderSignalsPanel(lastIaSignals);
};

// ─── WIPE DATA ────────────────────────────────────────────
window.wipeAllData = async () => {
    if (!confirm('⚠️ WIPE ALL DATA?\nEsto borrará TODOS los registros de la base de datos.\n¿Estás seguro?')) return;
    try {
        const r = await fetch('/api/wipe-all', { method: 'DELETE' });
        const data = await r.json();
        if (data.success) {
            // Reset local state too
            history.length = 0;
            lastKnownSpinId = null;
            iaSignalsHistory.forEach(h => h.length = 0);
            renderSignalsPanel(lastIaSignals);
            renderTravelPanel();
            alert(`✅ Wipe completado. Se borraron ${data.deleted} registros.\nEl bot puede comenzar a registrar datos frescos.`);
        } else {
            alert('Error: ' + (data.error || 'Wipe fallido'));
        }
    } catch(e) {
        alert('Error al hacer wipe: ' + e.message);
    }
};

// ─── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Clock
    setInterval(() => {
        const el = document.getElementById('live-clock');
        if (el) el.innerText = new Date().toLocaleTimeString();
    }, 1000);

    // Immediate render with placeholders
    renderSignalsPanel(lastIaSignals);
    renderTravelPanel();

    // Load tables from API
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
    } catch (e) { console.warn('API not reachable, offline mode.'); }

    // Poll for updates every 1s (Ultra-fast sync)
    setInterval(syncData, 1000);
});
