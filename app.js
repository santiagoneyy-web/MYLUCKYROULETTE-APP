// ============================================================
// app.js — UI logic for Roulette Predictor Pro v3.1
// ============================================================

const history      = [];
const stats        = {};
const iaSignalsHistory = [ [], [], [], [], [] ]; 
const iaWins = [0, 0, 0, 0, 0];
const iaLosses = [0, 0, 0, 0, 0];
let lastIaSignals = [null, null, null, null, null]; 
let activeIaTab    = 0; 

const API_BASE = '/api';
let currentTableId = null;

// Pro v3.1 Selectors
const activeAgentLabel = document.getElementById('active-agent-name');
const historyEl       = document.getElementById('history-strip');
const tableSelect     = document.getElementById('table-select');
const travelTbody     = document.getElementById('travel-tbody');
const topSignalEl     = document.getElementById('top-signal-val');

const numInput = { value: '', focus: () => {}, addEventListener: () => {} }; 
const submitBtn = { addEventListener: () => {} };

const wheelCanvas = document.getElementById('wheel-canvas');
const wheelCtx = wheelCanvas ? wheelCanvas.getContext('2d') : null;

const WHEEL_NUMS = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED_NUMS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function numColor(n) { if (n === 0) return 'green'; if (RED_NUMS.has(n)) return 'red'; return 'black'; }

function calcDist(from, to) {
    const i1 = WHEEL_NUMS.indexOf(from);
    const i2 = WHEEL_NUMS.indexOf(to);
    if (i1 === -1 || i2 === -1) return 0;
    let d = i2 - i1;
    if (d > 18) d -= 37;
    if (d < -18) d += 37;
    return d;
}

function drawWheel(highlightNum = null) {
    if (!wheelCtx) return;
    const ctx = wheelCtx;
    const cx = 110, cy = 110;
    ctx.clearRect(0, 0, 220, 220);

    // 1. Bronze Outermost Circle
    ctx.beginPath();
    ctx.arc(cx, cy, 105, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a1a';
    ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();

    // 2. Track & Pockets
    WHEEL_NUMS.forEach((n, i) => {
        const startAng = (i * (360 / 37) - 90 - (360/74)) * (Math.PI / 180);
        const endAng   = (i * (360 / 37) - 90 + (360/74)) * (Math.PI / 180);
        const midAng   = (i * (360 / 37) - 90) * (Math.PI / 180);

        // Pocket Background
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(startAng) * 60, cy + Math.sin(startAng) * 60);
        ctx.arc(cx, cy, 100, startAng, endAng);
        ctx.lineTo(cx + Math.cos(endAng) * 60, cy + Math.sin(endAng) * 60);
        ctx.closePath();
        
        ctx.fillStyle = (n === 0) ? '#008b00' : (RED_NUMS.has(n) ? '#c41e3a' : '#000');
        ctx.fill();
        ctx.strokeStyle = '#222'; ctx.lineWidth = 0.5; ctx.stroke();

        // Numbers (Bigger & Clearer)
        const rx = cx + Math.cos(midAng) * 82;
        const ry = cy + Math.sin(midAng) * 82;
        
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(midAng + Math.PI/2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px var(--mono)';
        ctx.textAlign = 'center';
        ctx.fillText(n, 0, 4);
        ctx.restore();

        // Highlight & Ball
        if (n === highlightNum) {
            ctx.beginPath();
            ctx.arc(rx, ry, 14, 0, Math.PI * 2);
            ctx.strokeStyle = '#f5c842'; ctx.lineWidth = 3; ctx.stroke();
            
            // The actual ball
            const bx = cx + Math.cos(midAng) * 105;
            const by = cy + Math.sin(midAng) * 105;
            ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI*2);
            ctx.fillStyle = '#fff'; ctx.shadowBlur = 10; ctx.shadowColor = '#fff';
            ctx.fill(); ctx.shadowBlur = 0;
        }
    });

    // 3. Inner Spindle (Professional look)
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
    gr.addColorStop(0, '#333');
    gr.addColorStop(0.5, '#111');
    gr.addColorStop(1, '#000');
    ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI*2);
    ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = '#444'; ctx.lineWidth = 2; ctx.stroke();
    
    ctx.fillStyle = '#f5c842';
    ctx.font = '800 9px var(--font)';
    ctx.textAlign = 'center';
    ctx.fillText("ELITE V3.1", cx, cy + 4);
}

