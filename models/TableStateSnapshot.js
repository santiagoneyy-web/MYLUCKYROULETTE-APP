const mongoose = require('mongoose');

const TableStateSnapshotSchema = new mongoose.Schema({
    schema_version: { type: Number, default: 1 },
    id: { type: Number, required: true, unique: true },
    table_id: { type: Number, required: true, index: true },
    table_code: { type: String, default: 'AUTO', index: true },
    spin_id: { type: Number, default: null, index: true },
    metric_snapshot_id: { type: Number, default: null, index: true },
    recent_numbers: [{ type: Number }],
    block_state: {
        type: String,
        enum: ['none', 'forming', 'active', 'weakening', 'broken'],
        default: 'none',
        index: true
    },
    block_size: { type: Number, default: 0 },
    turbulence_level: {
        type: String,
        enum: ['none', 'micro', 'short', 'medium', 'large'],
        default: 'none',
        index: true
    },
    turbulence_size: { type: Number, default: 0 },
    dominance_state: {
        type: String,
        enum: ['none', 'forming', 'strong', 'tired', 'breaking', 'reversing'],
        default: 'none',
        index: true
    },
    dominance_side: {
        type: String,
        enum: ['CW', 'CCW', 'BIG', 'SMALL', 'NONE'],
        default: 'NONE'
    },
    dominance_strength: { type: Number, default: 0 },
    dominance_fatigue: { type: Number, default: 0 },
    farol_state: {
        type: String,
        enum: ['none', 'suspected', 'active', 'resolved'],
        default: 'none',
        index: true
    },
    farol_side: {
        type: String,
        enum: ['CW', 'CCW', 'BIG', 'SMALL', 'NONE'],
        default: 'NONE'
    },
    continuation_bias: {
        type: String,
        enum: ['CW', 'CCW', 'BIG', 'SMALL', 'NONE'],
        default: 'NONE'
    },
    reversal_risk: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'low',
        index: true
    },
    color_state: {
        type: String,
        enum: ['green', 'yellow', 'red'],
        default: 'red',
        index: true
    },
    interpretation: { type: String, default: '' },
    created_at: { type: Date, default: Date.now, index: true }
});

TableStateSnapshotSchema.index({ table_id: 1, created_at: -1 });

module.exports = mongoose.model('TableStateSnapshot', TableStateSnapshotSchema);
