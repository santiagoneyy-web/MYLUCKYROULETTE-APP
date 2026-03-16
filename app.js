// ============================================================
// app.js — UI logic for Roulette Predictor v2
// ============================================================

const history      = [];
const stats        = {};
const topHitHistory = []; // 'over' | 'under' | 'miss'
// State for 4 IA Signals
const iaSignalsHistory = [ [], [], [], [] ]; 
const lastIaHits = [null, null, null, null];
const iaWins = [0, 0, 0, 0];
const iaLosses = [0, 0, 0, 0];
let lastIaSignals = [null, null, null, null]; 
let activeIaTab    = 0; // index of active IA signal (0-3)
let activeTab      = '-'; // active strategy tab key

// ── API & Table State ─────────────────────────────────────────
const API_BASE = 'http://localhost:3000/api';
let currentTableId = null;
let pollingTimer   = null;
let lastKnownSpinId = null;

// Auditoría de Sesión (Protocolo Pro)
const auditStats = {
    'N9': { w: 0, l: 0 },
    'N4_S': { w: 0, l: 0 },
    'N4_B': { w: 0, l: 0 }
};

// ── DOM refs ──────────────────────────────────────────────────
const numInput    = document.getElementById('num-input');
const submitBtn   = document.getElementById('submit-btn');
const clearBtn    = document.getElementById('clear-btn');
const historyEl   = document.getElementById('history-strip');
const statusMsg   = document.getElementById('status-msg');
const stratTabs   = document.getElementById('strat-tabs');
const targetPanel = document.getElementById('target-content');
const nextPanel   = document.getElementById('next-content');
const topPanel    = document.getElementById('top-content');
const travelPanel = document.getElementById('travel-content');

// API DOM refs
const tableSelect      = document.getElementById('table-select');
const tableSpinCount   = document.getElementById('table-spin-count');
const addTableBtn      = document.getElementById('add-table-btn');
const clearTableBtn    = document.getElementById('clear-table-btn');
const ocrBadge         = document.getElementById('ocr-badge');
const modalOverlay     = document.getElementById('modal-overlay');
const modalName        = document.getElementById('modal-name');
const modalProvider    = document.getElementById('modal-provider');
const modalUrl         = document.getElementById('modal-url');
const modalCancel      = document.getElementById('modal-cancel');
const modalSave        = document.getElementById('modal-save');

// ── API Functions ─────────────────────────────────────────────
async function apiFetchTables() { const r = await fetch(`${API_BASE}/tables`); return r.json(); }
async function apiAddTable(name, provider, url) { const r = await fetch(`${API_BASE}/tables`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, provider, url }) }); return r.json(); }
async function apiFetchHistory(tableId) { const r = await fetch(`${API_BASE}/history/${tableId}`); return r.json(); }
async function apiPostSpin(tableId, number) { const r = await fetch(`${API_BASE}/spin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table_id: tableId, number, source: 'manual' }) }); return r.json(); }
async function apiClearHistory(tableId) { const r = await fetch(`${API_BASE}/history/${tableId}`, { method: 'DELETE' }); return r.json(); }

// ── Number colors ─────────────────────────────────────────────
const RED_NUMS   = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const BLACK_NUMS = new Set([2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]);

function numColor(n) {
    if (n === 0) return 'green';
    if (RED_NUMS.has(n)) return 'red';
    return 'black';
}

function zoneNum(n, realNum, hideText = false) {
    const hit = (realNum !== undefined && n === realNum);
    return `<span class="zone-num zone-${numColor(n)} ${hit ? 'zone-hit' : ''}" title="${n}">${hideText ? '' : n}</span>`;
}

// ── Roulette wheel canvas ──────────────────────────────────────
function drawWheel(highlightNum = null) {
    const canvas = document.getElementById('wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const outerR = cx - 4;
    const innerR = outerR * 0.52;
    const numR   = outerR * 0.78;
    const count  = 37;
    const slice  = (2 * Math.PI) / count;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Outer ring shadow
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 2, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(74,124,255,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();

    WHEEL_ORDER.forEach((num, i) => {
        const start = i * slice - Math.PI / 2;
        const end   = start + slice;
        const isHit = (num === highlightNum);

        let fill;
        if (num === 0)              fill = isHit ? '#00ff88' : '#00994e';
        else if (RED_NUMS.has(num)) fill = isHit ? '#ff7090' : '#8a1820';
        else                        fill = isHit ? '#7090ff' : '#12122c';

        // Sector
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerR, start, end);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = '#04061a';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Number text
        const mid = start + slice / 2;
        const tx  = cx + numR * Math.cos(mid);
        const ty  = cy + numR * Math.sin(mid);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(mid + Math.PI / 2);
        ctx.fillStyle = isHit ? '#fff' : 'rgba(200,210,255,0.7)';
        ctx.font = `bold 7.5px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num, 0, 0);
        ctx.restore();
    });

    // Inner circle
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
    ctx.fillStyle = '#06091e';
    ctx.fill();
    ctx.strokeStyle = 'rgba(74,124,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Center logo
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(74,124,255,0.5)';
    ctx.fill();
}


