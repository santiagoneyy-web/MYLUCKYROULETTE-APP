// ============================================================
// server.js — Roulette Predictor API (Neural V5)
// Optimización: Build sin Chromium para Render (10/04/2026)
// ============================================================
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const db      = require('./database');
const Spin    = require('./models/Spin'); // MongoDB Model
const mongoose = require('mongoose');
const TrackerBankrollSession = require('./models/TrackerBankrollSession');
const TrackerBankrollEntry = require('./models/TrackerBankrollEntry');
const TrackerAnalystSnapshot = require('./models/TrackerAnalystSnapshot');
const TrackerPredictionAudit = require('./models/TrackerPredictionAudit');
const trackerBankroll = require('./src/engine/tracker_bankroll');
const predictor = require('./src/engine/predictor'); // Agents 1-4
const { WHEEL_ORDER, WHEEL_INDEX } = predictor;
const agent5  = require('./src/engine/agent5');      // Autonomous AI & Physics
const axios   = require('axios');
const strategyStore = require('./src/engine/strategy_store');
const { evaluatePredictionContexts } = require('./src/engine/evaluation_engine');
const {
    buildMetricSnapshot,
    buildTableStateSnapshot,
    chooseDominancePrediction,
    evaluatePredictionHit,
    wheelNeighbors
} = require('./src/engine/analytics_snapshot');

const forest = require('./src/engine/forest_engine');

const spinMethod = require('./src/engine/spin_method');
const brain = require('./src/engine/brain');

const NTFY_TOPIC = process.env.NTFY_TOPIC || 'ofi_santi_alerts';
const ntfyCooldowns = {}; // { tableId: remaining_spins_before_next_alert }
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';
const AUTO_AI_REMOTE_ANALYSIS = String(process.env.AUTO_AI_REMOTE_ANALYSIS ?? 'true').toLowerCase() !== 'false';
const GROQ_MODEL = process.env.GROQ_MODEL || process.env.AUTO_AI_GROQ_MODEL || 'openai/gpt-oss-120b';

const GROQ_MODELS = {
    'llama-3.1-8b-instant': { label: 'Llama 3.1 8B (Rapido)', reasoning: 'bajo', speed: 'muy rapido', tokens: 131072 },
    'openai/gpt-oss-120b': { label: 'GPT OSS 120B (Razonamiento)', reasoning: 'maximo', speed: 'rapido', tokens: 128000 },
    'openai/gpt-oss-20b': { label: 'GPT OSS 20B (Rapido)', reasoning: 'medio', speed: 'muy rapido', tokens: 128000 },
    'qwen/qwen3.6-27b': { label: 'Qwen 3.6 27B (Balance)', reasoning: 'alto', speed: 'rapido', tokens: 128000 },
    'meta-llama/llama-4-maverick-17b-128e-instruct': { label: 'Llama 4 Maverick 17B (Rapido)', reasoning: 'medio', speed: 'muy rapido', tokens: 131072 },
    'moonshotai/kimi-k2-instruct-0905': { label: 'Kimi K2 (Contexto)', reasoning: 'alto', speed: 'moderado', tokens: 131072 }
};

function getGroqModels() {
    return Object.entries(GROQ_MODELS).map(([id, info]) => ({
        id,
        label: info.label,
        reasoning: info.reasoning,
        speed: info.speed,
        selected: id === GROQ_MODEL
    }));
}
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
let llmRateLimitedUntil = 0;
let lastLlmRateLimit = null;
const llmUsage = {
    total: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    minute: { key: '', requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    day: { key: '', requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    last: null,
    limits: {}
};

const app = express();

// START
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve static frontend from the same folder
app.use(express.static(path.join(__dirname)));

const databaseReady = db.initDB();
strategyStore.ensureStore();
let crawlerStarted = false;

function startCrawlerIfEnabled() {
    if (crawlerStarted || String(process.env.DISABLE_BOTS || '').toLowerCase() === 'true') return;
    try {
        console.log('[BOOT] Starting automatic casino.org crawler...');
        require('./start-bots.js')(PORT);
        crawlerStarted = true;
    } catch (error) {
        console.error('[BOOT] Failed to start crawler:', error.message);
    }
}

app.get('/api/db/status', (req, res) => {
    const status = db.getConnectionStatus();
    if (status.connected) startCrawlerIfEnabled();
    res.status(status.connected ? 200 : 503).json(status);
});

app.post('/api/db/reconnect', async (req, res) => {
    const status = await db.reconnect();
    if (status.connected) startCrawlerIfEnabled();
    res.status(status.connected ? 200 : 503).json(status);
});

app.use('/api', (req, res, next) => {
    if (req.path === '/db/status' || req.path === '/db/reconnect') return next();
    if (!db.getUseMongo()) {
        return res.status(503).json({
            error: 'MongoDB Atlas está desconectado. Los datos y análisis están pausados.',
            code: 'MONGODB_DISCONNECTED'
        });
    }
    next();
});

// ---- API: Tables ----
app.get('/api/tables', (req, res) => {
    db.getTables((err, tables) => {
        if (err || !tables || tables.length === 0) {
            return res.status(503).json({ error: 'No se pudieron cargar las mesas desde MongoDB Atlas.' });
        }
        res.json(tables);
    });
});

app.post('/api/tables', (req, res) => {
    const { name, provider, url } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    db.addTable(name, provider || '', url || '', (err, id) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id, name, provider, url });
    });
});

app.delete('/api/tables/:id', (req, res) => {
    db.deleteTable(req.params.id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ---- API: Spins / History ----
app.get('/api/history/:tableId', (req, res) => {
    const tableId = req.params.tableId;
    const limit = req.query.limit ? parseInt(req.query.limit) : 400; // Updated limit to 400 to match OFI
    console.log(`[GET] History for table ${tableId} (limit: ${limit})`);
    db.getHistory(tableId, limit, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        console.log(`[DB] Found ${rows.length} rows for table ${tableId}`);
        res.json(rows);
    });
});

app.get('/api/metrics/:tableId', (req, res) => {
    const tableId = req.params.tableId;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
    db.getMetricSnapshots(tableId, limit, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.get('/api/table-state/:tableId', (req, res) => {
    const tableId = req.params.tableId;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
    db.getTableStateSnapshots(tableId, limit, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.get('/api/ai/predictions/:tableId', (req, res) => {
    const tableId = req.params.tableId;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
    const mode = req.query.mode ? String(req.query.mode).toUpperCase() : null;
    const basis = req.query.basis ? String(req.query.basis) : null;
    db.getAiPredictions(tableId, limit, { mode, basis }, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.get('/api/ai/status', (req, res) => {
    res.json({
        provider: getPreferredLlmProvider(),
        deepseekConfigured: Boolean(DEEPSEEK_API_KEY),
        deepseekModel: DEEPSEEK_MODEL,
        ollamaConfigured: hasOllamaConfigured(),
        ollamaBaseUrl: OLLAMA_BASE_URL,
        ollamaModel: OLLAMA_MODEL,
        groqConfigured: Boolean(process.env.GROQ_API_KEY),
        autoAiRemoteAnalysis: AUTO_AI_REMOTE_ANALYSIS,
        ...getLlmUsageStatus()
    });
});

app.get('/api/ai/summary/:tableId', (req, res) => {
    db.getAiLearningSummary(req.params.tableId, (err, summary) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(summary || {});
    });
});

app.get('/api/evaluation/:tableId', (req, res) => {
    const tableId = req.params.tableId;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 500;

    db.getAiPredictions(tableId, limit, (predErr, predictions) => {
        if (predErr) return res.status(500).json({ error: predErr.message });

        db.getTableStateSnapshots(tableId, limit, (stateErr, states) => {
            if (stateErr) return res.status(500).json({ error: stateErr.message });

            const evaluation = evaluatePredictionContexts(predictions || [], states || []);
            res.json(evaluation);
        });
    });
});

app.post('/api/evaluation/:tableId/promote-candidates', (req, res) => {
    const tableId = req.params.tableId;
    const limit = req.body?.limit ? parseInt(req.body.limit, 10) : 500;

    db.getAiPredictions(tableId, limit, (predErr, predictions) => {
        if (predErr) return res.status(500).json({ error: predErr.message });

        db.getTableStateSnapshots(tableId, limit, (stateErr, states) => {
            if (stateErr) return res.status(500).json({ error: stateErr.message });

            const evaluation = evaluatePredictionContexts(predictions || [], states || []);
            const saved = [];
            const failed = [];

            const candidates = evaluation.candidates || [];
            if (!candidates.length) {
                return res.json({ saved: 0, failed: 0, strategies: [] });
            }

            let pending = candidates.length;
            candidates.forEach(candidate => {
                db.saveStrategyRecord({
                    ...candidate,
                    table_id: String(tableId),
                    table_code: 'AUTO'
                }, (err, record) => {
                    if (err) failed.push({ name: candidate.name, error: err.message });
                    else saved.push(record);
                    pending--;
                    if (pending === 0) {
                        res.json({
                            saved: saved.length,
                            failed: failed.length,
                            strategies: saved,
                            errors: failed
                        });
                    }
                });
            });
        });
    });
});

// ── SSE: broadcast to all clients listening per table ──────
const sseClients = {}; // { tableId: [res, res, ...] }

// SSE Heartbeat para evitar desconexiones de Render por inactividad (>60s)
setInterval(() => {
    Object.keys(sseClients).forEach(tableId => {
        sseClients[tableId].forEach(client => {
            try { client.write('data: {"type":"ping"}\n\n'); } catch (e) {}
        });
    });
}, 25000);

app.get('/api/events/:tableId', (req, res) => {
    const tableId = req.params.tableId;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering on Render
    res.flushHeaders();
    // Keep connection alive
    res.write('data: {"type":"connected"}\n\n');
    if (!sseClients[tableId]) sseClients[tableId] = [];
    sseClients[tableId].push(res);
    req.on('close', () => {
        sseClients[tableId] = (sseClients[tableId] || []).filter(c => c !== res);
    });
});

app.get('/api/patterns/:tableId', async (req, res) => {
    const { tableId } = req.params;
    const { seq_mag, seq_dir } = req.query; // 'BSBS', 'CWCCWCW'
    
    try {
        const isMongo = db.getUseMongo();
        if (!isMongo) return res.json({ error: 'MongoDB not enabled', mag: {}, dir: {} });
        
        let magStats = [];
        let dirStats = [];

        if (seq_mag) {
            magStats = await Pattern.aggregate([
                { $match: { table_id: String(tableId), sequence_mag: seq_mag } },
                { $group: { _id: "$next_mag", count: { $sum: 1 } } }
            ]);
        }
        
        if (seq_dir) {
            dirStats = await Pattern.aggregate([
                { $match: { table_id: String(tableId), sequence_dir: seq_dir } },
                { $group: { _id: "$next_dir", count: { $sum: 1 } } }
            ]);
        }
        
        res.json({
            mag: magStats.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}),
            dir: dirStats.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {})
        });
    } catch(e) {
        res.status(500).json({ error: e.message, mag: {}, dir: {} });
    }
});

// ── Meta-Pattern Endpoints ──
app.post('/api/meta-patterns/:tableId', async (req, res) => {
    const { tableId } = req.params;
    const data = req.body;
    
    try {
        const result = await db.saveMetaPattern(tableId, data);
        res.json({ success: true, id: result?._id || null });
    } catch(e) {
        res.status(500).json({ error: e.message, success: false });
    }
});

app.patch('/api/meta-patterns/:patternId/result', async (req, res) => {
    const { patternId } = req.params;
    const { result, accurate } = req.body;
    
    try {
        await db.updateMetaPatternResult(patternId, result, accurate);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: e.message, success: false });
    }
});

app.get('/api/meta-patterns/:tableId/stats', async (req, res) => {
    const { tableId } = req.params;
    const { type, limit } = req.query;
    
    try {
        const stats = await db.getMetaPatternStats(tableId, type, parseInt(limit) || 100);
        res.json(stats);
    } catch(e) {
        res.status(500).json({ error: e.message, total: 0, accurate: 0, accuracy: 0, patterns: [] });
    }
});

app.get('/api/meta-patterns/:tableId/unresolved', async (req, res) => {
    const { tableId } = req.params;
    
    try {
        const patterns = await db.getUnresolvedMetaPatterns(tableId);
        res.json(patterns);
    } catch(e) {
        res.status(500).json({ error: e.message, patterns: [] });
    }
});

// ── Direction Patterns (Patrones de direcciones R/L) ──
app.post('/api/direction-patterns/:tableId', async (req, res) => {
    const { tableId } = req.params;
    const data = req.body;
    
    try {
        const result = await db.saveDirectionPattern(tableId, data);
        res.json({ success: true, id: result?._id || null });
    } catch(e) {
        res.status(500).json({ error: e.message, success: false });
    }
});

app.get('/api/direction-patterns/:tableId/find', async (req, res) => {
    const { tableId } = req.params;
    const { sequence } = req.query;
    
    try {
        const patterns = await db.findDirectionPatterns(tableId, sequence);
        res.json(patterns);
    } catch(e) {
        res.status(500).json({ error: e.message, patterns: [] });
    }
});

app.get('/api/direction-patterns/:tableId/stats', async (req, res) => {
    const { tableId } = req.params;
    const { sequence } = req.query;
    
    try {
        const stats = await db.getDirectionPatternStats(tableId, sequence);
        res.json(stats);
    } catch(e) {
        res.status(500).json({ error: e.message, total: 0, next_r: 0, next_l: 0, next_b: 0, next_s: 0 });
    }
});

// ── Memoria local para el chat del usuario (Temporal por reinicio)
const aiMemory = {};

function cleanAutoNumber(value) {
    return String(value ?? '').replace(/[^0-9]/g, '');
}

function formatAutoReply(n9, n4) {
    return `N9: ${n9} | N4: ${n4}`;
}

function hasOllamaConfigured() {
    return Boolean(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL || process.env.OLLAMA_ENABLED === 'true');
}

function getPreferredLlmProvider() {
    const explicit = String(process.env.LLM_PROVIDER || '').toLowerCase();
    if (explicit === 'deepseek' && DEEPSEEK_API_KEY) return 'deepseek';
    if (explicit === 'groq' && process.env.GROQ_API_KEY) return 'groq';
    if (explicit === 'ollama' && hasOllamaConfigured()) return 'ollama';
    if (DEEPSEEK_API_KEY) return 'deepseek';
    if (process.env.GROQ_API_KEY) return 'groq';
    if (hasOllamaConfigured()) return 'ollama';
    return 'none';
}

function isLlmRateLimited() {
    return Date.now() < llmRateLimitedUntil;
}

function markLlmRateLimit(error) {
    const status = error?.response?.status;
    if (status !== 429) return false;
    const retryAfter = Number(error?.response?.headers?.['retry-after']);
    const cooldownMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 5 * 60 * 1000;
    llmRateLimitedUntil = Date.now() + cooldownMs;
    lastLlmRateLimit = {
        at: new Date().toISOString(),
        status,
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
        until: new Date(llmRateLimitedUntil).toISOString(),
        provider: getPreferredLlmProvider()
    };
    return true;
}

function emptyUsageBucket(key) {
    return { key, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function addUsageToBucket(bucket, usage) {
    bucket.requests += 1;
    bucket.promptTokens += usage.promptTokens;
    bucket.completionTokens += usage.completionTokens;
    bucket.totalTokens += usage.totalTokens;
}

function extractRateLimitHeaders(headers = {}) {
    const pick = (name) => headers[name] || headers[name.toLowerCase()] || null;
    return {
        limitRequests: pick('x-ratelimit-limit-requests'),
        remainingRequests: pick('x-ratelimit-remaining-requests'),
        resetRequests: pick('x-ratelimit-reset-requests'),
        limitTokens: pick('x-ratelimit-limit-tokens'),
        remainingTokens: pick('x-ratelimit-remaining-tokens'),
        resetTokens: pick('x-ratelimit-reset-tokens')
    };
}

function recordLlmUsage(provider, usage = {}, headers = {}) {
    const normalized = {
        promptTokens: Number(usage.prompt_tokens || usage.promptTokens || 0),
        completionTokens: Number(usage.completion_tokens || usage.completionTokens || 0),
        totalTokens: Number(usage.total_tokens || usage.totalTokens || 0)
    };
    if (!normalized.totalTokens) {
        normalized.totalTokens = normalized.promptTokens + normalized.completionTokens;
    }

    const now = new Date();
    const minuteKey = now.toISOString().slice(0, 16);
    const dayKey = now.toISOString().slice(0, 10);
    if (llmUsage.minute.key !== minuteKey) llmUsage.minute = emptyUsageBucket(minuteKey);
    if (llmUsage.day.key !== dayKey) llmUsage.day = emptyUsageBucket(dayKey);

    addUsageToBucket(llmUsage.total, normalized);
    addUsageToBucket(llmUsage.minute, normalized);
    addUsageToBucket(llmUsage.day, normalized);
    llmUsage.limits = extractRateLimitHeaders(headers);
    llmUsage.last = {
        at: now.toISOString(),
        provider,
        ...normalized,
        model: GROQ_MODEL
    };
}

function getLlmUsageStatus() {
    return {
        usage: llmUsage,
        rateLimited: isLlmRateLimited(),
        rateLimitedUntil: isLlmRateLimited() ? new Date(llmRateLimitedUntil).toISOString() : null,
        lastRateLimit: lastLlmRateLimit
    };
}

async function callGroqChat({ systemPrompt, userPrompt, temperature = 0.3, maxTokens = 180, jsonMode = false }) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) throw new Error('GROQ_API_KEY missing');

    const model = process.env.GROQ_MODEL || GROQ_MODEL;
    const isReasoningModel = model.includes('gpt-oss') || model.includes('deepseek-r1');
    const requestBody = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature,
        max_tokens: maxTokens
    };
    if (isReasoningModel) requestBody.reasoning_effort = 'medium';

    // Note: json_object response_format only supported by some Groq models (not 8b-instant).
    // JSON output is enforced via system prompt instead.

    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', requestBody, {
        timeout: isReasoningModel ? 45000 : 20000,
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' }
    });

    const msg = response.data?.choices?.[0]?.message || {};
    return {
        content: String(msg.content || '').trim(),
        reasoning: msg.reasoning ? String(msg.reasoning).trim() : null,
        usage: response.data?.usage || {},
        headers: response.headers || {}
    };
}

async function callDeepSeekChat({ systemPrompt, userPrompt, temperature = 0.3, maxTokens = 180, jsonMode = false }) {
    if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY missing');

    const requestBody = {
        model: DEEPSEEK_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature,
        max_tokens: maxTokens
    };

    if (jsonMode) {
        requestBody.response_format = { type: 'json_object' };
    }

    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', requestBody, {
        timeout: 30000,
        headers: {
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    return {
        content: String(response.data?.choices?.[0]?.message?.content || '').trim(),
        usage: response.data?.usage || {},
        headers: response.headers || {}
    };
}

async function callOllamaChat({ systemPrompt, userPrompt, temperature = 0.3, maxTokens = 180, jsonMode = false }) {
    const payload = {
        model: OLLAMA_MODEL,
        stream: false,
        format: jsonMode ? 'json' : undefined,
        options: {
            temperature,
            num_predict: maxTokens
        },
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    };

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, payload, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
    });

    return {
        content: String(response.data?.message?.content || '').trim(),
        usage: {
            promptTokens: response.data?.prompt_eval_count || 0,
            completionTokens: response.data?.eval_count || 0,
            totalTokens: (response.data?.prompt_eval_count || 0) + (response.data?.eval_count || 0)
        },
        headers: response.headers || {}
    };
}

async function callPreferredLlm(options) {
    const provider = getPreferredLlmProvider();
    if (provider === 'deepseek') {
        try {
            const result = await callDeepSeekChat(options);
            recordLlmUsage(provider, result.usage, result.headers);
            return { provider, content: result.content, usage: result.usage };
        } catch (error) {
            if (process.env.GROQ_API_KEY) {
                const result = await callGroqChat(options);
                recordLlmUsage('groq-fallback', result.usage, result.headers);
                return { provider: 'groq-fallback', content: result.content, usage: result.usage };
            }
            throw error;
        }
    }
    if (provider === 'ollama') {
        try {
            const result = await callOllamaChat(options);
            recordLlmUsage(provider, result.usage, result.headers);
            return { provider, content: result.content, usage: result.usage };
        } catch (error) {
            if (!process.env.GROQ_API_KEY) throw error;
            const result = await callGroqChat(options);
            recordLlmUsage('groq-fallback', result.usage, result.headers);
            return { provider: 'groq-fallback', content: result.content, usage: result.usage };
        }
    }
    if (provider === 'groq') {
        const result = await callGroqChat(options);
        recordLlmUsage(provider, result.usage, result.headers);
        return { provider, content: result.content, usage: result.usage };
    }
    throw new Error('No LLM provider configured');
}

function detectWlPattern(sequence) {
    const s = String(sequence || '').replace(/[^WL]/g, '');
    if (!s) return 'sin historial';
    if (/WLWL$/.test(s) || /LWLW$/.test(s)) return 'zigzag/rodillo';
    if (/WWLL$/.test(s) || /LLWW$/.test(s)) return 'ola 2-2';
    if (/WWWLL$/.test(s) || /LLWWW$/.test(s)) return 'bambu/bloque';
    if (/WLLWLL$/.test(s) || /LLWLL$/.test(s)) return 'trampa';
    if (/WWL$/.test(s)) return 'doble victoria';
    if (/WWWL$/.test(s)) return 'racha 3W antes de L';
    if (/WWWWL$/.test(s)) return 'pico';
    if (/WWW$/.test(s) || /LLLL$/.test(s)) return 'racha/bloque';
    return 'patron mixto';
}

function summarizePatternContext(context, routeKey) {
    const perf = context.performance8 || {};
    const n9Seq = routeKey === 'cw' ? perf.cwN9 : perf.ccwN9;
    const n4Seq = routeKey === 'cw' ? perf.cwN4 : perf.ccwN4;
    return `Patron ${detectWlPattern(n9Seq)} en N9 y ${detectWlPattern(n4Seq)} en N4`;
}

function extractAutoPatternName(rawAnalysis, context, routeKey) {
    const source = `${rawAnalysis || ''} ${summarizePatternContext(context, routeKey)}`.toLowerCase();
    if (source.includes('rodillo') || source.includes('zigzag')) return 'rodillo';
    if (source.includes('ola')) return 'ola';
    if (source.includes('bambu')) return 'bambu';
    if (source.includes('trampa')) return 'trampa';
    if (source.includes('pico')) return 'pico';
    if (source.includes('farol')) return 'farol';
    if (source.includes('turbulencia')) return 'turbulencia';
    if (source.includes('bloque') || String(context?.stabilityLevel || '').toLowerCase() === 'green') return 'bloques';
    if (source.includes('racha')) return 'racha';
    if (source.includes('mixto')) return 'mixto';
    return 'flujo mixto';
}

function buildHumanAutoAiAnalysis(context, decision = {}, rawAnalysis = '') {
    if (!context || !context.routes || !context.routes.cw || !context.routes.ccw) {
        return 'Sin contexto suficiente para explicar la jugada.';
    }

    const route = String(decision.route || '').toUpperCase();
    const zone = String(decision.zone || '').toUpperCase();
    const mode = String(context.mode || 'SAFE').toUpperCase();
    const stability = String(context.stabilityLevel || 'red').toLowerCase();
    const dom8 = context.dominance8 || {};
    const mom15 = context.momentum15 || {};
    const cw = context.routes.cw || {};
    const ccw = context.routes.ccw || {};
    const scoreCW = (Number(cw.hitRate) || 0) + ((Number(mom15.cw) || 0) * 4) + ((Number(dom8.cw) || 0) * 2);
    const scoreCCW = (Number(ccw.hitRate) || 0) + ((Number(mom15.ccw) || 0) * 4) + ((Number(dom8.ccw) || 0) * 2);
    const zoneBigScore = ((Number(mom15.big) || 0) * 4) + ((Number(dom8.big) || 0) * 2);
    const zoneSmallScore = ((Number(mom15.small) || 0) * 4) + ((Number(dom8.small) || 0) * 2);
    const routeGap = Math.abs(scoreCW - scoreCCW);
    const zoneGap = Math.abs(zoneBigScore - zoneSmallScore);
    const routeKey = route === 'CCW' ? 'ccw' : 'cw';
    const patternName = extractAutoPatternName(rawAnalysis, context, routeKey);
    const routeText = route === 'CCW' ? 'ruta izquierda (CCW)' : 'ruta derecha (CW)';
    const zoneText = zone === 'BIG' ? 'zona amplia (10-18)' : 'zona corta (1-9)';
    const stabilityText = {
        green: 'mesa estable por bloques',
        yellow: 'mesa en transicion',
        red: 'mesa sensible o trabada'
    }[stability] || 'mesa en lectura';
    const routeEdgeText = routeGap >= 12 ? 'ventaja clara en ruta' : routeGap >= 6 ? 'ventaja moderada en ruta' : 'ventaja corta en ruta';
    const zoneEdgeText = zoneGap >= 10 ? 'zona bien definida' : zoneGap >= 5 ? 'zona algo definida' : 'zona todavia mezclada';

    if (decision.n9 === 'ESPERAR' || decision.n4 === 'ESPERAR' || route === 'ESPERAR' || zone === 'ESPERAR') {
        return `${mode} no entra: ${stabilityText}. El patron actual parece ${patternName} y la ventaja entre CW/CCW o BIG/SMALL todavia no alcanza para disparar.`;
    }

    return `${mode} entra por ${routeText} y ${zoneText}. Ve patron ${patternName}, ${stabilityText}, ${routeEdgeText} y ${zoneEdgeText}.`;
}

function isLiveDuplicateSpin(currentHistory, payload) {
    const history = Array.isArray(currentHistory) ? currentHistory : [];
    if (history.length === 0) return false;

    const eventId = String(payload?.event_id || '').trim();
    const roundKey = String(payload?.round_key || '').trim();
    const source = String(payload?.source || '').trim();
    const number = Number(payload?.number);
    const lastSpin = history[history.length - 1];

    if (eventId && history.some(spin => String(spin.event_id || '') === eventId)) return true;
    if (roundKey && history.some(spin => String(spin.round_key || '') === roundKey)) return true;
    if (!eventId && !roundKey && ['public_scraper', 'casino_org_live'].includes(source) && Number.isInteger(number) && lastSpin && Number(lastSpin.number) === number) {
        return true;
    }

    return false;
}

function buildStrategyDigest(tableId) {
    return strategyStore.buildPromptDigest({ tableId: tableId || 'global', limit: 12 });
}

function compactDigest(text, maxChars = 500) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > maxChars ? clean.slice(0, maxChars) + '...' : clean;
}

