// ============================================================
// server.js — Express API server for Roulette Predictor
// Run: node server.js
// ============================================================
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./database');

const app  = express();
const PORT = 3000;

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
app.get('/api/history/:tableId', (req, res) => {
    const tableId = req.params.tableId;
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    console.log(`[GET] History for table ${tableId} (limit: ${limit})`);
    db.getHistory(tableId, limit, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        console.log(`[DB] Found ${rows.length} rows for table ${tableId}`);
        res.json(rows);
    });
});

app.post('/api/spin', (req, res) => {
    const { table_id, number, source } = req.body;
    if (table_id == null || number == null) return res.status(400).json({ error: 'table_id and number required' });
    if (number < 0 || number > 36) return res.status(400).json({ error: 'number must be 0-36' });
    db.addSpin(table_id, number, source || 'manual', (err, id) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id, table_id, number, source });
    });
});

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

app.delete('/api/history/:tableId', (req, res) => {
    db.clearHistory(req.params.tableId, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/stats/:tableId', (req, res) => {
    db.getStats(req.params.tableId, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

// ---- Start ----
app.listen(PORT, () => {
    console.log(`\n🎰 Roulette Predictor Server running at http://localhost:${PORT}`);
    console.log(`   Open your browser at: http://localhost:${PORT}`);
    console.log(`   API ready at:          http://localhost:${PORT}/api/\n`);
});