// ── History strip ─────────────────────────────────────────────
function renderHistory() {
    historyEl.innerHTML = '';
    history.slice(-18).forEach((n, i, arr) => {
        const ball = document.createElement('div');
        ball.className = `hist-ball hist-${numColor(n)}`;
        ball.textContent = n;
        if (i === arr.length - 1) ball.classList.add('hist-latest');
        historyEl.appendChild(ball);
    });
}

// ── Strategy tabs ─────────────────────────────────────────────
const STRAT_KEYS = ['-', '+', '-,-1', '-,+1', '+,-1', '+,+1'];

function buildStratTabs(results) {
    stratTabs.innerHTML = '';
    STRAT_KEYS.forEach(key => {
        const btn = document.createElement('button');
        btn.className = `strat-tab${key === activeTab ? ' active' : ''}`;
        btn.textContent = key;
        // Color tab by last result
        if (results) {
            const r = results.find(x => x.strategy === key);
            if (r) btn.classList.add(r.win ? 'tab-win' : 'tab-loss');
        }
        btn.addEventListener('click', () => {
            activeTab = key;
            if (results) {
                buildStratTabs(results);
                renderTargetPanel(results, history[history.length - 1]);
            }
        });
        stratTabs.appendChild(btn);
    });
}

// ── Helpers ───────────────────────────────────────────────────
function hitRateBar(rate) {
    const pct = rate.toFixed(1);
    const cls = rate >= 60 ? 'bar-high' : rate >= 40 ? 'bar-mid' : 'bar-low';
    return `<div class="hit-bar-wrap">
        <div class="hit-bar ${cls}" style="width:${Math.min(rate,100)}%"></div>
        <span class="hit-label">${pct}%</span>
    </div>`;
}

function streakBadge(sw, sl) {
    if (sw > 0) return `<span class="badge badge-win">W${sw}</span>`;
    if (sl > 0) return `<span class="badge badge-loss">L${sl}</span>`;
    return `<span class="badge badge-neutral">-</span>`;
}

function viaBadge(via) {
    const map = { tp:'via-tp', cor:'via-cor', n:'via-n', '-':'via-miss' };
    const lbl = { tp:'TP', cor:'COR', n:'N', '-':'-' };
    return `<span class="badge ${map[via]||'via-miss'}">${lbl[via]||'-'}</span>`;
}

function patBadge(p) {
    const m = {
        hot_streak:  ['pat-hot',         '🔥 HOT STREAK'],
        weakening:   ['pat-weakening',   '⚠️ DEBILITÁNDOSE'],
        alternating: ['pat-alternating', '🔀 ALTERNANDO'],
        cold:        ['pat-cold',        '❄️ COLD'],
        neutral:     ['pat-neutral',     '· NEUTRO'],
    };
    const [cls, lbl] = m[p] || m.neutral;
    return `<span class="pat-badge ${cls}">${lbl}</span>`;
}

function patternDots(outcomes) {
    return outcomes.map(v =>
        `<span class="dot ${v ? 'dot-w' : 'dot-l'}">${v ? 'W' : 'L'}</span>`
    ).join('');
}

// ── TARGET ESTRATEGIA panel ───────────────────────────────────
function renderTargetPanel(results, real) {
    if (!results || !results.length) {
        targetPanel.innerHTML = '<p class="muted">Ingresa al menos 3 números para analizar.</p>';
        return;
    }
    
    const r = results.find(x => x.strategy === activeTab) || results[0];

    targetPanel.innerHTML = `
        <div class="target-strat-block" style="margin-bottom: 0;">
            <div class="target-header">
                <span class="target-strat-name">${r.strategy}</span>
                <span class="target-result ${r.win ? 'target-win' : 'target-loss'}">
                    ${r.win ? '✓ WIN' : '✗ MISS'}
                </span>
                ${streakBadge(r.streakWin, r.streakLoss)}
                ${patBadge(r.targetPattern)}
            </div>
            <div class="stats-row">
                <span><span class="stat-lbl">W</span>${r.wins}/${r.attempts}</span>
                <span><span class="stat-lbl">L</span>${r.losses}/${r.attempts}</span>
                <span><span class="stat-lbl">d</span>${r.distGroupMin}</span>
                <span><span class="stat-lbl">zona</span>${r.betZone.length}</span>
                <span><span class="stat-lbl">via</span>${viaBadge(r.hitVia)}</span>
            </div>
            <div class="detail-row">
                <span class="det-lbl">b:</span> ${r.basePrevA},${r.basePrevB}
                <span class="det-lbl">tp:</span> <span class="tp-num">${r.mainTerminal}</span>
                <span class="det-lbl">cor:</span> [${[...new Set([r.mainTerminal, ...r.correlated])].join(', ')}]
                <span class="rule-tag">${r.rule}</span>
            </div>
            <div class="pattern-row">
                ${patternDots(r.outcomes)}
            </div>
        </div>
    `;
}

