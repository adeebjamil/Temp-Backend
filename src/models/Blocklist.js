const mongoose = require('mongoose');

const blocklistSchema = new mongoose.Schema({
  value: { type: String, required: true, unique: true }, // IP or Domain
  type: { type: String, enum: ['IP', 'DOMAIN'], required: true },
  reason: { type: String, default: 'Spam/Abuse' },
  addedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.Blocklist || mongoose.model('Blocklist', blocklistSchema);
