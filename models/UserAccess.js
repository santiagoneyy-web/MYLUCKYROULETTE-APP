const mongoose = require('mongoose');

const UserAccessSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true, index: true },
    role: { type: String, enum: ['master', 'member'], default: 'member' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    permissions: [{ type: String }],
    notes: { type: String, default: '' },
    last_login_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

UserAccessSchema.pre('save', function updateTimestamp(next) {
    this.updated_at = new Date();
    next();
});

module.exports = mongoose.model('UserAccess', UserAccessSchema);
