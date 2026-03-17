const mongoose = require('mongoose');

const SpinSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    table_id: { type: Number, required: true, ref: 'Table' },
    number: { type: Number, required: true, min: 0, max: 36 },
    source: { type: String, default: 'bot' },
    
    // Physical characteristics (calculated on ingest)
    distance: { type: String, enum: ['Small', 'Big', 'Zero', null], default: null }, // 1-9 vs 10-18
    direction: { type: String, enum: ['CW', 'CCW', null], default: null },
    sector: { type: String, enum: ['Voisins', 'Orphelins', 'Tiers', 'Zero', null], default: null },
    
    // Predictions from Agents (snapshots)
    predictions: {
        agent1_top: { type: Number, default: null },
        agent2_top: { type: Number, default: null },
        agent3_top: { type: Number, default: null },
        agent4_top: { type: Number, default: null },
        agent5_top: { type: Number, default: null }
    },
    
    // Automatic qualification
    results: {
        agent1_result: { type: String, enum: ['Direct', 'Neighbor', 'Loss', null], default: null },
        agent2_result: { type: String, enum: ['Direct', 'Neighbor', 'Loss', null], default: null },
        agent3_result: { type: String, enum: ['Direct', 'Neighbor', 'Loss', null], default: null },
        agent4_result: { type: String, enum: ['Direct', 'Neighbor', 'Loss', null], default: null },
        agent5_result: { type: String, enum: ['Direct', 'Neighbor', 'Loss', null], default: null }
    },

    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Spin', SpinSchema);
