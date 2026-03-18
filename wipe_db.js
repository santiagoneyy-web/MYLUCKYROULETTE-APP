const db = require('./database');

async function runWipe() {
    console.log('🧹 [WIPE] Starting full database purge...');
    
    // 1. Initialize DB to connect (it will use the new URI from .env)
    await db.initDB();
    
    // 2. Clear all spins
    db.wipeAllSpins((err) => {
        if (err) {
            console.error('❌ [WIPE] Error clearing spins:', err.message);
        } else {
            console.log('✅ [WIPE] All spins deleted from MongoDB and JSON.');
        }
        
        // Finalize
        process.exit(0);
    });
}

runWipe();
