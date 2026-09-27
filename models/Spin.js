const mongoose = require('mongoose');

const SpinSchema = new mongoose.Schema({
    schema_version: { type: Number, default: 2 },
    id: { type: Number, required: true, unique: true },
    table_id: { type: Number, required: true, ref: 'Table' },
    table_code: { type: String, default: 'AUTO', index: true },
    number: { type: Number, required: true, min: 0, max: 36 },
    source: { type: String, default: 'bot' },
    source_quality: { type: String, enum: ['live', 'manual', 'batch', 'import'], default: 'live' },
    session_id: { type: String, default: '' },
    round_key: { type: String, default: '', index: true },
    
    // Physical characteristics (calculated on ingest)
    distance: { type: String, default: null }, 
    direction: { type: String, default: null },
    sector: { type: String, default: null },
    
    // Pro v3.1 Metrics
    event_id: { type: String, default: null },
    speed_rpm: { type: Number, default: null },
    timestamp_str: { type: String, default: null },
    angle: { type: Number, default: null },
    raw_history: [{ type: Number }],

    // Predictions from Agents (snapshots)
    predictions: {
        agent1_top: { type: Number, default: null },
        agent2_top: { type: Number, default: null },
        agent3_top: { type: Number, default: null },
        agent4_top: { type: Number, default: null },
        master_target: { type: String, default: null },
        master_confidence: { type: Number, default: null },
        analyst_dir: { type: String, default: null },
        analyst_size: { type: String, default: null },
        zone_magnitude: { type: String, default: null },
        zone_direction: { type: String, default: null }
    },
    
    // Automatic qualification
    results: {
        agent1_result: { type: String, enum: ['Direct', 'Neighbor', 'Loss', null], default: null },
        agent2_result: { type: String, enum: ['Direct', 'Neighbor', 'Loss', null], default: null },
        agent3_result: { type: String, enum: ['Direct', 'Neighbor', 'Loss', null], default: null },
        agent4_result: { type: String, enum: ['Direct', 'Neighbor', 'Loss', null], default: null }
    },

    observed_at: { type: Date, default: Date.now, index: true },
    ingested_at: { type: Date, default: Date.now, index: true },
    timestamp: { type: Date, default: Date.now }
});

SpinSchema.index({ table_id: 1, id: -1 });
SpinSchema.index({ table_id: 1, observed_at: -1 });
SpinSchema.index({ table_id: 1, round_key: 1 }, { sparse: true });
SpinSchema.index({ table_id: 1, event_id: 1 }, { sparse: true });

module.exports = mongoose.model('Spin', SpinSchema);