function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 4);
}

function getLearningSummaryAsync(tableId) {
    return new Promise(resolve => {
        db.getAiLearningSummary(tableId || 0, (err, summary) => {
            if (err) {
                console.error('[AI Learning] Summary error:', err.message);
                return resolve(null);
            }
            resolve(summary || null);
        });
    });
}

function buildLearningDigest(summary, mode = 'FULL') {
    if (!summary || !summary.aiPredictions) {
        return 'Memoria RL: sin muestra suficiente todavia.';
    }

    const all = summary.aiPredictions || {};
    const byMode = summary.aiPredictionsByMode || {};
    const scoped = byMode[String(mode || 'FULL').toUpperCase()] || null;
    const source = scoped && Number(scoped.total || 0) > 0 ? scoped : all;
    const total = Number(source.total || 0);
    const wins = Number(source.wins || 0);
    const losses = Number(source.losses || 0);
    const skips = Number(source.skips || 0);
    const pending = Number(source.pending || 0);
    const reward = Number(source.reward || 0);
    const n9Rate = Number((scoped && scoped.n9Rate) || 0);
    const n4Rate = Number((scoped && scoped.n4Rate) || 0);

    if (!total) return 'Memoria RL: sin predicciones resueltas para este modo.';

    return [
        `Memoria RL ${String(mode || 'FULL').toUpperCase()}: total=${total}, W=${wins}, L=${losses}, skip=${skips}, pending=${pending}.`,
        `Reward acumulado=${reward}. N9 hit=${n9Rate}%, N4 hit=${n4Rate}%.`,
        'Premios/castigos: N4 +100, N9 +30, esperar +15, fallo total -200.'
    ].join(' ');
}

function buildAutoAiContextSnapshot(context, strategyDigest, learningDigest) {
    if (!context) return {};
    return {
        mode: String(context.mode || 'SAFE').toUpperCase(),
        stabilityLevel: context.stabilityLevel || '',
        patternLabel: context.patternLabel || '',
        dominance8: context.dominance8 || {},
        momentum15: context.momentum15 || {},
        sequence15: context.sequence15 || {},
        performance8: context.performance8 || {},
        routes: context.routes || {},
        recentNumbers: Array.isArray(context.recentNumbers) ? context.recentNumbers.slice(-15) : [],
        strategyDigest: String(strategyDigest || '').slice(0, 2000),
        learningDigest: String(learningDigest || '').slice(0, 1000)
    };
}

function wheelDistance(from, to) {
    const i1 = predictor.WHEEL_INDEX[Number(from)];
    const i2 = predictor.WHEEL_INDEX[Number(to)];
    if (i1 === undefined || i2 === undefined) return 0;
    let d = i2 - i1;
    if (d > 18) d -= 37;
    if (d < -18) d += 37;
    return d;
}

function buildSequenceContext(history) {
    const dir = [];
    const zone = [];
    const sample = Array.isArray(history) ? history.slice(-16) : [];
    for (let i = 1; i < sample.length; i++) {
        const d = wheelDistance(sample[i - 1], sample[i]);
        dir.push(d >= 0 ? 'DER' : 'IZQ');
        zone.push(Math.abs(d) >= 10 ? 'BIG' : 'SMALL');
    }
    return { dir: dir.join(' '), zone: zone.join(' ') };
}

function snapshotToAutoAiContext(snapshot, mode, clientContext = null) {
    if (!snapshot || !snapshot.routes || !snapshot.routes.cw || !snapshot.routes.ccw) return clientContext;
    const recentNumbers = Array.isArray(snapshot.recent_numbers) ? snapshot.recent_numbers : [];
    const hasClientMetrics = clientContext && clientContext.dominance8 && clientContext.routes && clientContext.routes.cw;
    return {
        ...(clientContext || {}),
        mode: String(mode || clientContext?.mode || 'SAFE').toUpperCase(),
        tableCode: snapshot.table_code || 'AUTO',
        spinId: snapshot.spin_id ?? clientContext?.spinId ?? null,
        windowSize: snapshot.window_size || Math.max(0, recentNumbers.length - 1),
        stabilityLevel: hasClientMetrics ? (clientContext.stabilityLevel || snapshot.stability_level || 'red') : (snapshot.stability_level || clientContext?.stabilityLevel || 'red'),
        patternLabel: hasClientMetrics ? (clientContext.patternLabel || snapshot.pattern_label || 'Estandar') : (snapshot.pattern_label || clientContext?.patternLabel || 'Estandar'),
        dominantAxis: hasClientMetrics ? (clientContext.dominantAxis || snapshot.dominant_axis || 'none') : (snapshot.dominant_axis || clientContext?.dominantAxis || 'none'),
        dominantSignal: hasClientMetrics ? (clientContext.dominantSignal || snapshot.dominant_signal || '') : (snapshot.dominant_signal || clientContext?.dominantSignal || ''),
        dominanceScore: Number(hasClientMetrics ? (clientContext.dominanceScore || snapshot.dominance_score || 0) : (snapshot.dominance_score || clientContext?.dominanceScore || 0)),
        dominance8: hasClientMetrics ? (clientContext.dominance8 || snapshot.dominance8 || {}) : (snapshot.dominance8 || clientContext?.dominance8 || {}),
        momentum15: hasClientMetrics ? (clientContext.momentum15 || snapshot.momentum15 || {}) : (snapshot.momentum15 || clientContext?.momentum15 || {}),
        sequence15: hasClientMetrics && clientContext.sequence15?.dir ? clientContext.sequence15 : buildSequenceContext(recentNumbers),
        performance8: hasClientMetrics ? (clientContext.performance8 || snapshot.performance8 || {}) : (snapshot.performance8 || clientContext?.performance8 || {}),
        routes: hasClientMetrics && clientContext.routes?.cw?.n9 != null ? clientContext.routes : snapshot.routes,
        recentNumbers: hasClientMetrics ? (clientContext.recentNumbers || recentNumbers) : recentNumbers,
        context: {
            source: 'server_mongo_context',
            notes: hasClientMetrics ? 'Client metrics preserved (frontend calculation)' : 'Auto AI context rebuilt from saved spins/metric snapshot before prediction.'
        }
    };
}

async function buildServerAutoAiContext(tableId, clientContext = null) {
    const mode = String(clientContext?.mode || 'SAFE').toUpperCase();
    const rows = await new Promise(resolve => {
        db.getHistory(tableId || 0, 100, (err, historyRows) => {
            if (err || !Array.isArray(historyRows)) return resolve([]);
            resolve(historyRows);
        });
    });
    const history = rows
        .map(row => Number(row.number))
        .filter(n => Number.isInteger(n) && n >= 0 && n <= 36);

    if (history.length < 2) return clientContext;
    const latestSpin = rows[rows.length - 1] || {};
    const snapshot = buildMetricSnapshot({
        tableId,
        tableCode: 'AUTO',
        spinId: latestSpin.id ?? clientContext?.spinId ?? null,
        history,
        mode: 'AUTO_AI_SERVER_CONTEXT'
    });
    return snapshotToAutoAiContext(snapshot, mode, clientContext);
}

function persistAutoAiStrategy(parsed, context, tableId) {
    const name = String(parsed?.strategy_name || parsed?.strategyName || '').trim();
    const note = String(parsed?.strategy_note || parsed?.strategyNote || '').trim();
    if (!name || !note || !context) return null;

    const route = String(parsed?.route || parsed?.direccion || '').toUpperCase();
    const zone = String(parsed?.zone || parsed?.zona || '').toUpperCase();
    const tags = [
        'auto-ai',
        String(context.mode || '').toLowerCase(),
        String(context.stabilityLevel || '').toLowerCase(),
        String(context.patternLabel || '').toLowerCase(),
        route.toLowerCase(),
        zone.toLowerCase()
    ].filter(Boolean);

    return strategyStore.saveStrategy({
        source: 'ai',
        origin: 'auto_ai',
        tableId: tableId || 'global',
        name,
        summary: note,
        pattern: context.patternLabel || '',
        trigger: `stability=${context.stabilityLevel || 'na'} route=${route || 'na'} zone=${zone || 'na'}`,
        action: `Aplicar sobre las 6 medidas activas usando ${route || 'ruta'} y ${zone || 'zona'}.`,
        tags
    });
}

function persistMetricSnapshot(context, tableId) {
    if (!context) return;
    db.addMetricSnapshot({
        table_id: Number(tableId) || 0,
        table_code: context.tableCode || 'AUTO',
        spin_id: context.spinId ?? null,
        window_size: context.windowSize || 15,
        recent_numbers: Array.isArray(context.recentNumbers) ? context.recentNumbers : [],
        stability_level: context.stabilityLevel || 'red',
        pattern_label: context.patternLabel || '',
        dominant_axis: context.dominantAxis || 'none',
        dominant_signal: context.dominantSignal || '',
        dominance_score: Number(context.dominanceScore || 0),
        dominance8: context.dominance8 || {},
        momentum15: context.momentum15 || {},
        performance8: context.performance8 || {},
        routes: context.routes || {},
        context: context.context || { source: 'auto_ai_context', notes: '' },
        captured_at: new Date().toISOString()
    }, () => {});
}

function persistIngestMetricSnapshot(tableId, spinId, history, mode = 'INGEST') {
    try {
        const snapshot = buildMetricSnapshot({
            tableId,
            tableCode: 'AUTO',
            spinId,
            history,
            mode
        });

        db.addMetricSnapshot(snapshot, (err) => {
            if (err) console.error('[MetricSnapshot] Save error:', err.message);
        });
        return snapshot;
    } catch (err) {
        console.error('[MetricSnapshot] Build error:', err.message);
        return null;
    }
}

function persistTableStateSnapshot(tableId, spinId, metricSnapshot) {
    try {
        const stateSnapshot = buildTableStateSnapshot({
            metricSnapshot,
            tableId,
            tableCode: 'AUTO',
            spinId
        });
        if (!stateSnapshot) return null;

        db.addTableStateSnapshot(stateSnapshot, (err) => {
            if (err) console.error('[TableStateSnapshot] Save error:', err.message);
        });
        return stateSnapshot;
    } catch (err) {
        console.error('[TableStateSnapshot] Build error:', err.message);
        return null;
    }
}

function resolvePendingAiPredictions(tableId, resolvedNumber) {
    db.resolvePendingAiPredictions(tableId, resolvedNumber, evaluatePredictionHit, (err, info) => {
        if (err) return console.error('[AiPrediction] Resolve error:', err.message);
        if (info?.resolved) console.log(`[AiPrediction] Resolved ${info.resolved} pending prediction(s).`);
    });
}

function persistDominanceAiPrediction(tableId, spinId, snapshot) {
    const prediction = chooseDominancePrediction(snapshot, spinId);
    if (!prediction) return;

    db.addAiPrediction(prediction, (err) => {
        if (err) return console.error('[AiPrediction] Save error:', err.message);
        console.log(`[AiPrediction] Next ${prediction.route}/${prediction.zone} N9=${prediction.n9} N4=${prediction.n4} (${prediction.result})`);
    });
}

function normalizeAiRoute(value, n9, context) {
    const raw = String(value || '').trim().toUpperCase();
    if (raw === 'CW' || raw === 'DER' || raw === 'DERECHA' || raw === 'RIGHT') return 'CW';
    if (raw === 'CCW' || raw === 'IZQ' || raw === 'IZQUIERDA' || raw === 'LEFT') return 'CCW';
    if (raw === 'SMALL' || raw === 'S' || raw === 'MISMA') return 'SMALL';
    if (raw === 'BIG' || raw === 'B' || raw === 'OPUESTA') return 'BIG';
    const routes = context?.routes || {};
    if (n9 !== 'ESPERAR') {
        if (String(routes.cw?.n9) === String(n9)) return 'CW';
        if (String(routes.ccw?.n9) === String(n9)) return 'CCW';
        if (String(routes.small?.n9) === String(n9)) return 'SMALL';
        if (String(routes.big?.n9) === String(n9)) return 'BIG';
    }
    return 'ESPERAR';
}

function normalizeAiZone(value, route, n4, context) {
    const raw = String(value || '').trim().toUpperCase();
    if (raw === 'SMALL' || raw === 'CORTA' || raw === 'SHORT') return 'SMALL';
    if (raw === 'BIG' || raw === 'AMPLIA' || raw === 'LARGA' || raw === 'LONG') return 'BIG';
    const routes = context?.routes || {};
    if (n4 !== 'ESPERAR') {
        if (route === 'CW' && String(routes.cw?.n4Small) === String(n4)) return 'SMALL';
        if (route === 'CW' && String(routes.cw?.n4Big) === String(n4)) return 'BIG';
        if (route === 'CCW' && String(routes.ccw?.n4Small) === String(n4)) return 'SMALL';
        if (route === 'CCW' && String(routes.ccw?.n4Big) === String(n4)) return 'BIG';
    }
    return 'ESPERAR';
}

function buildAiUnavailableDecision(reason) {
    const analysis = reason === 'rate_limit'
        ? 'IA externa limitada por 429. No se fuerza lectura sin auditor; queda en espera.'
        : 'IA externa no disponible. No se fuerza lectura sin auditor; queda en espera.';
    return {
        reply: formatAutoReply('ESPERAR', 'ESPERAR'),
        route: 'ESPERAR',
        zone: 'ESPERAR',
        analysis,
        provider: reason === 'rate_limit' ? 'llm-rate-limit' : 'llm-unavailable'
    };
}

function persistAiPredictionRecord(tableId, context, normalizedReply, parsed, meta = {}) {
    if (!context || !normalizedReply) return;

    const normalized = typeof normalizedReply === 'object'
        ? normalizedReply
        : { reply: String(normalizedReply || '') };
    const parts = String(normalized.reply || '').split('|');
    const n9 = parts[0] ? parts[0].replace('N9:', '').trim() : 'ESPERAR';
    const n4 = parts[1] ? parts[1].replace('N4:', '').trim() : 'ESPERAR';
    const mode = String(context.mode || 'SAFE').toUpperCase();
    const recentKey = Array.isArray(context.recentNumbers) ? context.recentNumbers.slice(-15).join('-') : '';
    const contextHash = ['AI', mode, recentKey, n9, n4].join('|');
    const route = normalizeAiRoute(normalized.route || parsed?.route || parsed?.direccion, n9, context);
    const zone = normalizeAiZone(normalized.zone || parsed?.zone || parsed?.zona, route, n4, context);

    db.addAiPrediction({
        table_id: Number(tableId) || 0,
        basis: 'ai_analysis',
        dominance_priority: false,
        mode,
        route,
        zone,
        n9,
        n4,
        analysis: String(normalized.analysis || parsed?.analysis || parsed?.reason || '').trim(),
        strategy_refs: parsed?.strategy_name ? [String(parsed.strategy_name)] : [],
        context_snapshot: buildAutoAiContextSnapshot(context, meta.strategyDigest, meta.learningDigest),
        decision_source: meta.provider || normalized.provider || 'auto_ai',
        prompt_version: 'auto_ai_v3_connected_rl',
        context_hash: contextHash,
        result: n9 === 'ESPERAR' || n4 === 'ESPERAR' ? 'skip' : 'pending',
        n9_result: n9 === 'ESPERAR' ? 'skip' : 'pending',
        n4_result: n4 === 'ESPERAR' ? 'skip' : 'pending',
        created_at: new Date().toISOString()
    }, (err) => {
        if (err) console.error('[AiPrediction] Auto AI save error:', err.message);
    });
}

