const mongoose = require('mongoose');

const TrackerBankrollEntrySchema = new mongoose.Schema({
    session_id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'TrackerBankrollSession' },
    session_no: { type: Number, required: true },
    cycle_no: { type: Number, required: true, min: 1 },
    table_id: { type: Number, required: true },
    spin_key: { type: String, required: true },
    number: { type: Number, required: true, min: 0, max: 36 },
    prediction_center: { type: Number, min: 0, max: 36 },
    prediction_numbers: { type: [Number], required: true, validate: values => values.length === 9 },
    context_snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    round: { type: Number, required: true, min: 1 },
    stake: { type: Number, required: true, min: 0 },
    cycle_wagered: { type: Number, required: true, min: 0 },
    cycle_payout: { type: Number, default: 0, min: 0 },
    payout: { type: Number, required: true, min: 0 },
    cycle_profit: { type: Number, default: null },
    strategy_metric_label: { type: String, default: '' },
    strategy_streak_hits: { type: Number, default: null, min: 0, max: 3 },
    strategy_cycle_completed: { type: Boolean, default: false },
    balance_after: { type: Number, required: true },
    net_profit: { type: Number, required: true },
    won: { type: Boolean, required: true },
    created_at: { type: Date, default: Date.now }
});

TrackerBankrollEntrySchema.index({ session_id: 1, spin_key: 1 }, { unique: true });
TrackerBankrollEntrySchema.index({ table_id: 1, session_no: 1, created_at: -1 });

module.exports = mongoose.model('TrackerBankrollEntry', TrackerBankrollEntrySchema);