// ── IA AGENTS (3-SLOTS) panel ───────────────────────────────
function renderSignalsPanel(signals, sig, real) {
    if (!sig || sig.avgTravel === null || real === undefined) {
        topPanel.innerHTML = '<p class="muted">Ingresa datos...</p>';
        return;
    }

    if (!signals || signals.length < 2) return;

    // IA Tab Strip
    const tabButtons = signals.map((s, idx) => {
        const isActive = idx === activeIaTab;
        return `
            <button class="ia-tab ${isActive ? 'active' : ''}" onclick="setActiveIaTab(${idx})">
                ${s.name.split(' ')[0]}
            </button>
        `;
    }).join('');

    const s = signals[activeIaTab];
    const isWin = s.streakWin > 0;
    
    // Direction label: CW (Der ↻), CCW (Izq ↺)
    const dirTxt = sig.directionState === 'zigzag' ? 'ZIG-ZAG ⚡' :
                   (sig.directionState === 'stable' ? (sig.currentTrendDir >= 0 ? 'Der. ↻' : 'Izq. ↺') : 'Midiendo...');
    
    const dots = iaSignalsHistory[activeIaTab].slice(-10).map(h => {
        const hIsWin = h === 'win';
        const cls = hIsWin ? 'm-hist-w' : 'm-hist-l';
        return `<span class="m-hist-badge ${cls}">${hIsWin ? 'W' : 'L'}</span>`;
    }).join('');

    let content = '';
    const isPausa = s.rule === 'STOP' || s.rule.includes('PAUSA') || s.confidence === '0%';
    const displayDirTxt = isPausa ? 'CHARGING' : dirTxt;

    // Zone Badge logic for all agents
    const showZoneBadge = sig.directionState === 'stable' && (sig.recommendedPlay === 'SMALL' || sig.recommendedPlay === 'BIG');
    const zoneBadgeCls = sig.recommendedPlay === 'SMALL' ? 'badge-win' : 'badge-loss';
    const zoneBadgeText = sig.recommendedPlay;
    const zoneBadgeHTML = showZoneBadge ? `<span class="badge ${zoneBadgeCls}" style="font-size:0.6rem; padding:1px 6px; margin-left:8px; border:1px solid currentColor;">PROX: ${zoneBadgeText}</span>` : '';

    if (s.name === 'SIX STRATEGIE') {
        const rs = s.streakWin > 0 ? `W${s.streakWin}` : s.streakLoss > 0 ? `L${s.streakLoss}` : '-';
        content = `
            <div class="ia-active-slot slot-math">
                <div class="ia-slot-header">
                    <span class="ia-slot-name">${s.strategy} ${zoneBadgeHTML}</span>
                    <span class="ia-slot-conf" style="${isPausa ? 'color:var(--text-dim)' : ''}">${s.confidence} CONF.</span>
                </div>
                <div class="ia-main-val" style="display:flex; flex-direction:column; align-items:center;">
                    <span class="tp-num" style="font-size:3.5rem; line-height: 1; ${isPausa ? 'color:var(--text-dim); letter-spacing:8px;' : ''}">${isPausa ? '...' : s.tp}</span>
                    <div style="font-size:0.8rem; color:var(--text); margin-top:8px; font-weight:700;">
                        COR: <span style="font-size:0.85rem; color:var(--gold);">${isPausa ? '...' : [...new Set(s.cor)].filter(c=>c!==s.tp).join(', ')}</span>
                    </div>
                    <div style="font-size:0.75rem; color:var(--text-dim); margin-top:4px;">
                        [ ZONA TOTAL: ${s.betZone ? s.betZone.length : 9} FICHAS ]
                    </div>
                </div>
                <div class="ia-slot-footer">
                    <div>RACHA: <strong class="${s.streakWin > 0 ? 'text-green' : 'text-red'}">${rs}</strong></div>
                    <div class="ia-reason">${s.reason}</div>
                    <div class="ia-rule">${s.rule}</div>
                </div>
            </div>
        `;
    } else if (s.name === 'COMBINATION') {
        const isAtaque = s.mode === 'ATAQUE_ZONA';
        const isCaos = s.mode === 'TOP_NUMBER';
        const isActive = isAtaque || isCaos;
        const androidPausa = s.confidence === '0%' || s.mode === 'NEUTRAL';
        
        const zoneLabel = s.targetZone === 'SMALL' ? 'SMALL' : (s.targetZone === 'BIG' ? 'BIG' : '—');
        const zoneColor = s.targetZone === 'SMALL' ? 'var(--green)' : (s.targetZone === 'BIG' ? 'var(--red)' : 'var(--gold)');
        const androidGlow = isActive ? `box-shadow: 0 0 20px ${zoneColor}44; border-color: ${zoneColor}66;` : '';

        let innerContent = '';
        if (isAtaque) {
            innerContent = `
                <div style="font-size:0.7rem; color:var(--text-dim); letter-spacing:2px; margin-bottom:6px;">PREDICCIÓN HÍBRIDA</div>
                <div style="font-size:2.8rem; font-weight:900; color:${zoneColor}; letter-spacing:2px; text-shadow:0 0 18px ${zoneColor}88;">${zoneLabel}</div>
                <div style="font-size:0.75rem; color:var(--text); margin-top:6px; font-weight:700;">
                    TARGET FÍSICO: <span style="color:${zoneColor}; font-weight:900;">${s.number}<sup>n4</sup></span>
                </div>
            `;
        } else if (isCaos) {
            innerContent = `
                <div style="font-size:0.7rem; color:var(--gold); letter-spacing:2px; margin-bottom:6px;">ESCUDO ANTI-CAOS</div>
                <div style="font-size:3.2rem; font-weight:900; color:var(--gold); line-height:1; text-shadow:0 0 15px rgba(255,215,0,0.4);">${s.number}<sup>n9</sup></div>
                <div style="font-size:0.75rem; color:var(--text); margin-top:6px; font-weight:700;">
                    ANCLAJE TOP NUMBER
                </div>
            `;
        } else {
            innerContent = `
                <div style="font-size:2.2rem; color:var(--text-dim); letter-spacing:10px; opacity:0.5;">···</div>
                <div style="font-size:0.68rem; color:var(--text-dim); margin-top:8px; letter-spacing:1px;">SINCRONIZANDO VECTORES...</div>
            `;
        }

        content = `
            <div class="ia-active-slot slot-lanza" style="${androidGlow}">
                <div class="ia-slot-header">
                    <span class="ia-slot-name">🤖 ANDROIDE PERFECTO ${zoneBadgeHTML}</span>
                    <span class="ia-slot-conf" style="${androidPausa ? 'color:var(--text-dim)' : `color:${zoneColor};`}">${s.confidence} CONF.</span>
                </div>

                <div class="ia-main-val" style="display:flex; flex-direction:column; align-items:center; padding: 12px 0;">
                    ${innerContent}
                </div>

                <div class="ia-slot-footer">
                    <div class="ia-stats-mini">W: ${iaWins[activeIaTab]} L: ${iaLosses[activeIaTab]}</div>
                    <div class="ia-reason">${s.reason}</div>
                    <div class="ia-rule">${s.rule}</div>
                </div>
            </div>
        `;
    } else if (s.name === 'SOPORTE PRO') {
        const isSmallMode = s.mode === 'SOPORTE_SMALL';
        const soportePausa = s.confidence === '0%';
        const modeColor = isSmallMode ? 'var(--green)' : 'var(--red)';
        const modeLabel = isSmallMode ? '🛡️ SOPORTE SMALL' : '🛡️ SOPORTE BIG';
        const activeBox = isSmallMode ? s.casilla1 : s.casilla19;
        const activeLabel = isSmallMode ? 'CASILLA 1' : 'CASILLA 19';
        const soporteGlow = soportePausa ? '' : `box-shadow: 0 0 16px ${modeColor}33; border-color: ${modeColor}44;`;

        content = `
            <div class="ia-active-slot slot-escudo" style="${soporteGlow}">
                <div class="ia-slot-header">
                    <span class="ia-slot-name">${modeLabel} ${zoneBadgeHTML}</span>
                    <span class="ia-slot-conf" style="${soportePausa ? 'color:var(--text-dim)' : `color:${modeColor}`}">${s.confidence} CONF.</span>
                </div>

                <div class="ia-grid">
                    <div class="ia-side-box">
                        <div class="ia-side-lbl">SMALL</div>
                        <div class="ia-side-num" style="font-size:1.1rem">${s.small}<sup>n4</sup></div>
                        <div class="ia-side-theory">CASILLA 5</div>
                    </div>

                    <div class="ia-center-box active-val">
                        <div style="font-size:0.6rem; color:var(--text-dim); letter-spacing:2px; margin-bottom:4px;">${activeLabel}</div>
                        <div class="ia-main-num" style="${soportePausa ? 'color:var(--text-dim); letter-spacing:6px;' : `color:${modeColor};`}">
                            ${soportePausa ? '...' : `${activeBox}<sup>n9</sup>`}
                        </div>
                        <div class="ia-dir-lbl" style="${soportePausa ? 'color:var(--text-dim)' : ''}">
                            TENDENCIA: ${soportePausa ? 'CHARGING' : displayDirTxt}
                        </div>
                        <div class="ia-rule-pro">${s.rule}</div>
                    </div>

                    <div class="ia-side-box">
                        <div class="ia-side-lbl">BIG</div>
                        <div class="ia-side-num" style="font-size:1.1rem">${s.big}<sup>n4</sup></div>
                        <div class="ia-side-theory">CASILLA 14</div>
                    </div>
                </div>

                <div class="ia-slot-footer">
                    <div class="ia-stats-mini">W: ${iaWins[activeIaTab]} L: ${iaLosses[activeIaTab]}</div>
                    <div class="ia-reason">${s.reason}</div>
                </div>
            </div>
        `;
    } else {
        const isEscudo = s.mode === 'ESCUDO';
        const numN = isEscudo ? 'n9' : 'n4';
        
        content = `
            <div class="ia-active-slot ${isEscudo ? 'slot-escudo' : 'slot-lanza'}">
                <div class="ia-slot-header">
                    <span class="ia-slot-name">${s.name} ${zoneBadgeHTML} — ${isEscudo ? '🛡️ ESCUDO' : '⚔️ LANZA'}</span>
                    <span class="ia-slot-conf">${s.confidence} CONF.</span>
                </div>
                
                <div class="ia-grid">
                    <div class="ia-side-box">
                        <div class="ia-side-lbl">SMALL</div>
                        <div class="ia-side-num">${s.small}<sup>n4</sup></div>
                        <div class="ia-side-theory">4 FICHAS</div>
                    </div>

                    <div class="ia-center-box active-val">
                        <div class="ia-main-num" style="${isPausa ? 'color:var(--text-dim); letter-spacing:4px;' : ''}">${isPausa ? '...' : s.number + `<sup>${numN}</sup>`}</div>
                        <div class="ia-dir-lbl" style="${isPausa ? 'color:var(--text-dim)' : ''}">TENDENCIA: ${displayDirTxt}</div>
                        <div class="ia-rule-pro">${s.rule}</div>
                    </div>

                    <div class="ia-side-box">
                        <div class="ia-side-lbl">BIG</div>
                        <div class="ia-side-num">${s.big}<sup>n4</sup></div>
                        <div class="ia-side-theory">14 FICHAS</div>
                    </div>
                </div>

                <div class="ia-slot-footer">
                    <div class="ia-stats-mini">W: ${iaWins[activeIaTab]} L: ${iaLosses[activeIaTab]}</div>
                    <div class="ia-reason">${s.reason}</div>
                </div>
            </div>
        `;
    }

    topPanel.innerHTML = `
        <div class="ia-tabs-strip">${tabButtons}</div>
        ${content}
        <div class="ia-pattern-strip">${dots}</div>
    `;
}

