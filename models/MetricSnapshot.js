const mongoose = require('mongoose');

const MetricSnapshotSchema = new mongoose.Schema({
    schema_version: { type: Number, default: 2 },
    id: { type: Number, required: true, unique: true },
    table_id: { type: Number, required: true, index: true },
    table_code: { type: String, default: 'AUTO', index: true },
    spin_id: { type: Number, default: null, index: true },
    window_size: { type: Number, default: 15 },
    recent_numbers: [{ type: Number }],
    stability_level: { type: String, default: 'red' },
    pattern_label: { type: String, default: '' },
    dominant_axis: { type: String, enum: ['direction', 'size', 'none'], default: 'none' },
    dominant_signal: { type: String, default: '' },
    dominance_score: { type: Number, default: 0 },
    dominance8: {
        cw: { type: Number, default: 0 },
        ccw: { type: Number, default: 0 },
        big: { type: Number, default: 0 },
        small: { type: Number, default: 0 }
    },
    momentum15: {
        cw: { type: Number, default: 0 },
        ccw: { type: Number, default: 0 },
        big: { type: Number, default: 0 },
        small: { type: Number, default: 0 }
    },
    performance8: {
        cwN9: { type: String, default: '' },
        cwN4: { type: String, default: '' },
        ccwN9: { type: String, default: '' },
        ccwN4: { type: String, default: '' }
    },
    routes: {
        cw: {
            n9: { type: Number, default: null },
            n4Small: { type: Number, default: null },
            n4Big: { type: Number, default: null },
            hitRate: { type: Number, default: 0 }
        },
        ccw: {
            n9: { type: Number, default: null },
            n4Small: { type: Number, default: null },
            n4Big: { type: Number, default: null },
            hitRate: { type: Number, default: 0 }
        }
    },
    context: {
        source: { type: String, default: 'auto' },
        notes: { type: String, default: '' }
    },
    captured_at: { type: Date, default: Date.now, index: true }
});

MetricSnapshotSchema.index({ table_id: 1, captured_at: -1 });

module.exports = mongoose.model('MetricSnapshot', MetricSnapshotSchema);