function renderHistory() {
    if (!historyEl) return;
    historyEl.innerHTML = '';
    history.slice(-15).reverse().forEach((n, idx) => {
        const div = document.createElement('div');
        div.className = `hist-ball hist-${numColor(n)} ${idx === 0 ? 'hist-latest' : ''}`;
        div.textContent = n;
        historyEl.appendChild(div);
    });
}

function updateClock() {
    const el = document.getElementById('live-clock');
    if (el) el.innerText = new Date().toLocaleTimeString();
}
setInterval(updateClock, 1000);

function renderSignalsPanel(signals) {
    const tabStrip = document.getElementById('strat-tabs');
    const activeLabel = document.getElementById('active-agent-name');
    if (!tabStrip) return;

    try {
        const names = ['N17', 'N16', 'N17PLUS', 'N18', 'CELULA'];
        tabStrip.innerHTML = names.map((name, idx) => {
            const h = iaSignalsHistory[idx] || [];
            const winCount = h.filter(x => x === 'win').length;
            const hitRate = h.length > 0 ? Math.round((winCount / h.length) * 100) : 0;
            const wL = h.length > 0 ? `(W-L ${winCount}-${h.length-winCount})` : '(W-L 0-0)';
            
            return `<div class="nav-item ${idx === activeIaTab ? 'active' : ''}" onclick="setActiveIaTab(${idx})" style="flex:1; background:rgba(255,255,255,0.02); border:1px solid ${idx === activeIaTab ? 'var(--gold)' : 'var(--border)'}; padding:8px; border-radius:4px; text-align:center; cursor:pointer;">
                <span style="font-size:0.8rem; font-weight:800; color:#fff;">${name}</span>
                <span style="display:block; font-size:0.55rem; color:var(--text-dim);">${wL}</span>
            </div>`;
        }).join('');

        if (activeLabel) activeLabel.innerText = names[activeIaTab];

        const s = signals[activeIaTab];
        const targetEl = document.getElementById('target-number');
        const smallLabel = document.getElementById('pred-small-val');
        const bigLabel = document.getElementById('pred-big-val');

        if (!s || !s.top || s.rule === 'STOP') {
            if (targetEl) targetEl.innerText = '--';
        } else {
            if (targetEl) targetEl.innerText = s.top;
            if (smallLabel) smallLabel.style.opacity = (s.top <= 9) ? '1' : '0.3';
            if (bigLabel) bigLabel.style.opacity = (s.top >= 10 && s.top <= 18) ? '1' : '0.3';
        }
    } catch (e) { console.error("Signal Render Error:", e); }
}

function renderTravelPanel(sig) {
    const cont = travelTbody;
    if (!cont) return;

    if (!history || history.length < 2) {
        cont.innerHTML = '<tr><td colspan="5" class="muted" style="padding:20px; text-align:center;">Analyzing patterns (min 2 spins required)...</td></tr>';
        return;
    }

    const rows = history.slice(-50).reverse().map((n, i) => {
        const idx = history.length - 1 - i;
        const dist = (idx > 0) ? calcDist(history[idx-1], history[idx]) : 0;
        const dir = dist >= 0 ? 'CW' : 'CCW';
        const colorClass = RED_NUMS.has(n) ? 'val-down' : (n === 0 ? 'val-up' : 'val-neutral');
        
        // Corrected Logic: Small 1-9, Big 10-18
        let phase = '---';
        if (n >= 1 && n <= 9) phase = 'SMALL';
        else if (n >= 10 && n <= 18) phase = 'BIG';
        else if (n > 18) phase = 'ULTRA';

        return `<tr>
            <td style="padding:10px 12px; color:var(--text-dim);">${idx + 1}</td>
            <td class="${colorClass}" style="padding:10px 12px; font-weight:900;">${n}</td>
            <td style="padding:10px 12px; color:${dist >= 0 ? 'var(--green)' : 'var(--red)'}">${dist >= 0 ? '+' : ''}${dist}</td>
            <td style="padding:10px 12px; color:var(--accent); font-weight:800;">${dir}</td>
            <td style="padding:10px 12px; font-weight:900; color:${phase === 'SMALL' ? 'var(--green)' : (phase === 'BIG' ? 'var(--red)' : '#fff')}">${phase}</td>
        </tr>`;
    }).join('');

    cont.innerHTML = rows;
}