window.setActiveIaTab = (idx) => {
    activeIaTab = idx;
    const sig = computeDealerSignature(history);
    const results = analyzeSpin(history, stats);
    const prox = projectNextRound(history, stats);
    const signals = getIAMasterSignals(prox, sig, history);
    renderSignalsPanel(signals, sig, history[history.length-1]);
};

// ── PRÓXIMA TIRADA panel ──────────────────────────────────────
function renderNextPanel(prox) {
    if (!prox || !prox.length) {
        nextPanel.innerHTML = '<p class="muted">Ingresa más números.</p>';
        return;
    }

    const sorted = [...prox].sort((a,b) => {
        const patScore = { 'hot_streak': 4, 'alternating': 3, 'neutral': 2, 'weakening': 1, 'cold': 0 };
        const scoreA = (patScore[a.targetPattern] || 0) * 1000 + a.streakWin * 100 + a.hitRate;
        const scoreB = (patScore[b.targetPattern] || 0) * 1000 + b.streakWin * 100 + b.hitRate;
        return scoreB - scoreA;
    });

    const recommended = sorted.slice(0, 3); // Top 3

    nextPanel.innerHTML = recommended.map(active => {
        const rs = active.streakWin > 0 ? `W${active.streakWin}` : active.streakLoss > 0 ? `L${active.streakLoss}` : '-';
        return `
        <div style="margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px;">
            <div class="next-row">
                <span class="tp-num" style="font-size:1rem">${active.strategy}</span>
                <span class="det-lbl">tp:</span> <span class="tp-num">${active.tp}</span>
                <span class="det-lbl">cor:</span> [${[...new Set([active.tp, ...active.cor])].join(',')}]
                <span class="rule-tag">${active.rule}</span>
                hit: <strong>${active.hitRate.toFixed(1)}%</strong>
                racha: <strong>${rs}</strong>
                ${patBadge(active.targetPattern)}
            </div>
        </div>`;
    }).join('');
}

