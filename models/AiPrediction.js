const mongoose = require('mongoose');

const AiPredictionSchema = new mongoose.Schema({
    schema_version: { type: Number, default: 2 },
    id: { type: Number, required: true, unique: true },
    table_id: { type: Number, required: true, index: true },
    table_code: { type: String, default: 'AUTO', index: true },
    spin_id: { type: Number, default: null, index: true },
    basis: { type: String, enum: ['dominance', 'ai_analysis', 'strategy', 'hybrid'], default: 'dominance' },
    dominance_priority: { type: Boolean, default: true },
    mode: { type: String, enum: ['SAFE', 'FULL', 'RAW'], default: 'SAFE' },
    route: { type: String, enum: ['CW', 'CCW', 'SMALL', 'BIG', 'ESPERAR'], default: 'ESPERAR' },
    zone: { type: String, enum: ['SMALL', 'BIG', 'ESPERAR'], default: 'ESPERAR' },
    n9: { type: String, default: 'ESPERAR' },
    n4: { type: String, default: 'ESPERAR' },
    analysis: { type: String, default: '' },
    strategy_refs: [{ type: String }],
    confidence: { type: Number, default: 0 },
    context_snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    decision_source: { type: String, default: 'auto_ai', index: true },
    prompt_version: { type: String, default: '' },
    rl_reward: { type: Number, default: 0, index: true },
    reward_reason: { type: String, default: '' },
    context_hash: { type: String, default: '' },
    result: { type: String, enum: ['pending', 'win', 'loss', 'skip'], default: 'pending', index: true },
    n9_result: { type: String, enum: ['pending', 'win', 'loss', 'skip'], default: 'pending' },
    n4_result: { type: String, enum: ['pending', 'win', 'loss', 'skip'], default: 'pending' },
    resolved_number: { type: Number, default: null },
    created_at: { type: Date, default: Date.now, index: true },
    resolved_at: { type: Date, default: null }
});

AiPredictionSchema.index({ table_id: 1, created_at: -1 });
AiPredictionSchema.index({ table_id: 1, mode: 1, basis: 1, created_at: -1 });
AiPredictionSchema.index({ table_id: 1, mode: 1, context_hash: 1 });
AiPredictionSchema.index({ table_id: 1, mode: 1, basis: 1, rl_reward: -1 });

module.exports = mongoose.model('AiPrediction', AiPredictionSchema);