function parseChatStrategyCommand(text, tableId) {
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();
    const prefixes = ['/estrategia', 'guardar estrategia:', 'guardar estrategia '];
    const prefix = prefixes.find(item => lower.startsWith(item));
    if (!prefix) return null;

    let body = raw.slice(prefix.length).trim();
    if (!body) return { error: 'Formato sugerido: /estrategia Nombre | resumen | trigger=... | action=... | tags=a,b' };

    const parts = body.split('|').map(part => String(part || '').trim()).filter(Boolean);
    if (parts.length < 2) {
        return { error: 'Te falta informacion. Usa: /estrategia Nombre | resumen | trigger=... | action=... | tags=a,b' };
    }

    const data = {
        source: 'human',
        origin: 'chat_command',
        tableId: tableId || 'global',
        name: parts[0],
        summary: parts[1]
    };

    for (const part of parts.slice(2)) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim().toLowerCase();
        const value = part.slice(idx + 1).trim();
        if (!value) continue;
        if (key === 'trigger') data.trigger = value;
        if (key === 'action') data.action = value;
        if (key === 'pattern') data.pattern = value;
        if (key === 'tags') data.tags = value.split(',').map(tag => tag.trim()).filter(Boolean);
    }

    return { data };
}

function buildAutoAiFallback(context) {
    const brainState = brain.loadBrain();
    const t = brainState.thresholds;

    if (!context || !context.routes || !context.routes.cw || !context.routes.ccw) {
        return {
            n9: 'ESPERAR',
            n4: 'ESPERAR',
            route: 'ESPERAR',
            zone: 'ESPERAR',
            analysis: 'Sin medidas matematicas activas para analizar.'
        };
    }

    const dom8 = context.dominance8 || {};
    const mom15 = context.momentum15 || {};
    const cw = context.routes.cw;
    const ccw = context.routes.ccw;

    const scoreCW = (Number(cw.hitRate) || 0) + ((Number(mom15.cw) || 0) * 4) + ((Number(dom8.cw) || 0) * 2);
    const scoreCCW = (Number(ccw.hitRate) || 0) + ((Number(mom15.ccw) || 0) * 4) + ((Number(dom8.ccw) || 0) * 2);
    const zoneBigScore = ((Number(mom15.big) || 0) * 4) + ((Number(dom8.big) || 0) * 2);
    const zoneSmallScore = ((Number(mom15.small) || 0) * 4) + ((Number(dom8.small) || 0) * 2);

    const routeKey = scoreCW >= scoreCCW ? 'cw' : 'ccw';
    const zoneKey = zoneBigScore > zoneSmallScore ? 'big' : 'small';
    const route = context.routes[routeKey];
    const routeLabel = routeKey.toUpperCase();
    const zoneLabel = zoneKey.toUpperCase();
    const stability = String(context.stabilityLevel || 'red').toLowerCase();
    const safeMode = String(context.mode || 'SAFE').toUpperCase() === 'SAFE';
    const patternText = summarizePatternContext(context, routeKey);
    const dominantRoute = routeKey === 'cw' ? 'CW' : 'CCW';
    const routeGap = Math.abs(scoreCW - scoreCCW);
    const zoneGap = Math.abs(zoneBigScore - zoneSmallScore);
    const strongestHitRate = Math.max(Number(cw.hitRate) || 0, Number(ccw.hitRate) || 0);
    const directionalPressure = Math.max(Number(dom8.cw) || 0, Number(dom8.ccw) || 0) + Math.max(Number(mom15.cw) || 0, Number(mom15.ccw) || 0);
    const zonePressure = Math.max(Number(dom8.big) || 0, Number(dom8.small) || 0) + Math.max(Number(mom15.big) || 0, Number(mom15.small) || 0);
    const patternLower = String(context.patternLabel || '').toLowerCase();
    const unstablePattern = ['mixta', 'mixto', 'transicion', 'turbulencia', 'inest'].some(tag => patternLower.includes(tag));

    if (safeMode && (
        routeGap < t.minRouteDiff ||
        strongestHitRate < t.minHitRate ||
        directionalPressure < t.minRouteDiff ||
        brainState.streakState.protected
    )) {
        return {
            n9: 'ESPERAR',
            n4: 'ESPERAR',
            route: 'ESPERAR',
            zone: 'ESPERAR',
            analysis: buildHumanAutoAiAnalysis(context, {
                route: 'ESPERAR',
                zone: 'ESPERAR',
                n9: 'ESPERAR',
                n4: 'ESPERAR'
            }, patternText)
        };
    }

    const decision = {
        route: routeKey.toUpperCase(),
        zone: zoneLabel,
        n9: String(route.n9),
        n4: zoneKey === 'big' ? String(route.n4Big) : String(route.n4Small)
    };

    return {
        n9: decision.n9,
        n4: decision.n4,
        route: decision.route,
        zone: decision.zone,
        analysis: buildHumanAutoAiAnalysis(
            context,
            decision,
            `${patternText}. Dom ${dominantRoute} con zona ${zoneLabel}. Brecha ruta ${routeGap}, brecha zona ${zoneGap}. Mesa ${stability.toUpperCase()}.`
        )
    };
}

function buildAutoAiPromptLines(context, strategyDigest, learningDigest = '', mode = 'SAFE') {
    const dom8 = context.dominance8 || {};
    const mom15 = context.momentum15 || {};
    const perf8 = context.performance8 || {};
    const cw = context.routes.cw;
    const ccw = context.routes.ccw;
    const safeMode = String(mode || context.mode || 'SAFE').toUpperCase() === 'SAFE';

    return [
        safeMode ? 'MODO SAFE: audita; si no hay ventaja clara responde ESPERAR.' : 'MODO FULL: elige la mejor lectura relativa entre las 6 medidas.',
        `ESTABILIDAD=${String(context.stabilityLevel || 'red').toUpperCase()} PATRON=${context.patternLabel || 'Sin patron'}`,
        `DOM8 CW=${dom8.cw || 0} CCW=${dom8.ccw || 0} BIG=${dom8.big || 0} SMALL=${dom8.small || 0}`,
        `MOM15 CW=${mom15.cw || 0} CCW=${mom15.ccw || 0} BIG=${mom15.big || 0} SMALL=${mom15.small || 0}`,
        `WL CW_N9=${perf8.cwN9 || '-'} CW_N4=${perf8.cwN4 || '-'} CCW_N9=${perf8.ccwN9 || '-'} CCW_N4=${perf8.ccwN4 || '-'}`,
        `DIR15=${context.sequence15?.dir || '-'} ZON15=${context.sequence15?.zone || '-'}`,
        `MEDIDAS: CW_N9=${cw?.n9} CW_N4S=${cw?.n4Small} CW_N4B=${cw?.n4Big} CCW_N9=${ccw?.n9} CCW_N4S=${ccw?.n4Small} CCW_N4B=${ccw?.n4Big}`,
        `NUMS=${(context.recentNumbers || []).slice(-12).join(',') || '-'}`,
        `MEM=${compactDigest(learningDigest || 'sin memoria', 280)}`,
        `ESTR=${compactDigest(strategyDigest || 'sin estrategias', 260)}`,
        `MEM=${compactDigest(learningDigest || 'sin memoria', 280)}`,
        `ESTR=${compactDigest(strategyDigest || 'sin estrategias', 260)}`,
        'Reglas: SMALL=1-9, BIG=10-18. No inventes numeros. Patrones W/L: racha, alternancia, ola, bambu, pico, trampa, bloque, turbulencia, farol, mixto.',
        'REGLA DIRECCION: Si N9 es CW/CCW, N4 debe ser de esa misma direccion. Si N9 es SMALL, N4 debe ser un Small-N4 (izq o der). Si N9 es BIG, N4 debe ser un Big-N4 (izq o der).',
        safeMode ? 'Bloquea por contradiccion, fatiga, mezcla o W/L peligroso.' : 'Prioriza dominancia viva, momentum, W/L e hit rate; si hay mezcla elige la opcion menos mala.',
        'JSON exacto: {"route":"CW|CCW|SMALL|BIG|ESPERAR","zone":"SMALL|BIG|ESPERAR","n9":"numero o ESPERAR","n4":"numero o ESPERAR","analysis":"max 25 palabras","strategy_name":"opcional","strategy_note":"opcional"}.'
    ];
}

function buildSafeAutoAiUserPrompt(context, strategyDigest, learningDigest = '') {
    return buildAutoAiPromptLines(context, strategyDigest, learningDigest, 'SAFE').join('\n');
}

function buildFullAutoAiUserPrompt(context, strategyDigest, learningDigest = '') {
    return buildAutoAiPromptLines(context, strategyDigest, learningDigest, 'FULL').join('\n');
}

function buildRawAutoAiUserPrompt(context) {
    if (!context || !context.routes || !context.routes.cw || !context.routes.ccw) {
        return 'RAW: sin contexto suficiente.';
    }
    const dom8 = context.dominance8 || {};
    const mom15 = context.momentum15 || {};
    const perf8 = context.performance8 || {};
    const cw = context.routes.cw;
    const ccw = context.routes.ccw;
    const strategyText = String(context.strategyDigest || buildStrategyDigest('global') || '').slice(0, 800);
    return [
        'MODO RAW: trabajas con las metricas actuales + estrategias disenadas por el usuario.',
        'Tienes acceso a las estrategias guardadas pero NO a la memoria RL ni al historial de aprendizaje.',
        'Las estrategias del usuario son reglas que debes considerar en tu decision.',
        `ESTRATEGIAS:\n${strategyText || '(sin estrategias guardadas)'}`,
        `DOM8 CW=${dom8.cw || 0} CCW=${dom8.ccw || 0} BIG=${dom8.big || 0} SMALL=${dom8.small || 0}`,
        `MOM15 CW=${mom15.cw || 0} CCW=${mom15.ccw || 0} BIG=${mom15.big || 0} SMALL=${mom15.small || 0}`,
        `WL CW_N9=${perf8.cwN9 || '-'} CW_N4=${perf8.cwN4 || '-'} CCW_N9=${perf8.ccwN9 || '-'} CCW_N4=${perf8.ccwN4 || '-'}`,
        `DIR15=${context.sequence15?.dir || '-'}`,
        `CW n9=${cw.n9} n4S=${cw.n4Small} n4B=${cw.n4Big}`,
        `CCW n9=${ccw.n9} n4S=${ccw.n4Small} n4B=${ccw.n4Big}`,
        `NUMS=${(context.recentNumbers || []).slice(-12).join(',') || '-'}`,
        'Elige el mejor entre CW/CCW basado en DOM8+MOM15+WL+ESTRATEGIAS. Responde JSON.',
        'Si la diferencia entre rutas es < 3 y el hit rate < 40%, responde ESPERAR.',
        'Aplica las estrategias del usuario: continuidad en bloques, zigzag en turbulencia, etc.',
        'JSON: {"route":"CW|CCW|ESPERAR","zone":"SMALL|BIG|ESPERAR","n9":"numero","n4":"numero","analysis":"max 20 palabras"}'
    ].join('\n');
}

function buildAutoAiUserPrompt(context, strategyDigest, learningDigest = '') {
    const mode = String(context?.mode || 'SAFE').toUpperCase();
    if (mode === 'RAW') return buildRawAutoAiUserPrompt(context);
    return mode === 'SAFE'
        ? buildSafeAutoAiUserPrompt(context, strategyDigest, learningDigest)
        : buildFullAutoAiUserPrompt(context, strategyDigest, learningDigest);
}

function normalizeAutoAiResponse(parsed, context, fallback) {
    const cw = context.routes.cw;
    const ccw = context.routes.ccw;
    const small = context.routes.small || {};
    const big = context.routes.big || {};
    const isRouletteNumber = (v) => String(v).match(/^\d+$/) && parseInt(v) >= 0 && parseInt(v) <= 36;
    const allowedN9 = [
        String(cw.n9), String(ccw.n9)
    ].filter(v => v && v !== 'undefined' && v !== 'null');
    const allowedN4 = [
        String(cw.n4Small), String(cw.n4Big),
        String(ccw.n4Small), String(ccw.n4Big)
    ].filter(v => v && v !== 'undefined' && v !== 'null');

    let route = normalizeAiRoute(parsed.route || parsed.direccion || '', cleanAutoNumber(parsed.n9), context);
    let zone = String(parsed.zone || parsed.zona || '').toUpperCase();
    let n9 = cleanAutoNumber(parsed.n9);
    let n4 = cleanAutoNumber(parsed.n4);
    const rawAnalysis = String(parsed.analysis || parsed.reason || fallback.analysis || '').trim();

    if (!allowedN9.includes(n9)) {
        if (route === 'CW') n9 = String(cw.n9);
        else if (route === 'CCW') n9 = String(ccw.n9);
        else if (route === 'SMALL') n9 = String(small.n9 || fallback.n9);
        else if (route === 'BIG') n9 = String(big.n9 || fallback.n9);
        else n9 = fallback.n9;
    }

    if (!allowedN4.includes(n4)) {
        if (zone === 'SMALL') {
            n4 = (route === 'CCW') ? String(ccw.n4Small) : String(cw.n4Small);
        } else if (zone === 'BIG') {
            n4 = (route === 'CCW') ? String(ccw.n4Big) : String(cw.n4Big);
        } else if (route === 'CW') {
            n4 = String(cw.n4Small);
        } else if (route === 'CCW') {
            n4 = String(ccw.n4Small);
        } else {
            n4 = fallback.n4;
        }
    }

    // Force direction consistency: N4 must match route direction
    if (route === 'CW') {
        const cwN4s = [String(cw.n4Small), String(cw.n4Big)];
        if (!cwN4s.includes(n4)) {
            n4 = (zone === 'BIG') ? String(cw.n4Big) : String(cw.n4Small);
        }
    } else if (route === 'CCW') {
        const ccwN4s = [String(ccw.n4Small), String(ccw.n4Big)];
        if (!ccwN4s.includes(n4)) {
            n4 = (zone === 'BIG') ? String(ccw.n4Big) : String(ccw.n4Small);
        }
    } else if (route === 'SMALL') {
        const smallN4s = [String(cw.n4Small), String(ccw.n4Small)];
        if (!smallN4s.includes(n4)) {
            n4 = smallN4s.includes(String(cw.n4Small)) ? String(cw.n4Small) : String(ccw.n4Small);
        }
    } else if (route === 'BIG') {
        const bigN4s = [String(cw.n4Big), String(ccw.n4Big)];
        if (!bigN4s.includes(n4)) {
            n4 = bigN4s.includes(String(cw.n4Big)) ? String(cw.n4Big) : String(ccw.n4Big);
        }
    }

    // VALIDACIÓN BRUTAL: Si N9 o N4 no están en las 6 métricas del DIR, 
    // RECHAZAMOS la respuesta de la IA y usamos el fallback local
    const n9Valido = allowedN9.includes(n9);
    const n4Valido = allowedN4.includes(n4) || n4 === 'ESPERAR';
    
    if (!n9Valido || !n4Valido) {
        console.warn(`[AI] RECHAZADA: N9=${n9} (válido:${n9Valido}), N4=${n4} (válido:${n4Valido}). Usando fallback local.`);
        console.warn(`[AI] Métricas permitidas N9: [${allowedN9.join(', ')}]`);
        console.warn(`[AI] Métricas permitidas N4: [${allowedN4.join(', ')}]`);
        // Retornar el fallback directamente, ignorando todo lo que hizo la IA
        return {
            reply: formatAutoReply(fallback.n9, fallback.n4),
            route: fallback.route,
            zone: fallback.zone,
            analysis: `[FALLBACK] ${fallback.analysis}`,
            provider: 'local-fallback-brutal'
        };
    }

    if (!route || route === 'ESPERAR') {
        if (n9 === String(cw.n9)) route = 'CW';
        else if (n9 === String(ccw.n9)) route = 'CCW';
        else if (n9 === String(small.n9)) route = 'SMALL';
        else if (n9 === String(big.n9)) route = 'BIG';
    }
    if (!zone || zone === 'ESPERAR') {
        if (route === 'CW' && n4 === String(cw.n4Small)) zone = 'SMALL';
        else if (route === 'CW' && n4 === String(cw.n4Big)) zone = 'BIG';
        else if (route === 'CCW' && n4 === String(ccw.n4Small)) zone = 'SMALL';
        else if (route === 'CCW' && n4 === String(ccw.n4Big)) zone = 'BIG';
        else if (route === 'SMALL') zone = 'SMALL';
        else if (route === 'BIG') zone = 'BIG';
    }

    if (n9 === 'ESPERAR') {
        return {
            reply: formatAutoReply('ESPERAR', 'ESPERAR'),
            route: 'ESPERAR',
            zone: 'ESPERAR',
            analysis: buildHumanAutoAiAnalysis(
                context,
                { route: 'ESPERAR', zone: 'ESPERAR', n9: 'ESPERAR', n4: 'ESPERAR' },
                rawAnalysis || fallback.analysis
            )
        };
    }

    return {
        reply: formatAutoReply(n9, n4 || 'ESPERAR'),
        route,
        zone,
        analysis: buildHumanAutoAiAnalysis(context, { route, zone, n9, n4: n4 || 'ESPERAR' }, rawAnalysis || fallback.analysis)
    };
}

// ─── AI COLLABORATION ENDPOINTS (V5 GEMINI) ────────────────────────

