const express = require('express');
const router = express.Router();
const { verifyAdmin } = require('../middlewares/auth');
const {
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
} = require('../controllers/adminController');

router.use(verifyAdmin); // Protect all routes below

router.get('/stats', getStats);
router.get('/inboxes', getInboxes);
router.post('/purge-inbox', purgeInbox);
router.post('/bulk-purge', bulkPurge);
router.get('/locked-inboxes', getLockedInboxes);
router.put('/unlock-inbox', unlockInbox);
router.post('/trigger-maintenance', triggerMaintenance);
router.get('/socket-logs', getSocketLogs);
router.get('/jwt-audit', getJwtAudit);
router.get('/users', getUsers);
router.put('/users/status', updateUserStatus);
router.get('/blocklist', getBlocklist);
router.post('/blocklist', addBlocklist);
router.delete('/blocklist/:value', removeBlocklist);

module.exports = router;
