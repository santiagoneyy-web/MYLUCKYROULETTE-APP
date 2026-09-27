const mongoose = require('mongoose');

const ExpertRuleSchema = new mongoose.Schema({
    pattern_dna: { type: String, required: true }, // Sequence DNA (e.g., 'BS+CW|BS+CCW')
    label: { type: String },                       // Human name for the pattern
    suggested_move: { type: String },              // 'CW' or 'CCW'
    confidence_weight: { type: Number, default: 1.0 }, // Higher if human confirmed it multiple times
    success_hits: { type: Number, default: 0 },
    fail_hits: { type: Number, default: 0 },
    learned_from: { type: String, default: 'human' }, // 'human' or 'ai_discovery'
    last_seen: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ExpertRule', ExpertRuleSchema);
