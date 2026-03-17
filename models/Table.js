const mongoose = require('mongoose');

const TableSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    provider: { type: String, default: '' },
    url: { type: String, default: '' },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Table', TableSchema);
