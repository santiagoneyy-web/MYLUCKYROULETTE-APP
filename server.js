// ============================================================
// server.js — Express API server for Roulette Predictor
// Run: node server.js
// ============================================================
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./database');
const Spin    = require('./models/Spin'); // MongoDB Model
const agent5  = require('./agent5');      // Autonomous AI & Physics
const predictor = require('./predictor'); // Agents 1-4

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve static frontend from the same folder
app.use(express.static(path.join(__dirname)));

db.initDB();

// ---- API: Tables ----
app.get('/api/tables', (req, res) => {
    db.getTables((err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
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
app.get('/api/history/:tableId', async (req, res) => {
    const tableId = req.params.tableId;
    const limit = req.query.limit ? parseInt(req.query.limit) : 1000;
    try {
        const isMongo = db.getUseMongo();
        if (isMongo) {
            // CRITICAL: Query MongoDB directly, NOT the fallback db
            const rows = await Spin.find({ table_id: tableId })
                .sort({ id: 1 })
                .limit(limit)
                .lean();
            console.log(`[MONGO] History for table ${tableId}: ${rows.length} rows`);
            return res.json(rows);
        } else {
            db.getHistory(tableId, limit, (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(rows);
            });
        }
    } catch(e) {
        console.error('[History Error]', e);
        res.status(500).json({ error: e.message });
    }
});

// ATOMIC COUNTER FOR SPIN IDs
const mongoose = require('mongoose');
const counterSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 }
});
let Counter;
try { Counter = mongoose.model('Counter'); } catch (error) { Counter = mongoose.model('Counter', counterSchema); }

async function syncCounter(retries = 3) {
    try {
        const isMongo = db.getUseMongo();
        if (!isMongo) return;
        const maxSpin = await Spin.findOne().sort({ id: -1 }).select('id').lean();
        const seqVal = maxSpin ? maxSpin.id : 0;
        await Counter.findOneAndUpdate(
            { id: 'spinId' },
            { $set: { seq: seqVal } },
            { returnDocument: 'after', upsert: true }
        );
        console.log(`✅ [DB] Synced spinId counter to ${seqVal}`);
    } catch (e) {
        console.error('Counter Sync Error:', e);
        if (retries > 0) {
            console.log(`⏳ Retrying syncCounter in 3s... (${retries} retries left)`);
            setTimeout(() => syncCounter(retries - 1), 3000);
        }
    }
}
setTimeout(syncCounter, 5000); // Wait for mongo connection

app.post('/api/spin', async (req, res) => {
    // ── NODO 1: INGESTA ──
    const { table_id, number, source, direction, event_id } = req.body;
    if (table_id == null || number == null) return res.status(400).json({ error: 'table_id and number required' });
    if (number < 0 || number > 36) return res.status(400).json({ error: 'number must be 0-36' });

    try {
        const isMongo = db.getUseMongo();
        let newSpinId = 1;
        
        // DE-DUPLICATION (by event_id or public scraper last number)
        let earlyReturnId = null;
        if (isMongo) {
            if (event_id) {
                const existing = await Spin.findOne({ event_id, table_id }).lean();
                if (existing) {
                    console.log(`[DUPLICATE IGNORED] Table ${table_id}, Event ${event_id} already exists (ID: ${existing.id})`);
                    return res.json({ id: existing.id, table_id, number, source, note: 'Duplicate by event_id ignored', event_id });
                }
            } else if (source === 'public_scraper') {
                const lastSpin = await Spin.findOne({ table_id }).sort({ id: -1 }).lean();
                if (lastSpin && lastSpin.number === number) {
                    console.log(`[DUPLICATE IGNORED] Table ${table_id}, Number ${number} (Source: ${source})`);
                    return res.json({ id: lastSpin.id, table_id, number, source, note: 'Duplicate by number match ignored' });
                }
            }

            // ATOMIC ID GENERATION
            const counter = await Counter.findOneAndUpdate(
                { id: 'spinId' },
                { $inc: { seq: 1 } },
                { returnDocument: 'after', upsert: true }
            );
            newSpinId = counter.seq;
            
            // QUICK SAVE AND EARLY RESPONSE ("FIRE AND FORGET")
            const newSpin = new Spin({
                id: newSpinId,
                table_id,
                number,
                source: source || 'bot',
                event_id,
                distance: 0, // Placeholder
                direction: direction || '--',
                sector: '--',
                predictions: {}
            });
            await newSpin.save();
            res.json({ id: newSpinId, table_id, number, source, note: 'Spin logged instantly. Background enrichment started.' });

            // BACKGROUND ENRICHMENT (Does not block the API response)
            processSpinBackground(newSpin, table_id, number, source, direction).catch(err => {
                console.error(`[BACKGROUND ENRICHMENT FAILED] Spin ${newSpinId}:`, err);
            });
        } else {
            // Fallback SQLite/JSON
            db.addSpin(table_id, number, source || 'bot', (err, id) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id, table_id, number, source, note: 'Saved to fallback DB' });
            });
        }
    } catch (e) {
        if (e.code === 11000) {
            console.warn(`[API] Ignored duplicate key error during rapid ingestion.`);
            return res.status(200).json({ note: 'Duplicate safely ignored.' });
        }
        console.error('Pipeline Error:', e);
        if (!res.headersSent) res.status(500).json({ error: e.message });
    }
});

