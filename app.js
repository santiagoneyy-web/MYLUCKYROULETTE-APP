// ============================================================
// app.js — UI logic for Roulette Predictor v2
// ============================================================

const history      = [];
const stats        = {};
const topHitHistory = []; // 'over' | 'under' | 'miss'
// State for 5 IA Signals (Agent 1-4 + Agent 5)
const iaSignalsHistory = [ [], [], [], [], [] ]; 
const lastIaHits = [null, null, null, null, null];
const iaWins = [0, 0, 0, 0, 0];
const iaLosses = [0, 0, 0, 0, 0];
let lastIaSignals = [null, null, null, null, null]; 
let activeIaTab    = 0; // index of active IA signal (0-4)
let latestAgent5Top = null; // Stored from API calls
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
async function apiFetchPredict(tableId) { const r = await fetch(`${API_BASE}/predict/${tableId}`); return r.json(); }

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
    // Show only last 15 balls to prevent overflow
    history.slice(-15).forEach((n, i, arr) => {
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
    try {
        if (!sig || sig.avgTravel === null || real === undefined) {
            topPanel.innerHTML = '<p class="muted">Ingresa datos...</p>';
            return;
        }

        if (!signals || !signals.length) {
            topPanel.innerHTML = '<p class="muted">Esperando señales...</p>';
            return;
        }
        // Make sure activeIaTab is within bounds
        if (activeIaTab >= signals.length) activeIaTab = 0;

        // Helper: Build Travel Recommendation HTML
        const getTravelRec = () => {
            const isStable = sig.directionState === 'stable';
            const playIsClear = sig.recommendedPlay === 'SMALL' || sig.recommendedPlay === 'BIG';
            if (!isStable || !playIsClear) return '';

            const isSmall = sig.recommendedPlay === 'SMALL';
            const lanzaTarget = isSmall ? sig.casilla5 : sig.casilla14;
            const recClass = isSmall ? 'rec-small' : 'rec-big';
            const recRuleText = isSmall ? 'SMALL' : 'BIG';
            const casillaLabel = isSmall ? 'CASILLA 5' : 'CASILLA 14';

            const cat = isSmall ? 'N4_S' : 'N4_B';
            const w = (auditStats[cat] && auditStats[cat].w) || 0;
            const l = (auditStats[cat] && auditStats[cat].l) || 0;
            const wlHTML = `<span style="font-size:0.65rem; color:var(--text-dim); margin-left:auto;">W:${w} L:${l}</span>`;

            return `
                <div class="rec-block ${recClass}" style="margin-top:10px; padding:6px 10px; border-radius:6px; font-size:0.75rem; border:1px solid rgba(255,255,255,0.05); background:rgba(0,0,0,0.2);">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="color:var(--gold); font-weight:900;">⚔️ JUGAR ${recRuleText}</span>
                        <span style="opacity:0.3">|</span>
                        <span>${casillaLabel}</span>
                        <span style="opacity:0.3">|</span>
                        <span style="font-weight:700; color:var(--gold)">${lanzaTarget}<sup>n4</sup></span>
                        ${wlHTML}
                    </div>
                </div>`;
        };

        const travelRecHTML = getTravelRec();

        // IA Tab Strip
        const tabButtons = signals.map((s, idx) => {
            const isActive = idx === activeIaTab;
            const name = s && s.name ? s.name.split(' ')[0] : 'IA';
            return `
                <button class="ia-tab ${isActive ? 'active' : ''}" onclick="setActiveIaTab(${idx})">
                    ${name}
                </button>
            `;
        }).join('');

        const s = signals[activeIaTab] || signals[0];
        if (!s) {
            topPanel.innerHTML = `<div class="ia-tabs-strip">${tabButtons}</div><p class="muted">Sin señal.</p>`;
            return;
        }

        const sName = s.name || 'IA';
        const sRule = s.rule || 'ANALIZANDO';
        const sConf = s.confidence || '0%';
        const sReason = s.reason || 'SINCRO...';
        
        // Direction label
        const dirTxt = sig.directionState === 'zigzag' ? 'ZIG-ZAG ⚡' :
                       (sig.directionState === 'stable' ? (sig.currentTrendDir >= 0 ? 'Der. ↻' : 'Izq. ↺') : 'Midiendo...');
        
        const currentHist = iaSignalsHistory[activeIaTab] || [];
        const dots = currentHist.slice(-10).map(h => {
            const hIsWin = h === 'win';
            const cls = hIsWin ? 'm-hist-w' : 'm-hist-l';
            return `<span class="m-hist-badge ${cls}">${hIsWin ? 'W' : 'L'}</span>`;
        }).join('');

        let content = '';
        const isPausa = sRule === 'STOP' || sRule.includes('PAUSA') || sConf === '0%';
        const displayDirTxt = isPausa ? 'CHARGING' : dirTxt;

        const showZoneBadge = sig.directionState === 'stable' && (sig.recommendedPlay === 'SMALL' || sig.recommendedPlay === 'BIG');
        const zoneBadgeCls = sig.recommendedPlay === 'SMALL' ? 'badge-win' : 'badge-loss';
        const zoneBadgeText = sig.recommendedPlay;
        const zoneBadgeHTML = showZoneBadge ? `<span class="badge ${zoneBadgeCls}" style="font-size:0.6rem; padding:1px 6px; margin-left:8px; border:1px solid currentColor;">PROX: ${zoneBadgeText}</span>` : '';

        if (sName === 'FISICA STUDIO') {
            const isPausaFisica = sConf === '0%' || sRule === 'STOP';
            const numColor = isPausaFisica ? 'var(--text-dim)' : 'var(--accent)';
            content = `
                <div class="ia-active-slot slot-escudo">
                    <div class="ia-slot-header"><span class="ia-slot-name">🎯 FÍSICA STUDIO ${zoneBadgeHTML}</span><span class="ia-slot-conf">${sConf} CONF.</span></div>
                    <div class="ia-grid">
                        <div class="ia-side-box"><div class="ia-side-lbl">SMALL</div><div class="ia-side-num">${s.small}<sup>n4</sup></div></div>
                        <div class="ia-center-box active-val">
                            <div class="ia-main-num" style="color:${numColor}">${isPausaFisica ? '...' : s.number + '<sup>n9</sup>'}</div>
                            <div class="ia-dir-lbl">TENDENCIA: ${isPausaFisica ? '⏸ STOP' : displayDirTxt}</div>
                        </div>
                        <div class="ia-side-box"><div class="ia-side-lbl">BIG</div><div class="ia-side-num">${s.big}<sup>n4</sup></div></div>
                    </div>
                    <div class="ia-slot-footer">
                        <div class="ia-stats-mini">W: ${iaWins[activeIaTab]} L: ${iaLosses[activeIaTab]}</div>
                        <div class="ia-reason">${sReason}</div>
                        <div class="ia-rule">${sRule}</div>
                    </div>
                    ${travelRecHTML}
                </div>
            `;
        } else if (sName === 'SIX STRATEGIE') {
            const rs = s.streakWin > 0 ? `W${s.streakWin}` : (s.streakLoss > 0 ? `L${s.streakLoss}` : '-');
            content = `
                <div class="ia-active-slot slot-math">
                    <div class="ia-slot-header">
                        <span class="ia-slot-name">${s.strategy || 'SIX'} ${zoneBadgeHTML}</span>
                        <span class="ia-slot-conf" style="${isPausa ? 'color:var(--text-dim)' : ''}">${sConf} CONF.</span>
                    </div>
                    <div class="ia-main-val" style="display:flex; flex-direction:column; align-items:center; padding:10px 0;">
                        <span class="tp-num" style="font-size:3.5rem; line-height:1; ${isPausa ? 'color:var(--text-dim);' : ''}">${isPausa ? '...' : (s.tp !== undefined ? s.tp : '...')}</span>
                        <div style="font-size:0.8rem; color:var(--text); margin-top:8px; font-weight:700;">
                            COR: <span style="font-size:0.85rem; color:var(--gold);">${isPausa ? '...' : [...new Set(s.cor || [])].filter(c=>c!==s.tp).join(', ')}</span>
                        </div>
                    </div>
                    <div class="ia-slot-footer">
                        <div>RACHA: <strong class="${s.streakWin > 0 ? 'text-green' : 'text-red'}">${rs}</strong></div>
                        <div class="ia-reason">${sReason}</div>
                        <div class="ia-rule">${sRule}</div>
                    </div>
                    ${travelRecHTML}
                </div>
            `;
        } else if (sName === 'COMBINATION') {
            const isAtaque = s.mode === 'ATAQUE_ZONA';
            const isCaos = s.mode === 'TOP_NUMBER';
            const zoneLabel = s.targetZone === 'SMALL' ? 'SMALL' : (s.targetZone === 'BIG' ? 'BIG' : '—');
            const zoneColor = s.targetZone === 'SMALL' ? 'var(--green)' : (s.targetZone === 'BIG' ? 'var(--red)' : 'var(--gold)');
            const androidGlow = (isAtaque || isCaos) ? `box-shadow:0 0 20px ${zoneColor}44; border-color:${zoneColor}66;` : '';
            let innerContent;
            if (isAtaque) {
                innerContent = `
                    <div style="font-size:0.7rem; color:var(--text-dim); letter-spacing:2px;">PREDICCIÓN HÍBRIDA</div>
                    <div style="font-size:2.8rem; font-weight:900; color:${zoneColor}; text-shadow:0 0 18px ${zoneColor}88;">${zoneLabel}</div>
                    <div style="font-size:0.75rem; color:var(--text); margin-top:6px;">TARGET N4: <span style="color:${zoneColor}; font-weight:900;">${s.number}<sup>n4</sup></span></div>`;
            } else if (isCaos) {
                innerContent = `
                    <div style="font-size:0.7rem; color:var(--gold); letter-spacing:2px;">ESCUDO ANTI-CAOS</div>
                    <div style="font-size:3.2rem; font-weight:900; color:var(--gold); line-height:1;">${s.number}<sup>n9</sup></div>
                    <div style="font-size:0.75rem; color:var(--text); margin-top:6px;">ANCLAJE TOP NUMBER</div>`;
            } else {
                innerContent = `<div style="font-size:2rem; color:var(--text-dim); opacity:0.5;">···</div><div style="font-size:0.68rem; color:var(--text-dim);">SINCRONIZANDO...</div>`;
            }
            content = `
                <div class="ia-active-slot slot-lanza" style="${androidGlow}">
                    <div class="ia-slot-header"><span class="ia-slot-name">🤖 ANDROIDE</span><span class="ia-slot-conf">${sConf} CONF.</span></div>
                    <div class="ia-main-val" style="display:flex; flex-direction:column; align-items:center; padding:12px 0;">${innerContent}</div>
                    <div class="ia-slot-footer">
                        <div class="ia-stats-mini">W: ${iaWins[activeIaTab]} L: ${iaLosses[activeIaTab]}</div>
                        <div class="ia-reason">${sReason}</div>
                        <div class="ia-rule">${sRule}</div>
                    </div>
                    ${travelRecHTML}
                </div>
            `;
        } else if (sName === 'SOPORTE PRO') {
            const isSmallMode = s.mode === 'SOPORTE_SMALL';
            const sopPausa = sConf === '0%';
            const modeColor = isSmallMode ? 'var(--green)' : 'var(--red)';
            content = `
                <div class="ia-active-slot slot-escudo">
                    <div class="ia-slot-header"><span class="ia-slot-name">${sName}</span><span class="ia-slot-conf">${sConf} CONF.</span></div>
                    <div class="ia-grid">
                        <div class="ia-side-box"><div class="ia-side-lbl">SMALL</div><div class="ia-side-num">${s.small}<sup>n4</sup></div></div>
                        <div class="ia-center-box active-val">
                            <div class="ia-main-num" style="${sopPausa ? 'color:var(--text-dim)' : `color:${modeColor}`}">${sopPausa ? '...' : s.number + '<sup>n9</sup>'}</div>
                            <div class="ia-dir-lbl">TENDENCIA: ${displayDirTxt}</div>
                        </div>
                        <div class="ia-side-box"><div class="ia-side-lbl">BIG</div><div class="ia-side-num">${s.big}<sup>n4</sup></div></div>
                    </div>
                    <div class="ia-slot-footer"><div class="ia-reason">${sReason}</div><div class="ia-rule">${sRule}</div></div>
                    ${travelRecHTML}
                </div>
            `;
        } else if (sName === 'IA AUTÓNOMA') {
            // IA Bot: Always show the number if available, regardless of confidence status
            const hasNumber = s.number !== null && s.number !== undefined;
            content = `
                <div class="ia-active-slot slot-escudo" style="border-color:var(--gold)">
                    <div class="ia-slot-header"><span class="ia-slot-name">🤖 IA AUTÓNOMA</span><span class="ia-slot-conf" style="color:var(--gold)">${sConf}</span></div>
                    <div class="ia-main-val" style="display:flex; flex-direction:column; align-items:center; padding:20px 0;">
                        <div style="font-size:0.75rem; color:var(--gold); font-weight:900; margin-bottom:10px;">ESCUDO BDD N9</div>
                        <div class="ia-main-num" style="color:var(--gold); font-size:4rem; line-height:1;">${hasNumber ? s.number : '...'}<sup style="font-size:1.2rem; opacity:0.7;">n9</sup></div>
                        ${hasNumber ? `<div style="font-size:0.65rem; color:var(--gold); opacity:0.7; margin-top:6px;">TOP POR SIMILITUD HISTÓRICA</div>` : `<div style="font-size:0.65rem; color:var(--text-dim); margin-top:6px;">BUSCANDO EN BASE DE DATOS...</div>`}
                        <div class="ia-rule-pro" style="margin-top:12px; color:var(--gold);">${sRule}</div>
                    </div>
                    <div class="ia-slot-footer"><div class="ia-reason">${sReason}</div></div>
                    ${travelRecHTML}
                </div>
            `;
        } else {
            const num = s.number !== undefined ? s.number : (s.tp !== undefined ? s.tp : '...');
            content = `
                <div class="ia-active-slot slot-escudo">
                    <div class="ia-slot-header"><span class="ia-slot-name">${sName}</span><span class="ia-slot-conf">${sConf}</span></div>
                    <div class="ia-main-val" style="display:flex; flex-direction:column; align-items:center; padding:15px 0;">
                        <div class="ia-main-num">${isPausa ? '...' : num}</div>
                        <div class="ia-rule-pro" style="margin-top:8px;">${sRule}</div>
                    </div>
                    <div class="ia-slot-footer"><div class="ia-reason">${sReason}</div></div>
                    ${travelRecHTML}
                </div>
            `;
        }

        topPanel.innerHTML = `
            <div class="ia-tabs-strip">${tabButtons}</div>
            ${content}
            <div class="ia-pattern-strip">${dots}</div>
        `;
    } catch (e) {
        console.error("Error UI render:", e);
        topPanel.innerHTML = `<div style="color:var(--red); font-size:0.7rem; padding:10px;">⚠ Error UI: ${e.message}</div>`;
    }
}

window.setActiveIaTab = (idx) => {
    activeIaTab = idx;
    const sig = computeDealerSignature(history);
    const results = analyzeSpin(history, stats);
    const prox = projectNextRound(history, stats);
    const signals = getIAMasterSignals(prox, sig, history) || [];
    
    // Always push Agent 5 to ensure slot visibility
    signals.push({
        name: 'IA AUTÓNOMA',
        number: latestAgent5Top,
        small: null,
        big: null,
        confidence: latestAgent5Top !== null ? "MAX%" : "0%",
        reason: latestAgent5Top !== null ? "SIMILITUD HISTÓRICA BDD" : "SINCRONIZANDO BDD...",
        rule: latestAgent5Top !== null ? "ESTADÍSTICA PURA N9" : "CARGANDO...",
        mode: 'ESCUDO'
    });

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

    // Compute state label safely here (avoids undefined `state` bug)
    let stateLabel = '—', stateIcon = '●', stateCls = '';
    if (sig.directionState === 'stable') { stateLabel = 'ESTABLE'; stateIcon = '▶'; stateCls = 'state-stable'; }
    else if (sig.directionState === 'zigzag') { stateLabel = 'ZIG-ZAG'; stateIcon = '⚡'; stateCls = 'state-zigzag'; }
    else if (sig.directionState === 'debilitado') { stateLabel = 'DEBILITADO'; stateIcon = '⬇'; stateCls = 'state-weak'; }
    else { stateLabel = 'MIDIENDO'; stateIcon = '⌛'; stateCls = ''; }

    // Show last 100 rows (scrollable panel)
    const MAX_ROWS = 100;
    const limitedHistory = sig.travelHistory.slice(-MAX_ROWS).reverse();
    const rows = limitedHistory.map((t, idx) => {
        const abs = Math.abs(t);
        const dir = t > 0 ? 'DER. ↻' : t < 0 ? 'IZQ. ↺' : '-';
        const phaseClass = abs <= 9 ? 'text-green' : 'text-red';
        const histIdx = history.length - 1 - idx;
        const num = histIdx >= 0 ? history[histIdx] : '?';
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

    const hitZone = sig.lastHitZone || 'NONE';
    const hitZoneClass = hitZone === 'SMALL' ? 'badge-win' : (hitZone === 'BIG' ? 'badge-loss' : '');
    const lastHitBadge = hitZone !== 'NONE' ? `<div class="badge ${hitZoneClass}" style="margin-left:auto; padding:4px 10px; font-size:0.7rem; letter-spacing:1px;">LAST: ${hitZone}</div>` : '';
    
    travelPanel.innerHTML = `
        <div class="travel-header-row" style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <div class="dir-state-badge ${stateCls}" style="font-size:0.7rem; padding:3px 8px;">${stateIcon} ${stateLabel}</div>
            ${lastHitBadge}
        </div>
        <div class="travel-scroll-container">
            <table class="travel-table">
                <thead><tr><th>N°</th><th>DIST</th><th>DIR</th><th>PHASE</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

// ── Main submit ───────────────────────────────────────────────
async function submitNumber(nOverride = null, skipApi = false) {
    const val = nOverride !== null ? String(nOverride) : numInput.value.trim();
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

    if (!skipApi) {
        try {
            const spinResult = await apiPostSpin(currentTableId, n);
            latestAgent5Top = (spinResult && spinResult.predictions) ? spinResult.predictions.agent5_top : null;
        } catch(e) {
            statusMsg.textContent = '⚠ Error al guardar en BD.';
            statusMsg.className = 'status-msg status-error';
            return;
        }
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
    const signals = getIAMasterSignals(prox, sig, history) || [];
    
    // Inject Agent 5 (Backend AI)
    signals.push({
        name: 'IA AUTÓNOMA',
        number: latestAgent5Top,
        small: null,
        big: null,
        confidence: latestAgent5Top !== null ? "MAX%" : "0%",
        reason: latestAgent5Top !== null ? "SIMILITUD HISTÓRICA BDD" : "SINCRONIZANDO BDD...",
        rule: latestAgent5Top !== null ? "ESTADÍSTICA PURA N9" : "CARGANDO...",
        mode: 'ESCUDO'
    });
    
    lastIaSignals = signals.length ? signals : [null, null, null, null, null];

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
    lastIaSignals = [null, null, null, null, null];
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
        
        let initialPred = { agent5_top: null };
        if (spins.length >= 3) {
            initialPred = await apiFetchPredict(tableId);
        }
        latestAgent5Top = initialPred.agent5_top;
        
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
            const signals = getIAMasterSignals(prox, sig, history) || [];
            
            // Always push Agent 5 to ensure slot visibility
            signals.push({
                name: 'IA AUTÓNOMA',
                number: latestAgent5Top,
                small: null,
                big: null,
                confidence: latestAgent5Top !== null ? "MAX%" : "0%",
                reason: latestAgent5Top !== null ? "SIMILITUD HISTÓRICA BDD" : "SINCRONIZANDO BDD...",
                rule: latestAgent5Top !== null ? "ESTADÍSTICA PURA N9" : "CARGANDO...",
                mode: 'ESCUDO'
            });
            
            lastIaSignals = signals.length ? signals : [null, null, null, null, null]; 
            
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
        startAutoPolling(tableId);
    } catch(e) {}
}

function updateSpinCount() {
    if (tableSelect.selectedOptions[0]) tableSpinCount.textContent = `(${history.length} registradas)`;
}

function startAutoPolling(tableId) {
    if (pollingTimer) clearInterval(pollingTimer);
    lastKnownSpinId = null;
    pollingTimer = setInterval(async () => {
        try {
            const spins = await apiFetchHistory(tableId);
            if (!spins.length) return;
            
            const lastSpinObj = spins[spins.length - 1];
            const latestId = lastSpinObj.id;
            if (lastKnownSpinId === null) { lastKnownSpinId = latestId; return; }
            if (latestId !== lastKnownSpinId) {
                const newSpins = spins.filter(s => s.id > lastKnownSpinId);
                lastKnownSpinId = latestId;
                const autoBadge = document.getElementById('ocr-badge'); // Reuse for now
                if (autoBadge) autoBadge.style.display = 'inline-block';
                for (const spin of newSpins) {
                    await submitNumber(spin.number, true);
                }
                
                // Fetch fresh prediction after adding new spins
                if (history.length >= 3) {
                    const freshPred = await apiFetchPredict(tableId);
                    latestAgent5Top = freshPred.agent5_top;
                    
                    // Render UI with latest Agent 5 data natively
                    const prox = projectNextRound(history, stats);
                    const sig = computeDealerSignature(history);
                    const signals = getIAMasterSignals(prox, sig, history) || [];
                    signals.push({
                        name: 'IA AUTÓNOMA',
                        number: latestAgent5Top,
                        small: null,
                        big: null,
                        confidence: latestAgent5Top !== null ? "MAX%" : "0%",
                        reason: latestAgent5Top !== null ? "SIMILITUD HISTÓRICA BDD" : "SINCRONIZANDO BDD...",
                        rule: latestAgent5Top !== null ? "ESTADÍSTICA PURA N9" : "CARGANDO...",
                        mode: 'ESCUDO'
                    });
                    renderSignalsPanel(signals, sig, history[history.length-1]);
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
