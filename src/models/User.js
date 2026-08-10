const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  photoURL: String,
  role: { type: String, enum: ['SUPERADMIN', 'USER'], default: 'USER' },
  status: { type: String, enum: ['ACTIVE', 'DEACTIVATED', 'BANNED'], default: 'ACTIVE' },
  dailyEmailsGenerated: { type: Number, default: 0 },
  lastEmailGeneratedDate: { type: String, default: null },
  lastLogin: { type: Date, default: Date.now },
  lastIp: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
