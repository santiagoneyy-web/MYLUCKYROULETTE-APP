const mongoose = require('mongoose');

const TrackerBankrollSessionSchema = new mongoose.Schema({
    table_id: { type: Number, required: true, index: true },
    session_no: { type: Number, required: true, min: 1 },
    initial_capital: { type: Number, required: true, min: 0.01 },
    balance: { type: Number, required: true, min: 0 },
    chip_value: { type: Number, required: true, min: 0.01 },
    current_round: { type: Number, default: 1, min: 1 },
    cycle_wagered: { type: Number, default: 0, min: 0 },
    wins: { type: Number, default: 0, min: 0 },
    losses: { type: Number, default: 0, min: 0 },
    total_spins: { type: Number, default: 0, min: 0 },
    total_wagered: { type: Number, default: 0, min: 0 },
    total_payout: { type: Number, default: 0, min: 0 },
    completed_cycles: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['draft', 'active', 'paused', 'closed'], default: 'draft', index: true },
    final_outcome: { type: String, enum: ['pending', 'won', 'lost', 'break_even'], default: 'pending' },
    starts_at: { type: Date, default: null },
    closed_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

TrackerBankrollSessionSchema.index({ table_id: 1, session_no: 1 }, { unique: true });

module.exports = mongoose.model('TrackerBankrollSession', TrackerBankrollSessionSchema);