// NON-BLOCKING BACKGROUND TASK (Original Intelligence)
async function processSpinBackground(newSpin, table_id, number, source, direction) {
    // Fetch only last 100 spins for analysis (performance limit)
    const HISTORY_LIMIT = 100;
    let currentHistory = await Spin.find({ table_id, id: { $lt: newSpin.id } })
        .sort({ id: -1 })
        .limit(HISTORY_LIMIT)
        .lean();
    currentHistory = currentHistory.reverse(); // oldest first
    
    const numsOnly = currentHistory.map(s => s.number);
    const prevSpin = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1] : null;
    
    // ── NODO 2: PROCESAMIENTO FÍSICO ──
    const prevNumber = prevSpin ? prevSpin.number : null;
    const physics = agent5.getPhysics(prevNumber, number);
    const sector = agent5.getSector(number);

    // EVALUATION (Of previous predictions against current number)
    if (prevSpin && prevSpin.predictions) {
        await Spin.updateOne({ _id: prevSpin._id }, {
            $set: {
                results: {
                    agent1_result: agent5.evaluatePrediction(number, prevSpin.predictions.agent1_top, 9),
                    agent2_result: agent5.evaluatePrediction(number, prevSpin.predictions.agent2_top, 3),
                    agent3_result: agent5.evaluatePrediction(number, prevSpin.predictions.agent3_top, 9),
                    agent4_result: agent5.evaluatePrediction(number, prevSpin.predictions.agent4_top, 9),
                    agent5_result: agent5.evaluatePrediction(number, prevSpin.predictions.agent5_top, 9)
                }
            }
        });
    }

    numsOnly.push(number);

    // ── NODO 3: IA & AGENTES (Predicciones para el FUTURO) ──
    let newPredictions = { agent1_top: null, agent2_top: null, agent3_top: null, agent4_top: null, agent5_top: null };

    if (numsOnly.length >= 3) {
        const stats = {};
        // Only analyze last 50 spins in the loop to avoid timeout
        const analysisWindow = numsOnly.slice(-50);
        for (let i = 2; i < analysisWindow.length; i++) {
            predictor.analyzeSpin(analysisWindow.slice(0, i + 1), stats);
        }
        
        const nextRound = predictor.projectNextRound(numsOnly, stats);
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

        // ORIGINAL Célula (Androide Célula) Call - UNTOUCHED LOGIC
        const ag5Result = await agent5.predictAgent5(table_id, numsOnly, masterSignals);
        if (ag5Result) {
            newPredictions.agent5_top = ag5Result.topNum;
            newPredictions.agent5_dna = ag5Result.dnaMatch; 
        }
    }

    await Spin.updateOne({ _id: newSpin._id }, {
        $set: {
            distance: physics.distance,
            direction: direction || physics.direction,
            sector: sector,
            predictions: newPredictions,
            pattern_code: (masterSignals && masterSignals[0]) ? masterSignals[0].patternCode : null,
            streak_count: (masterSignals && masterSignals[0]) ? masterSignals[0].streakCount : 0
        }
    });

    console.log(`✅ [BKG] Processed spin ${newSpin.id} | Result: ${number} | AI done.`);
}

// Batch import (for OCR auto-capture)
app.post('/api/spin/batch', (req, res) => {
    const { table_id, numbers, source } = req.body;
    if (!table_id || !Array.isArray(numbers)) return res.status(400).json({ error: 'table_id and numbers[] required' });
    let inserted = 0;
    const errors = [];
    const done = () => {
        if (inserted + errors.length === numbers.length) {
            res.json({ inserted, errors });
        }
    };
    if (numbers.length === 0) return res.json({ inserted: 0, errors: [] });
    numbers.forEach(n => {
        if (n < 0 || n > 36) { errors.push(n); return done(); }
        db.addSpin(table_id, n, source || 'ocr', (err) => {
            if (err) errors.push(n); else inserted++;
            done();
        });
    });
});

