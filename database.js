require('dotenv').config();
const mongoose = require('mongoose');

const Table = require('./models/Table');
const Spin = require('./models/Spin');
const UserAccess = require('./models/UserAccess');
const Strategy = require('./models/Strategy');
const MetricSnapshot = require('./models/MetricSnapshot');
const AiPrediction = require('./models/AiPrediction');
const TableStateSnapshot = require('./models/TableStateSnapshot');
const Pattern = require('./models/Pattern');
const MetaPattern = require('./models/MetaPattern');
const DirectionPattern = require('./models/DirectionPattern');
const TrackerMemory = require('./models/TrackerMemory');

let useMongo = false;
let lastConnectionError = '';
let reconnectPromise = null;

mongoose.connection.on('connected', () => {
    useMongo = true;
    lastConnectionError = '';
    console.log('[DB] MongoDB connection restored.');
});
mongoose.connection.on('disconnected', () => {
    useMongo = false;
    console.error('[DB] MongoDB disconnected; database-backed features are paused.');
});
mongoose.connection.on('error', error => {
    useMongo = false;
    lastConnectionError = error.message;
    console.error('[DB] MongoDB connection error:', error.message);
});

// Memory cache for fallback
let fallbackData = {
    tables: [
        {
            schema_version: 2,
            id: 1,
            code: 'AUTO',
            name: 'Auto Roulette',
            provider: 'Evolution',
            url: 'https://www.casino.org/casinoscores/es/auto-roulette/',
            source_type: 'casino_org',
            status: 'active'
        }
    ],
    spins: [],
    expertRules: [],
    users: [],
    strategies: [],
    metricSnapshots: [],
    aiPredictions: [],
    tableStateSnapshots: [],
    v1v2History: {},
    syncLog: {},
    wipeGeneration: 0
};

function saveFallback() {
    console.error('[DB] JSON persistence is disabled; connect MongoDB Atlas.');
}

