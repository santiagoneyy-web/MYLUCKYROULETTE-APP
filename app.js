// ============================================================
// app.js — COMPACT MOBILE UI ENGINE (Phase 30)
// ============================================================

const history      = [];
const iaSignalsHistory = [ [], [], [], [], [] ]; 
let activeIaTab    = 0; 
let lastIaSignals = [
    { top: 17, rule: 'READY', radius:'N9' },
    { top: 16, rule: 'READY', radius:'N2/N3' },
    { top: 5,  rule: 'READY', radius:'N9' },
    { top: 22, rule: 'READY', radius:'N9' },
    { top: 10, rule: 'READY', radius:'N4' }
]; 

// Agent names as per user request
const AGENT_NAMES   = ['Android N17', 'Android N16', 'Android 1717', 'Android N18', 'CÉLULA'];
const AGENT_KEYS    = ['N17', 'N16', 'N17PLUS', 'N18', 'CELULA'];
const AGENT_MODES   = ['SOPORTE/HIBRIDO', 'SIX STRATEGIE', 'HIBRIDO/ZIGZAG', 'SOPORTE PURO', 'SNIPER'];

const RED_NUMS  = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const WHEEL_NUMS = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];

let currentTableId = null;

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
    if (targetEl) targetEl.innerText = s.top !== undefined ? s.top : '--';
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

    // Result dots (last 5)
    if (dotsEl) {
        const last5 = h.slice(-5);
        dotsEl.innerHTML = last5.map(r =>
            `<span class="rd ${r === 'win' ? 'rd-win' : 'rd-loss'}">${r === 'win' ? 'W' : 'L'}</span>`
        ).join('');
    }
}

// ─── RENDER: ALL SIGNALS ───────────────────────────────────
function renderSignalsPanel(signals) {
    renderTabs();
    renderAgentCard(signals);
}

// ─── RENDER: TRAVEL TABLE ──────────────────────────────────
function renderTravelPanel() {
    const tbody   = document.getElementById('travel-tbody');
    const patEl   = document.getElementById('travel-pattern');
    const lastZEl = document.getElementById('travel-last-zone');
    if (!tbody) return;

    if (history.length < 2) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">Selecciona una mesa...</td></tr>';
        return;
    }

    // Pattern badge
    if (patEl) {
        const last5 = history.slice(-5);
        const bigCount   = last5.filter(n => n >= 10 && n <= 19).length;
        const smallCount = last5.filter(n => n >= 1 && n <= 9).length;
        const dirs = [];
        for (let i = history.length - 4; i < history.length; i++) {
            if (i > 0) dirs.push(calcDist(history[i-1], history[i]) > 0 ? 'D' : 'I');
        }
        const isZigZagDir = dirs.length >= 2 && dirs[dirs.length-1] !== dirs[dirs.length-2];
        
        let pat = 'ESTABLE', patClass = 'badge-stable';
        if (isZigZagDir) { pat = 'ZIG ZAG ↔'; patClass = 'badge-zigzag'; }
        else if (bigCount >= 3) { pat = 'BIG TREND'; patClass = 'badge-zone'; }
        else if (smallCount >= 3) { pat = 'SMALL TREND'; patClass = 'badge-stable'; }
        
        patEl.textContent = pat;
        patEl.className = `badge ${patClass}`;
    }

    // Last zone badge (based on number for the badge, but distance for the table)
    const lastN = history[history.length - 1];
    if (lastZEl) {
        if (lastN >= 1 && lastN <= 9)        { lastZEl.textContent = 'LAST: SMALL'; lastZEl.style.color = 'var(--green)'; }
        else if (lastN >= 10 && lastN <= 19) { lastZEl.textContent = 'LAST: BIG';   lastZEl.style.color = 'var(--red)'; }
        else                                 { lastZEl.textContent = `LAST: ${lastN}`; lastZEl.style.color = 'var(--muted)'; }
    }

    tbody.innerHTML = history.slice(-50).reverse().map((n, i) => {
        const idxInHistory = history.length - 1 - i;
        const prev = history[idxInHistory - 1];
        const dist = (prev !== undefined) ? calcDist(prev, n) : 0;
        const absDist = Math.abs(dist);
        const dir  = dist > 0 ? 'DER.' : (dist < 0 ? 'IZQ.' : '--');
        
        const numClass = (n === 0) ? 'num-zero' : (RED_NUMS.has(n) ? 'num-red' : 'num-black');
        const dirClass = dist >= 0 ? 'dir-der' : 'dir-izq';
        
        // Correct classification based on DISTANCE (Phase 31 Fix)
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
function submitNumber(val, silent = false, batch = false) {
    const inputEl = document.getElementById('spin-number');
    const raw = val !== undefined ? val : (inputEl ? inputEl.value : '');
    const n = parseInt(raw);
    
    if (!isNaN(n) && n >= 0 && n <= 36) {
        // Evaluate previous predictions
        lastIaSignals.forEach((s, idx) => {
            if (!s || s.top === undefined || s.top === null) return;
            const radius = s.radius === 'N4' ? 4 : 9;
            const win = Math.abs(calcDist(n, s.top)) <= radius;
            iaSignalsHistory[idx].push(win ? 'win' : 'loss');
        });
        
        history.push(n);
        if (inputEl && !batch) inputEl.value = '';

        // Compute new predictions
        if (typeof computeDealerSignature === 'function' && history.length >= 3) {
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
                        { top: ag17?.number,   confidence: ag17?.confidence,   reason: ag17?.reason,   rule: ag17?.rule,   mode: ag17?.mode,   radius: ag17?.radius   || 'N9'  },
                        { top: ag16?.tp,        confidence: ag16?.confidence,   reason: ag16?.reason,   rule: ag16?.rule,   mode: ag16?.mode,   radius: 'N2/N3',        tp: ag16?.tp, cors: ag16?.cor },
                        { top: ag1717?.number, confidence: ag1717?.confidence, reason: ag1717?.reason, rule: ag1717?.rule, mode: ag1717?.mode, radius: ag1717?.radius || 'N9'  },
                        { top: agN18?.number,  confidence: agN18?.confidence,  reason: agN18?.reason,  rule: agN18?.rule,  mode: agN18?.mode,  radius: agN18?.radius  || 'N9'  },
                        { top: agCel?.number,  confidence: agCel?.confidence,  reason: agCel?.reason,  rule: agCel?.rule,  mode: agCel?.mode,  radius: agCel?.radius  || 'N4'  }
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

// ─── SYNC FROM SERVER ──────────────────────────────────────
async function syncData() {
    if (!currentTableId) return;
    try {
        const r = await fetch(`/api/history/${currentTableId}`);
        if (!r.ok) return;
        const spins = await r.json();
        if (spins.length !== history.length) {
            history.length = 0;
            iaSignalsHistory.forEach(h => h.length = 0);
            for (const s of spins) submitNumber(s.number, true, true);
            renderSignalsPanel(lastIaSignals);
            renderTravelPanel();
        }
    } catch(e) {}
}

// ─── TAB SWITCH ───────────────────────────────────────────
window.setActiveIaTab = (idx) => {
    activeIaTab = idx;
    renderSignalsPanel(lastIaSignals);
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
                    iaSignalsHistory.forEach(h => h.length = 0);
                    syncData();
                });
                currentTableId = ts[0].id;
                syncData();
            }
        }
    } catch (e) { console.warn('API not reachable, offline mode.'); }

    // Poll for updates every 5s
    setInterval(syncData, 5000);
});