// ---------------------------------------------------
// Groq LLM endpoint (Llama 4 via Groq API)
// ---------------------------------------------------
app.post('/api/ai/groq', async (req, res) => {
    const { prompt, autoAiContext: clientAutoAiContext, tableId } = req.body;
    try {
        const autoAiContext = clientAutoAiContext
            ? await buildServerAutoAiContext(tableId || 0, clientAutoAiContext)
            : null;
        const fallback = buildAutoAiFallback(autoAiContext);
        const groqKey = process.env.GROQ_API_KEY;
        const autoMode = String(autoAiContext?.mode || 'SAFE').toUpperCase();
        const strategyDigest = buildStrategyDigest(tableId || 'global');
        const learningSummary = (autoAiContext && autoMode !== 'RAW') ? await getLearningSummaryAsync(tableId || 0) : null;
        const learningDigest = (autoAiContext && autoMode !== 'RAW') ? buildLearningDigest(learningSummary, autoMode) : '';
        const brainDigest = (autoAiContext && autoMode !== 'RAW') ? brain.buildBrainDigest(autoAiContext) : '';
        const combinedDigest = [brainDigest, learningDigest].filter(Boolean).join('\n') || 'sin datos de aprendizaje';
        const predictionMeta = { strategyDigest, learningDigest: combinedDigest, provider: 'llm-pending' };
        if (autoAiContext && !AUTO_AI_REMOTE_ANALYSIS) {
            const localDecision = {
                reply: formatAutoReply(fallback.n9, fallback.n4),
                route: fallback.route,
                zone: fallback.zone,
                analysis: fallback.analysis,
                provider: 'local-dominance'
            };
            persistAiPredictionRecord(tableId || 0, autoAiContext, localDecision, fallback, { ...predictionMeta, provider: 'local-dominance' });
            return res.json(localDecision);
        }
        if (!groqKey && !hasOllamaConfigured() && !DEEPSEEK_API_KEY) {
            const unavailableDecision = buildAiUnavailableDecision('unavailable');
            persistAiPredictionRecord(tableId || 0, autoAiContext, unavailableDecision, unavailableDecision, { ...predictionMeta, provider: unavailableDecision.provider });
            return res.json(unavailableDecision);
        }
        if (autoAiContext && isLlmRateLimited()) {
            const unavailableDecision = buildAiUnavailableDecision('rate_limit');
            return res.json({
                ...unavailableDecision,
                rateLimited: true,
                model: GROQ_MODEL,
                estimatedPromptTokens: 0,
                rateLimitedUntil: new Date(llmRateLimitedUntil).toISOString()
            });
        }

        const userPrompt = autoAiContext ? buildAutoAiUserPrompt({ ...autoAiContext, strategyDigest }, strategyDigest, combinedDigest) : prompt;
        
        let systemPrompt;
        if (autoAiContext) {
            if (autoMode === 'SAFE') {
                systemPrompt = [
                    'Eres AUDITOR SAFE de ROULETTE-CLASSIC. Tu unico trabajo es decidir SI conviene entrar o esperar.',
                    'Responde solo JSON valido. No inventes numeros fuera de las metricas dadas.',
                    'Analiza estabilidad, dominancia, momentum, brechas ruta/zona, patron W/L, fatiga, faroles.',
                    'REGLAS DEL AUDITOR:',
                    '- Si la mesa esta VERDE (bloque estable): puedes entrar con confianza.',
                    '- Si esta AMARILLA (transicion): entra solo si la brecha entre rutas >= 5 y la brecha entre zonas >= 3.',
                    '- Si esta ROJA (caos/mixta): responde ESPERAR en n9 y n4.',
                    '- Si hay fatiga (3+ L seguidos en la ruta dominante): responde ESPERAR.',
                    '- Si hay farol activo: responde ESPERAR.',
                    '- Si las seniales se contradicen (ruta dice CW pero zona dice SMALL y no concuerdan): responde ESPERAR.',
                    'Cuando sea seguro entrar, dame los mismos numeros de las medidas (no inventes).',
                    'JSON: {"route":"CW|CCW|ESPERAR","zone":"SMALL|BIG|ESPERAR","n9":"numero o ESPERAR","n4":"numero o ESPERAR","analysis":"max 25 palabras explicando la decision"}'
                ].join('\n');
            } else if (autoMode === 'RAW') {
                systemPrompt = [
                    'Eres motor RAW de ROULETTE-CLASSIC. Trabajas SIN memoria, SIN aprendizaje, SIN estrategias guardadas.',
                    'Solo ves las metricas actuales de la mesa. Nada de historial RL ni patrones aprendidos.',
                    'Responde solo JSON valido. Elige exclusivamente entre las medidas dadas.',
                    'Si la brecha entre rutas (DOM8) es >= 4 y el hit rate >= 45%: elige la ruta dominante.',
                    'Si la brecha es < 3 o el hit rate < 35%: responde ESPERAR (no hay ventaja clara).',
                    'Entre 3-4 de brecha: decide segun el momentum de los ultimos 15 tiros.',
                    'JSON: {"route":"CW|CCW|ESPERAR","zone":"SMALL|BIG|ESPERAR","n9":"numero o ESPERAR","n4":"numero o ESPERAR","analysis":"max 20 palabras"}'
                ].join('\n');
            } else {
                systemPrompt = [
                    'Eres motor FULL de ROULETTE-CLASSIC.',
                    'Responde solo JSON valido. Elige exclusivamente entre las medidas dadas. No inventes numeros.',
                    'SMALL=1-9, BIG=10-18. Analiza dominancia, momentum, W/L, hit rate, bloque/farol/turbulencia.',
                    'En FULL elige la mejor opcion relativa disponible. SIEMPRE elige un numero, nunca ESPERAR.'
                ].join('\n');
            }
        } else {
            systemPrompt = 'Eres un motor de prediccion. RESPONDE SOLO JSON.';
        }
        const estimatedPromptTokens = estimateTokens(systemPrompt) + estimateTokens(userPrompt);

        const llm = await callPreferredLlm({
            systemPrompt,
            userPrompt,
            temperature: 0.15,
            maxTokens: 800,
            jsonMode: true
        });

        let result = llm.content;
        // Extract first JSON object from response (small LLMs often wrap JSON in text)
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) result = jsonMatch[0];
        try {
            const parsed = JSON.parse(result);
            if (autoAiContext) {
                const modeContext = { ...autoAiContext, mode: autoMode };
                
                // SAFE auditor + RAW: if LLM says ESPERAR, trust it and block
                if (autoMode === 'SAFE' || autoMode === 'RAW') {
                    const safeN9 = cleanAutoNumber(parsed.n9);
                    const safeRoute = normalizeAiRoute(parsed.route || parsed.direccion, safeN9, modeContext);
                    
                    if (safeN9 === 'ESPERAR' || safeRoute === 'ESPERAR' || String(parsed.n9 || '').toUpperCase().includes('ESPERAR')) {
                        const safeDecision = {
                            reply: formatAutoReply('ESPERAR', 'ESPERAR'),
                            route: 'ESPERAR',
                            zone: 'ESPERAR',
                            analysis: String(parsed.analysis || (autoMode === 'RAW' ? 'RAW: metricas insuficientes para entrar.' : 'Auditor SAFE: condiciones no optimas para entrar.')).trim()
                        };
                        persistAiPredictionRecord(tableId || 0, modeContext, safeDecision, parsed, { ...predictionMeta, provider: llm.provider });
                        return res.json({
                            ...safeDecision,
                            provider: llm.provider,
                            model: GROQ_MODEL,
                            usage: llm.usage || {},
                            estimatedPromptTokens
                        });
                    }
                }
                
                // FULL / SAFE-green / RAW-green: normalize prediction
                const normalized = normalizeAutoAiResponse(parsed, modeContext, fallback);
                persistAutoAiStrategy(parsed, autoAiContext, tableId || 'global');
                persistAiPredictionRecord(tableId || 0, modeContext, normalized, parsed, { ...predictionMeta, provider: llm.provider });

                return res.json({
                    ...normalized,
                    provider: llm.provider,
                    model: GROQ_MODEL,
                    usage: llm.usage || {},
                    estimatedPromptTokens
                });
            }

            let n9 = String(parsed.n9 || '').replace(/[^0-9]/g, '');
            let n4 = String(parsed.n4 || '').replace(/[^0-9]/g, '');
            res.json({ reply: formatAutoReply(n9 || 'ESPERAR', n4 || 'ESPERAR'), provider: llm.provider });
        } catch(e) {
            console.warn('[AI] JSON parse failed. Raw:', String(result || '').slice(0, 120));
            if (autoAiContext) {
                const unavailableDecision = {
                    ...buildAiUnavailableDecision('unavailable'),
                    analysis: 'La IA respondio fuera de formato JSON. No se fuerza lectura sin auditor; queda en espera.',
                    provider: 'llm-invalid-json'
                };
                persistAiPredictionRecord(tableId || 0, autoAiContext, unavailableDecision, unavailableDecision, { ...predictionMeta, provider: unavailableDecision.provider });
                return res.json(unavailableDecision);
            }
            res.json({ reply: 'N9: ESPERAR | N4: ESPERAR' });
        }
    } catch (error) {
        const autoAiContext = req.body.autoAiContext || null;
        const isRateLimit = markLlmRateLimit(error);
        const unavailableDecision = buildAiUnavailableDecision(isRateLimit ? 'rate_limit' : 'unavailable');
        if (autoAiContext && !isRateLimit) {
            persistAiPredictionRecord(tableId || 0, autoAiContext, unavailableDecision, unavailableDecision, { provider: unavailableDecision.provider });
        }
        if (isRateLimit) {
            console.warn('LLM predictor rate limited (429). AI decision paused; no prediction stored.');
        } else {
            console.error('LLM predictor error:', error.response?.status || error.message);
        }
        res.json({
            ...unavailableDecision,
            rateLimited: isRateLimit,
            model: GROQ_MODEL,
            rateLimitedUntil: isRateLimit ? new Date(llmRateLimitedUntil).toISOString() : null
        });
    }
});

app.post('/api/ai/chat', async (req, res) => {
    const { text, tableId, historyStr } = req.body;
    try {
        if (getPreferredLlmProvider() === 'none') {
            return res.json({ reply: 'IA desconectada. Configura OLLAMA o GROQ para el chat.' });
        }

        const strategyCommand = parseChatStrategyCommand(text, tableId || 'global');
        if (strategyCommand) {
            if (strategyCommand.error) {
                return res.json({ reply: strategyCommand.error });
            }

            const saved = strategyStore.saveStrategy(strategyCommand.data);
            if (!saved.ok) {
                return res.json({ reply: 'No pude guardar esa estrategia. Revisa nombre y resumen.' });
            }

            return res.json({
                reply: `Estrategia guardada en la biblioteca: ${saved.strategy.name}.`
            });
        }

        if (!aiMemory[tableId]) aiMemory[tableId] = [];
        // Sanitizar memoria vieja (formato Gemini -> Groq)
        aiMemory[tableId] = aiMemory[tableId].map(m => {
            if (m.parts && m.parts[0]) return { role: m.role === 'model' ? 'assistant' : m.role, content: m.parts[0].text };
            if (!m.content && m.text) return { role: m.role, content: m.text };
            return m;
        }).filter(m => m.content && m.role);

        const sysPrompt = `Eres la IA analista de apoyo en la web "ROULETTE CLASSIC". 
Eres conversacional, directo y casual.
IMPORTANTE: Si Santi te saluda, SALUDALO de vuelta como un amigo. Si te pregunta algo personal, responde normal.
NO eres un robot de datos. Eres un compañero humano que TAMBIEN sabe de ruleta.
Cuando te pregunten sobre la mesa, usas tu conocimiento: SMALL(1-9), BIG(10-18), CW(Derecha), CCW(Izquierda).
Colores: Verde=Dominancia, Amarillo=Tendencia, Rojo=Caos.
Si el usuario quiere guardar una estrategia en la biblioteca, dile que use: /estrategia Nombre | resumen | trigger=... | action=... | tags=...
Responde CORTO, maximo 2-3 oraciones. Sin listas, sin markdown, sin asteriscos.`;
        const priorTurns = aiMemory[tableId]
            .slice(-10)
            .map(item => `${item.role === 'assistant' ? 'IA' : 'Usuario'}: ${item.content}`)
            .join('\n');
        const userPrompt = [
            priorTurns ? `MEMORIA:\n${priorTurns}` : '',
            historyStr ? `HISTORIAL MESA: ${historyStr}` : '',
            `USUARIO: ${text}`
        ].filter(Boolean).join('\n\n');

        const llm = await callPreferredLlm({
            systemPrompt: sysPrompt,
            userPrompt,
            temperature: 0.6,
            maxTokens: 150,
            jsonMode: false
        });
        
        const reply = llm.content;
        aiMemory[tableId].push({ role: "user", content: text });
        aiMemory[tableId].push({ role: "assistant", content: reply });
        if (aiMemory[tableId].length > 20) aiMemory[tableId] = aiMemory[tableId].slice(-20);

        res.json({ reply, provider: llm.provider });
    } catch (error) {
        console.error('Chat error:', error.response?.status || error.message);
        res.json({ reply: 'Error de conexion con la IA. Revisa OLLAMA o GROQ.' });
    }
});

app.get('/api/tracker/memory/:tableId/:source', async (req, res) => {
    const tableId = Number(req.params.tableId);
    const source = req.params.source;
    if (!Number.isInteger(tableId) || source !== 'live') {
        return res.status(400).json({ error: 'La memoria persistente está disponible solo para Live.' });
    }
    if (!db.getUseMongo()) {
        return res.status(503).json({ error: 'MongoDB Atlas no está conectado. La memoria y la IA del Tracker están pausadas.' });
    }
    try {
        const memory = await db.getTrackerMemory(tableId, source);
        res.json({
            ...(memory || { table_id: tableId, source, summary: '', messages: [], context: {} }),
            storage: 'mongodb'
        });
    } catch (error) {
        console.error('[Tracker memory] Load failed:', error.message);
        res.status(500).json({ error: 'No se pudo cargar la memoria del Tracker.' });
    }
});

app.put('/api/tracker/memory/:tableId/:source', async (req, res) => {
    const tableId = Number(req.params.tableId);
    const source = req.params.source;
    if (!Number.isInteger(tableId) || source !== 'live') {
        return res.status(400).json({ error: 'Solo se guarda el contexto y análisis de Live.' });
    }
    if (!db.getUseMongo()) {
        return res.status(503).json({ error: 'MongoDB Atlas no está conectado. No se guardó la memoria.' });
    }
    try {
        const memory = await db.saveTrackerMemory({
            table_id: tableId,
            source,
            summary: req.body.summary,
            messages: req.body.messages,
            context: req.body.context
        });
        res.json({ success: true, updated_at: memory.updated_at, storage: 'mongodb' });
    } catch (error) {
        console.error('[Tracker memory] Save failed:', error.message);
        res.status(500).json({ error: 'No se pudo guardar la memoria del Tracker.' });
    }
});

// Tracker bankroll records are intentionally MongoDB-only. Manual spins never reach these routes.
app.get('/api/tracker/bankroll/:tableId', async (req, res) => {
    const tableId = Number(req.params.tableId);
    if (!Number.isInteger(tableId)) return res.status(400).json({ error: 'Mesa inválida.' });
    try {
        const sessions = await TrackerBankrollSession.find({ table_id: tableId })
            .sort({ session_no: -1 }).limit(100).lean().exec();
        const selected = (req.query.session_id
            ? sessions.find(item => String(item._id) === String(req.query.session_id))
            : null) || sessions.find(item => item.status === 'active');
        const [entries, sessionAudits, legacyAudits] = selected ? await Promise.all([
            TrackerBankrollEntry.find({ session_id: selected._id }).sort({ created_at: -1 }).limit(30).lean().exec(),
            TrackerPredictionAudit.find({ bankroll_session_id: String(selected._id) })
                .sort({ updated_at: -1 }).limit(500)
                .lean().exec(),
            TrackerAnalystSnapshot.find({ bankroll_session_id: String(selected._id) })
                .sort({ updated_at: -1 }).limit(500)
                .select('spin_id latest_number analyst_model analyst_status analyst_summary analyst_error bankroll_session_id bankroll_session_no prediction_mode prediction_source forecast_history_length system_center system_status system_metric_label system_reasoning system_won system_reward ai_center ai_metric_label ai_model ai_reasoning ai_status ai_won ai_reward result_spin_id result_number audited_at updated_at')
                .lean().exec()
        ]) : [[], [], []];
        const auditByForecast = new Map();
        for (const audit of legacyAudits) auditByForecast.set(String(audit.spin_id), audit);
        for (const audit of sessionAudits) auditByForecast.set(String(audit.spin_id), audit);
        const audits = Array.from(auditByForecast.values())
            .sort((left, right) => Number(left.result_spin_id || 0) - Number(right.result_spin_id || 0))
            .slice(-500);
        res.json({ sessions, selected_session_id: selected?._id || null, entries: entries.reverse(), audits: audits.reverse(), storage: 'mongodb' });
    } catch (error) {
        console.error('[Tracker bankroll] Load failed:', error.message);
        res.status(500).json({ error: 'No se pudieron cargar las sesiones desde MongoDB.' });
    }
});

app.post('/api/tracker/bankroll/:tableId', async (req, res) => {
    const tableId = Number(req.params.tableId);
    let sessionNo = req.body.session_no === undefined ? null : Number(req.body.session_no);
    const capital = Number(req.body.initial_capital);
    const chipValue = Number(req.body.chip_value);
    if (!Number.isInteger(tableId) || (sessionNo !== null && (!Number.isInteger(sessionNo) || sessionNo < 1)) ||
        !Number.isFinite(capital) || capital <= 0 || !Number.isFinite(chipValue) || chipValue <= 0) {
        return res.status(400).json({ error: 'Ingresa un capital y valor de ficha válidos.' });
    }
    try {
        const mongoSession = await mongoose.startSession();
        let created;
        try {
            await mongoSession.withTransaction(async () => {
                if (sessionNo === null) {
                    const latest = await TrackerBankrollSession.findOne({ table_id: tableId })
                        .sort({ session_no: -1 }).select('session_no').session(mongoSession).lean().exec();
                    sessionNo = Number(latest?.session_no || 0) + 1;
                }
                if (await TrackerBankrollSession.exists({ table_id: tableId, session_no: sessionNo }).session(mongoSession)) {
                    const error = new Error('Ese número de sesión ya existe.');
                    error.code = 'SESSION_EXISTS';
                    throw error;
                }
                [created] = await TrackerBankrollSession.create([{
                    table_id: tableId,
                    session_no: sessionNo,
                    initial_capital: capital,
                    balance: capital,
                    chip_value: chipValue,
                    status: 'draft'
                }], { session: mongoSession });
            });
        } finally {
            await mongoSession.endSession();
        }
        res.status(201).json({ success: true, session: created, storage: 'mongodb' });
    } catch (error) {
        const duplicate = error.code === 'SESSION_EXISTS' || error.code === 11000;
        if (!duplicate) console.error('[Tracker bankroll] Create failed:', error.message);
        res.status(duplicate ? 409 : 500).json({ error: duplicate ? 'Ese número de sesión ya existe.' : 'No se pudo crear la sesión en MongoDB.' });
    }
});

app.post('/api/tracker/bankroll/:tableId/:sessionId/activate', async (req, res) => {
    const tableId = Number(req.params.tableId);
    try {
        const mongoSession = await mongoose.startSession();
        let selected;
        try {
            await mongoSession.withTransaction(async () => {
                selected = await TrackerBankrollSession.findOne({ _id: req.params.sessionId, table_id: tableId }).session(mongoSession);
                if (!selected || selected.status === 'closed') return;
                if (selected.start_spin_id == null) {
                    const latestSpin = await Spin.findOne({ table_id: tableId })
                        .sort({ id: -1 }).select('id').session(mongoSession).lean().exec();
                    selected.start_spin_id = Number(latestSpin?.id || 0);
                    selected.last_settled_spin_id = selected.start_spin_id;
                }
                await TrackerBankrollSession.updateMany(
                    { table_id: tableId, status: 'active' },
                    { $set: { status: 'paused', updated_at: new Date() } },
                    { session: mongoSession }
                );
                selected.status = 'active';
                selected.starts_at = selected.starts_at || new Date();
                selected.updated_at = new Date();
                await selected.save({ session: mongoSession });
            });
        } finally {
            await mongoSession.endSession();
        }
        if (!selected || selected.status === 'closed') return res.status(404).json({ error: 'La sesión no existe o ya fue cerrada.' });
        res.json({ success: true, session: selected, storage: 'mongodb' });
    } catch (error) {
        console.error('[Tracker bankroll] Activate failed:', error.message);
        res.status(500).json({ error: 'No se pudo activar la sesión.' });
    }
});