app.delete('/api/history/:tableId', async (req, res) => {
    try {
        const isMongo = db.getUseMongo();
        if (isMongo) {
            await Spin.deleteMany({ table_id: req.params.tableId });
            // Reset the counter after wipe
            await Counter.findOneAndUpdate(
                { id: 'spinId' },
                { $set: { seq: 0 } },
                { upsert: true }
            );
            console.log(`[WIPE] Deleted all spins for table ${req.params.tableId}`);
            return res.json({ success: true, message: 'MongoDB data cleared' });
        } else {
            db.clearHistory(req.params.tableId, (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
        }
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// WIPE ALL spins across all tables
app.delete('/api/wipe-all', async (req, res) => {
    try {
        const isMongo = db.getUseMongo();
        if (!isMongo) return res.status(400).json({ error: 'Only available in MongoDB mode' });
        const result = await Spin.deleteMany({});
        await Counter.findOneAndUpdate(
            { id: 'spinId' },
            { $set: { seq: 0 } },
            { upsert: true }
        );
        console.log(`[WIPE ALL] Deleted ${result.deletedCount} spins.`);
        return res.json({ success: true, deleted: result.deletedCount });
    } catch(e) {
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
            spins = await Spin.find({ table_id: tableId }).sort({ id: 1 }).exec();
        } else {
            spins = await new Promise((resolve, reject) => {
                db.getHistory(tableId, null, (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
        }
        const numsOnly = spins.map(s => s.number);
        if (numsOnly.length < 3) return res.json({ agent5_top: null, message: 'Not enough data' });

        // Full prediction pipeline
        const stats = {};
        for (let i = 2; i < numsOnly.length; i++) {
            predictor.analyzeSpin(numsOnly.slice(0, i + 1), stats);
        }
        const nextRound = predictor.projectNextRound(numsOnly, stats);
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
        if (isMongo) {
            predictions.agent5_top = await agent5.predictAgent5(tableId, numsOnly);
        }
        res.json(predictions);
    } catch (e) {
        console.error('Predict endpoint error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Admin endpoint to wipe DB without shell (Free tier Render doesn't have shell)
app.get('/api/admin/wipe-all-spins-securely', async (req, res) => {
    try {
        if (db.getUseMongo()) {
            const result = await Spin.deleteMany({});
            res.send(`✅ [ADMIN] MongoDB: Historial borrado. Se eliminaron ${result.deletedCount} registros.`);
        } else {
            // Wipe local JSON too
            db.wipeAllSpins(() => {});
            res.send('✅ [ADMIN] Local JSON: Historial borrado.');
        }
    } catch (e) {
        res.status(500).send(`❌ Error en el wipe: ${e.message}`);
    }
});

// DELETE all spins for all tables (frontend "Wipe All" button)
app.delete('/api/wipe-all', async (req, res) => {
    try {
        console.log('🧹 [Wipe All] Triggering full database cleaning...');
        if (db.getUseMongo()) {
            const result = await Spin.deleteMany({});
            res.json({ success: true, deleted: result.deletedCount, message: `Borrados ${result.deletedCount} registros de MongoDB.` });
        } else {
            db.wipeAllSpins((err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: 'Historial local vaciado.' });
            });
        }
    } catch (e) {
        console.error('Wipe failed:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stats/:tableId', (req, res) => {
    db.getStats(req.params.tableId, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

// ---- Start ----
const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n🎰 Roulette Predictor Server running at http://0.0.0.0:${PORT}`);
    console.log(`   API ready at:          http://0.0.0.0:${PORT}/api/\n`);
    
    // 🔥 CRITICAL: Update table names if they exist but have old names (for Mongo)
    if (db.getUseMongo()) {
        try {
            const Table = require('./models/Table');
            await Table.updateOne({ id: 1 }, { $set: { name: 'Auto Roulette', url: 'https://www.casino.org/casinoscores/es/auto-roulette/' } });
            await Table.updateOne({ id: 2 }, { $set: { name: 'Inmersive Roulette', url: 'https://www.casino.org/casinoscores/es/immersive-roulette/' } });
            console.log('✅ [BOOT] Table names synchronized with focused config.');
        } catch (e) {
            console.error('❌ [BOOT] Table sync error:', e.message);
        }
    }

    if (!process.env.DISABLE_BOTS) {
        require('./start-bots.js')(PORT);
    }
});