// ── TRAVEL DATA panel ─────────────────────────────────────────
function renderTravelPanel(sig, currentSignals = null) {
    if (!sig || sig.avgTravel === null) {
        travelPanel.innerHTML = '<p class="muted">Ingresa al menos 2 números.</p>';
        return;
    }

    // LISTADO DESLIZANTE: Mostramos todo el historial para detectar patrones largos
    const fullHistory = sig.travelHistory.slice().reverse();
    const rows = fullHistory.map((t, idx) => {
        const abs = Math.abs(t);
        const dir = t > 0 ? 'DER. ↻' : t < 0 ? 'IZQ. ↺' : '-';
        const phaseClass = abs <= 9 ? 'text-green' : 'text-red';
        const num = history[history.length - 1 - idx];
        const isLast = idx === 0;
        
        return `
            <tr class="${isLast ? 'travel-row-last' : ''}">
                <td><span class="tp-num">${num}</span>${isLast ? ' <span class="travel-last-badge">★ LAST</span>' : ''}</td>
                <td><span class="${phaseClass}">${abs}p</span></td>
                <td style="font-size:0.65rem; color:var(--text-dim)">${dir}</td>
                <td><span class="badge ${abs <= 9 ? 'badge-win' : 'badge-loss'}" style="font-size:0.55rem; padding:1px 4px">${abs <= 9 ? 'SMALL' : 'BIG'}</span></td>
            </tr>
        `;
    }).join('');

    // Direction state badge (Technical terminology)
    const stateMap = {
        stable:   { cls: 'state-stable',   icon: '🟢', label: `ESTABLE — ${sig.currentTrendDir >= 0 ? 'DER. ↻' : 'IZQ. ↺'}` },
        charging: { cls: 'state-charging',  icon: '🟡', label: 'CHARGING (DATOS)' },
        zigzag:   { cls: 'state-charging',  icon: '⚡', label: 'ZIG ZAG DETECTADO' },
        debilitado: { cls: 'state-unstable', icon: '⚠️', label: 'DIR. DEBILITADA' },
        unstable: { cls: 'state-unstable',  icon: '🔴', label: 'TURBULENTO' }
    };
    const state = stateMap[sig.directionState] || stateMap.unstable;

    // Recommendation block (Matrix-Driven)
    let recHTML = '';
    
    // Last Hit Badge (for manual analysis)
    const hitZone = sig.lastHitZone || 'NONE';
    const hitZoneClass = hitZone === 'SMALL' ? 'badge-win' : (hitZone === 'BIG' ? 'badge-loss' : '');
    const lastHitBadge = hitZone !== 'NONE' ? `<div class="badge ${hitZoneClass}" style="margin-left:auto; padding:4px 12px; font-size:0.75rem; letter-spacing:1px; box-shadow:0 0 8px var(--${hitZone === 'SMALL' ? 'green' : 'red'});">LAST HIT: ${hitZone}</div>` : '';
    const lastSig = currentSignals ? currentSignals[0] : (lastIaSignals ? lastIaSignals[0] : null); // FISICA STUDIO es nuestro Agente Pro
    
    if (lastSig) {
        const isStop = lastSig.rule === 'STOP';
        
        // ── QUALITY FILTER ─────────────────────────────────────────
        // Only show recommendation when:
        // 1. Direction must be STABLE (never on charging/turbulento/zigzag)
        // 2. Zone must be definitively BIG or SMALL (not HIBRIDO/NIVELADAS)
        // 3. Agent must not be in STOP/PAUSA mode
        const dirIsStable = sig.directionState === 'stable';
        const playIsClear = sig.recommendedPlay === 'SMALL' || sig.recommendedPlay === 'BIG';
        const shouldShowRec = dirIsStable && playIsClear && !isStop;

        if (!shouldShowRec) {
            // No recommendation - leave recHTML empty (silence = discipline)
        } else {
            const isSmall = sig.recommendedPlay === 'SMALL';
            // Always use casilla5 (SMALL, +4) or casilla14 (BIG, +14) in playing direction
            const lanzaTarget = isSmall ? sig.casilla5 : sig.casilla14;
            const recClass = isSmall ? 'rec-small' : 'rec-big';
            const recRuleText = isSmall ? 'SMALL' : 'BIG';
            const dirUsed = sig.playingDir >= 0 ? 'Der. ↻' : 'Izq. ↺';
            const casillaLabel = isSmall ? 'CASILLA 5' : 'CASILLA 14';

            // Win/loss counter for zone
            const cat = isSmall ? 'N4_S' : 'N4_B';
            const w = auditStats[cat].w;
            const l = auditStats[cat].l;
            const wlHTML = `<span style="font-size:0.65rem; color:var(--text-dim); margin-left:auto;">W:${w} L:${l}</span>`;

            // Phase label (DEBILITADO → DOMINANTE)
            const phaseLabel = sig.phaseStateText && !sig.phaseStateText.includes('NIVELADAS') && !sig.phaseStateText.includes('MIDIENDO')
                ? `<div style="font-size:0.6rem; color:var(--gold); margin-bottom:4px; margin-left:8px; opacity:0.85; font-weight:700">📌 ${sig.phaseStateText}</div>`
                : '';

            recHTML = `
                ${phaseLabel}
                <div class="rec-block ${recClass} rec-lanza" style="display:flex; align-items:center; gap:8px;">
                    <span class="rec-arrow">▶</span>
                    <span class="rec-play">⚔️ JUGAR ${recRuleText}</span>
                    <span class="rec-sep">|</span>
                    <span class="rec-rule" style="font-size:0.7rem; letter-spacing:1px;">${casillaLabel}</span>
                    <span class="rec-sep">|</span>
                    <span style="font-size:0.65rem; color:var(--text); font-weight:700">${dirUsed}</span>
                    <span class="rec-sep">|</span>
                    <span class="rec-num">${lanzaTarget} <sup>N4</sup></span>
                    ${wlHTML}
                </div>
            `;
        }
    }

    travelPanel.innerHTML = `
        <div class="travel-header-row" style="display:flex; align-items:center;">
            <div class="dir-state-badge ${state.cls}">${state.icon} ${state.label}</div>
            ${lastHitBadge}
        </div>
        ${recHTML}
        <div class="travel-scroll-container">
            <table class="travel-table">
                <thead>
                    <tr>
                        <th>N°</th>
                        <th>DIST</th>
                        <th>DIR</th>
                        <th>PHASE</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

// ── Main submit ───────────────────────────────────────────────
async function submitNumber() {
    const val = numInput.value.trim();
    const n = parseInt(val, 10);
    
    if (isNaN(n) || n < 0 || n > 36) {
        statusMsg.textContent = '⚠ Número inválido (0–36)';
        statusMsg.className = 'status-msg status-error';
        numInput.value = '';
        numInput.focus();
        return;
    }
    if (!currentTableId) {
        statusMsg.textContent = '⚠ Selecciona una mesa primero.';
        statusMsg.className = 'status-msg status-error';
        return;
    }

    try {
        await apiPostSpin(currentTableId, n);
    } catch(e) {
        statusMsg.textContent = '⚠ Error al guardar en BD.';
        statusMsg.className = 'status-msg status-error';
        return;
    }

    numInput.value = '';
    numInput.focus();

    // 1. Detección de HIT (usando la firma calculada ANTES de añadir el nuevo número)
    if (history.length >= 2) {
        const prevSig = computeDealerSignature(history);
        if (prevSig && prevSig.avgTravel !== null) {
            const smallZone = [prevSig.casilla5, ...wheelNeighbors(prevSig.casilla5, 4)];
            const bigZone = [prevSig.casilla14, ...wheelNeighbors(prevSig.casilla14, 4)];
            if (smallZone.includes(n)) {
                topHitHistory.push('small');
            } else if (bigZone.includes(n)) {
                topHitHistory.push('big');
            } else {
                topHitHistory.push('miss');
            }
            if (topHitHistory.length > 12) topHitHistory.shift();
        }
    }

    // 2. Actualizar historia
    history.push(n);

    // Draw wheel with latest number highlighted
    drawWheel(n);
    renderHistory();

    // 3. Detección de HIT para SEÑALES IA (3 slots)
    lastIaSignals.forEach((s, idx) => {
        if (!s) return;
        
        // ── Step A: Check win/loss for the Dots ──
        let tpWin = false;
        if (s.betZone) {
            tpWin = new Set(s.betZone).has(n);
        } else if (s.number !== null) {
            tpWin = new Set([s.number, ...wheelNeighbors(s.number, 9)]).has(n);
        }
        
        if (tpWin) {
            iaWins[idx]++;
            iaSignalsHistory[idx].push('win');
        } else {
            iaLosses[idx]++;
            iaSignalsHistory[idx].push('loss');
        }
        if (iaSignalsHistory[idx].length > 15) iaSignalsHistory[idx].shift();

        // ── Step B: Check classification for the GOLD badge (SMALL/BIG) ──
        const isSmall = s.small !== null && new Set([s.small, ...wheelNeighbors(s.small, 4)]).has(n);
        const isBig = s.big !== null && new Set([s.big, ...wheelNeighbors(s.big, 4)]).has(n);
        
        let hitType = null;
        if (isSmall) hitType = 'SMALL';
        else if (isBig) hitType = 'BIG';
        else if (tpWin) {
            // If it hit Top Number but not the focal N4 of Small/Big, classify by proximity
            const distS = wheelDistance(n, s.small);
            const distB = wheelDistance(n, s.big);
            hitType = distS <= distB ? 'SMALL' : 'BIG';
        }
        lastIaHits[idx] = hitType;
    });

    // Actualizar Auditoría de Sesión (Protocolo Pro)
    if (lastIaSignals && lastIaSignals[0]) {
        const fisica = lastIaSignals[0];
        
        // 1. Escudo (N9) hit check
        const hitEscudo = wheelDistance(n, fisica.number) <= 9;
        if (hitEscudo) auditStats['N9'].w++;
        else auditStats['N9'].l++;
        
        // 2. Lanza (N4) hit check
        const isSmall = (fisica.lanzaTarget === fisica.small);
        const lanzaCategory = isSmall ? 'N4_S' : 'N4_B';
        const hitLanza = wheelDistance(n, fisica.lanzaTarget) <= 4;
        
        if (hitLanza) auditStats[lanzaCategory].w++;
        else auditStats[lanzaCategory].l++;
    }

    const sig = computeDealerSignature(history);

    if (history.length < 3) {
        const needed = 3 - history.length;
        statusMsg.textContent = `Faltan ${needed} número${needed > 1 ? 's' : ''} más.`;
        statusMsg.className = 'status-msg status-info';
        buildStratTabs(null);
        renderTravelPanel(sig);
        return;
    }

    statusMsg.textContent = `#${history.length}: ${n}`;
    statusMsg.className = 'status-msg status-ok';

    const results = analyzeSpin(history, stats);
    const prox    = projectNextRound(history, stats);
    
    // 5. Señales IA (basadas en resultados actuales para la SIGUIENTE tirada)
    const signals = getIAMasterSignals(prox, sig, history);
    lastIaSignals = signals || [null, null, null, null]; 

    renderTravelPanel(sig, signals);
    buildStratTabs(results);
    renderTargetPanel(results, n);
    renderNextPanel(prox);
    renderSignalsPanel(signals, sig, n);
    updateSpinCount();
}

