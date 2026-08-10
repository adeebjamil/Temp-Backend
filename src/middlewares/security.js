const mongoose = require('mongoose');
const BlocklistModel = require('../models/Blocklist');
const state = require('../config/state');

const loadBlocklist = async () => {
  if (mongoose.connection.readyState === 1) {
    try {
      const docs = await BlocklistModel.find();
      // Replace the array content without breaking references if any, or just reassign
      state.blocklistStore.length = 0;
      docs.forEach(d => state.blocklistStore.push(d.value));
      console.log(`🛡️  Security Blocklist loaded: ${state.blocklistStore.length} items`);
    } catch (e) {
      console.error('Failed to load blocklist', e);
    }
  }
};

const checkBlocklist = (req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
  if (state.blocklistStore.includes(clientIp)) {
    return res.status(403).json({ success: false, error: '403 Forbidden: Your IP has been blocked due to abuse or spam.' });
  }
  next();
};

module.exports = { loadBlocklist, checkBlocklist };
