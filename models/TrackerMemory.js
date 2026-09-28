const mongoose = require('mongoose');

const TrackerMemorySchema = new mongoose.Schema({
    table_id: { type: Number, required: true },
    source: { type: String, enum: ['live'], default: 'live', required: true },
    summary: { type: String, default: '' },
    messages: [{
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, required: true },
        created_at: { type: Date, default: Date.now }
    }],
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    updated_at: { type: Date, default: Date.now }
});

TrackerMemorySchema.index({ table_id: 1, source: 1 }, { unique: true });

module.exports = mongoose.model('TrackerMemory', TrackerMemorySchema);
