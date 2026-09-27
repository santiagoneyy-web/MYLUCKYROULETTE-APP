const mongoose = require('mongoose');

const StrategySchema = new mongoose.Schema({
    schema_version: { type: Number, default: 2 },
    id: { type: Number, required: true, unique: true },
    table_id: { type: String, default: 'global', index: true },
    table_code: { type: String, default: 'GLOBAL', index: true },
    name: { type: String, required: true },
    summary: { type: String, required: true },
    source: { type: String, enum: ['human', 'ai', 'system'], default: 'human', index: true },
    origin: { type: String, default: 'manual' },
    category: { type: String, enum: ['strategy', 'analysis_rule', 'context_rule'], default: 'strategy', index: true },
    status: { type: String, enum: ['candidate', 'active', 'validated', 'inactive'], default: 'active', index: true },
    pattern: { type: String, default: '' },
    trigger: { type: String, default: '' },
    action: { type: String, default: '' },
    tags: [{ type: String }],
    priority: { type: String, enum: ['suggestion', 'support', 'primary'], default: 'suggestion' },
    confidence_weight: { type: Number, default: 1 },
    success_hits: { type: Number, default: 0 },
    fail_hits: { type: Number, default: 0 },
    sample_size: { type: Number, default: 0 },
    effectiveness: {
        direct_rate: { type: Number, default: 0 },
        neighbor_rate: { type: Number, default: 0 },
        loss_rate: { type: Number, default: 0 }
    },
    evidence: {
        sample_size: { type: Number, default: 0 },
        win_rate: { type: Number, default: 0 },
        loss_rate: { type: Number, default: 0 },
        skip_rate: { type: Number, default: 0 },
        contexts: [{ type: String }]
    },
    last_context: { type: String, default: '' },
    last_used_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

StrategySchema.index({ table_id: 1, source: 1, status: 1 });

StrategySchema.pre('save', function updateTimestamp(next) {
    this.updated_at = new Date();
    next();
});

module.exports = mongoose.model('Strategy', StrategySchema);
