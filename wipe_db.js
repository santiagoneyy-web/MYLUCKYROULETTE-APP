require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Spin = require('./models/Spin');

async function wipe() {
    console.log("🧹 Iniciando limpieza de base de datos...");

    if (process.env.MONGODB_URI) {
        try {
            await mongoose.connect(process.env.MONGODB_URI);
            const res = await Spin.deleteMany({});
            console.log(`✅ MongoDB: Historial de tiradas borrado limpiamente. Se eliminaron ${res.deletedCount} registros.`);
            process.exit(0);
        } catch(e) {
            console.error("❌ Error conectando a MongoDB:", e.message);
            process.exit(1);
        }
    } else {
        // Fallback to JSON
        const dbFile = path.join(__dirname, 'roulette_db.json');
        if (fs.existsSync(dbFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
                data.spins = [];
                fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
                console.log("✅ Local JSON: Historial borrado.");
            } catch(e) {
                console.error("❌ Error reading local JSON:", e.message);
            }
        } else {
            console.log("No MongoDB URI and no local JSON to wipe.");
        }
        process.exit(0);
    }
}

wipe();
