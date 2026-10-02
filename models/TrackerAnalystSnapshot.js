const mongoose = require('mongoose');

const TrackerAnalystSnapshotSchema = new mongoose.Schema({
    table_id: { type: Number, required: true },
    spin_id: { type: Number, required: true },
    latest_number: { type: Number, required: true, min: 0, max: 36 },
    evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
    analyst_model: { type: String, default: 'qwen/qwen3.6-27b' },
    analyst_status: { type: String, enum: ['pending', 'complete', 'failed'], default: 'pending' },
    analyst_summary: { type: String, default: '' },
    analyst_error: { type: String, default: '' },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

TrackerAnalystSnapshotSchema.index({ table_id: 1, spin_id: 1 }, { unique: true });
TrackerAnalystSnapshotSchema.index({ table_id: 1, created_at: -1 });

module.exports = mongoose.model('TrackerAnalystSnapshot', TrackerAnalystSnapshotSchema);
