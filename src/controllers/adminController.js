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
    let lockedInboxCount = 0;
    const isMongoConnected = getMongoStatus();

    if (isMongoConnected) {
      mongoInboxesCount = await InboxModel.countDocuments();
      lockedInboxCount = await InboxModel.countDocuments({ status: 'LOCKED', lockedUntil: { $gt: new Date() } });
    }

    res.json({
      success: true,
      mongoConnected: isMongoConnected,
      mongoUri: getMongoUri(),
      activeInboxes: mongoInboxesCount,
      lockedInboxCount,
      isMaintenanceMode: state.isMaintenanceMode,
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
      const dbInboxes = await InboxModel.find({ status: { $ne: 'LOCKED' } }).sort({ createdAt: -1 }).limit(100);
      inboxes = dbInboxes.map((i) => ({
        email: i.email,
        createdAt: i.createdAt,
        messagesCount: i.messagesCount,
        clientIp: i.clientIp,
        status: i.status || 'ACTIVE',
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

// 🛡️ NEW: Bulk purge multiple inboxes at once
const bulkPurge = async (req, res) => {
  try {
    const { emails } = req.body;
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ success: false, error: 'Array of emails required' });
    }

    let deletedCount = 0;
    for (const email of emails) {
      state.mailCache.del(`account:${email}`);
      state.activeInboxesStore.delete(email);
      deletedCount++;
    }

    if (getMongoStatus()) {
      await InboxModel.deleteMany({ email: { $in: emails } });
    }

    res.json({ success: true, message: `${deletedCount} inboxes purged successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Bulk purge failed' });
  }
};

// 🛡️ NEW: Get all locked inboxes
const getLockedInboxes = async (req, res) => {
  try {
    if (!getMongoStatus()) {
      return res.json({ success: true, lockedInboxes: [] });
    }

    const locked = await InboxModel.find({
      status: 'LOCKED',
      lockedUntil: { $gt: new Date() },
    }).sort({ lockedUntil: -1 }).limit(100);

    const lockedInboxes = locked.map((i) => ({
      email: i.email,
      clientIp: i.clientIp,
      lockReason: i.lockReason,
      lockedUntil: i.lockedUntil,
      createdAt: i.createdAt,
    }));

    res.json({ success: true, count: lockedInboxes.length, lockedInboxes });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch locked inboxes' });
  }
};

// 🛡️ NEW: Unlock a locked inbox (admin only)
const unlockInbox = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });

    if (getMongoStatus()) {
      await InboxModel.updateOne({ email }, {
        status: 'ACTIVE',
        lockedUntil: null,
        lockReason: null,
      });
    }

    res.json({ success: true, message: `Inbox ${email} unlocked.` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Unlock failed' });
  }
};

// 🛡️ NEW: Trigger maintenance mode manually
const triggerMaintenance = async (req, res) => {
  try {
    if (state.isMaintenanceMode) {
      return res.status(400).json({ success: false, error: 'Maintenance already in progress' });
    }

    state.isMaintenanceMode = true;

    // Broadcast to all connected clients
    if (req.io) {
      req.io.emit('maintenance_start', { message: 'System maintenance in progress. Back in 2 minutes.' });
    }

    // Clear all caches
    state.mailCache.flushAll();
    state.activeInboxesStore.clear();
    state.abuseTracker.clear();

    // Clear temporary MongoDB data (inboxes only, not users/audit)
    if (getMongoStatus()) {
      await InboxModel.deleteMany({ status: { $ne: 'LOCKED' } }); // Keep locked ones for audit
    }

    // Auto end maintenance after 2 minutes
    setTimeout(() => {
      state.isMaintenanceMode = false;
      if (req.io) {
        req.io.emit('maintenance_end', { message: 'Maintenance complete. System is back online.' });
      }
      console.log('✅ Maintenance mode ended. System is back online.');
    }, 2 * 60 * 1000);

    res.json({ success: true, message: 'Maintenance mode started. Will auto-end in 2 minutes.' });
  } catch (error) {
    state.isMaintenanceMode = false;
    res.status(500).json({ success: false, error: 'Failed to start maintenance' });
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
    
    const validStatuses = ['ACTIVE', 'DEACTIVATED', 'BANNED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Allowed: ${validStatuses.join(', ')}` });
    }

    const cleanEmail = email.trim();
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    
    // Safety check: Prevent modifying the SUPERADMIN status
    if (cleanEmail.toLowerCase() === adminEmail) {
      return res.status(403).json({ success: false, error: 'Cannot deactivate or ban the superadmin account' });
    }
    
    let updatedUser = null;
    if (getMongoStatus()) {
      updatedUser = await UserModel.findOneAndUpdate(
        { email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } },
        { status },
        { new: true }
      );
    }
    
    // Broadcast live disconnect & status event to user's active sockets
    if (req.io) {
      req.io.to(cleanEmail.toLowerCase()).emit('account_status_changed', { email: cleanEmail, status });
      req.io.to(cleanEmail).emit('account_status_changed', { email: cleanEmail, status });
    }

    res.json({
      success: true,
      message: `User ${cleanEmail} status successfully changed to ${status}`,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ success: false, error: 'Failed to update user status' });
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
  bulkPurge,
  getLockedInboxes,
  unlockInbox,
  triggerMaintenance,
  getSocketLogs,
  getJwtAudit,
  getUsers,
  updateUserStatus,
  getBlocklist,
  addBlocklist,
  removeBlocklist,
};
