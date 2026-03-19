const mongoose = require('mongoose');

const SpinSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    table_id: { type: Number, required: true, ref: 'Table' },
    number: { type: Number, required: true, min: 0, max: 36 },
    source: { type: String, default: 'bot' },
    
    // Physical characteristics (calculated on ingest)
    distance: { type: String, default: null }, 
    direction: { type: String, default: null },
    sector: { type: String, default: null },
    
    // Pro v3.1 Metrics
    event_id: { type: String, default: null },
    speed_rpm: { type: Number, default: null },
    timestamp_str: { type: String, default: null },
    angle: { type: Number, default: null },

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

// Compound index for fast history queries per table
SpinSchema.index({ table_id: 1, id: -1 });
// Index for event_id deduplication
SpinSchema.index({ event_id: 1, table_id: 1 }, { sparse: true });

module.exports = mongoose.model('Spin', SpinSchema);
