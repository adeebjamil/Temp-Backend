const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  user: { type: String, required: true },
  role: String,
  bcryptSalt: String,
  tokenExp: String,
  status: String,
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
