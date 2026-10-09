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
    bankroll_session_id: { type: String, default: '' },
    bankroll_session_no: { type: Number, default: null },
    has_bankroll_audit: { type: Boolean, default: false },
    prediction_mode: { type: String, enum: ['n4', 'n9', 'both'], default: null },
    prediction_source: { type: String, enum: ['system', 'ai'], default: null },
    forecast_history_length: { type: Number, default: null },
    system_center: { type: Number, min: 0, max: 36, default: null },
    system_status: { type: String, enum: ['ready', 'unavailable', 'no_signal', 'late'], default: 'unavailable' },
    system_metric_label: { type: String, default: '' },
    system_reasoning: { type: mongoose.Schema.Types.Mixed, default: null },
    system_won: { type: Boolean, default: null },
    system_reward: { type: Number, default: null },
    system_pattern_center: { type: Number, min: 0, max: 36, default: null },
    system_pattern_status: { type: String, enum: ['ready', 'unavailable', 'no_signal', 'late'], default: 'unavailable' },
    system_pattern_metric_label: { type: String, default: '' },
    system_pattern_reasoning: { type: mongoose.Schema.Types.Mixed, default: null },
    system_pattern_won: { type: Boolean, default: null },
    system_pattern_reward: { type: Number, default: null },
    last_direction_zone_center: { type: Number, min: 0, max: 36, default: null },
    last_direction_zone_status: { type: String, enum: ['ready', 'unavailable', 'no_signal', 'late'], default: 'unavailable' },
    last_direction_zone_metric_label: { type: String, default: '' },
    last_direction_zone_reasoning: { type: mongoose.Schema.Types.Mixed, default: null },
    last_direction_zone_won: { type: Boolean, default: null },
    last_direction_zone_reward: { type: Number, default: null },
    ai_center: { type: Number, min: 0, max: 36, default: null },
    ai_metric_label: { type: String, default: '' },
    ai_model: { type: String, default: '' },
    ai_reasoning: { type: String, default: '' },
    ai_status: { type: String, enum: ['ready', 'unavailable', 'late'], default: 'unavailable' },
    ai_won: { type: Boolean, default: null },
    ai_reward: { type: Number, default: null },
    result_spin_id: { type: Number, default: null },
    result_number: { type: Number, min: 0, max: 36, default: null },
    audited_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

TrackerAnalystSnapshotSchema.index({ table_id: 1, spin_id: 1 }, { unique: true });
TrackerAnalystSnapshotSchema.index({ table_id: 1, created_at: -1 });
TrackerAnalystSnapshotSchema.index({ bankroll_session_id: 1, updated_at: -1 });
TrackerAnalystSnapshotSchema.index({ table_id: 1, prediction_mode: 1, result_spin_id: -1 });

module.exports = mongoose.model('TrackerAnalystSnapshot', TrackerAnalystSnapshotSchema);