async function apiFetchTables() { const r = await fetch(`${API_BASE}/tables`); return r.json(); }
async function apiFetchHistory(tableId) { const r = await fetch(`${API_BASE}/history/${tableId}`); return r.json(); }
async function apiPostSpin(tableId, number) { const r = await fetch(`${API_BASE}/spin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table_id: tableId, number, source: 'manual' }) }); return r.json(); }
async function apiFetchPredict(tableId) { const r = await fetch(`${API_BASE}/predict/${tableId}`); return r.json(); }

async function submitNumber(val, silent = false, batch = false) {
    let n = parseInt(val || numInput.value);
    
    if (!isNaN(n) && n >= 0 && n <= 36) {
        history.push(n);

        if (!silent && currentTableId) {
            try { 
                await apiPostSpin(currentTableId, n); 
            } catch(e) { console.error("Error posting spin:", e); }
        }

        lastIaSignals.forEach((s, idx) => {
            if (!s || s.confidence === '0%' || s.rule === 'STOP') return;
            let win = false;
            const target = s.number !== null && s.number !== undefined ? s.number : s.top;
            if (target !== null && target !== undefined) {
                const dist = Math.abs(calcDist(n, target));
                win = (dist <= 4); 
            }
            if (win) iaWins[idx]++; else iaLosses[idx]++;
            iaSignalsHistory[idx].push(win ? 'win' : 'loss');
        });
    }

    if (typeof computeDealerSignature !== 'function') return;

    const sig = computeDealerSignature(history);
    const res = analyzeSpin(history, stats);
    const prx = projectNextRound(history, stats);
    const sigs = getIAMasterSignals(prx, sig, history) || [];
    
    const finalSigs = [
        { ...sigs[1], name: 'N17', top: sig.casilla1, small: sig.casilla5, big: sig.casilla14 },
        { ...sigs[0], name: 'N16', top: sig.casilla10, small: sig.casilla5, big: sig.casilla19 },
        { ...sigs[2], name: 'N17PLUS', top: sig.casilla14, small: sig.casilla5, big: sig.casilla19 },
        { ...sigs[3], name: 'N18', top: sig.casilla19, small: sig.casilla1, big: sig.casilla10 },
        { ...sigs[0], name: 'CELULA', top: sig.casilla5, small: sig.casilla1, big: sig.casilla14 }
    ];
    
    lastIaSignals = finalSigs;

    if (!batch) {
        renderHistory(); 
        renderTravelPanel(null); 
        drawWheel(history[history.length - 1]);
        renderSignalsPanel(lastIaSignals);
    }
}

function wipeData() { 
    history.length = 0; 
    iaWins.fill(0); 
    iaLosses.fill(0); 
    iaSignalsHistory.forEach(h => h.length = 0); 
    lastIaSignals.fill(null); 
    renderHistory(); 
}

window.setActiveIaTab = (idx) => { activeIaTab = idx; submitNumber(null, true, false); };

window.toggleDashboard = () => {
    const banner = document.getElementById('active-signal-container');
    banner.classList.toggle('signal-collapsed');
};

window.toggleSettings = () => {
    const content = document.getElementById('settings-content');
    const arrow = document.getElementById('settings-arrow');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        arrow.style.transform = 'rotate(180deg)';
    } else {
        content.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
    }
};

const clearBtn = document.getElementById('clear-btn');
if (clearBtn) clearBtn.addEventListener('click', wipeData);

document.addEventListener('DOMContentLoaded', () => { 
    if (tableSelect) {
        tableSelect.addEventListener('change', async () => {
            currentTableId = tableSelect.value; if (!currentTableId) return;
            const spins = await apiFetchHistory(currentTableId); 
            wipeData(); 
            for (const s of spins) {
                if (s && s.number !== undefined) await submitNumber(s.number, true, true);
            }
            submitNumber(null, true, false);
        });
    }
    
    loadTables().then(() => {
        // Force initial render
        renderHistory();
        renderTravelPanel(null);
        drawWheel();
        renderSignalsPanel(lastIaSignals);
    });

    updateClock();
    setInterval(syncData, 5000); 
});