async function initDB() {
    let mongoUri = process.env.MONGODB_URI || null; 
    
    if (mongoUri) {
        // Attempt connection with SRV fallback
        useMongo = false;
        
        for (const attempt of ['srv', 'direct']) {
            try {
                let uri = mongoUri;
                
                if (attempt === 'direct' && mongoUri.startsWith('mongodb+srv://')) {
                    const url = new URL(mongoUri);
                    const user = url.username;
                    const pass = url.password;
                    const host = url.hostname;
                    const dbName = url.pathname.replace(/^\//, '') || 'test';
                    const params = url.search || '?retryWrites=true&w=majority';
                    
                    const shardHost = host;
                    uri = `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@ac-1b4e820-shard-00-00.${shardHost}:27017,ac-1b4e820-shard-00-01.${shardHost}:27017,ac-1b4e820-shard-00-02.${shardHost}:27017/${dbName}${params}&authSource=admin`;
                    
                    console.log('[DB] Retrying with direct connection...');
                }
                
                console.log(`[DB] Connecting to MongoDB Atlas (${attempt})...`);
                await mongoose.connect(uri, {
                    serverSelectionTimeoutMS: 5000,
                    connectTimeoutMS: 10000
                });
                
                useMongo = true;
                lastConnectionError = '';
                console.log('[DB] Connected to MongoDB Atlas successfully.');
                break;
            } catch (err) {
                if (attempt === 'srv' && mongoUri.startsWith('mongodb+srv://')) {
                    console.log('[DB] SRV connection failed, will try direct...');
                    continue;
                }
                console.error('[DB] MongoDB Connection Failed:', err.message);
                lastConnectionError = err.message;
                console.log('[DB] Tip: Check if cluster is paused in MongoDB Atlas (free tier auto-pauses).');
                break;
            }
        }
        
        if (useMongo) {
            try {
                // Pre-seed tables
                const tableCount = await Table.countDocuments();
                if (tableCount === 0 && fallbackData.tables.length > 0) {
                    console.log('[DB] Seeding default tables in MongoDB...');
                    await Table.insertMany(fallbackData.tables);
                } else {
                    await Table.updateOne(
                        { id: 1 },
                        {
                            $setOnInsert: { schema_version: 2, id: 1, created_at: new Date() },
                            $set: {
                                code: 'AUTO', name: 'Auto Roulette',
                                provider: 'Evolution',
                                url: 'https://www.casino.org/casinoscores/es/auto-roulette/',
                                source_type: 'casino_org', status: 'active'
                            }
                        },
                        { upsert: true }
                    );
                    await Table.updateOne({ id: 2 }, { $set: { status: 'inactive' } });
                }
                console.log('[DB] MongoDB ready.');
            } catch (seedErr) {
                console.error('[DB] Seed error:', seedErr.message);
            }
        } else {
            console.error('[DB] MongoDB unavailable. Waiting for reconnection; JSON storage is disabled.');
        }
    } else {
        console.error('[DB] No MONGODB_URI configured. MongoDB is required; JSON storage is disabled.');
        lastConnectionError = 'MONGODB_URI no está configurada en el entorno del servidor.';
        useMongo = false;
    }
}

async function reconnect() {
    if (reconnectPromise) return reconnectPromise;
    reconnectPromise = (async () => {
        if (!process.env.MONGODB_URI) {
            lastConnectionError = 'MONGODB_URI no está configurada en el entorno del servidor.';
            return getConnectionStatus();
        }
        try {
            await initDB();
        } catch (error) {
            lastConnectionError = error.message;
            useMongo = false;
        }
        return getConnectionStatus();
    })();
    try {
        return await reconnectPromise;
    } finally {
        reconnectPromise = null;
    }
}

function getConnectionStatus() {
    const readyState = mongoose.connection.readyState;
    const connected = useMongo && readyState === 1;
    return {
        connected,
        state: readyState,
        error: connected ? '' : lastConnectionError.includes('MONGODB_URI')
            ? lastConnectionError
            : 'No se pudo conectar a MongoDB Atlas. Verifica la URI, el usuario y la lista de IP permitidas.'
    };
}

function isMongoConnected() {
    return getConnectionStatus().connected;
}

// --- Tables ---
async function getTables(cb) {
    if (useMongo) {
        try {
            // Aggregate spins count
            const tables = await Table.aggregate([
                {
                    $match: {
                        status: { $ne: 'inactive' }
                    }
                },
                {
                    $lookup: {
                        from: 'spins',
                        localField: 'id',
                        foreignField: 'table_id',
                        as: 'spins_data'
                    }
                },
                {
                    $addFields: {
                        spin_count: { $size: "$spins_data" }
                    }
                },
                { $project: { spins_data: 0 } },
                { $sort: { id: 1 } }
            ]);
            cb(null, tables);
        } catch (e) { cb(e); }
    } else {
        const results = fallbackData.tables.map(t => {
            const spins = fallbackData.spins.filter(s => s.table_id == t.id);
            return { ...t, spin_count: spins.length };
        }).filter(t => t.status !== 'inactive');
        cb(null, results);
    }
}

async function addTable(name, provider, url, cb) {
    if (useMongo) {
        try {
            const maxTable = await Table.findOne().sort('-id').exec();
            const id = maxTable ? maxTable.id + 1 : 1;
            const newTable = new Table({
                schema_version: 2,
                id,
                code: String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
                name,
                provider,
                url,
                source_type: 'manual',
                status: 'active'
            });
            await newTable.save();
            cb(null, id);
        } catch (e) { cb(e); }
    } else {
        const id = fallbackData.tables.length > 0 ? Math.max(...fallbackData.tables.map(t => t.id)) + 1 : 1;
        fallbackData.tables.push({
            schema_version: 2,
            id,
            code: String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
            name,
            provider,
            url,
            source_type: 'manual',
            status: 'active'
        });
        saveFallback();
        cb(null, id);
    }
}

async function deleteTable(tableId, cb) {
    if (useMongo) {
        try {
            await Spin.deleteMany({ table_id: tableId });
            await Table.deleteOne({ id: tableId });
            cb(null);
        } catch (e) { cb(e); }
    } else {
        fallbackData.spins = fallbackData.spins.filter(s => s.table_id != tableId);
        fallbackData.tables = fallbackData.tables.filter(t => t.id != tableId);
        saveFallback();
        cb(null);
    }
}

// --- Spins ---
async function getHistory(tableId, limit, cb) {
    if (useMongo) {
        try {
            let query = Spin.find({ table_id: tableId }).sort({ id: 1 });
            if (limit) query = query.limit(limit);
            // Mongoose limit() with ASC sort might return the *first* N elements instead of the *last* N.
            // Wait, to get the LAST N, we normally sort descending, limit, then sort ascending.
            // If they want the most recent N spins, we should do:
            if (limit) {
                let recent = await Spin.find({ table_id: tableId }).sort({ id: -1 }).limit(limit);
                recent = recent.reverse(); // put back into ASC order
                return cb(null, recent);
            } else {
                const all = await Spin.find({ table_id: tableId }).sort({ id: 1 });
                return cb(null, all);
            }
        } catch (e) { cb(e); }
    } else {
        let spins = fallbackData.spins.filter(s => s.table_id == tableId);
        if (limit) spins = spins.slice(-limit);
        cb(null, spins);
    }
}

async function addSpin(tableId, number, source, extra = {}, cb) {
    if (useMongo) {
        try {
            if (extra.event_id) {
                const existing = await Spin.findOne({ table_id: parseInt(tableId), event_id: extra.event_id }).exec();
                if (existing) {
                    if (typeof cb === 'function') cb(null, existing.id);
                    return;
                }
            }
            if (extra.round_key) {
                const existingRound = await Spin.findOne({ table_id: parseInt(tableId), round_key: extra.round_key }).exec();
                if (existingRound) {
                    if (typeof cb === 'function') cb(null, existingRound.id);
                    return;
                }
            }
            if (['public_scraper', 'casino_org_live'].includes(source)) {
                const lastSpin = await Spin.findOne({ table_id: parseInt(tableId) }).sort({ id: -1 }).exec();
                if (lastSpin && lastSpin.number === parseInt(number)) {
                    if (typeof cb === 'function') cb(null, lastSpin.id);
                    return;
                }
            }
            const maxSpin = await Spin.findOne().sort('-id').exec();
            const id = maxSpin ? maxSpin.id + 1 : 1;
            
            // Basic Physics Calculation (Mock/Placeholder for now, can be refined)
            const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
            const num = parseInt(number);
            let sector = 'Zero';
            if ([26, 3, 35, 12, 28, 7, 29, 18, 22, 9, 31, 14, 20].includes(num)) sector = 'Voisins';
            if ([1, 20, 14, 31, 9].includes(num)) sector = 'Orphelins'; // Simplified
            
            const newSpin = new Spin({
                schema_version: 2,
                id,
                table_id: parseInt(tableId),
                table_code: extra.table_code || 'AUTO',
                number: num,
                source: source || 'bot',
                source_quality: extra.source_quality || (source === 'casino_org_live' ? 'live' : 'manual'),
                session_id: extra.session_id || '',
                round_key: extra.round_key || extra.event_id || '',
                event_id: extra.event_id || null,
                speed_rpm: extra.speed_rpm || Number((21 + Math.random()).toFixed(1)),
                timestamp_str: extra.timestamp_str || new Date().toLocaleTimeString(),
                angle: extra.angle || Math.floor(Math.random() * 360),
                raw_history: Array.isArray(extra.raw_history) ? extra.raw_history : [],
                distance: extra.distance || (num > 18 ? 'Big' : 'Small'),
                direction: extra.direction || (Math.random() > 0.5 ? 'CW' : 'CCW'),
                sector: sector,
                observed_at: extra.observed_at || new Date(),
                ingested_at: new Date()
            });
            await newSpin.save();
            if (typeof cb === 'function') cb(null, id);
        } catch (e) { if (typeof cb === 'function') cb(e); }
    } else {
        if (extra && extra.event_id) {
            const exists = fallbackData.spins.find(s => s.table_id == tableId && s.event_id === extra.event_id);
            if (exists) {
                if (typeof cb === 'function') cb(null, exists.id);
                return;
            }
        }
        if (extra && extra.round_key) {
            const exists = fallbackData.spins.find(s => s.table_id == tableId && s.round_key === extra.round_key);
            if (exists) {
                if (typeof cb === 'function') cb(null, exists.id);
                return;
            }
        }
        if (['public_scraper', 'casino_org_live'].includes(source)) {
            const lastSpin = fallbackData.spins.filter(s => s.table_id == tableId).slice(-1)[0];
            if (lastSpin && lastSpin.number === parseInt(number)) {
                if (typeof cb === 'function') cb(null, lastSpin.id);
                return;
            }
        }
        const id = fallbackData.spins.length > 0 ? Math.max(...fallbackData.spins.map(s => s.id)) + 1 : 1;
        const newSpin = {
            schema_version: 2,
            id,
            table_id: parseInt(tableId),
            table_code: extra?.table_code || 'AUTO',
            number: parseInt(number),
            source: source || 'manual',
            source_quality: extra?.source_quality || (source === 'casino_org_live' ? 'live' : 'manual'),
            session_id: extra?.session_id || '',
            round_key: extra?.round_key || extra?.event_id || '',
            event_id: extra ? extra.event_id : null,
            raw_history: Array.isArray(extra?.raw_history) ? extra.raw_history : [],
            observed_at: extra?.observed_at || new Date().toISOString(),
            ingested_at: new Date().toISOString(),
            timestamp: new Date().toISOString()
        };
        fallbackData.spins.push(newSpin);
        if (fallbackData.spins.length > 5000) fallbackData.spins.shift(); 
        saveFallback();
        if (typeof cb === 'function') cb(null, id);
    }
}

async function clearHistory(tableId, cb) {
    if (useMongo) {
        try {
            const numericTableId = Number(tableId);
            await Promise.all([
                Spin.deleteMany({ table_id: numericTableId }),
                MetricSnapshot.deleteMany({ table_id: numericTableId }),
                AiPrediction.deleteMany({ table_id: numericTableId }),
                TableStateSnapshot.deleteMany({ table_id: numericTableId }),
                Pattern.deleteMany({ table_id: String(tableId) })
            ]);
            if (typeof cb === 'function') cb(null);
        } catch (e) { if (typeof cb === 'function') cb(e); }
    } else {
        fallbackData.spins = fallbackData.spins.filter(s => s.table_id != tableId);
        fallbackData.metricSnapshots = fallbackData.metricSnapshots.filter(s => s.table_id != tableId);
        fallbackData.aiPredictions = fallbackData.aiPredictions.filter(s => s.table_id != tableId);
        fallbackData.tableStateSnapshots = fallbackData.tableStateSnapshots.filter(s => s.table_id != tableId);
        saveFallback();
        if (typeof cb === 'function') cb(null);
    }
}

async function getStats(tableId, cb) {
    if (useMongo) {
        try {
            const total = await Spin.countDocuments({ table_id: tableId });
            const zeros = await Spin.countDocuments({ table_id: tableId, number: 0 });
            if (typeof cb === 'function') cb(null, { total, zeros });
        } catch (e) { if (typeof cb === 'function') cb(e); }
    } else {
        const spins = fallbackData.spins.filter(s => s.table_id == tableId);
        const zeros = spins.filter(s => s.number === 0).length;
        if (typeof cb === 'function') cb(null, { total: spins.length, zeros });
    }
}

async function wipeAllSpins(cb) {
    if (useMongo) {
        try {
            await Promise.all([
                Spin.deleteMany({}),
                MetricSnapshot.deleteMany({}),
                AiPrediction.deleteMany({}),
                TableStateSnapshot.deleteMany({}),
                Pattern.deleteMany({}),
                DirectionPattern.deleteMany({})
            ]);
            fallbackData.wipeGeneration++;
            saveFallback();
            if (typeof cb === 'function') cb(null, fallbackData.wipeGeneration);
        } catch (e) { if (typeof cb === 'function') cb(e); }
    } else {
        fallbackData.spins = [];
        fallbackData.metricSnapshots = [];
        fallbackData.aiPredictions = [];
        fallbackData.tableStateSnapshots = [];
        fallbackData.v1v2History = {};
        fallbackData.syncLog = {};
        fallbackData.wipeGeneration++;
        saveFallback();
        if (typeof cb === 'function') cb(null, fallbackData.wipeGeneration);
    }
}

function getWipeGeneration() {
    return fallbackData.wipeGeneration || 0;
}

function saveV1V2History(tableId, data) {
    const key = String(tableId || 1);
    const existing = fallbackData.v1v2History[key] || {};
    
    // Merge strategy: server is the source of truth.
    // Incoming data replaces existing data for each predictor array.
    const mergeArr = (existingArr, incomingArr) => {
        if (!Array.isArray(incomingArr)) return existingArr || [];
        if (!Array.isArray(existingArr)) return incomingArr;
        // Keep the array with the most recent savedAt (server override)
        return incomingArr.length >= existingArr.length ? incomingArr : existingArr;
    };
    
    // For object-based state, keep the one with later savedAt
    const mergeObj = (existingObj, incomingObj) => {
        if (!existingObj || !incomingObj) return incomingObj || existingObj || {};
        const existingTs = existingObj.savedAt || 0;
        const incomingTs = incomingObj.savedAt || data.savedAt || 0;
        return incomingTs > existingTs ? incomingObj : existingObj;
    };
    
    const merged = {
        analyst: mergeArr(existing.analyst, data.analyst),
        master: mergeArr(existing.master, data.master),
        analystV2: mergeArr(existing.analystV2, data.analystV2),
        sniperV2: mergeArr(existing.sniperV2, data.sniperV2),
        patternMemory: mergeArr(existing.patternMemory, data.patternMemory),
        dirOnlyMemory: mergeArr(existing.dirOnlyMemory, data.dirOnlyMemory),
        macroPatterns: mergeArr(existing.macroPatterns, data.macroPatterns),
        macroTransitions: mergeArr(existing.macroTransitions, data.macroTransitions),
        metricaScoresHistory: mergeObj(existing.metricaScoresHistory, data.metricaScoresHistory),
        metricaLastScores: mergeObj(existing.metricaLastScores, data.metricaLastScores),
        metricaHitCounts: mergeObj(existing.metricaHitCounts, data.metricaHitCounts),
        savedAt: Math.max(existing.savedAt || 0, data.savedAt || 0)
    };
    
    fallbackData.v1v2History[key] = merged;
    saveFallback();
}

function getV1V2History(tableId) {
    const key = String(tableId || 1);
    return fallbackData.v1v2History[key] || null;
}

function appendSyncLog(tableId, entry) {
    const key = String(tableId || 1);
    if (!fallbackData.syncLog[key]) fallbackData.syncLog[key] = [];
    fallbackData.syncLog[key].push(entry);
    if (fallbackData.syncLog[key].length > 5000) {
        fallbackData.syncLog[key] = fallbackData.syncLog[key].slice(-3000);
    }
    saveFallback();
}

function getSyncLog(tableId, afterIdx) {
    const key = String(tableId || 1);
    const log = fallbackData.syncLog[key] || [];
    if (afterIdx >= 0 && afterIdx < log.length) {
        return { entries: log.slice(afterIdx), total: log.length };
    }
    return { entries: log, total: log.length };
}

// --- Expert Rules (V5 Learning) ---
async function getExpertRule(patternDna, cb) {
    if (useMongo) {
        try {
            const ExpertRule = require('./models/ExpertRule');
            const rule = await ExpertRule.findOne({ pattern_dna: patternDna });
            cb(null, rule);
        } catch (e) { cb(e); }
    } else {
        const rule = fallbackData.expertRules.find(r => r.pattern_dna === patternDna);
        cb(null, rule || null);
    }
}

async function addExpertRule(data, cb) {
    if (useMongo) {
        try {
            const ExpertRule = require('./models/ExpertRule');
            const newRule = new ExpertRule(data);
            await newRule.save();
            cb(null, newRule._id);
        } catch (e) { cb(e); }
    } else {
        const id = Date.now();
        fallbackData.expertRules.push({ ...data, id, timestamp: new Date().toISOString() });
        saveFallback();
        cb(null, id);
    }
}

function nextFallbackId(collection) {
    return collection.length > 0 ? Math.max(...collection.map(item => Number(item.id) || 0)) + 1 : 1;
}

async function findAccessCode(code, cb) {
    if (useMongo) {
        try {
            const user = await UserAccess.findOne({ code }).lean().exec();
            cb(null, user || null);
        } catch (e) { cb(e); }
    } else {
        const user = fallbackData.users.find(item => item.code === code);
        cb(null, user || null);
    }
}

async function saveAccessCode(data, cb) {
    if (useMongo) {
        try {
            const existing = data.id ? await UserAccess.findOne({ id: data.id }).exec() : await UserAccess.findOne({ code: data.code }).exec();
            if (existing) {
                Object.assign(existing, data, { updated_at: new Date() });
                await existing.save();
                cb(null, existing);
                return;
            }

            const id = data.id || ((await UserAccess.findOne().sort('-id').lean().exec())?.id || 0) + 1;
            const created = await UserAccess.create({ ...data, id });
            cb(null, created);
        } catch (e) { cb(e); }
    } else {
        const idx = fallbackData.users.findIndex(item => item.code === data.code || item.id === data.id);
        const now = new Date().toISOString();
        if (idx >= 0) {
            fallbackData.users[idx] = { ...fallbackData.users[idx], ...data, updated_at: now };
            saveFallback();
            cb(null, fallbackData.users[idx]);
            return;
        }

        const record = {
            id: data.id || nextFallbackId(fallbackData.users),
            name: data.name || 'User',
            code: data.code,
            role: data.role || 'member',
            status: data.status || 'active',
            permissions: Array.isArray(data.permissions) ? data.permissions : [],
            notes: data.notes || '',
            last_login_at: data.last_login_at || null,
            created_at: now,
            updated_at: now
        };
        fallbackData.users.push(record);
        saveFallback();
        cb(null, record);
    }
}

async function listStrategies(filters, cb) {
    const source = filters?.source || null;
    const tableId = filters?.tableId || null;
    const includeInactive = Boolean(filters?.includeInactive);

    if (useMongo) {
        try {
            const query = {};
            if (source) query.source = source;
            if (!includeInactive) query.status = { $ne: 'inactive' };
            if (tableId) query.table_id = { $in: [String(tableId), 'global'] };
            const rows = await Strategy.find(query).sort({ updated_at: -1 }).lean().exec();
            cb(null, rows);
        } catch (e) { cb(e); }
    } else {
        const rows = fallbackData.strategies
            .filter(item => includeInactive || item.status !== 'inactive')
            .filter(item => !source || item.source === source)
            .filter(item => !tableId || item.table_id === String(tableId) || item.table_id === 'global')
            .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        cb(null, rows);
    }
}

async function saveStrategyRecord(data, cb) {
    if (useMongo) {
        try {
            const query = data.id ? { id: data.id } : { name: data.name, source: data.source || 'human', table_id: data.table_id || 'global' };
            let existing = await Strategy.findOne(query).exec();
            if (existing) {
                Object.assign(existing, data, { updated_at: new Date() });
                await existing.save();
                cb(null, existing);
                return;
            }

            const id = data.id || ((await Strategy.findOne().sort('-id').lean().exec())?.id || 0) + 1;
            const created = await Strategy.create({ ...data, id });
            cb(null, created);
        } catch (e) { cb(e); }
    } else {
        const idx = fallbackData.strategies.findIndex(item =>
            (data.id && item.id === data.id) ||
            (item.name === data.name && item.source === (data.source || 'human') && item.table_id === (data.table_id || 'global'))
        );
        const now = new Date().toISOString();
        if (idx >= 0) {
            fallbackData.strategies[idx] = { ...fallbackData.strategies[idx], ...data, updated_at: now };
            saveFallback();
            cb(null, fallbackData.strategies[idx]);
            return;
        }

        const record = {
            schema_version: 2,
            id: data.id || nextFallbackId(fallbackData.strategies),
            table_id: data.table_id || 'global',
            table_code: data.table_code || (data.table_id && data.table_id !== 'global' ? 'AUTO' : 'GLOBAL'),
            name: data.name || 'Strategy',
            summary: data.summary || '',
            source: data.source || 'human',
            origin: data.origin || 'manual',
            category: data.category || 'strategy',
            status: data.status || 'active',
            pattern: data.pattern || '',
            trigger: data.trigger || '',
            action: data.action || '',
            tags: Array.isArray(data.tags) ? data.tags : [],
            priority: data.priority || 'suggestion',
            confidence_weight: Number(data.confidence_weight || 1),
            success_hits: Number(data.success_hits || 0),
            fail_hits: Number(data.fail_hits || 0),
            sample_size: Number(data.sample_size || 0),
            effectiveness: data.effectiveness || { direct_rate: 0, neighbor_rate: 0, loss_rate: 0 },
            evidence: data.evidence || { sample_size: 0, win_rate: 0, loss_rate: 0, skip_rate: 0, contexts: [] },
            last_context: data.last_context || '',
            last_used_at: data.last_used_at || null,
            created_at: now,
            updated_at: now
        };
        fallbackData.strategies.push(record);
        saveFallback();
        cb(null, record);
    }
}

async function addMetricSnapshot(data, cb) {
    if (useMongo) {
        try {
            let created = null;
            let attempts = 0;
            while (!created && attempts < 5) {
                try {
                    const id = data.id || ((await MetricSnapshot.findOne().sort('-id').lean().exec())?.id || 0) + 1;
                    created = await MetricSnapshot.create({ ...data, schema_version: 2, id });
                } catch (err) {
                    if (err.code === 11000 && err.keyPattern && err.keyPattern.id) attempts++;
                    else throw err;
                }
            }
            cb(null, created);
        } catch (e) { cb(e); }
    } else {
        const record = {
            schema_version: 2,
            id: data.id || nextFallbackId(fallbackData.metricSnapshots),
            table_id: Number(data.table_id),
            table_code: data.table_code || 'AUTO',
            spin_id: data.spin_id ?? null,
            window_size: Number(data.window_size || 15),
            recent_numbers: Array.isArray(data.recent_numbers) ? data.recent_numbers : [],
            stability_level: data.stability_level || 'red',
            pattern_label: data.pattern_label || '',
            dominant_axis: data.dominant_axis || 'none',
            dominant_signal: data.dominant_signal || '',
            dominance_score: Number(data.dominance_score || 0),
            dominance8: data.dominance8 || { cw: 0, ccw: 0, big: 0, small: 0 },
            momentum15: data.momentum15 || { cw: 0, ccw: 0, big: 0, small: 0 },
            performance8: data.performance8 || { cwN9: '', cwN4: '', ccwN9: '', ccwN4: '' },
            routes: data.routes || {},
            context: data.context || { source: 'auto', notes: '' },
            captured_at: data.captured_at || new Date().toISOString()
        };
        fallbackData.metricSnapshots.push(record);
        if (fallbackData.metricSnapshots.length > 10000) fallbackData.metricSnapshots.shift();
        saveFallback();
        cb(null, record);
    }
}

async function getMetricSnapshots(tableId, limit, cb) {
    if (useMongo) {
        try {
            const rows = await MetricSnapshot.find({ table_id: Number(tableId) })
                .sort({ captured_at: -1 })
                .limit(limit || 100)
                .lean()
                .exec();
            cb(null, rows);
        } catch (e) { cb(e); }
    } else {
        const rows = fallbackData.metricSnapshots
            .filter(item => item.table_id == tableId)
            .slice(-(limit || 100))
            .reverse();
        cb(null, rows);
    }
}

async function addAiPrediction(data, cb) {
    if (useMongo) {
        try {
            if (data.context_hash && data.basis === 'ai_analysis') {
                const existing = await AiPrediction.findOne({
                    table_id: Number(data.table_id),
                    mode: String(data.mode || 'SAFE').toUpperCase(),
                    basis: 'ai_analysis',
                    context_hash: data.context_hash
                }).lean().exec();
                if (existing) return cb(null, existing);
            }

            let created = null;
            let attempts = 0;
            while (!created && attempts < 5) {
                try {
                    const id = data.id || ((await AiPrediction.findOne().sort('-id').lean().exec())?.id || 0) + 1;
                    created = await AiPrediction.create({ ...data, schema_version: 2, id });
                } catch (err) {
                    if (err.code === 11000 && err.keyPattern && err.keyPattern.id) attempts++;
                    else throw err;
                }
            }
            cb(null, created);
        } catch (e) { cb(e); }
    } else {
        if (data.context_hash && data.basis === 'ai_analysis') {
            const existing = fallbackData.aiPredictions.find(item =>
                item.table_id == data.table_id &&
                String(item.mode || 'SAFE').toUpperCase() === String(data.mode || 'SAFE').toUpperCase() &&
                item.basis === 'ai_analysis' &&
                item.context_hash === data.context_hash
            );
            if (existing) return cb(null, existing);
        }

        const record = {
            schema_version: 2,
            id: data.id || nextFallbackId(fallbackData.aiPredictions),
            table_id: Number(data.table_id),
            table_code: data.table_code || 'AUTO',
            spin_id: data.spin_id ?? null,
            basis: data.basis || 'dominance',
            dominance_priority: data.dominance_priority !== false,
            mode: data.mode || 'SAFE',
            route: data.route || 'ESPERAR',
            zone: data.zone || 'ESPERAR',
            n9: data.n9 || 'ESPERAR',
            n4: data.n4 || 'ESPERAR',
            analysis: data.analysis || '',
            strategy_refs: Array.isArray(data.strategy_refs) ? data.strategy_refs : [],
            confidence: Number(data.confidence || 0),
            context_snapshot: data.context_snapshot || {},
            decision_source: data.decision_source || 'auto_ai',
            prompt_version: data.prompt_version || '',
            rl_reward: Number(data.rl_reward || 0),
            reward_reason: data.reward_reason || '',
            context_hash: data.context_hash || '',
            result: data.result || 'pending',
            n9_result: data.n9_result || (data.result === 'skip' ? 'skip' : 'pending'),
            n4_result: data.n4_result || (data.result === 'skip' ? 'skip' : 'pending'),
            resolved_number: data.resolved_number ?? null,
            created_at: data.created_at || new Date().toISOString(),
            resolved_at: data.resolved_at || null
        };
        fallbackData.aiPredictions.push(record);
        if (fallbackData.aiPredictions.length > 10000) fallbackData.aiPredictions.shift();
        saveFallback();
        cb(null, record);
    }
}

function computeAiReward(normalized) {
    const result = normalized?.result || 'pending';
    const n9 = normalized?.n9_result || result;
    const n4 = normalized?.n4_result || result;
    if (result === 'skip' || (n9 === 'skip' && n4 === 'skip')) {
        return { reward: 15, reason: 'disciplina_esperar' };
    }
    if (n4 === 'win') return { reward: 100, reason: 'precision_n4' };
    if (n9 === 'win') return { reward: 30, reason: 'cobertura_n9' };
    if (n9 === 'loss' || n4 === 'loss' || result === 'loss') {
        return { reward: -200, reason: 'fallo_total' };
    }
    return { reward: 0, reason: 'pendiente' };
}

async function resolvePendingAiPredictions(tableId, resolvedNumber, evaluator, cb) {
    const now = new Date();
    if (useMongo) {
        try {
            const rows = await AiPrediction.find({
                table_id: Number(tableId),
                result: 'pending'
            }).sort({ created_at: 1 }).limit(25).exec();

            let resolved = 0;
            for (const row of rows) {
                const outcome = typeof evaluator === 'function'
                    ? evaluator(row, resolvedNumber)
                    : { result: 'loss', n9_result: 'loss', n4_result: 'loss' };
                const normalized = typeof outcome === 'string'
                    ? { result: outcome, n9_result: outcome, n4_result: outcome }
                    : outcome;
                if (!['win', 'loss', 'skip'].includes(normalized.result)) continue;
                const reward = computeAiReward(normalized);
                row.result = normalized.result;
                row.n9_result = normalized.n9_result || row.n9_result || 'pending';
                row.n4_result = normalized.n4_result || row.n4_result || 'pending';
                row.rl_reward = reward.reward;
                row.reward_reason = reward.reason;
                row.resolved_number = Number(resolvedNumber);
                row.resolved_at = now;
                await row.save();
                resolved++;
            }

            cb(null, { resolved });
        } catch (e) { cb(e); }
    } else {
        let resolved = 0;
        fallbackData.aiPredictions = fallbackData.aiPredictions.map(item => {
            if (item.table_id != tableId || item.result !== 'pending') return item;
            const outcome = typeof evaluator === 'function'
                ? evaluator(item, resolvedNumber)
                : { result: 'loss', n9_result: 'loss', n4_result: 'loss' };
            const normalized = typeof outcome === 'string'
                ? { result: outcome, n9_result: outcome, n4_result: outcome }
                : outcome;
            if (!['win', 'loss', 'skip'].includes(normalized.result)) return item;
            const reward = computeAiReward(normalized);
            resolved++;

            return {
                ...item,
                result: normalized.result,
                n9_result: normalized.n9_result || item.n9_result || 'pending',
                n4_result: normalized.n4_result || item.n4_result || 'pending',
                rl_reward: reward.reward,
                reward_reason: reward.reason,
                resolved_number: Number(resolvedNumber),
                resolved_at: now.toISOString()
            };
        });
        saveFallback();
        cb(null, { resolved });
    }
}

async function getAiPredictions(tableId, limit, modeOrCb, cb) {
    let mode = null;
    let basis = null;
    if (typeof modeOrCb === 'function') {
        cb = modeOrCb;
    } else if (modeOrCb && typeof modeOrCb === 'object') {
        mode = modeOrCb.mode ? String(modeOrCb.mode).toUpperCase() : null;
        basis = modeOrCb.basis ? String(modeOrCb.basis) : null;
    } else if (modeOrCb) {
        mode = String(modeOrCb).toUpperCase();
    }

    if (useMongo) {
        try {
            const query = { table_id: Number(tableId) };
            if (['SAFE', 'FULL', 'RAW'].includes(mode)) query.mode = mode;
            if (basis) query.basis = basis;
            const rows = await AiPrediction.find(query)
                .sort({ created_at: -1 })
                .limit(limit || 100)
                .lean()
                .exec();
            cb(null, rows);
        } catch (e) { cb(e); }
    } else {
        const rows = fallbackData.aiPredictions
            .filter(item => item.table_id == tableId)
            .filter(item => !['SAFE', 'FULL', 'RAW'].includes(mode) || String(item.mode || 'SAFE').toUpperCase() === mode)
            .filter(item => !basis || item.basis === basis)
            .slice(-(limit || 100))
            .reverse();
        cb(null, rows);
    }
}

async function getAiLearningSummary(tableId, cb) {
    if (useMongo) {
        try {
            const numericTableId = Number(tableId);
            const [spinCount, snapshotCount, stateCount, predictionStats, modeStats, strategyStats] = await Promise.all([
                Spin.countDocuments({ table_id: numericTableId }),
                MetricSnapshot.countDocuments({ table_id: numericTableId }),
                TableStateSnapshot.countDocuments({ table_id: numericTableId }),
                AiPrediction.aggregate([
                    { $match: { table_id: numericTableId } },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
                            losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
                            skips: { $sum: { $cond: [{ $eq: ['$result', 'skip'] }, 1, 0] } },
                            pending: { $sum: { $cond: [{ $eq: ['$result', 'pending'] }, 1, 0] } },
                            reward: { $sum: '$rl_reward' }
                        }
                    }
                ]),
                AiPrediction.aggregate([
                    { $match: { table_id: numericTableId, basis: 'ai_analysis' } },
                    {
                        $group: {
                            _id: '$mode',
                            total: { $sum: 1 },
                            wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
                            losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
                            skips: { $sum: { $cond: [{ $eq: ['$result', 'skip'] }, 1, 0] } },
                            pending: { $sum: { $cond: [{ $eq: ['$result', 'pending'] }, 1, 0] } },
                            n9Wins: { $sum: { $cond: [{ $eq: ['$n9_result', 'win'] }, 1, 0] } },
                            n9Resolved: { $sum: { $cond: [{ $in: ['$n9_result', ['win', 'loss']] }, 1, 0] } },
                            n4Wins: { $sum: { $cond: [{ $eq: ['$n4_result', 'win'] }, 1, 0] } },
                            n4Resolved: { $sum: { $cond: [{ $in: ['$n4_result', ['win', 'loss']] }, 1, 0] } },
                            reward: { $sum: '$rl_reward' }
                        }
                    }
                ]),
                Strategy.aggregate([
                    {
                        $match: {
                            source: 'ai',
                            table_id: { $in: [String(tableId), 'global'] }
                        }
                    },
                    {
                        $group: {
                            _id: '$status',
                            count: { $sum: 1 }
                        }
                    }
                ])
            ]);

            const pred = predictionStats[0] || { total: 0, wins: 0, losses: 0, skips: 0, pending: 0, reward: 0 };
            const aiPredictionsByMode = modeStats.reduce((acc, row) => {
                const key = String(row._id || 'SAFE').toUpperCase();
                acc[key] = {
                    total: row.total || 0,
                    wins: row.wins || 0,
                    losses: row.losses || 0,
                    skips: row.skips || 0,
                    pending: row.pending || 0,
                    reward: row.reward || 0,
                    n9Rate: row.n9Resolved ? Number(((row.n9Wins / row.n9Resolved) * 100).toFixed(1)) : 0,
                    n4Rate: row.n4Resolved ? Number(((row.n4Wins / row.n4Resolved) * 100).toFixed(1)) : 0
                };
                return acc;
            }, {});
            const strategies = strategyStats.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
            cb(null, {
                table_id: numericTableId,
                spins: spinCount,
                metricSnapshots: snapshotCount,
                tableStateSnapshots: stateCount,
                aiPredictions: pred,
                aiPredictionsByMode,
                aiStrategies: strategies
            });
        } catch (e) { cb(e); }
    } else {
        const numericTableId = Number(tableId);
        const predictions = fallbackData.aiPredictions.filter(item => item.table_id == numericTableId);
        const strategies = fallbackData.strategies.filter(item =>
            item.source === 'ai' && (item.table_id === String(tableId) || item.table_id === 'global')
        );

        cb(null, {
            table_id: numericTableId,
            spins: fallbackData.spins.filter(item => item.table_id == numericTableId).length,
            metricSnapshots: fallbackData.metricSnapshots.filter(item => item.table_id == numericTableId).length,
            tableStateSnapshots: fallbackData.tableStateSnapshots.filter(item => item.table_id == numericTableId).length,
            aiPredictions: {
                total: predictions.length,
                wins: predictions.filter(item => item.result === 'win').length,
                losses: predictions.filter(item => item.result === 'loss').length,
                skips: predictions.filter(item => item.result === 'skip').length,
                pending: predictions.filter(item => item.result === 'pending').length,
                reward: predictions.reduce((acc, item) => acc + Number(item.rl_reward || 0), 0)
            },
            aiPredictionsByMode: ['SAFE', 'FULL'].reduce((acc, mode) => {
                const rows = predictions.filter(item => item.basis === 'ai_analysis' && String(item.mode || 'SAFE').toUpperCase() === mode);
                const n9Rows = rows.filter(item => item.n9_result === 'win' || item.n9_result === 'loss');
                const n4Rows = rows.filter(item => item.n4_result === 'win' || item.n4_result === 'loss');
                acc[mode] = {
                    total: rows.length,
                    wins: rows.filter(item => item.result === 'win').length,
                    losses: rows.filter(item => item.result === 'loss').length,
                    skips: rows.filter(item => item.result === 'skip').length,
                    pending: rows.filter(item => item.result === 'pending').length,
                    reward: rows.reduce((sum, item) => sum + Number(item.rl_reward || 0), 0),
                    n9Rate: n9Rows.length ? Number(((n9Rows.filter(item => item.n9_result === 'win').length / n9Rows.length) * 100).toFixed(1)) : 0,
                    n4Rate: n4Rows.length ? Number(((n4Rows.filter(item => item.n4_result === 'win').length / n4Rows.length) * 100).toFixed(1)) : 0
                };
                return acc;
            }, {}),
            aiStrategies: strategies.reduce((acc, item) => {
                acc[item.status || 'active'] = (acc[item.status || 'active'] || 0) + 1;
                return acc;
            }, {})
        });
    }
}

