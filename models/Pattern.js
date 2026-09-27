const mongoose = require('mongoose');

const PatternSchema = new mongoose.Schema({
    table_id: { type: String, required: true }, // Can be Number or String based on how table ID comes in
    
    // The history leading up to the target spin
    sequence_mag: { type: String, required: true }, // 'BSBS'
    sequence_dir: { type: String, required: true }, // 'RRLL' (R=CW, L=CCW)
    
    // What actually happened next
    next_mag: { type: String, required: true }, // 'B' or 'S'
    next_dir: { type: String, required: true }, // 'R' or 'L'
    
    timestamp: { type: Date, default: Date.now }
});

// Indexes for fast lookup of exact sequences
PatternSchema.index({ table_id: 1, sequence_mag: 1 });
PatternSchema.index({ table_id: 1, sequence_dir: 1 });

module.exports = mongoose.model('Pattern', PatternSchema);