// ── Wipe all data helper ──
function wipeData() {
    history.length = 0;
    topHitHistory.length = 0;
    iaSignalsHistory.forEach(h => h.length = 0);
    lastIaHits.fill(null);
    iaWins.fill(0);
    iaLosses.fill(0);
    Object.keys(auditStats).forEach(k => { auditStats[k].w=0; auditStats[k].l=0; });
    lastIaSignals = [null, null, null, null];
    Object.keys(stats).forEach(k => delete stats[k]);
    historyEl.innerHTML      = '';
    targetPanel.innerHTML    = '<p class="muted">Ingresa al menos 3 números para analizar.</p>';
    nextPanel.innerHTML      = '<p class="muted">Ingresa más números.</p>';
    topPanel.innerHTML       = '<p class="muted">Ingresa al menos 2 números.</p>';
    travelPanel.innerHTML    = '<p class="muted">Ingresa al menos 2 números.</p>';
    drawWheel(null);
    buildStratTabs(null);
}

// ── Database Table Sync ──
async function loadTables() {
    try {
        const tables = await apiFetchTables();
        tableSelect.innerHTML = tables.map(t => `<option value="${t.id}">${t.provider ? t.provider+' — ' : ''}${t.name} (${t.spin_count})</option>`).join('');
        if (tables.length === 0) { tableSelect.innerHTML = '<option value="">Sin mesas</option>'; return; }
        tableSelect.value = tables[0].id;
        await loadTableHistory(tables[0].id);
    } catch(e) {
        statusMsg.textContent = '⚠ Servidor apagado (node server.js)';
        statusMsg.className = 'status-msg status-error';
    }
}