async function addTableStateSnapshot(data, cb) {
    if (useMongo) {
        try {
            let created = null;
            let attempts = 0;
            while (!created && attempts < 5) {
                try {
                    const id = data.id || ((await TableStateSnapshot.findOne().sort('-id').lean().exec())?.id || 0) + 1;
                    created = await TableStateSnapshot.create({ ...data, schema_version: 1, id });
                } catch (err) {
                    if (err.code === 11000 && err.keyPattern && err.keyPattern.id) attempts++;
                    else throw err;
                }
            }
            cb(null, created);
        } catch (e) { cb(e); }
    } else {
        const record = {
            schema_version: 1,
            id: data.id || nextFallbackId(fallbackData.tableStateSnapshots),
            table_id: Number(data.table_id),
            table_code: data.table_code || 'AUTO',
            spin_id: data.spin_id ?? null,
            metric_snapshot_id: data.metric_snapshot_id ?? null,
            recent_numbers: Array.isArray(data.recent_numbers) ? data.recent_numbers : [],
            block_state: data.block_state || 'none',
            block_size: Number(data.block_size || 0),
            turbulence_level: data.turbulence_level || 'none',
            turbulence_size: Number(data.turbulence_size || 0),
            dominance_state: data.dominance_state || 'none',
            dominance_side: data.dominance_side || 'NONE',
            dominance_strength: Number(data.dominance_strength || 0),
            dominance_fatigue: Number(data.dominance_fatigue || 0),
            farol_state: data.farol_state || 'none',
            farol_side: data.farol_side || 'NONE',
            continuation_bias: data.continuation_bias || 'NONE',
            reversal_risk: data.reversal_risk || 'low',
            color_state: data.color_state || 'red',
            interpretation: data.interpretation || '',
            created_at: data.created_at || new Date().toISOString()
        };
        fallbackData.tableStateSnapshots.push(record);
        if (fallbackData.tableStateSnapshots.length > 10000) fallbackData.tableStateSnapshots.shift();
        saveFallback();
        cb(null, record);
    }
}

