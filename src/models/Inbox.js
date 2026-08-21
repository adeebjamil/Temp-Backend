const mongoose = require('mongoose');

const inboxSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  userEmail: String,
  messagesCount: { type: Number, default: 0 },
  clientIp: String,
  status: { type: String, enum: ['ACTIVE', 'LOCKED'], default: 'ACTIVE' },
  lockedUntil: { type: Date, default: null },
  lockReason: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 300 * 1000), expires: 300 }, // 5 minutes TTL
});

module.exports = mongoose.models.Inbox || mongoose.model('Inbox', inboxSchema);
