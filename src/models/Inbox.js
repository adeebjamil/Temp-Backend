const mongoose = require('mongoose');

const inboxSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  userEmail: String,
  messagesCount: { type: Number, default: 0 },
  clientIp: String,
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7200 * 1000), expires: 7200 }, // 2 hours TTL
});

module.exports = mongoose.models.Inbox || mongoose.model('Inbox', inboxSchema);