async function loadTableHistory(tableId) {
    currentTableId = tableId;
    wipeData();
    try {
        const spins = await apiFetchHistory(tableId);
        const nums  = spins.map(s => s.number);
        statusMsg.textContent = `Cargando ${nums.length} tiradas...`;
        
        // Replay history
        for (const n of nums) {
            if (history.length >= 2) {
                const prevSig = computeDealerSignature(history);
                if (prevSig && prevSig.avgTravel !== null) {
                    const smallZone = [prevSig.casilla5, ...wheelNeighbors(prevSig.casilla5, 4)];
                    const bigZone = [prevSig.casilla14, ...wheelNeighbors(prevSig.casilla14, 4)];
                    if (smallZone.includes(n)) topHitHistory.push('small');
                    else if (bigZone.includes(n)) topHitHistory.push('big');
                    else topHitHistory.push('miss');
                    if (topHitHistory.length > 12) topHitHistory.shift();
                }
            }
            history.push(n);
            if (history.length >= 3) analyzeSpin(history, stats);
            // Replay IA hits logic silently here for accuracy...
            // (Omitting full IA replay to save performance on initial load, only core stats populated)
        }

        renderHistory();
        if (nums.length > 0) drawWheel(nums[nums.length-1]);
        
        if (history.length >= 3) {
            const results = analyzeSpin(history, stats);
            const prox = projectNextRound(history, stats);
            const sig = computeDealerSignature(history);
            const signals = getIAMasterSignals(prox, sig, history);
            lastIaSignals = signals || [null, null, null, null]; 
            
            buildStratTabs(results);
            renderTargetPanel(results, history[history.length-1]);
            renderNextPanel(prox);
            renderTravelPanel(sig, signals);
            renderSignalsPanel(signals, sig, history[history.length-1]);
            statusMsg.textContent = `Mesa cargada: ${history.length} tiradas.`;
            statusMsg.className = 'status-msg status-ok';
        } else {
            statusMsg.textContent = `Mesa cargada. Faltan ${3 - history.length} números.`;
            statusMsg.className = 'status-msg status-info';
        }
        updateSpinCount();
        startOcrPolling(tableId);
    } catch(e) {}
}

