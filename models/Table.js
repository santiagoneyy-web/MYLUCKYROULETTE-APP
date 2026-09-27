const mongoose = require('mongoose');

const TableSchema = new mongoose.Schema({
    schema_version: { type: Number, default: 2 },
    id: { type: Number, required: true, unique: true },
    code: { type: String, default: '', index: true },
    name: { type: String, required: true },
    provider: { type: String, default: '' },
    url: { type: String, default: '' },
    source_type: { type: String, enum: ['casino_org', 'manual', 'import'], default: 'casino_org' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Table', TableSchema);
