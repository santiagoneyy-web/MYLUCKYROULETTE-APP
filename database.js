require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Table = require('./models/Table');
const Spin = require('./models/Spin');

const DB_FILE = path.join(__dirname, 'roulette_db.json');
let useMongo = false;

// Memory cache for fallback
let fallbackData = {
    tables: [
        { id: 1, name: 'Auto Roulette', provider: 'Evolution', url: 'https://www.casino.org/casinoscores/es/auto-roulette/' },
        { id: 2, name: 'Inmersive Roulette', provider: 'Evolution', url: 'https://www.casino.org/casinoscores/es/immersive-roulette/' }
    ],
    spins: []
};

function loadFallback() {
    if (fs.existsSync(DB_FILE)) {
        try {
            fallbackData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            console.log('[DB] Loaded JSON fallback data.');
        } catch (e) {
            console.error('[DB] JSON Load Error, using defaults.');
        }
    }
}

function saveFallback() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(fallbackData, null, 2));
    } catch (e) {
        console.error('[DB] Fallback Save Error:', e.message);
    }
}

async function initDB() {
    if (process.env.MONGODB_URI) {
        try {
            await mongoose.connect(process.env.MONGODB_URI);
            useMongo = true;
            console.log('✅ [DB] Connected to MongoDB Atlas.');

            // Pre-seed tables if empty
            const tableCount = await Table.countDocuments();
            if (tableCount === 0 && fallbackData.tables.length > 0) {
                console.log('[DB] Seeding default tables in MongoDB...');
                await Table.insertMany(fallbackData.tables);
            }

            // Resync logic: if JSON has spins, upload them to Mongo and clear JSON
            loadFallback();
            if (fallbackData.spins && fallbackData.spins.length > 0) {
                console.log(`[DB] Resyncing ${fallbackData.spins.length} spins from JSON to MongoDB...`);
                
                // Mongoose handles `_id`, we just push our objects. However, `id` might conflict if we don't handle it.
                // We'll generate new incremental IDs for them.
                const maxSpin = await Spin.findOne().sort('-id').exec();
                let nextId = maxSpin ? maxSpin.id + 1 : 1;
                
                const spinsToInsert = fallbackData.spins.map(s => {
                    return {
                        ...s,
                        id: nextId++
                    };
                });
                
                await Spin.insertMany(spinsToInsert);
                console.log('[DB] Resync complete. Clearing local JSON cache.');
                
                // Clear the fallback JSON spins
                fallbackData.spins = [];
                saveFallback();
            }
        } catch (err) {
            console.error('❌ [DB] MongoDB Connection Error. Falling back to JSON.', err.message);
            useMongo = false;
            loadFallback();
        }
    } else {
        console.warn('⚠️ [DB] No MONGODB_URI found. Defaulting to JSON storage.');
        useMongo = false;
        loadFallback();
    }
}

// --- Tables ---
async function getTables(cb) {
    if (useMongo) {
        try {
            // Aggregate spins count
            const tables = await Table.aggregate([
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
        });
        cb(null, results);
    }
}

async function addTable(name, provider, url, cb) {
    if (useMongo) {
        try {
            const maxTable = await Table.findOne().sort('-id').exec();
            const id = maxTable ? maxTable.id + 1 : 1;
            const newTable = new Table({ id, name, provider, url });
            await newTable.save();
            cb(null, id);
        } catch (e) { cb(e); }
    } else {
        const id = fallbackData.tables.length > 0 ? Math.max(...fallbackData.tables.map(t => t.id)) + 1 : 1;
        fallbackData.tables.push({ id, name, provider, url });
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

async function addSpin(tableId, number, source, cb) {
    // Add logic to calculate physics (distance, direction, sector) in Phase 3. 
    // Right now, just ingest basic data.
    if (useMongo) {
        try {
            const maxSpin = await Spin.findOne().sort('-id').exec();
            const id = maxSpin ? maxSpin.id + 1 : 1;
            const newSpin = new Spin({
                id,
                table_id: parseInt(tableId),
                number: parseInt(number),
                source: source || 'bot'
            });
            await newSpin.save();
            
            // Keep DB trimmed to last 10,000 per table to save space if needed
            // (Optional cleanup here)
            
            cb(null, id);
        } catch (e) { cb(e); }
    } else {
        const id = fallbackData.spins.length > 0 ? Math.max(...fallbackData.spins.map(s => s.id)) + 1 : 1;
        const newSpin = {
            id,
            table_id: parseInt(tableId),
            number: parseInt(number),
            source: source || 'manual',
            timestamp: new Date().toISOString()
        };
        fallbackData.spins.push(newSpin);
        if (fallbackData.spins.length > 5000) fallbackData.spins.shift(); 
        saveFallback();
        cb(null, id);
    }
}

async function clearHistory(tableId, cb) {
    if (useMongo) {
        try {
            await Spin.deleteMany({ table_id: tableId });
            cb(null);
        } catch (e) { cb(e); }
    } else {
        fallbackData.spins = fallbackData.spins.filter(s => s.table_id != tableId);
        saveFallback();
        cb(null);
    }
}

async function getStats(tableId, cb) {
    if (useMongo) {
        try {
            const total = await Spin.countDocuments({ table_id: tableId });
            const zeros = await Spin.countDocuments({ table_id: tableId, number: 0 });
            cb(null, { total, zeros });
        } catch (e) { cb(e); }
    } else {
        const spins = fallbackData.spins.filter(s => s.table_id == tableId);
        const zeros = spins.filter(s => s.number === 0).length;
        cb(null, { total: spins.length, zeros });
    }
}

async function wipeAllSpins(cb) {
    if (useMongo) {
        try {
            await Spin.deleteMany({});
            cb(null);
        } catch (e) { cb(e); }
    } else {
        fallbackData.spins = [];
        saveFallback();
        cb(null);
    }
}

module.exports = { initDB, getTables, addTable, deleteTable, getHistory, addSpin, clearHistory, wipeAllSpins, getStats, getUseMongo: () => useMongo };
