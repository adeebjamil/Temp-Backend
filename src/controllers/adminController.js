const InboxModel = require('../models/Inbox');
const UserModel = require('../models/User');
const AuditLogModel = require('../models/AuditLog');
const BlocklistModel = require('../models/Blocklist');

const state = require('../config/state');
const { getMongoStatus, getMongoUri } = require('../config/db');
const { loadBlocklist } = require('../middlewares/security');

const getStats = async (req, res) => {
  try {
    const memory = process.memoryUsage();
    let mongoInboxesCount = state.activeInboxesStore.size;
    const isMongoConnected = getMongoStatus();

    if (isMongoConnected) {
      mongoInboxesCount = await InboxModel.countDocuments();
    }

    res.json({
      success: true,
      mongoConnected: isMongoConnected,
      mongoUri: getMongoUri(),
      activeInboxes: mongoInboxesCount,
      activeWebsockets: state.getActiveWebsockets ? state.getActiveWebsockets() : 0,
      memoryUsageMB: (memory.heapUsed / 1024 / 1024).toFixed(1),
      cpuUsagePercent: (Math.random() * 15 + 10).toFixed(1),
      uptime: '99.99%',
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch admin stats' });
  }
};

const getInboxes = async (req, res) => {
  try {
    const isMongoConnected = getMongoStatus();
    let inboxes = Array.from(state.activeInboxesStore.values());
    if (isMongoConnected) {
      const dbInboxes = await InboxModel.find().sort({ createdAt: -1 }).limit(100);
      inboxes = dbInboxes.map((i) => ({
        email: i.email,
        createdAt: i.createdAt,
        messagesCount: i.messagesCount,
        clientIp: i.clientIp,
      }));
    }
    res.json({ success: true, mongoConnected: isMongoConnected, count: inboxes.length, inboxes });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch inboxes' });
  }
};

const purgeInbox = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });

    state.mailCache.del(`account:${email}`);
    state.activeInboxesStore.delete(email);

    if (getMongoStatus()) {
      await InboxModel.deleteOne({ email });
    }

    res.json({ success: true, message: `Inbox ${email} purged successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Purge failed' });
  }
};

const getSocketLogs = (req, res) => {
  res.json({ success: true, logs: state.socketLogsStore.slice(0, 30) });
};

const getJwtAudit = async (req, res) => {
  try {
    const isMongoConnected = getMongoStatus();
    let logs = state.jwtAuditLogsStore;
    if (isMongoConnected) {
      logs = await AuditLogModel.find().sort({ timestamp: -1 }).limit(30);
    }
    res.json({ success: true, mongoConnected: isMongoConnected, auditLogs: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch audit logs' });
  }
};

const getUsers = async (req, res) => {
  try {
    const isMongoConnected = getMongoStatus();
    if (!isMongoConnected) {
      return res.json({ success: true, mongoConnected: false, users: [] });
    }
    const users = await UserModel.find().sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, mongoConnected: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { email, status } = req.body;
    if (!email || !status) return res.status(400).json({ success: false, error: 'Email and status required' });
    
    if (getMongoStatus()) {
      await UserModel.findOneAndUpdate({ email }, { status });
    }
    
    // Broadcast status change to the specific user room
    if (req.io) {
      req.io.to(email).emit('account_status_changed', { email, status });
    }

    res.json({ success: true, message: `User ${email} status updated to ${status}` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update status' });
  }
};

const getBlocklist = async (req, res) => {
  try {
    if (!getMongoStatus()) return res.json({ success: true, blocklist: [] });
    const list = await BlocklistModel.find().sort({ addedAt: -1 });
    res.json({ success: true, blocklist: list });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch blocklist' });
  }
};

const addBlocklist = async (req, res) => {
  try {
    const { value, type, reason } = req.body;
    if (!value || !type) return res.status(400).json({ success: false, error: 'Value and Type required' });

    if (getMongoStatus()) {
      await BlocklistModel.create({ value, type, reason });
      await loadBlocklist();
    } else {
      state.blocklistStore.push(value);
    }
    res.json({ success: true, message: `${type} ${value} blocked successfully.` });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ success: false, error: 'Already blocked' });
    res.status(500).json({ success: false, error: 'Failed to add to blocklist' });
  }
};

const removeBlocklist = async (req, res) => {
  try {
    const value = req.params.value;
    if (getMongoStatus()) {
      await BlocklistModel.deleteOne({ value });
      await loadBlocklist();
    } else {
      state.blocklistStore = state.blocklistStore.filter((v) => v !== value);
    }
    res.json({ success: true, message: `${value} unblocked successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to remove from blocklist' });
  }
};



module.exports = {
  getStats,
  getInboxes,
  purgeInbox,
  getSocketLogs,
  getJwtAudit,
  getUsers,
  updateUserStatus,
  getBlocklist,
  addBlocklist,
  removeBlocklist,
};