app.post('/api/tracker/bankroll/:tableId/:sessionId/forecast', async (req, res) => {
    if (!db.getUseMongo()) return res.status(503).json({ error: 'MongoDB Atlas no está conectado.' });
    const tableId = Number(req.params.tableId);
    const sessionId = String(req.params.sessionId || '');
    const baseSpinId = Number(req.body.forecast_base_spin_id);
    if (!Number.isInteger(tableId) || tableId < 1 || !sessionId || !Number.isInteger(baseSpinId) || baseSpinId < 1) {
        return res.status(400).json({ error: 'Pronóstico de sesión inválido.' });
    }
    try {
        const [session, baseSpin] = await Promise.all([
            // A delayed audit can arrive after the user closes the session.
            // Keep accepting it for the same completed session so the local queue can drain.
            TrackerBankrollSession.findOne({ _id: sessionId, table_id: tableId, status: { $in: ['active', 'closed'] } }).select('_id session_no').lean().exec(),
            Spin.findOne({ id: baseSpinId, table_id: tableId, source_quality: 'live' }).select('id number').lean().exec()
        ]);
        if (!session) return res.status(409).json({ error: 'No se encontró la sesión para guardar el pronóstico.' });
        if (!baseSpin) return res.status(409).json({ error: 'El giro base Live aún no está confirmado en MongoDB.' });

        const raw = req.body.context_snapshot && typeof req.body.context_snapshot === 'object' ? req.body.context_snapshot : {};
        const center = value => {
            const parsed = value == null ? null : Number(value);
            return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36 ? parsed : null;
        };
        const labels = new Set(['CW_N9', 'CCW_N9', 'CW_N4S', 'CW_N4B', 'CCW_N4S', 'CCW_N4B']);
        const systemCenter = center(raw.system_center);
        const aiCenter = center(raw.ai_center);
        const previous = await TrackerPredictionAudit.findOne({ table_id: tableId, bankroll_session_id: String(session._id), spin_id: baseSpinId })
            .select('result_number').lean().exec();
        const resultNumber = Number.isInteger(Number(previous?.result_number)) && previous?.result_number !== null
            ? Number(previous.result_number) : null;
        const hit = candidate => candidate === null || resultNumber === null
            ? null : wheelNeighbors(candidate, 4).includes(resultNumber);
        const systemWon = hit(systemCenter);
        const aiWon = hit(aiCenter);
        const forecast = await TrackerPredictionAudit.findOneAndUpdate(
            { table_id: tableId, bankroll_session_id: String(session._id), spin_id: baseSpinId },
            {
                $setOnInsert: {
                    table_id: tableId,
                    bankroll_session_id: String(session._id),
                    bankroll_session_no: Number(session.session_no),
                    spin_id: baseSpinId,
                    latest_number: Number(baseSpin.number),
                    created_at: new Date()
                },
                $set: {
                    bankroll_session_no: Number(session.session_no),
                    prediction_mode: ['n4', 'n9', 'both'].includes(raw.prediction_mode) ? raw.prediction_mode : null,
                    prediction_source: raw.prediction_source === 'ai' ? 'ai' : 'system',
                    forecast_history_length: raw.forecast_history_length != null && Number.isInteger(Number(raw.forecast_history_length)) ? Number(raw.forecast_history_length) : null,
                    system_center: systemCenter,
                    system_status: systemCenter === null ? (raw.system_status === 'late' ? 'late' : 'unavailable') : 'ready',
                    system_metric_label: labels.has(raw.system_metric_label) ? raw.system_metric_label : '',
                    system_reasoning: systemCenter === null ? null : (raw.system_reasoning || null),
                    system_won: systemWon,
                    system_reward: systemWon === null ? null : systemWon ? 1 : -1,
                    ai_center: aiCenter,
                    ai_metric_label: labels.has(raw.ai_metric_label) ? raw.ai_metric_label : '',
                    ai_model: aiCenter === null ? '' : String(raw.ai_model || '').slice(0, 120),
                    ai_reasoning: aiCenter === null ? '' : String(raw.ai_reasoning || '').slice(0, 1800),
                    ai_status: aiCenter === null ? (raw.ai_status === 'late' ? 'late' : 'unavailable') : 'ready',
                    ai_won: aiWon,
                    ai_reward: aiWon === null ? null : aiWon ? 1 : -1,
                    updated_at: new Date()
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean().exec();
        await TrackerAnalystSnapshot.updateOne({ table_id: tableId, spin_id: baseSpinId }, { $set: { has_bankroll_audit: true } }).exec();
        const analystSnapshot = await TrackerAnalystSnapshot.findOne({ table_id: tableId, spin_id: baseSpinId })
            .select('analyst_model analyst_status analyst_summary analyst_error').lean().exec();
        if (analystSnapshot) {
            await TrackerPredictionAudit.updateOne({ _id: forecast._id }, { $set: {
                analyst_model: analystSnapshot.analyst_model,
                analyst_status: analystSnapshot.analyst_status,
                analyst_summary: analystSnapshot.analyst_summary,
                analyst_error: analystSnapshot.analyst_error,
                updated_at: new Date()
            } });
        }
        const savedForecast = analystSnapshot
            ? { ...forecast, analyst_model: analystSnapshot.analyst_model, analyst_status: analystSnapshot.analyst_status, analyst_summary: analystSnapshot.analyst_summary, analyst_error: analystSnapshot.analyst_error }
            : forecast;
        res.json({
            success: true,
            forecast: {
                spin_id: savedForecast.spin_id,
                latest_number: savedForecast.latest_number,
                analyst_model: savedForecast.analyst_model,
                analyst_status: savedForecast.analyst_status,
                analyst_summary: savedForecast.analyst_summary,
                analyst_error: savedForecast.analyst_error,
                bankroll_session_id: savedForecast.bankroll_session_id,
                bankroll_session_no: savedForecast.bankroll_session_no,
                prediction_mode: savedForecast.prediction_mode,
                prediction_source: savedForecast.prediction_source,
                forecast_history_length: savedForecast.forecast_history_length,
                system_center: savedForecast.system_center,
                system_status: savedForecast.system_status,
                system_metric_label: savedForecast.system_metric_label,
                system_reasoning: savedForecast.system_reasoning,
                system_won: savedForecast.system_won,
                system_reward: savedForecast.system_reward,
                ai_center: savedForecast.ai_center,
                ai_metric_label: savedForecast.ai_metric_label,
                ai_model: savedForecast.ai_model,
                ai_reasoning: savedForecast.ai_reasoning,
                ai_status: savedForecast.ai_status,
                ai_won: savedForecast.ai_won,
                ai_reward: savedForecast.ai_reward,
                result_spin_id: savedForecast.result_spin_id,
                result_number: savedForecast.result_number,
                audited_at: savedForecast.audited_at
            },
            storage: 'mongodb'
        });
    } catch (error) {
        console.error('[Tracker audit] Forecast save failed:', error.message);
        res.status(500).json({ error: 'No se pudieron guardar los centros de SISTEMA e IA.' });
    }
});

app.post('/api/tracker/bankroll/:tableId/stop-active', async (req, res) => {
    const tableId = Number(req.params.tableId);
    if (!Number.isInteger(tableId)) return res.status(400).json({ error: 'Mesa inválida.' });
    let mongoSession;
    let closed = [];
    try {
        mongoSession = await mongoose.startSession();
        await mongoSession.withTransaction(async () => {
            const activeSessions = await TrackerBankrollSession.find({ table_id: tableId, status: 'active' })
                .session(mongoSession).exec();
            const now = new Date();
            for (const session of activeSessions) {
                session.status = 'closed';
                session.final_outcome = trackerBankroll.getSessionOutcome(session.balance, session.initial_capital);
                session.closed_at = now;
                session.updated_at = now;
                await session.save({ session: mongoSession });
            }
            closed = activeSessions;
        });
        res.json({
            success: true,
            closed_count: closed.length,
            session: closed[0] || null,
            storage: 'mongodb'
        });
    } catch (error) {
        console.error('[Tracker bankroll] Stop active failed:', error.message);
        res.status(500).json({ error: 'No se pudo detener y guardar la sesión en MongoDB.' });
    } finally {
        if (mongoSession) await mongoSession.endSession();
    }
});

app.post('/api/tracker/bankroll/:tableId/:sessionId/close', async (req, res) => {
    const tableId = Number(req.params.tableId);
    try {
        const session = await TrackerBankrollSession.findOne({ _id: req.params.sessionId, table_id: tableId }).exec();
        if (!session) return res.status(404).json({ error: 'No se encontró la sesión.' });
        if (session.status !== 'closed') {
            session.status = 'closed';
            session.final_outcome = trackerBankroll.getSessionOutcome(session.balance, session.initial_capital);
            session.closed_at = new Date();
            session.updated_at = session.closed_at;
            await session.save();
        }
        res.json({ success: true, session, storage: 'mongodb' });
    } catch (error) {
        console.error('[Tracker bankroll] Close failed:', error.message);
        res.status(500).json({ error: 'No se pudo cerrar la sesión en MongoDB.' });
    }
});

app.post('/api/tracker/bankroll/:tableId/:sessionId/settle', async (req, res) => {
    const tableId = Number(req.params.tableId);
    const spinId = Number(req.body.spin_id);
    const number = Number(req.body.number);
    const predictionCenter = Number(req.body.prediction_center);
    const rawContext = req.body.context_snapshot && typeof req.body.context_snapshot === 'object' ? req.body.context_snapshot : {};
    const systemCenter = rawContext.system_center == null ? null : Number(rawContext.system_center);
    const aiCenter = rawContext.ai_center == null ? null : Number(rawContext.ai_center);
    const validSystemCenter = Number.isInteger(systemCenter) && systemCenter >= 0 && systemCenter <= 36 ? systemCenter : null;
    const validAiCenter = Number.isInteger(aiCenter) && aiCenter >= 0 && aiCenter <= 36 ? aiCenter : null;
    const validMetricLabels = new Set(['CW_N9', 'CCW_N9', 'CW_N4S', 'CW_N4B', 'CCW_N4S', 'CCW_N4B']);
    const validPredictionMode = ['n4', 'n9', 'both'].includes(rawContext.prediction_mode) ? rawContext.prediction_mode : null;
    const validSystemMetricLabel = validMetricLabels.has(rawContext.system_metric_label) ? rawContext.system_metric_label : null;
    const validAiMetricLabel = validMetricLabels.has(rawContext.ai_metric_label) ? rawContext.ai_metric_label : null;
    const forecastBaseSpinId = Number.isInteger(Number(rawContext.forecast_base_spin_id)) && Number(rawContext.forecast_base_spin_id) > 0
        ? Number(rawContext.forecast_base_spin_id) : null;
    const systemWon = validSystemCenter !== null ? wheelNeighbors(validSystemCenter, 4).includes(number) : null;
    const aiWon = validAiCenter !== null ? wheelNeighbors(validAiCenter, 4).includes(number) : null;
    const rawSystemReasoning = rawContext.system_reasoning && typeof rawContext.system_reasoning === 'object'
        ? rawContext.system_reasoning : {};
    const safeNumber = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
    const systemReasoning = validSystemCenter === null ? null : {
        signal: String(rawSystemReasoning.signal || '').slice(0, 80),
        rule: String(rawSystemReasoning.rule || '').slice(0, 80),
        direction: ['CW', 'CCW'].includes(rawSystemReasoning.direction) ? rawSystemReasoning.direction : '',
        direction_basis: ['pattern', 'dominance', 'prediction'].includes(rawSystemReasoning.direction_basis) ? rawSystemReasoning.direction_basis : 'prediction',
        direction_pattern: String(rawSystemReasoning.direction_pattern || '').slice(0, 120),
        zone_projection: ['BIG', 'SMALL'].includes(rawSystemReasoning.zone_projection) ? rawSystemReasoning.zone_projection : '',
        zone_basis: ['pattern', 'dominance', 'prediction'].includes(rawSystemReasoning.zone_basis) ? rawSystemReasoning.zone_basis : 'prediction',
        zone_pattern: String(rawSystemReasoning.zone_pattern || '').slice(0, 120),
        level_projection: ['OVER', 'UNDER'].includes(rawSystemReasoning.level_projection) ? rawSystemReasoning.level_projection : '',
        level_basis: ['pattern', 'dominance', 'prediction'].includes(rawSystemReasoning.level_basis) ? rawSystemReasoning.level_basis : 'prediction',
        level_pattern: String(rawSystemReasoning.level_pattern || '').slice(0, 120),
        selected_target: validSystemCenter,
        metric_label: validSystemMetricLabel,
        target_cw: Number.isInteger(Number(rawSystemReasoning.target_cw)) ? Number(rawSystemReasoning.target_cw) : null,
        target_ccw: Number.isInteger(Number(rawSystemReasoning.target_ccw)) ? Number(rawSystemReasoning.target_ccw) : null,
        confidence_cw: safeNumber(rawSystemReasoning.confidence_cw),
        confidence_ccw: safeNumber(rawSystemReasoning.confidence_ccw),
        consensus_confidence: safeNumber(rawSystemReasoning.consensus_confidence),
        direction_state: String(rawSystemReasoning.direction_state || '').slice(0, 80),
        average_travel: safeNumber(rawSystemReasoning.average_travel),
        standard_deviation: safeNumber(rawSystemReasoning.standard_deviation),
        last_numbers: Array.isArray(rawSystemReasoning.last_numbers)
            ? rawSystemReasoning.last_numbers.slice(-21).map(Number).filter(value => Number.isInteger(value) && value >= 0 && value <= 36)
            : [],
        last_signed_distances: Array.isArray(rawSystemReasoning.last_signed_distances)
            ? rawSystemReasoning.last_signed_distances.slice(-20).map(Number).filter(Number.isFinite)
            : []
    };
    const contextSnapshot = {
        audit_version: Number(rawContext.audit_version) === 1 ? 1 : 0,
        history: Array.isArray(rawContext.history)
            ? rawContext.history.slice(-80).map(Number).filter(value => Number.isInteger(value) && value >= 0 && value <= 36)
            : [],
        prediction_source: rawContext.prediction_source === 'ai' ? 'ai' : 'system',
        prediction_mode: validPredictionMode,
        forecast_base_spin_id: forecastBaseSpinId,
        forecast_history_length: rawContext.forecast_history_length != null && Number.isInteger(Number(rawContext.forecast_history_length))
            ? Number(rawContext.forecast_history_length) : null,
        system_center: validSystemCenter,
        system_metric_label: validSystemMetricLabel,
        system_status: validSystemCenter === null ? (rawContext.system_status === 'late' ? 'late' : 'unavailable') : 'ready',
        system_reasoning: systemReasoning,
        system_won: systemWon,
        system_reward: systemWon === null ? null : systemWon ? 1 : -1,
        ai_center: validAiCenter,
        ai_metric_label: validAiMetricLabel,
        ai_model: validAiCenter === null ? null : String(rawContext.ai_model || '').slice(0, 120),
        ai_reasoning: validAiCenter === null ? '' : String(rawContext.ai_reasoning || '').slice(0, 1800),
        ai_status: validAiCenter === null ? 'unavailable' : 'ready',
        ai_won: aiWon,
        ai_reward: aiWon === null ? null : aiWon ? 1 : -1,
        analyst_base_spin_id: forecastBaseSpinId,
        analyst_status: 'unavailable',
        analyst_model: '',
        analyst_snapshot_id: '',
        analyst_summary: ''
    };
    const predictionNumbers = Number.isInteger(predictionCenter) && predictionCenter >= 0 && predictionCenter <= 36
        ? wheelNeighbors(predictionCenter, 4)
        : [];
    const spinKey = `${tableId}:${spinId}`;
    if (!Number.isInteger(tableId) || !Number.isInteger(spinId) || !Number.isInteger(number) || number < 0 || number > 36 ||
        !Number.isInteger(predictionCenter) || predictionCenter < 0 || predictionCenter > 36 ||
        predictionNumbers.length !== trackerBankroll.POCKETS_PER_BET ||
        predictionNumbers.some(value => !Number.isInteger(value) || value < 0 || value > 36) ||
        new Set(predictionNumbers).size !== trackerBankroll.POCKETS_PER_BET) {
        return res.status(400).json({ error: 'Tirada o predicción N4 inválida.' });
    }
    try {
        const spin = await Spin.findOne({ id: spinId, table_id: tableId, number, source_quality: 'live' }).lean().exec();
        if (!spin) return res.status(409).json({ error: 'La tirada Live no está confirmada en MongoDB.' });
        if (forecastBaseSpinId !== null) {
            const analystSnapshot = await TrackerAnalystSnapshot.findOne({ table_id: tableId, spin_id: forecastBaseSpinId })
                .select('_id analyst_status analyst_model analyst_summary').lean().exec();
            if (analystSnapshot) {
                contextSnapshot.analyst_status = String(analystSnapshot.analyst_status || 'pending');
                contextSnapshot.analyst_model = String(analystSnapshot.analyst_model || '').slice(0, 120);
                contextSnapshot.analyst_snapshot_id = String(analystSnapshot._id);
                contextSnapshot.analyst_summary = String(analystSnapshot.analyst_summary || '').slice(0, 1200);
            }
        }

        const mongoSession = await mongoose.startSession();
        let result;
        try {
            await mongoSession.withTransaction(async () => {
                const session = await TrackerBankrollSession.findOne({
                    _id: req.params.sessionId,
                    table_id: tableId,
                    status: 'active'
                }).session(mongoSession);
                if (!session) {
                    result = { error: 'No hay una sesión activa para esta mesa.', status: 409 };
                    return;
                }
                const existing = await TrackerBankrollEntry.findOne({ session_id: session._id, spin_key: spinKey }).session(mongoSession);
                if (existing) {
                    result = { session, entry: existing, duplicate: true };
                    return;
                }
                if (session.last_settled_spin_id == null) {
                    const latestEntry = await TrackerBankrollEntry.findOne({ session_id: session._id })
                        .sort({ created_at: -1 }).select('spin_key').session(mongoSession).lean().exec();
                    const priorId = Number(String(latestEntry?.spin_key || '').split(':').pop());
                    session.last_settled_spin_id = Number.isFinite(priorId)
                        ? priorId
                        : Number(session.start_spin_id || 0);
                }
                if (spinId <= Number(session.last_settled_spin_id)) {
                    result = { error: 'La tirada ya quedó atrás de la última apuesta liquidada.', status: 409 };
                    return;
                }
                const stake = trackerBankroll.getStake(session.chip_value, session.current_round);
                if (session.balance + 1e-9 < stake) {
                    result = { error: 'Capital insuficiente para la siguiente apuesta.', status: 409, insufficient_capital: true };
                    return;
                }
                const settlement = trackerBankroll.calculateSettlement(session, number, predictionNumbers);
                const [entry] = await TrackerBankrollEntry.create([{
                    session_id: session._id,
                    session_no: session.session_no,
                    cycle_no: session.completed_cycles + 1,
                    table_id: tableId,
                    spin_key: spinKey,
                    number,
                    prediction_center: predictionCenter,
                    prediction_numbers: predictionNumbers,
                    context_snapshot: contextSnapshot,
                    round: settlement.round,
                    stake: settlement.stake,
                    cycle_wagered: settlement.cycleWagered,
                    payout: settlement.payout,
                    cycle_profit: settlement.cycleProfit,
                    balance_after: settlement.balanceAfter,
                    net_profit: settlement.netProfit,
                    won: settlement.won
                }], { session: mongoSession });
                session.balance = settlement.balanceAfter;
                session.current_round = settlement.nextRound;
                session.cycle_wagered = settlement.nextCycleWagered;
                session.total_spins += 1;
                session.total_wagered = Number((session.total_wagered + settlement.stake).toFixed(2));
                session.total_payout = Number((session.total_payout + settlement.payout).toFixed(2));
                if (settlement.won) {
                    session.wins += 1;
                    session.completed_cycles += 1;
                } else {
                    session.losses += 1;
                }
                session.updated_at = new Date();
                session.last_settled_spin_id = spinId;
                await session.save({ session: mongoSession });
                result = { session, entry };
            });
        } finally {
            await mongoSession.endSession();
        }
        if (result?.error) return res.status(result.status).json(result);
        res.json({ success: true, ...result, storage: 'mongodb' });
    } catch (error) {
        if (error.code === 11000) {
            const session = await TrackerBankrollSession.findById(req.params.sessionId).lean().exec();
            const entry = session && await TrackerBankrollEntry.findOne({ session_id: session._id, spin_key: spinKey }).lean().exec();
            if (session && entry) return res.json({ success: true, session, entry, duplicate: true, storage: 'mongodb' });
        }
        console.error('[Tracker bankroll] Settlement failed:', error.message);
        res.status(500).json({ error: 'No se pudo guardar la liquidación en MongoDB.' });
    }
});

app.post('/api/tracker/bankroll/:tableId/:sessionId/audit', async (req, res) => {
    if (!db.getUseMongo()) return res.status(503).json({ error: 'MongoDB Atlas no está conectado.' });
    const tableId = Number(req.params.tableId);
    const sessionId = String(req.params.sessionId || '');
    const baseSpinId = Number(req.body.forecast_base_spin_id);
    const resultSpinId = Number(req.body.result_spin_id);
    const resultNumber = Number(req.body.result_number);
    if (!Number.isInteger(tableId) || tableId < 1 || !sessionId ||
        !Number.isInteger(baseSpinId) || baseSpinId < 1 ||
        !Number.isInteger(resultSpinId) || resultSpinId <= baseSpinId ||
        !Number.isInteger(resultNumber) || resultNumber < 0 || resultNumber > 36) {
        return res.status(400).json({ error: 'Auditoría de predicción inválida.' });
    }
    try {
        const [session, resultSpin, baseSpin] = await Promise.all([
            TrackerBankrollSession.findOne({ _id: sessionId, table_id: tableId }).select('_id session_no').lean().exec(),
            Spin.findOne({ id: resultSpinId, table_id: tableId, number: resultNumber, source_quality: 'live' }).select('id number').lean().exec(),
            Spin.findOne({ id: baseSpinId, table_id: tableId }).select('id number').lean().exec()
        ]);
        if (!session) return res.status(404).json({ error: 'No se encontró la sesión.' });
        if (!resultSpin || !baseSpin) return res.status(409).json({ error: 'La tirada Live no está confirmada en MongoDB.' });

        const raw = req.body.context_snapshot && typeof req.body.context_snapshot === 'object' ? req.body.context_snapshot : {};
        const center = value => {
            const parsed = value == null ? null : Number(value);
            return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36 ? parsed : null;
        };
        const labels = new Set(['CW_N9', 'CCW_N9', 'CW_N4S', 'CW_N4B', 'CCW_N4S', 'CCW_N4B']);
        const key = { table_id: tableId, bankroll_session_id: String(session._id), spin_id: baseSpinId };
        const previous = await TrackerPredictionAudit.findOne(key).lean().exec();
        const systemCenter = center(raw.system_center) ?? center(previous?.system_center);
        const aiCenter = center(raw.ai_center) ?? center(previous?.ai_center);
        const systemWon = systemCenter === null ? null : wheelNeighbors(systemCenter, 4).includes(resultNumber);
        const aiWon = aiCenter === null ? null : wheelNeighbors(aiCenter, 4).includes(resultNumber);
        const audit = await TrackerPredictionAudit.findOneAndUpdate(
            key,
            {
                $setOnInsert: {
                    table_id: tableId,
                    bankroll_session_id: String(session._id),
                    bankroll_session_no: Number(session.session_no),
                    spin_id: baseSpinId,
                    latest_number: Number(baseSpin.number),
                    created_at: new Date()
                },
                $set: {
                    bankroll_session_no: Number(session.session_no),
                    prediction_mode: ['n4', 'n9', 'both'].includes(raw.prediction_mode) ? raw.prediction_mode : previous?.prediction_mode || null,
                    prediction_source: ['ai', 'system'].includes(raw.prediction_source) ? raw.prediction_source : previous?.prediction_source || 'system',
                    forecast_history_length: raw.forecast_history_length != null && Number.isInteger(Number(raw.forecast_history_length)) ? Number(raw.forecast_history_length) : null,
                    system_center: systemCenter,
                    system_status: systemCenter === null ? (raw.system_status === 'late' ? 'late' : previous?.system_status || 'unavailable') : 'ready',
                    system_metric_label: labels.has(raw.system_metric_label) ? raw.system_metric_label : previous?.system_metric_label || '',
                    system_reasoning: systemCenter === null ? previous?.system_reasoning || null : (raw.system_reasoning || previous?.system_reasoning || null),
                    system_won: systemWon,
                    system_reward: systemWon === null ? null : systemWon ? 1 : -1,
                    ai_center: aiCenter,
                    ai_metric_label: labels.has(raw.ai_metric_label) ? raw.ai_metric_label : previous?.ai_metric_label || '',
                    ai_model: aiCenter === null ? previous?.ai_model || '' : String(raw.ai_model || previous?.ai_model || '').slice(0, 120),
                    ai_reasoning: aiCenter === null ? previous?.ai_reasoning || '' : String(raw.ai_reasoning || previous?.ai_reasoning || '').slice(0, 1800),
                    ai_status: aiCenter === null ? (raw.ai_status === 'late' ? 'late' : previous?.ai_status || 'unavailable') : 'ready',
                    ai_won: aiWon,
                    ai_reward: aiWon === null ? null : aiWon ? 1 : -1,
                    result_spin_id: resultSpinId,
                    result_number: resultNumber,
                    audited_at: new Date(),
                    updated_at: new Date()
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean().exec();
        await TrackerAnalystSnapshot.updateOne({ table_id: tableId, spin_id: baseSpinId }, { $set: { has_bankroll_audit: true } }).exec();
        const analystSnapshot = await TrackerAnalystSnapshot.findOne({ table_id: tableId, spin_id: baseSpinId })
            .select('analyst_model analyst_status analyst_summary analyst_error').lean().exec();
        if (analystSnapshot) {
            await TrackerPredictionAudit.updateOne({ _id: audit._id }, { $set: {
                analyst_model: analystSnapshot.analyst_model,
                analyst_status: analystSnapshot.analyst_status,
                analyst_summary: analystSnapshot.analyst_summary,
                analyst_error: analystSnapshot.analyst_error,
                updated_at: new Date()
            } });
        }
        const savedAudit = analystSnapshot
            ? { ...audit, analyst_model: analystSnapshot.analyst_model, analyst_status: analystSnapshot.analyst_status, analyst_summary: analystSnapshot.analyst_summary, analyst_error: analystSnapshot.analyst_error }
            : audit;
        res.json({
            success: true,
            snapshot_id: String(savedAudit._id),
            audit: {
                spin_id: savedAudit.spin_id,
                latest_number: savedAudit.latest_number,
                analyst_model: savedAudit.analyst_model,
                analyst_status: savedAudit.analyst_status,
                analyst_summary: savedAudit.analyst_summary,
                analyst_error: savedAudit.analyst_error,
                bankroll_session_id: savedAudit.bankroll_session_id,
                bankroll_session_no: savedAudit.bankroll_session_no,
                prediction_mode: savedAudit.prediction_mode,
                prediction_source: savedAudit.prediction_source,
                forecast_history_length: savedAudit.forecast_history_length,
                system_center: savedAudit.system_center,
                system_status: savedAudit.system_status,
                system_metric_label: savedAudit.system_metric_label,
                system_reasoning: savedAudit.system_reasoning,
                system_won: savedAudit.system_won,
                system_reward: savedAudit.system_reward,
                ai_center: savedAudit.ai_center,
                ai_metric_label: savedAudit.ai_metric_label,
                ai_model: savedAudit.ai_model,
                ai_reasoning: savedAudit.ai_reasoning,
                ai_status: savedAudit.ai_status,
                ai_won: savedAudit.ai_won,
                ai_reward: savedAudit.ai_reward,
                result_spin_id: savedAudit.result_spin_id,
                result_number: savedAudit.result_number,
                audited_at: savedAudit.audited_at
            },
            storage: 'mongodb'
        });
    } catch (error) {
        console.error('[Tracker audit] Save failed:', error.message);
        res.status(500).json({ error: 'No se pudo guardar la auditoría de ambos predictores.' });
    }
});

// Tracker AI endpoint — OpenRouter
const trackerAnalystInFlight = new Set();
const TRACKER_ANALYST_MODEL = process.env.TRACKER_ANALYST_MODEL || 'qwen/qwen3.6-27b';

function trackerWheelStep(from, to) {
    const fromIndex = WHEEL_INDEX[Number(from)];
    const toIndex = WHEEL_INDEX[Number(to)];
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return null;
    const clockwise = (toIndex - fromIndex + WHEEL_ORDER.length) % WHEEL_ORDER.length;
    const signed = clockwise > Math.floor(WHEEL_ORDER.length / 2) ? clockwise - WHEEL_ORDER.length : clockwise;
    const direction = signed === 0 ? 'STAY' : signed > 0 ? 'CW' : 'CCW';
    const magnitude = Math.abs(signed) >= 10 ? 'BIG' : 'SMALL';
    return { signed, direction, magnitude, signature: `${direction}-${magnitude}` };
}

function summarizeTrackerWindow(spins, minutes, now) {
    const cutoff = now.getTime() - minutes * 60 * 1000;
    const selected = spins.filter(spin => {
        const at = new Date(spin.observed_at || spin.timestamp || spin.ingested_at).getTime();
        return Number.isFinite(at) && at >= cutoff && at <= now.getTime();
    });
    const steps = [];
    for (let i = 1; i < selected.length; i++) {
        const step = trackerWheelStep(selected[i - 1].number, selected[i].number);
        if (step) steps.push(step);
    }
    const count = key => steps.filter(step => step.signature === key).length;
    const cw = steps.filter(step => step.direction === 'CW').length;
    const ccw = steps.filter(step => step.direction === 'CCW').length;
    const big = steps.filter(step => step.magnitude === 'BIG').length;
    const avg = steps.length ? Math.round(steps.reduce((sum, step) => sum + Math.abs(step.signed), 0) / steps.length * 10) / 10 : null;
    return {
        minutes,
        spins: selected.length,
        transitions: steps.length,
        clockwise: cw,
        counterclockwise: ccw,
        big,
        small: steps.length - big,
        averageWheelDistance: avg,
        mostCommonTransitions: ['CW-BIG', 'CW-SMALL', 'CCW-BIG', 'CCW-SMALL', 'STAY-SMALL']
            .map(signature => ({ signature, count: count(signature) }))
            .sort((a, b) => b.count - a.count)
    };
}

function buildTrackerAnalystEvidence(spins) {
    const valid = spins.filter(spin => Number.isInteger(Number(spin.number)) && Number(spin.number) >= 0 && Number(spin.number) <= 36);
    const steps = [];
    for (let i = 1; i < valid.length; i++) {
        const step = trackerWheelStep(valid[i - 1].number, valid[i].number);
        if (step) steps.push(step);
    }
    const patternLength = 5;
    const currentStart = Math.max(0, steps.length - patternLength);
    const current = steps.slice(currentStart);
    const matches = [];
    if (current.length === patternLength) {
        for (let start = 0; start + patternLength < currentStart; start++) {
            const candidate = steps.slice(start, start + patternLength);
            if (!candidate.every((step, index) => step.signature === current[index].signature)) continue;
            matches.push({
                priorSequence: valid.slice(start, start + patternLength + 1).map(spin => Number(spin.number)),
                followingNumber: Number(valid[start + patternLength + 1]?.number),
                followingTransition: steps[start + patternLength]?.signature,
                followingSignedDistance: steps[start + patternLength]?.signed
            });
        }
    }
    const now = new Date();
    return {
        generatedAt: now.toISOString(),
        historySize: valid.length,
        latestSpinId: Number(valid[valid.length - 1]?.id),
        latestNumber: Number(valid[valid.length - 1]?.number),
        currentSequence: valid.slice(-patternLength - 1).map(spin => Number(spin.number)),
        currentTransitionPattern: current.map(step => step.signature),
        similarity: {
            method: 'exact match of the last 5 signed wheel-transition classes (CW/CCW/STAY × BIG/SMALL)',
            occurrences: matches.length,
            examples: matches.slice(-8),
            followingTransitionCounts: ['CW-BIG', 'CW-SMALL', 'CCW-BIG', 'CCW-SMALL', 'STAY-SMALL']
                .map(signature => ({ signature, count: matches.filter(match => match.followingTransition === signature).length }))
        },
        regimes: buildTrackerRegimeEvidence(steps),
        fluctuation: {
            last15Minutes: summarizeTrackerWindow(valid, 15, now),
            last60Minutes: summarizeTrackerWindow(valid, 60, now)
        },
        note: 'Evidence is descriptive only; historical similarity does not guarantee a future outcome.'
    };
}

function buildTrackerRegimeEvidence(steps) {
    const dimensions = [
        { key: 'direction', label: 'dirección', value: step => step.direction },
        { key: 'zone', label: 'zona', value: step => step.magnitude },
        {
            key: 'level', label: 'nivel',
            value: step => ((step.signed >= 0 && Math.abs(step.signed) >= 10) || (step.signed < 0 && Math.abs(step.signed) < 10)) ? 'OVER' : 'UNDER'
        }
    ];
    const motifs = [[3, 3], [2, 1, 2, 1], [2, 1, 2, 1, 2, 1], [2, 2, 2, 2], [1, 3, 1, 3], [3, 3, 2, 3, 4]];
    const bucket = length => length >= 3 ? '3+' : String(length);

    return dimensions.map(dimension => {
        const sequence = steps.map(dimension.value);
        const runs = [];
        sequence.forEach((symbol, index) => {
            const last = runs[runs.length - 1];
            if (last && last.symbol === symbol) last.length++;
            else runs.push({ symbol, length: 1, start: index });
        });
        const windows = [20, 50, 100, 400].map(size => {
            const values = sequence.slice(-Math.max(1, size - 1));
            const counts = {};
            let switches = 0;
            values.forEach((symbol, index) => {
                counts[symbol] = (counts[symbol] || 0) + 1;
                if (index > 0 && symbol !== values[index - 1]) switches++;
            });
            const total = values.length;
            const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['', 0];
            return {
                spins: Math.min(size, total + 1), counts, switches,
                dominant: dominant[0], dominantPercent: total ? Math.round(dominant[1] / total * 100) : 0
            };
        });
        const motifStats = motifs.map(motif => {
            const following = { '1': 0, '2': 0, '3+': 0 };
            let n = 0;
            for (let index = 0; index + motif.length < runs.length; index++) {
                if (!motif.every((length, offset) => runs[index + offset].length === length)) continue;
                following[bucket(runs[index + motif.length].length)]++;
                n++;
            }
            return { motif, n, following };
        }).filter(item => item.n > 0);
        const zigzag = [4, 6].map(width => {
            let n = 0, continued = 0, stopped = 0;
            for (let index = 0; index + width < sequence.length; index++) {
                let alternating = true;
                for (let offset = 1; offset < width; offset++) {
                    if (sequence[index + offset] === sequence[index + offset - 1]) {
                        alternating = false;
                        break;
                    }
                }
                if (!alternating) continue;
                n++;
                if (sequence[index + width] !== sequence[index + width - 1]) continued++;
                else stopped++;
            }
            return { width, n, continued, stopped };
        });

        // A descriptive proxy only: a 3-run after choppy transitions is
        // classified by the following run length, never treated as a forecast.
        const threeRunAfterTurbulence = {
            criterion: 'racha de longitud 3 precedida por al menos 6 eventos; cambios >=60% en hasta 8 eventos previos; se clasifica por longitud de la racha siguiente',
            turbulentCases: 0,
            following: { '1': 0, '2': 0, '3+': 0 }
        };
        for (let index = 0; index + 1 < runs.length; index++) {
            if (runs[index].length !== 3) continue;
            const leadIn = sequence.slice(Math.max(0, runs[index].start - 8), runs[index].start);
            let switches = 0;
            for (let cursor = 1; cursor < leadIn.length; cursor++) {
                if (leadIn[cursor] !== leadIn[cursor - 1]) switches++;
            }
            if (leadIn.length < 6 || switches < Math.ceil((leadIn.length - 1) * 0.6)) continue;
            threeRunAfterTurbulence.turbulentCases++;
            threeRunAfterTurbulence.following[bucket(runs[index + 1].length)]++;
        }
        return {
            key: dimension.key, label: dimension.label,
            currentRun: runs.length ? { state: runs[runs.length - 1].symbol, length: runs[runs.length - 1].length } : null,
            recentRuns: runs.slice(-10).map(run => ({ state: run.symbol, length: run.length })),
            windows, zigzag, motifs: motifStats, threeRunAfterTurbulence
        };
    });
}

function startTrackerAnalystReview(snapshotId, evidence, apiKey, tableId, spinId) {
    const inFlightKey = `${tableId}:${spinId}`;
    if (trackerAnalystInFlight.has(inFlightKey)) return;
    trackerAnalystInFlight.add(inFlightKey);
    const key = String(apiKey || process.env.OPENROUTER_API_KEY || '').trim().replace(/[^\x00-\x7F]/g, '');
    if (!key) {
        trackerAnalystInFlight.delete(inFlightKey);
        TrackerAnalystSnapshot.updateOne({ _id: snapshotId }, {
            $set: { analyst_status: 'failed', analyst_error: 'OpenRouter API key faltante.', updated_at: new Date() }
        }).then(() => syncTrackerAnalystResultToAudits(tableId, spinId)).catch(() => {});
        return;
    }
    (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                    'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost',
                    'X-Title': 'OneMillion Tracker Analyst'
                },
                body: JSON.stringify({
                    model: TRACKER_ANALYST_MODEL,
                    messages: [
                        { role: 'system', content: 'Eres un analista descriptivo de secuencias de ruleta. No predigas números, no elijas centro, no recomiendes apuestas ni afirmes causalidad. Compara por separado dirección, zona y nivel; resume muestras, dominancias, cambios, motivos de bloques, zigzag y observaciones de rachas de 3 tras turbulencia. Una racha de 3 tras turbulencia es una observación, no confirmes una falsa ruptura. Usa n, resultados posteriores y fluctuación 15/60 min; si la muestra es baja, dilo. Devuelve JSON compacto con: hallazgo (string con conteos concretos), confianza_evidencia (baja|media|alta), limite (string). Si no hay coincidencias suficientes, dilo claramente.' },
                        { role: 'user', content: JSON.stringify(evidence) }
                    ],
                    temperature: 0.1,
                    max_tokens: 350,
                    response_format: { type: 'json_object' }
                }),
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
            const data = await response.json();
            const text = String(data.choices?.[0]?.message?.content || '').trim();
            if (!text) throw new Error('Qwen devolvió el análisis vacío.');
            let parsed;
            try { parsed = JSON.parse(text); } catch { parsed = { hallazgo: text.slice(0, 500) }; }
            const summary = JSON.stringify({
                hallazgo: String(parsed.hallazgo || '').slice(0, 500),
                confianza_evidencia: ['baja', 'media', 'alta'].includes(parsed.confianza_evidencia) ? parsed.confianza_evidencia : 'baja',
                limite: String(parsed.limite || '').slice(0, 250)
            });
            await TrackerAnalystSnapshot.updateOne({ _id: snapshotId }, {
                $set: { analyst_status: 'complete', analyst_summary: summary, analyst_error: '', updated_at: new Date() }
            });
            await syncTrackerAnalystResultToAudits(tableId, spinId);
            console.log('[Tracker Analyst] Complete:', TRACKER_ANALYST_MODEL, 'table:', tableId, 'spin:', spinId, 'duration_ms:', Date.now() - new Date(evidence.generatedAt).getTime());
        } catch (error) {
            await TrackerAnalystSnapshot.updateOne({ _id: snapshotId }, {
                $set: { analyst_status: 'failed', analyst_error: String(error.message || error).slice(0, 250), updated_at: new Date() }
            }).catch(() => {});
            await syncTrackerAnalystResultToAudits(tableId, spinId).catch(() => {});
            console.warn('[Tracker Analyst] Review failed:', error.message);
        } finally {
            clearTimeout(timeout);
            trackerAnalystInFlight.delete(inFlightKey);
        }
    })();
}

async function syncTrackerAnalystResultToAudits(tableId, spinId) {
    const snapshot = await TrackerAnalystSnapshot.findOne({ table_id: Number(tableId), spin_id: Number(spinId) })
        .select('_id analyst_status analyst_model analyst_summary analyst_error').lean().exec();
    if (!snapshot) return;
    const analystFields = {
        analyst_model: String(snapshot.analyst_model || '').slice(0, 120),
        analyst_status: String(snapshot.analyst_status || 'pending'),
        analyst_summary: String(snapshot.analyst_summary || '').slice(0, 1200),
        analyst_error: String(snapshot.analyst_error || ''),
        updated_at: new Date()
    };
    await TrackerPredictionAudit.updateMany({ table_id: Number(tableId), spin_id: Number(spinId) }, { $set: analystFields });
    await TrackerBankrollEntry.updateMany({
        table_id: Number(tableId),
        'context_snapshot.analyst_base_spin_id': Number(spinId)
    }, { $set: {
        'context_snapshot.analyst_status': analystFields.analyst_status,
        'context_snapshot.analyst_model': analystFields.analyst_model,
        'context_snapshot.analyst_snapshot_id': String(snapshot._id),
        'context_snapshot.analyst_summary': analystFields.analyst_summary
    } });
}

app.post('/api/ai/tracker', async (req, res) => {
    const requestStartedAt = Date.now();
    const { provider, model, apiKey, system, messages, purpose, tableId, prediction_context: predictionContext } = req.body;
    let requestTimeout = null;
    let requestTimedOut = false;
    console.log('[Tracker AI] Request:', {
        provider, model, hasKey: !!apiKey, msgCount: messages?.length,
        revision: predictionContext?.revision,
        historyLength: predictionContext?.history_length,
        latestSpin: predictionContext?.latest_spin
    });
    if (!db.getUseMongo()) {
        return res.status(503).json({ success: false, error: 'MongoDB Atlas no está conectado. La IA del Tracker permanece pausada.' });
    }
    try {
        // Strip non-ASCII characters from API key to prevent ByteString errors
        const rawKey = (apiKey || process.env.OPENROUTER_API_KEY || '').trim();
        const key = rawKey.replace(/[^\x00-\x7F]/g, '');
        if (!key) throw new Error('API key de OpenRouter faltante. Pegala en Config IA o configura OPENROUTER_API_KEY.');
        const orModel = (model || 'google/gemini-3.8-flash').trim();
        const isGeminiModel = orModel.startsWith('google/gemini-');
        const requestMessages = Array.isArray(messages) ? messages.map(message => ({ ...message })) : [];
        if (purpose === 'prediction' && requestMessages.length && Number.isInteger(Number(tableId))) {
            try {
                const numericTableId = Number(tableId);
                const activeSession = await TrackerBankrollSession.findOne({ table_id: numericTableId, status: 'active' })
                    .sort({ updated_at: -1 }).select('_id').lean().exec();
                if (activeSession) {
                    const liveSpins = await Spin.find({ table_id: numericTableId, source_quality: 'live' })
                        .sort({ id: -1 }).limit(400).lean().exec();
                    liveSpins.reverse();
                    if (liveSpins.length) {
                        const evidence = buildTrackerAnalystEvidence(liveSpins);
                        const latestSpinId = Number(liveSpins[liveSpins.length - 1].id);
                        const hasBankrollAudit = Boolean(await TrackerPredictionAudit.exists({ table_id: numericTableId, spin_id: latestSpinId }));
                        const previous = await TrackerAnalystSnapshot.findOne({ table_id: numericTableId, spin_id: latestSpinId })
                            .select('_id analyst_status').lean().exec();
                        const snapshot = await TrackerAnalystSnapshot.findOneAndUpdate(
                            { table_id: numericTableId, spin_id: latestSpinId },
                            {
                                $setOnInsert: {
                                    table_id: numericTableId,
                                    spin_id: latestSpinId,
                                    analyst_model: TRACKER_ANALYST_MODEL,
                                    analyst_status: 'pending',
                                    created_at: new Date()
                                },
                                $set: {
                                    latest_number: evidence.latestNumber,
                                    evidence,
                                    ...(hasBankrollAudit ? { has_bankroll_audit: true } : {}),
                                    updated_at: new Date()
                                }
                            },
                            { new: true, upsert: true, setDefaultsOnInsert: true }
                        ).lean().exec();
                        if (!previous || previous.analyst_status !== 'complete') {
                            startTrackerAnalystReview(snapshot._id, evidence, key, numericTableId, latestSpinId);
                            TrackerAnalystSnapshot.deleteMany({
                                table_id: numericTableId,
                                spin_id: { $lt: latestSpinId - 200 },
                                has_bankroll_audit: { $ne: true },
                                bankroll_session_id: { $in: ['', null] }
                            })
                                .catch(error => console.warn('[Tracker Analyst] Snapshot cleanup failed:', error.message));
                        }
                        const recentReviews = await TrackerAnalystSnapshot.find({
                            table_id: numericTableId,
                            spin_id: { $lt: latestSpinId },
                            analyst_status: 'complete',
                            analyst_summary: { $ne: '' }
                        }).sort({ spin_id: -1 }).limit(2).select('spin_id analyst_model analyst_summary').lean().exec();
                        const analystContext = [
                            'EVIDENCIA DEL ANALISTA (descriptiva; no es una predicción ni una orden):',
                            JSON.stringify(evidence),
                            ...recentReviews.reverse().map(report => `Revision Qwen ${report.analyst_model} del giro ${report.spin_id}: ${report.analyst_summary}`),
                            'Usa las coincidencias solo si tienen muestra concreta; distingue datos recientes de históricos y considera el tamaño de muestra. Gemini conserva la decisión final.'
                        ].join('\n');
                        const lastMessage = requestMessages[requestMessages.length - 1];
                        if (typeof lastMessage.content === 'string') lastMessage.content += `\n\n${analystContext}`;
                        console.log('[Tracker Analyst] Evidence attached:', TRACKER_ANALYST_MODEL,
                            'table:', numericTableId, 'spin:', latestSpinId,
                            'similar sequences:', evidence.similarity.occurrences,
                            '15m spins:', evidence.fluctuation.last15Minutes.spins,
                            '60m spins:', evidence.fluctuation.last60Minutes.spins);
                    }
                }
            } catch (analystError) {
                console.warn('[Tracker Analyst] Evidence unavailable; Gemini continues with its current data:', analystError.message);
            }
            try {
                const tableNumber = Number(tableId);
                const predictionMode = ['n4', 'n9', 'both'].includes(predictionContext?.mode) ? predictionContext.mode : null;
                const modeFilter = predictionMode ? { prediction_mode: predictionMode } : {};
                const [predictionAudits, legacyAudits] = await Promise.all([
                    TrackerPredictionAudit.find({ table_id: tableNumber, result_spin_id: { $gt: 0 }, ...modeFilter })
                        .sort({ result_spin_id: -1 }).limit(240).lean().exec(),
                    TrackerAnalystSnapshot.find({
                        table_id: tableNumber,
                        result_spin_id: { $gt: 0 },
                        bankroll_session_id: { $nin: ['', null] },
                        ...modeFilter
                    }).sort({ result_spin_id: -1 }).limit(240)
                        .select('spin_id evidence.currentSequence evidence.regimes system_center system_metric_label system_reasoning system_won system_reward ai_center ai_metric_label ai_model ai_reasoning ai_won ai_reward result_spin_id result_number audited_at prediction_mode bankroll_session_id')
                        .lean().exec()
                ]);
                const relevantBaseSpinIds = Array.from(new Set([
                    ...predictionAudits.map(snapshot => Number(snapshot.spin_id)),
                    ...legacyAudits.map(snapshot => Number(snapshot.spin_id))
                ]));
                const analystEvidenceDocs = relevantBaseSpinIds.length
                    ? await TrackerAnalystSnapshot.find({ table_id: tableNumber, spin_id: { $in: relevantBaseSpinIds } })
                        .select('spin_id evidence.currentSequence evidence.regimes').lean().exec()
                    : [];
                const evidenceByBaseSpin = new Map(analystEvidenceDocs.map(snapshot => [Number(snapshot.spin_id), snapshot.evidence || {}]));
                const auditsByResult = new Map();
                for (const snapshot of legacyAudits) auditsByResult.set(Number(snapshot.result_spin_id), snapshot);
                for (const snapshot of predictionAudits) {
                    auditsByResult.set(Number(snapshot.result_spin_id), {
                        ...snapshot,
                        evidence: evidenceByBaseSpin.get(Number(snapshot.spin_id)) || {}
                    });
                }
                const auditSnapshots = Array.from(auditsByResult.values()).sort((left, right) => Number(right.result_spin_id) - Number(left.result_spin_id)).slice(0, 240);
                /* Legacy V1 sessions may have bank entries but no standalone audit row. */
                const auditedResults = new Set(auditSnapshots.map(snapshot => Number(snapshot.result_spin_id)));
                const makeAuditedEntry = snapshot => ({
                    _id: `audit:${snapshot.result_spin_id}`,
                    number: Number(snapshot.result_number),
                    round: Number(snapshot.result_spin_id),
                    created_at: snapshot.audited_at,
                    context_snapshot: {
                        history: Array.isArray(snapshot.evidence?.currentSequence) ? snapshot.evidence.currentSequence : [],
                        ai_center: snapshot.ai_center,
                        ai_metric_label: snapshot.ai_metric_label,
                        ai_model: snapshot.ai_model,
                        ai_reasoning: snapshot.ai_reasoning,
                        ai_won: snapshot.ai_won,
                        ai_reward: snapshot.ai_reward,
                        system_center: snapshot.system_center,
                        system_metric_label: snapshot.system_metric_label,
                        system_won: snapshot.system_won,
                        system_reward: snapshot.system_reward,
                        system_reasoning: snapshot.system_reasoning
                    }
                });
                const legacyAiEntries = await TrackerBankrollEntry.find({
                    table_id: tableNumber,
                    'context_snapshot.ai_won': { $in: [true, false] },
                    ...(predictionMode ? { 'context_snapshot.prediction_mode': predictionMode } : {})
                }).sort({ created_at: -1 }).limit(240).select('spin_key number context_snapshot.ai_center context_snapshot.ai_metric_label context_snapshot.ai_model context_snapshot.ai_reasoning context_snapshot.ai_won context_snapshot.history round created_at').lean().exec();
                const aiEntries = [
                    ...auditSnapshots.filter(snapshot => typeof snapshot.ai_won === 'boolean').map(makeAuditedEntry),
                    ...legacyAiEntries.filter(entry => !auditedResults.has(Number(String(entry.spin_key).split(':').pop())))
                ].sort((a, b) => Number(b.round || 0) - Number(a.round || 0)).slice(0, 120);
                const wins = aiEntries.filter(entry => entry.context_snapshot?.ai_won === true).length;
                const losses = aiEntries.filter(entry => entry.context_snapshot?.ai_won === false).length;
                const samples = aiEntries.slice(0, 12).reverse().map(entry => {
                    const history = Array.isArray(entry.context_snapshot?.history)
                        ? entry.context_snapshot.history.slice(-10).join(',') : '';
                    const reasoning = String(entry.context_snapshot?.ai_reasoning || '').replace(/\s+/g, ' ').slice(0, 150);
                    const metric = entry.context_snapshot.ai_metric_label || '?';
                    const model = entry.context_snapshot.ai_model ? ` ${entry.context_snapshot.ai_model}` : '';
                    return `${metric} IA${model}, centro ${entry.context_snapshot.ai_center}, ${entry.context_snapshot.ai_won ? 'acierto' : 'fallo'}${reasoning ? `; análisis: ${reasoning}` : ''}${history ? ` (previos ${history})` : ''}`;
                });
                const feedback = `RESULTADOS IA EN SESIONES: ${aiEntries.length} predicciones evaluadas, ${wins} aciertos y ${losses} fallos. ${samples.length ? `Muestras recientes: ${samples.join(' | ')}.` : 'Aún no hay resultados IA evaluados.'} Son datos de referencia; decide libremente según el análisis actual.`;
                const legacySystemEntries = await TrackerBankrollEntry.find({
                    table_id: tableNumber,
                    'context_snapshot.system_center': { $gte: 0, $lte: 36 },
                    ...(predictionMode ? { 'context_snapshot.prediction_mode': predictionMode } : {})
                }).sort({ created_at: -1 }).limit(240)
                    .select('_id spin_key number context_snapshot.system_center context_snapshot.system_metric_label context_snapshot.system_won context_snapshot.system_reward context_snapshot.system_reasoning context_snapshot.history round created_at')
                    .lean().exec();
                const systemBackfills = [];
                legacySystemEntries.forEach(entry => {
                    if (typeof entry.context_snapshot?.system_won === 'boolean') return;
                    const auditedHit = wheelNeighbors(Number(entry.context_snapshot.system_center), 4).includes(Number(entry.number));
                    entry.context_snapshot.system_won = auditedHit;
                    entry.context_snapshot.system_reward = auditedHit ? 1 : -1;
                    systemBackfills.push({
                        updateOne: {
                            filter: { _id: entry._id },
                            update: { $set: {
                                'context_snapshot.system_won': auditedHit,
                                'context_snapshot.system_reward': auditedHit ? 1 : -1
                            } }
                        }
                    });
                });
                if (systemBackfills.length) {
                    try {
                        await TrackerBankrollEntry.bulkWrite(systemBackfills, { ordered: false });
                        console.log('[Tracker AI] Backfilled system audit outcomes:', systemBackfills.length);
                    } catch (backfillError) {
                        console.warn('[Tracker AI] Could not persist legacy system audit backfill:', backfillError.message);
                    }
                }
                const systemEntries = [
                    ...auditSnapshots.filter(snapshot => Number.isInteger(Number(snapshot.system_center)) && typeof snapshot.system_won === 'boolean').map(makeAuditedEntry),
                    ...legacySystemEntries.filter(entry => !auditedResults.has(Number(String(entry.spin_key).split(':').pop())))
                ].sort((a, b) => Number(b.round || 0) - Number(a.round || 0)).slice(0, 120);
                const systemWins = systemEntries.filter(entry => entry.context_snapshot?.system_won === true).length;
                const systemLosses = systemEntries.filter(entry => entry.context_snapshot?.system_won === false).length;
                const systemReward = systemEntries.reduce((sum, entry) => sum + Number(entry.context_snapshot?.system_reward || 0), 0);
                const systemSamples = systemEntries.slice(0, 8).reverse().map(entry => {
                    const reasoning = entry.context_snapshot?.system_reasoning || {};
                    const history = Array.isArray(entry.context_snapshot?.history)
                        ? entry.context_snapshot.history.slice(-8).join(',') : '';
                    const direction = reasoning.direction || '?';
                    const confidence = Number.isFinite(Number(reasoning.consensus_confidence))
                        ? ` conf ${Math.round(Number(reasoning.consensus_confidence))}%` : '';
                    const state = reasoning.direction_state ? ` estado ${reasoning.direction_state}` : '';
                    const metric = entry.context_snapshot.system_metric_label || '?';
                    return `${metric} Sistema centro ${entry.context_snapshot.system_center}: ${entry.context_snapshot.system_won ? 'acierto (+1)' : 'fallo (-1)'}, ${direction}${confidence}${state}${history ? ` (previos ${history})` : ''}`;
                });
                const systemFeedback = `AUDITORÍA Y RECOMPENSA DEL SISTEMA: ${systemEntries.length} señales evaluadas (${systemWins} aciertos, ${systemLosses} fallos; recompensa acumulada ${systemReward >= 0 ? '+' : ''}${systemReward}, +1 acierto/-1 fallo). ${systemSamples.length ? `Muestras recientes con dirección, confianza y contexto: ${systemSamples.join(' | ')}.` : 'Aún no hay auditorías guardadas.'} Úsalo como evidencia secundaria para calibrar tu análisis; no copies automáticamente la señal del sistema ni trates la muestra como garantía.`;
                const patternGroups = new Map();
                const activeAiModel = `${provider}/${model}`;
                const addPatternOutcomes = (snapshot, predictor, won, metric, modelName = '') => {
                    if (typeof won !== 'boolean' || !metric) return;
                    for (const regime of Array.isArray(snapshot.evidence?.regimes) ? snapshot.evidence.regimes : []) {
                        const run = regime.currentRun;
                        if (!run || !run.state || !Number.isInteger(Number(run.length))) continue;
                        const length = Number(run.length) >= 3 ? '3+' : String(Number(run.length));
                        const key = `${predictor}|${metric}|${modelName}|${regime.key}|${run.state}|${length}`;
                        const group = patternGroups.get(key) || { predictor, metric, modelName, dimension: regime.key, state: run.state, length, n: 0, wins: 0 };
                        group.n++;
                        if (won) group.wins++;
                        patternGroups.set(key, group);
                    }
                };
                auditSnapshots.forEach(snapshot => {
                    addPatternOutcomes(snapshot, 'SISTEMA', snapshot.system_won, snapshot.system_metric_label || '?');
                    if (!snapshot.ai_model || snapshot.ai_model === activeAiModel) {
                        addPatternOutcomes(snapshot, 'IA', snapshot.ai_won, snapshot.ai_metric_label || '?', snapshot.ai_model || activeAiModel);
                    }
                });
                const patternLines = Array.from(patternGroups.values())
                    .filter(group => group.n >= 4)
                    .sort((left, right) => right.n - left.n || right.wins / right.n - left.wins / left.n)
                    .slice(0, 10)
                    .map(group => `${group.predictor} ${group.metric} ${group.dimension}=${group.state}×${group.length}: ${group.wins}/${group.n} (${Math.round(group.wins / group.n * 100)}%)`);
                const patternFeedback = `APRENDIZAJE DESCRIPTIVO POR RÉGIMEN (solo grupos con n≥4, mismo filtro ${predictionMode || 'sin filtro'}; IA acotada al modelo actual cuando hay etiqueta): ${patternLines.length ? patternLines.join(' | ') : 'Aún no hay muestra suficiente de sesiones con régimen guardado para estimar aciertos condicionados.'} Son asociaciones históricas, no causas ni garantías; no subas la confianza con muestras pequeñas.`;
                const lastMessage = requestMessages[requestMessages.length - 1];
                if (typeof lastMessage.content === 'string') lastMessage.content += `\n\n${feedback}\n\n${systemFeedback}\n\n${patternFeedback}`;
            } catch (learningError) {
                console.warn('[Tracker AI] No se pudo cargar aprendizaje de banca:', learningError.message);
            }
        }
        const orBody = {
            model: orModel,
            messages: [{ role: 'system', content: system }, ...requestMessages],
            temperature: 0.7,
            ...(isGeminiModel
                ? { reasoning: { effort: 'medium' }, max_tokens: purpose === 'prediction' ? 1536 : 1024 }
                : {
                    reasoning_effort: 'medium',
                    // Keep enough room for GPT-OSS reasoning and its concise N4 answer without
                    // letting prediction requests consume an oversized completion budget.
                    max_completion_tokens: purpose === 'prediction' ? 1536 : 1024
                })
        };
        const orHeaders = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key,
            'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost',
            'X-Title': 'Roulette-Classic'
        };
        const requestController = new AbortController();
        requestTimeout = setTimeout(() => {
            requestTimedOut = true;
            requestController.abort();
        }, purpose === 'prediction' ? 14000 : 60000);
        const orResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: orHeaders,
            body: JSON.stringify(orBody),
            signal: requestController.signal
        });
        if (!orResp.ok) {
            const orErr = await orResp.text().catch(() => '');
            clearTimeout(requestTimeout);
            console.error('[Tracker AI] OpenRouter HTTP', orResp.status, orErr);
            let orFriendly = 'OpenRouter HTTP ' + orResp.status;
            if (orErr.includes('auth') || orErr.includes('invalid') || orErr.includes('Invalid') || orResp.status === 401) {
                orFriendly = 'API key de OpenRouter invalida. Revisala en https://openrouter.ai/keys';
            } else if (orErr.includes('model') || orErr.includes('not found') || orResp.status === 404) {
                orFriendly = 'Modelo "' + orModel + '" no disponible en OpenRouter.';
            } else {
                orFriendly = orErr.substring(0, 200);
            }
            throw new Error(orFriendly);
        }
        const orData = await orResp.json();
        clearTimeout(requestTimeout);
        const choice = orData.choices?.[0];
        const message = choice?.message || {};
        const content = message.content;
        const responseText = typeof content === 'string'
            ? content.trim()
            : Array.isArray(content)
                ? content.map(part => typeof part === 'string' ? part : (part?.text || part?.content || '')).join('\n').trim()
                : typeof message.output_text === 'string' ? message.output_text.trim() : '';
        if (!responseText) {
            const finishReason = choice?.finish_reason || 'sin detalle';
            const refusal = String(message.refusal || '').trim();
            const detail = refusal
                ? `El proveedor rechazó la respuesta: ${refusal.slice(0, 180)}`
                : `El modelo no generó texto (finish_reason: ${finishReason}). Prueba de nuevo o selecciona otro modelo.`;
            throw new Error(detail);
        }
        const predictedCenter = responseText.match(/\bN4\s*:\s*(3[0-6]|[0-2]?\d)\b/i)?.[1] || 'invalid';
        console.log('[Tracker AI] OpenRouter success:', orModel, 'N4:', predictedCenter,
            'historyLength:', predictionContext?.history_length,
            'latestSpin:', predictionContext?.latest_spin,
            'response length:', responseText.length, 'duration_ms:', Date.now() - requestStartedAt);
        res.json({ success: true, response: responseText });
    } catch (err) {
        clearTimeout(requestTimeout);
        const errorMessage = requestTimedOut || err.name === 'AbortError'
            ? 'OpenRouter no completó la predicción dentro del límite de 15 segundos.'
            : err.message;
        console.error('[Tracker AI] ERROR:', errorMessage, 'duration_ms:', Date.now() - requestStartedAt);
        res.json({ success: false, error: errorMessage, provider: provider || 'openrouter' });
    }
});