function updateSpinCount() {
    if (tableSelect.selectedOptions[0]) tableSpinCount.textContent = `(${history.length} registradas)`;
}

function startOcrPolling(tableId) {
    if (pollingTimer) clearInterval(pollingTimer);
    lastKnownSpinId = null;
    pollingTimer = setInterval(async () => {
        try {
            const spins = await apiFetchHistory(tableId);
            if (!spins.length) return;
            const latestId = spins[spins.length - 1].id;
            if (lastKnownSpinId === null) { lastKnownSpinId = latestId; return; }
            if (latestId !== lastKnownSpinId) {
                const newSpins = spins.filter(s => s.id > lastKnownSpinId);
                lastKnownSpinId = latestId;
                ocrBadge.style.display = 'inline-block';
                for (const spin of newSpins) {
                    if (spin.source !== 'manual') {
                        numInput.value = spin.number; // trick it
                        await submitNumber();         // simulate manual entry
                    }
                }
            }
        } catch {}
    }, 5000);
}

// ── Event listeners ───────────────────────────────────────────
submitBtn.addEventListener('click', () => submitNumber());
numInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitNumber(); });

clearBtn.addEventListener('click', () => {
    wipeData();
    statusMsg.textContent = 'Historial borrado (Local).';
    statusMsg.className = 'status-msg status-info';
});

tableSelect.addEventListener('change', () => { if (tableSelect.value) loadTableHistory(tableSelect.value); });
if(clearTableBtn) clearTableBtn.addEventListener('click', async () => {
    if (!currentTableId) return;
    if (!confirm('¿Borrar TODAS las tiradas de esta mesa en la base de datos?')) return;
    await apiClearHistory(currentTableId);
    await loadTableHistory(currentTableId);
});

if(addTableBtn) addTableBtn.addEventListener('click', () => {
    modalName.value = ''; modalProvider.value = ''; modalUrl.value = '';
    modalOverlay.style.display = 'flex';
});
if(modalCancel) modalCancel.addEventListener('click', () => modalOverlay.style.display = 'none');
if(modalSave) modalSave.addEventListener('click', async () => {
    const name = modalName.value.trim();
    if (!name) return alert('El nombre es obligatorio.');
    const table = await apiAddTable(name, modalProvider.value.trim(), modalUrl.value.trim());
    modalOverlay.style.display = 'none';
    await loadTables();
    tableSelect.value = table.id;
    await loadTableHistory(table.id);
});

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    drawWheel(null);
    buildStratTabs(null);
    numInput.focus();
    loadTables(); // Auto-load tables from DB instead of fresh start
});