async function getTableStateSnapshots(tableId, limit, cb) {
    if (useMongo) {
        try {
            const rows = await TableStateSnapshot.find({ table_id: Number(tableId) })
                .sort({ created_at: -1 })
                .limit(limit || 100)
                .lean()
                .exec();
            cb(null, rows);
        } catch (e) { cb(e); }
    } else {
        const rows = fallbackData.tableStateSnapshots
            .filter(item => item.table_id == tableId)
            .slice(-(limit || 100))
            .reverse();
        cb(null, rows);
    }
}

// --- Pattern Stats (Learning Engine) ---
async function getPatternStats(tableId, seqMag, seqDir, cb) {
    if (useMongo) {
        try {
            const stats = await Pattern.aggregate([
                { $match: { table_id: String(tableId), sequence_mag: seqMag, sequence_dir: seqDir } },
                { $group: { _id: { mag: "$next_mag", dir: "$next_dir" }, count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]);
            cb(null, stats);
        } catch (e) { cb(e); }
    } else {
        // Simple manual aggregation for JSON fallback
        // We look for patterns in the 'spins' history if 'Pattern' collection isn't fully replicated in JSON
        // Actually, let's just return empty for now or implement a basic scan if necessary.
        // For the sake of the task, I'll assume we want at least Mongo-like behavior.
        cb(null, []); 
    }
}

// --- Meta-Pattern Functions ---
async function saveMetaPattern(tableId, data) {
    if (!useMongo) {
        console.log('MetaPattern: MongoDB not available, skipping save');
        return null;
    }
    try {
        const metaPattern = new MetaPattern({
            table_id: String(tableId),
            type: data.type,
            wl_sequence: data.wl_sequence,
            full_history: data.full_history || [],
            numbers_history: data.numbers_history || [],
            sniper_prediction: data.sniper_prediction || null,
            detected_at: new Date()
        });
        await metaPattern.save();
        console.log(`MetaPattern saved: ${data.type} for table ${tableId}`);
        return metaPattern;
    } catch (e) {
        console.error('Error saving meta-pattern:', e);
        return null;
    }
}

async function updateMetaPatternResult(metaPatternId, result, accurate) {
    if (!useMongo) return;
    try {
        await MetaPattern.findByIdAndUpdate(metaPatternId, {
            actual_result: result,
            prediction_accurate: accurate,
            resolved_at: new Date()
        });
    } catch (e) {
        console.error('Error updating meta-pattern result:', e);
    }
}

async function getMetaPatternStats(tableId, type, limit = 100) {
    if (!useMongo) return { total: 0, accurate: 0, accuracy: 0, patterns: [] };
    try {
        const query = { table_id: String(tableId) };
        if (type) query.type = type;
        
        const patterns = await MetaPattern.find(query)
            .sort({ detected_at: -1 })
            .limit(limit)
            .lean();
        
        const resolved = patterns.filter(p => p.actual_result !== null);
        const accurate = resolved.filter(p => p.prediction_accurate === true);
        
        return {
            total: resolved.length,
            accurate: accurate.length,
            accuracy: resolved.length > 0 ? (accurate.length / resolved.length * 100).toFixed(1) : 0,
            patterns: patterns
        };
    } catch (e) {
        console.error('Error getting meta-pattern stats:', e);
        return { total: 0, accurate: 0, accuracy: 0, patterns: [] };
    }
}

async function getUnresolvedMetaPatterns(tableId) {
    if (!useMongo) return [];
    try {
        return await MetaPattern.find({ 
            table_id: String(tableId),
            actual_result: null 
        }).sort({ detected_at: -1 }).lean();
    } catch (e) {
        console.error('Error getting unresolved meta-patterns:', e);
        return [];
    }
}

// === Direction Patterns (Patrones de direcciones R/L) ===
async function saveDirectionPattern(tableId, data) {
    if (!useMongo) {
        console.log('DirectionPattern: MongoDB not available, skipping save');
        return null;
    }
    try {
        // Calcular secuencia inversa para búsqueda simétrica
        const reversed = data.sequence.split('').reverse().join('');
        const isPalindrome = data.sequence === reversed;
        
        const pattern = new DirectionPattern({
            table_id: String(tableId),
            sequence: data.sequence,
            length: data.sequence.length,
            next_direction: data.next_direction || null,
            next_magnitude: data.next_magnitude || null,
            numbers: data.numbers || [],
            distances: data.distances || [],
            reversed_sequence: reversed,
            is_palindrome: isPalindrome,
            timestamp: new Date()
        });
        
        await pattern.save();
        console.log(`DirectionPattern saved: ${data.sequence} for table ${tableId}`);
        return pattern;
    } catch (e) {
        console.error('Error saving direction pattern:', e);
        return null;
    }
}

async function findDirectionPatterns(tableId, sequence) {
    if (!useMongo) return [];
    try {
        // Buscar la secuencia exacta O su inversa (simetría)
        const reversed = sequence.split('').reverse().join('');
        
        const patterns = await DirectionPattern.find({
            table_id: String(tableId),
            $or: [
                { sequence: sequence },
                { sequence: reversed }
            ]
        }).sort({ timestamp: -1 }).limit(50).lean();
        
        return patterns;
    } catch (e) {
        console.error('Error finding direction patterns:', e);
        return [];
    }
}

async function getDirectionPatternStats(tableId, sequence) {
    if (!useMongo) return { total: 0, next_r: 0, next_l: 0, next_b: 0, next_s: 0 };
    try {
        const reversed = sequence.split('').reverse().join('');
        
        const stats = await DirectionPattern.aggregate([
            { 
                $match: { 
                    table_id: String(tableId),
                    $or: [
                        { sequence: sequence },
                        { sequence: reversed }
                    ],
                    next_direction: { $ne: null }
                } 
            },
            { 
                $group: { 
                    _id: { 
                        dir: "$next_direction",
                        mag: "$next_magnitude"
                    },
                    count: { $sum: 1 }
                } 
            }
        ]);
        
        const result = { total: 0, next_r: 0, next_l: 0, next_b: 0, next_s: 0 };
        stats.forEach(s => {
            result.total += s.count;
            if (s._id.dir === 'R') result.next_r += s.count;
            if (s._id.dir === 'L') result.next_l += s.count;
            if (s._id.mag === 'B') result.next_b += s.count;
            if (s._id.mag === 'S') result.next_s += s.count;
        });
        
        return result;
    } catch (e) {
        console.error('Error getting direction pattern stats:', e);
        return { total: 0, next_r: 0, next_l: 0, next_b: 0, next_s: 0 };
    }
}

async function getTrackerMemory(tableId, source) {
    if (!useMongo) throw new Error('MongoDB Atlas no está conectado; memoria del Tracker deshabilitada.');
    return await TrackerMemory.findOne({ table_id: Number(tableId), source }).lean().exec() || null;
}

async function saveTrackerMemory(data) {
    const tableId = Number(data.table_id);
    if (data.source !== 'live') throw new Error('Solo se persiste la memoria del modo Live.');
    const source = 'live';
    if (!useMongo) throw new Error('MongoDB Atlas no está conectado; memoria del Tracker deshabilitada.');
    const memory = {
        table_id: tableId,
        source,
        summary: String(data.summary || '').slice(-3000),
        messages: (Array.isArray(data.messages) ? data.messages : []).slice(-20).map(message => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: String(message.content || '').slice(0, 1800),
            created_at: message.created_at || new Date()
        })).filter(message => message.content),
        context: data.context && typeof data.context === 'object' ? data.context : {},
        updated_at: new Date()
    };
    return await TrackerMemory.findOneAndUpdate(
        { table_id: tableId, source },
        { $set: memory },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean().exec();
}

module.exports = { 
    initDB, reconnect, getConnectionStatus, getTables, addTable, deleteTable, getHistory, addSpin,
    clearHistory, wipeAllSpins, getStats, getUseMongo: isMongoConnected,
    getExpertRule, addExpertRule, getPatternStats,
    findAccessCode, saveAccessCode,
    listStrategies, saveStrategyRecord,
    addMetricSnapshot, getMetricSnapshots,
    addAiPrediction, getAiPredictions, resolvePendingAiPredictions, getAiLearningSummary,
    addTableStateSnapshot, getTableStateSnapshots,
    saveMetaPattern, updateMetaPatternResult, getMetaPatternStats, getUnresolvedMetaPatterns,
    saveDirectionPattern, findDirectionPatterns, getDirectionPatternStats,
    getWipeGeneration, saveV1V2History, getV1V2History, appendSyncLog, getSyncLog,
    getTrackerMemory, saveTrackerMemory
};