app.get('/api/strategies', (req, res) => {
    try {
        const strategies = strategyStore.listStrategies({
            source: req.query.source,
            tableId: req.query.tableId,
            includeInactive: String(req.query.includeInactive || '').toLowerCase() === 'true'
        });
        res.json({
            count: strategies.length,
            strategies
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/strategies', (req, res) => {
    try {
        const saved = strategyStore.saveStrategy({
            source: req.body.source === 'ai' ? 'ai' : 'human',
            origin: req.body.origin || 'manual_api',
            tableId: req.body.tableId || 'global',
            name: req.body.name,
            summary: req.body.summary || req.body.note,
            pattern: req.body.pattern,
            trigger: req.body.trigger,
            action: req.body.action,
            tags: req.body.tags,
            status: req.body.status
        });

        if (!saved.ok) {
            return res.status(400).json({ error: saved.error });
        }

        res.json({ success: true, strategy: saved.strategy });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/ai/teach', async (req, res) => {
    const { patternDna, label, suggestedMove } = req.body;
    try {
        strategyStore.saveStrategy({
            source: 'human',
            origin: 'teach',
            tableId: req.body.tableId || 'global',
            name: label || 'Patron humano',
            summary: suggestedMove || 'Sin movimiento sugerido.',
            pattern: patternDna || '',
            trigger: req.body.trigger || '',
            action: suggestedMove || ''
        });

        db.addExpertRule({ pattern_dna: patternDna, label, suggested_move: suggestedMove, learned_from: 'human' }, (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Conceito aprendido y guardado.' });
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/spin', async (req, res) => {
    // ── NODO 1: INGESTA SÚPER RÁPIDA ──
    const { table_id, number, source, direction } = req.body || {};
    let currentHistory = [];
    if (table_id == null || number == null) return res.status(400).json({ error: 'table_id and number required' });
    if (number < 0 || number > 36) return res.status(400).json({ error: 'number must be 0-36' });
    const isMongo = db.getUseMongo();
    if (isMongo) {
        currentHistory = await Spin.find({ table_id }).sort({ id: -1 }).limit(100).exec();
        currentHistory.reverse();
    } else {
        currentHistory = await new Promise((resolve, reject) => {
            db.getHistory(table_id, 100, (err, rows) => {
                if (err) reject(err);
                else resolve(Array.isArray(rows) ? rows : []);
            });
        });
    }
    if (isLiveDuplicateSpin(currentHistory, req.body)) {
        return res.json({ status: 'ignored_duplicate', table_id, number });
    }

    // Persist first: the crawler retries this event if MongoDB cannot confirm it.
    (async () => {
        try {
            if (ntfyCooldowns[table_id] && ntfyCooldowns[table_id] > 0) {
                ntfyCooldowns[table_id]--;
            }

            let savedSpinId = null;
            const numsOnly = currentHistory.map(s => s.number);

            resolvePendingAiPredictions(table_id, number);

            const prevSpin = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1] : null;
            const prevNumber = prevSpin ? prevSpin.number : null;
            const physics = agent5.getPhysics(prevNumber, number);
            const sector = agent5.getSector(number);

            // EVALUACIÓN DE AGENTES DEL TIRO ANTERIOR
            if (isMongo && prevSpin && prevSpin.predictions) {
                prevSpin.results = {
                    agent1_result: agent5.evaluatePrediction(number, prevSpin.predictions.agent1_top),
                    agent2_result: agent5.evaluatePrediction(number, prevSpin.predictions.agent2_top),
                    agent3_result: agent5.evaluatePrediction(number, prevSpin.predictions.agent3_top),
                    agent4_result: agent5.evaluatePrediction(number, prevSpin.predictions.agent4_top)
                };
                await prevSpin.save();
            }

            numsOnly.push(number);

            // PATTERN MEMORY (Mongo focus, JSON-sync skipped for performance)
            if (isMongo && numsOnly.length >= 6) {
                try {
                    const Pattern = require('./models/Pattern');
                    const last6 = numsOnly.slice(-6); 
                    const jumps = [];
                    for (let i = 1; i < last6.length; i++) {
                        const p = agent5.getPhysics(last6[i-1], last6[i]);
                        const mag = (p.distance === 'Big' || p.distance === 'ULTRA') ? 'B' : 'S';
                        let dir = 'CW';
                        if (p.direction === 'IZQUIERDA') dir = 'CCW';
                        jumps.push({ mag, dir });
                    }
                    const seq = jumps.slice(0, 4);
                    const outcome = jumps[4];
                    const seqMag = seq.map(x => x.mag).join('');
                    const seqDir = seq.map(x => x.dir).join('');
                    
                    const newPattern = new Pattern({
                        table_id: String(table_id),
                        sequence_mag: seqMag,
                        sequence_dir: seqDir,
                        next_mag: outcome.mag,
                        next_dir: outcome.dir
                    });
                    await newPattern.save();
                } catch (err) { console.error('[DB] Pattern save err:', err.message); }
            }

            // PREDICCIONES FUTURAS (Optimizado: Cálculo Plano Inmediato)
            let newPredictions = { agent1_top: null, agent2_top: null, agent3_top: null, agent4_top: null, master_target: null, master_confidence: null, analyst_dir: null, analyst_size: null, zone_magnitude: null, zone_direction: null };
            if (numsOnly.length >= 3) {
                const nextRound = predictor.projectNextRound(numsOnly, {});
                const signature = predictor.computeDealerSignature(numsOnly);
                const masterSignals = predictor.getIAMasterSignals(nextRound, signature, numsOnly);

                if (masterSignals && masterSignals.length > 0) {
                    const ag1 = masterSignals.find(s => s.name === 'Android n17');
                    const ag2 = masterSignals.find(s => s.name === 'Android n16');
                    const ag3 = masterSignals.find(s => s.name === 'Android 1717');
                    const ag4 = masterSignals.find(s => s.name === 'N18');
                    if (ag1) newPredictions.agent1_top = ag1.number;
                    if (ag2 && ag2.tp !== undefined) newPredictions.agent2_top = ag2.tp;
                    if (ag3) newPredictions.agent3_top = ag3.number;
                    if (ag4) newPredictions.agent4_top = ag4.number;
                }

                const travels = [];
                for (let i = 1; i < numsOnly.length; i++) {
                    travels.push(predictor.getDistance(numsOnly[i-1], numsOnly[i]));
                }
                const analystPred = predictor.analyzeTravelWave(travels);
                if (analystPred) {
                    newPredictions.analyst_dir = analystPred.targetDir || null;
                    newPredictions.analyst_size = analystPred.size || null;
                }
                const zonePred = predictor.predictZonePattern(numsOnly, null);
                if (zonePred) {
                    newPredictions.zone_magnitude = zonePred.magnitude || null;
                    newPredictions.zone_direction = zonePred.direction || null;
                }
                if (analystPred && zonePred) {
                    const masterPred = predictor.analyzeMasterConfluence(numsOnly, analystPred, zonePred, {});
                    if (masterPred) {
                        newPredictions.master_target = masterPred.target || null;
                        newPredictions.master_confidence = masterPred.confidence || null;
                    }
                }
            }

            // EXPORTAR A DB PARA QUE CUANDO EL CLIENTE RECARGUE ESTÉ TODO LINCADO
            if (isMongo) {
                let savedSpin = null, attempts = 0;
                while (!savedSpin && attempts < 5) {
                    try {
                        const maxSpin = await Spin.findOne().sort('-id').exec();
                        const newId = maxSpin ? maxSpin.id + 1 : 1;
                        const newSpin = new Spin({
                            schema_version: 2,
                            id: newId,
                            table_id,
                            table_code: 'AUTO',
                            number,
                            source: source || 'bot',
                            source_quality: source === 'casino_org_live' || source === 'public_scraper' ? 'live' : 'manual',
                            session_id: req.body.session_id || '',
                            round_key: req.body.round_key || req.body.event_id || '',
                            event_id: req.body.event_id || null,
                            raw_history: Array.isArray(req.body.raw_history) ? req.body.raw_history : [],
                            distance: physics.distance, direction: direction || physics.direction, sector,
                            predictions: newPredictions,
                            observed_at: req.body.observed_at || new Date(),
                            ingested_at: new Date()
                        });
                        savedSpin = await newSpin.save();
                        savedSpinId = savedSpin.id;
                    } catch (err) {
                        if (err.code === 11000 && err.keyPattern && err.keyPattern.id) attempts++;
                        else throw err;
                    }
                }
            } else {
                savedSpinId = await new Promise(resolve => {
                    db.addSpin(table_id, number, source || 'bot', {
                        event_id: req.body.event_id,
                        source_quality: source === 'casino_org_live' || source === 'public_scraper' ? 'live' : 'manual',
                        session_id: req.body.session_id || '',
                        round_key: req.body.round_key || req.body.event_id || '',
                        raw_history: Array.isArray(req.body.raw_history) ? req.body.raw_history : [],
                        observed_at: req.body.observed_at || new Date().toISOString()
                    }, (err, id) => {
                        if (err) console.error('[DB] JSON spin save err:', err.message);
                        resolve(id || null);
                    });
                });
            }

            if (savedSpinId) {
                if (!res.headersSent) res.json({ status: 'saved', table_id, number, spin_id: savedSpinId });
                const snapshot = persistIngestMetricSnapshot(table_id, savedSpinId, numsOnly, source || 'bot');
                persistTableStateSnapshot(table_id, savedSpinId, snapshot);
                persistDominanceAiPrediction(table_id, savedSpinId, snapshot);
                if (sseClients[table_id]) {
                    sseClients[table_id].forEach(client => {
                        client.write(`data: ${JSON.stringify({ type: 'new_spin', number, spin_id: savedSpinId, spin_key: `${table_id}:${savedSpinId}`, ready: true })}\n\n`);
                    });
                }
                
                // Forest engine: observe which metrics predicted correctly
                if (snapshot && snapshot.routes) {
                    try {
                        const fmem = forest.loadForest();
                        const ctx = {
                            stability: snapshot.stability_level || 'red',
                            pattern: snapshot.pattern_label || 'unknown',
                            dominant_axis: snapshot.dominant_axis || 'none'
                        };
                        const { wheelNeighbors } = require('./src/engine/analytics_snapshot');
                        const metrics = [
                            { id: 'cw_n9', target: snapshot.routes.cw?.n9, radius: 9 },
                            { id: 'cw_n4s', target: snapshot.routes.cw?.n4Small, radius: 4 },
                            { id: 'cw_n4b', target: snapshot.routes.cw?.n4Big, radius: 4 },
                            { id: 'ccw_n4s', target: snapshot.routes.ccw?.n4Small, radius: 4 },
                            { id: 'ccw_n4b', target: snapshot.routes.ccw?.n4Big, radius: 4 }
                        ];
                        metrics.forEach(m => {
                            if (m.target != null && Number.isInteger(m.target)) {
                                const hit = wheelNeighbors(m.target, m.radius).includes(number);
                                forest.observe(fmem, ctx, m.id, hit);
                            }
                        });
                    } catch (fe) { /* forest observe non-critical */ }
                }
            }

        } catch(e) {
            console.error('[Spin Ingest Err]', e);
            if (!res.headersSent) res.status(503).json({ error: 'No se pudo guardar el giro en MongoDB.', code: 'SPIN_NOT_PERSISTED' });
        }
    })();
});

// ── Forest Engine API ────────────────────────────────────
app.get('/api/forest/discoveries', (req, res) => {
    try {
        const fmem = forest.loadForest();
        const promoted = forest.getPromotedDiscoveries(fmem);
        const rlContexts = forest.getRlBestContexts(fmem);
        res.json({
            total: fmem.discoveries.length,
            promoted: promoted.length,
            discoveries: promoted,
            rlBestContexts: rlContexts
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Spin Method API (post-mortem analysis) ──────────────
app.get('/api/spin-method/analyze/:tableId', async (req, res) => {
    try {
        const tableId = req.params.tableId;
        const results = await spinMethod.analyze(db, tableId);
        res.json(results);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/spin-method/results', (req, res) => {
    try {
        if (fs.existsSync(spinMethod.ANALYSIS_FILE)) {
            const data = JSON.parse(fs.readFileSync(spinMethod.ANALYSIS_FILE, 'utf8'));
            res.json(data);
        } else {
            res.json({ status: 'no_data', message: 'No hay analisis aun. Ejecuta /api/spin-method/analyze/:tableId' });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auto-run analysis every 5 minutes ──────────────────
setInterval(async () => {
    try {
        await spinMethod.analyze(db, 1);
    } catch (e) { /* silent */ }
}, 5 * 60 * 1000);

// Batch import (for manual/automatic history sync)
app.post('/api/spin/batch', async (req, res) => {
    const { table_id, numbers, source } = req.body || {};
    if (!table_id || !Array.isArray(numbers)) {
        return res.status(400).json({ error: 'table_id and numbers[] required' });
    }

    let inserted = 0;
    const errors = [];
    const cleanNumbers = numbers
        .map(n => Number(n))
        .filter(n => Number.isInteger(n));
    let rollingHistory = await new Promise(resolve => {
        db.getHistory(table_id, 100, (err, rows) => {
            if (err || !Array.isArray(rows)) return resolve([]);
            resolve(rows.map(row => Number(row.number)).filter(n => Number.isInteger(n)));
        });
    });

    for (const n of cleanNumbers) {
        if (n < 0 || n > 36) {
            errors.push(n);
            continue;
        }

        let savedBatchSpinId = null;
        await new Promise(resolve => {
            db.addSpin(table_id, n, source || 'batch', {}, (err, id) => {
                if (err) errors.push({ number: n, error: err.message });
                else {
                    inserted++;
                    savedBatchSpinId = id || null;
                }
                resolve();
            });
        });

        if (savedBatchSpinId || source === 'batch') {
            resolvePendingAiPredictions(table_id, n);
            rollingHistory.push(n);
            const snapshot = persistIngestMetricSnapshot(table_id, savedBatchSpinId, rollingHistory, source || 'batch');
            persistTableStateSnapshot(table_id, savedBatchSpinId, snapshot);
            persistDominanceAiPrediction(table_id, savedBatchSpinId, snapshot);
        }
    }

    if (sseClients[table_id]) {
        sseClients[table_id].forEach(client => {
            client.write(`data: ${JSON.stringify({ type: 'batch_load', inserted })}\n\n`);
        });
    }

    res.json({ inserted, errors });
});

app.delete('/api/history/:tableId', (req, res) => {
    db.clearHistory(req.params.tableId, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/history/:tableId', async (req, res) => {
    const tableId = req.params.tableId;
    const limit = parseInt(req.query.limit) || 100;
    try {
        db.getHistory(tableId, limit, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Real-time prediction endpoint (called at page load)
app.get('/api/predict/:tableId', async (req, res) => {
    const tableId = req.params.tableId;
    try {
        let spins = [];
        const isMongo = db.getUseMongo();
        if (isMongo) {
            spins = await Spin.find({ table_id: tableId }).sort({ id: -1 }).limit(100).exec();
            spins.reverse();
        } else {
            spins = await new Promise((resolve, reject) => {
                db.getHistory(tableId, 100, (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
        }
        const numsOnly = spins.map(s => s.number);
        if (numsOnly.length < 3) return res.json({ agent5_top: null, message: 'Not enough data' });

        // Fast prediction pipeline (No 400-spin history loop)
        const nextRound = predictor.projectNextRound(numsOnly, {});
        const signature = predictor.computeDealerSignature(numsOnly);
        const masterSignals = predictor.getIAMasterSignals(nextRound, signature, numsOnly);
        
        let predictions = { agent1_top: null, agent2_top: null, agent3_top: null, agent4_top: null, agent5_top: null };
        if (masterSignals && masterSignals.length > 0) {
            const ag1 = masterSignals.find(s => s.name === 'Android n17');
            const ag2 = masterSignals.find(s => s.name === 'Android n16');
            const ag3 = masterSignals.find(s => s.name === 'Android 1717');
            const ag4 = masterSignals.find(s => s.name === 'N18');
            if (ag1) predictions.agent1_top = ag1.number;
            if (ag2 && ag2.tp !== undefined) predictions.agent2_top = ag2.tp;
            if (ag3) predictions.agent3_top = ag3.number;
            if (ag4) predictions.agent4_top = ag4.number;
        }

        // Agent 5 Neural Logic (V5 Learning)
        const jumpsA5 = [];
        for (let i = 1; i < numsOnly.slice(-5).length; i++) {
            const p = agent5.getPhysics(numsOnly.slice(-5)[i-1], numsOnly.slice(-5)[i]);
            jumpsA5.push({ mag: (p.distance==='Big'||p.distance==='ULTRA')?'B':'S', dir: p.direction==='IZQUIERDA'?'CCW':'CW' });
        }
        const seqMA5 = jumpsA5.map(x=>x.mag).join('');
        const seqDA5 = jumpsA5.map(x=>x.dir).join('');
        const dnaA5 = `${seqMA5}|${seqDA5}`;

        const expert = await new Promise(r => db.getExpertRule(dnaA5, (err, rule) => r(rule)));
        const stats = await new Promise(r => db.getPatternStats(tableId, seqMA5, seqDA5, (err, s) => r(s)));
        
        predictions.agent5_top = await agent5.predictAgent5(numsOnly, expert, stats);
        
        res.json(predictions);
    } catch (e) {
        console.error('Predict endpoint error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/fix-urls', async (req, res) => {
    try {
        if (db.getUseMongo()) {
            const Table = require('./models/Table');
            await Table.updateOne({ id: 1 }, { $set: { url: 'https://www.casino.org/casinoscores/es/auto-roulette/' } });
            await Table.updateOne({ id: 2 }, { $set: { url: 'https://www.casino.org/casinoscores/es/immersive-roulette/' } });
            res.send('✅ URLs de MongoDB Atlas actualizadas a Casino.org.');
        } else {
            res.send('⚠️ No se está usando MongoDB, cambio ignorado.');
        }
    } catch (e) {
        res.status(500).send('❌ Error: ' + e.message);
    }
});

// DELETE all spins for all tables (frontend "Wipe All" button)
app.delete('/api/wipe-all', async (req, res) => {
    try {
        console.log('🧹 [Wipe All] Triggering full database cleaning...');
        db.wipeAllSpins((err, gen) => {
            if (err) return res.status(500).json({ error: err.message });
            // Broadcast wipe to ALL connected devices so they clear instantly
            Object.keys(sseClients).forEach(tableId => {
                sseClients[tableId].forEach(client => {
                    try { client.write('data: {"type":"wipe"}\n\n'); } catch(e) {}
                });
            });
            console.log('[Wipe All] SSE wipe broadcast enviado a todos los dispositivos conectados.');
            res.json({ success: true, message: 'Base operativa vaciada por completo.', wipeGeneration: gen });
        });
    } catch (e) {
        console.error('Wipe failed:', e);
        res.status(500).json({ error: e.message });
    }
});

// Get wipe generation (for cross-device sync)
app.get('/api/wipe-generation', (req, res) => {
    res.json({ wipeGeneration: db.getWipeGeneration() });
});

app.get('/api/stats/:tableId', (req, res) => {
    db.getStats(req.params.tableId, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

// ─── Sync Log: append V1/V2 results per spin (ligero, incremental) ───
app.post('/api/sync-log/:tableId', (req, res) => {
    try {
        db.appendSyncLog(req.params.tableId, req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/sync-log/:tableId', (req, res) => {
    try {
        const afterIdx = parseInt(req.query.localCount || '0');
        const data = db.getSyncLog(req.params.tableId, afterIdx);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Legacy endpoints (backward compat) ───
app.get('/api/sync-state/:tableId', (req, res) => {
    try {
        const data = db.getV1V2History(req.params.tableId);
        res.json(data || { analyst: [], master: [], analystV2: [], sniperV2: [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sync-state/:tableId', (req, res) => {
    try {
        db.saveV1V2History(req.params.tableId, req.body);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v1v2-history/:tableId', (req, res) => {
    try {
        const data = db.getV1V2History(req.params.tableId);
        res.json(data || { analyst: [], master: [], analystV2: [], sniperV2: [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1v2-history/:tableId', (req, res) => {
    try {
        db.saveV1V2History(req.params.tableId, req.body);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════ NUKE: Wipe total via navegador ═══════════
app.get('/nuke', async (req, res) => {
    if (!db.getUseMongo()) return res.status(503).send('MongoDB Atlas desconectado. No se modificó ningún dato.');
    try {
        db.wipeAllSpins((err) => {
            if (err) console.error('Nuke DB error:', err);
            // Broadcast wipe to all connected SSE clients
            Object.keys(sseClients).forEach(tableId => {
                sseClients[tableId].forEach(client => {
                    try { client.write('data: {"type":"wipe"}\n\n'); } catch(e) {}
                });
            });
        });
        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NUKE</title>
<style>body{background:#0a0e1a;color:#f55;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;font-size:18px;text-align:center;}</style></head>
<body><div><p>&#9762;&#65039; LIMPIANDO TODO...</p><small id="msg"></small></div>
<script>
(function(){
    var keys = Object.keys(localStorage).filter(function(k){ return k.startsWith('clasi_roulette_'); });
    var el = document.getElementById('msg');
    el.innerText = 'Borrando ' + keys.length + ' keys de localStorage...';
    keys.forEach(function(k){ localStorage.removeItem(k); });
    localStorage.clear();
    sessionStorage.clear();
    setTimeout(function(){ el.innerText = 'Hecho. Redirigiendo...'; setTimeout(function(){ location.href='/'; }, 800); }, 400);
})();
</script></body></html>`);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
});

// Catch-all: Siempre servir el frontend para cualquier ruta no reconocida (Middleware final)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ---- Start ----

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎰 Roulette Predictor Server running at http://0.0.0.0:${PORT}`);
    console.log(`   API ready at:          http://0.0.0.0:${PORT}/api/\n`);
    console.log(`[AI] Provider preference: ${getPreferredLlmProvider()} | Ollama: ${hasOllamaConfigured() ? OLLAMA_BASE_URL : 'not configured'} | Auto remote analysis: ${AUTO_AI_REMOTE_ANALYSIS}`);

    if (String(process.env.DISABLE_BOTS || '').toLowerCase() === 'true') {
        console.log('[BOOT] Automatic casino.org crawler disabled by DISABLE_BOTS=true.');
    } else {
        console.log('[BOOT] Starting crawler independently of MongoDB availability.');
        startCrawlerIfEnabled();
    }

    databaseReady.then(async () => {
        if (!db.getUseMongo()) return;
        try {
            const Table = require('./models/Table');
            await Table.updateOne({ id: 1 }, { $set: { name: 'Auto Roulette', url: 'https://www.casino.org/casinoscores/es/auto-roulette/' } });
            await Table.updateOne({ id: 2 }, { $set: { name: 'Inmersive Roulette', url: 'https://www.casino.org/casinoscores/es/immersive-roulette/' } });
            console.log('✅ [BOOT] Table names synchronized with focused config.');
        } catch (e) {
            console.error('❌ [BOOT] Table sync error:', e.message);
        }
    }).catch(error => console.error('[BOOT] Database initialization failed:', error.message));
});

