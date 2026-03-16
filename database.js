// ============================================================
// database.js — SQLite setup and wrapper functions
// ============================================================
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'roulette.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) return console.error('Error opening database:', err);
    console.log('[DB] Connected to SQLite database at', DB_PATH);
});

function initDB() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS tables (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT NOT NULL,
            provider TEXT,
            url      TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS spins (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id  INTEGER NOT NULL,
            number    INTEGER NOT NULL CHECK(number >= 0 AND number <= 36),
            source    TEXT DEFAULT 'manual',
            timestamp TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (table_id) REFERENCES tables(id)
        )`);

        // Pre-load the two configured tables if they don't exist
        const preset = [
            { name: 'Betano Immersive Deluxe', provider: 'Betano', url: 'https://www.betano.pe/casino/live/games/immersive-roulette-deluxe/23563/tables/' },
            { name: 'Olimpo Ruleta', provider: 'Olimpo', url: 'https://www.olimpo.bet/casino-en-vivo?machine=5002830' }
        ];
        preset.forEach(t => {
            db.run(`INSERT OR IGNORE INTO tables (name, provider, url) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM tables WHERE url=?)`,
                [t.name, t.provider, t.url, t.url]);
        });

        console.log('[DB] Tables initialized.');
    });
}

// --- Tables ---
function getTables(cb) {
    db.all(`SELECT t.*, COUNT(s.id) as spin_count FROM tables t LEFT JOIN spins s ON t.id = s.table_id GROUP BY t.id ORDER BY t.id`, cb);
}

function addTable(name, provider, url, cb) {
    db.run(`INSERT INTO tables (name, provider, url) VALUES (?, ?, ?)`, [name, provider, url], function(err) {
        cb(err, this ? this.lastID : null);
    });
}

function deleteTable(tableId, cb) {
    db.run(`DELETE FROM spins WHERE table_id = ?`, [tableId], (err) => {
        if (err) return cb(err);
        db.run(`DELETE FROM tables WHERE id = ?`, [tableId], cb);
    });
}

// --- Spins ---
function getHistory(tableId, limit, cb) {
    const q = limit
        ? `SELECT * FROM spins WHERE table_id = ? ORDER BY id ASC LIMIT ?`
        : `SELECT * FROM spins WHERE table_id = ? ORDER BY id ASC`;
    const params = limit ? [tableId, limit] : [tableId];
    db.all(q, params, cb);
}

function addSpin(tableId, number, source, cb) {
    db.run(`INSERT INTO spins (table_id, number, source) VALUES (?, ?, ?)`, [tableId, number, source || 'manual'], function(err) {
        cb(err, this ? this.lastID : null);
    });
}

function clearHistory(tableId, cb) {
    db.run(`DELETE FROM spins WHERE table_id = ?`, [tableId], cb);
}

function getStats(tableId, cb) {
    db.get(`SELECT COUNT(*) as total, COUNT(CASE WHEN number=0 THEN 1 END) as zeros FROM spins WHERE table_id = ?`, [tableId], cb);
}

module.exports = { initDB, getTables, addTable, deleteTable, getHistory, addSpin, clearHistory, getStats };
