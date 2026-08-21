const NodeCache = require('node-cache');

const mailCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });
const activeInboxesStore = new Map();
const socketLogsStore = [];
const jwtAuditLogsStore = [];
let blocklistStore = []; // In-Memory Cache for IPs/Domains

// 🛡️ Maintenance Mode state
let isMaintenanceMode = false;

// 🛡️ Abuse Detection: Track request counts per IP
const abuseTracker = new Map(); // ip -> { generateCount, messageCount, windowStart }

module.exports = {
  mailCache,
  activeInboxesStore,
  socketLogsStore,
  jwtAuditLogsStore,
  blocklistStore,
  get isMaintenanceMode() { return isMaintenanceMode; },
  set isMaintenanceMode(val) { isMaintenanceMode = val; },
  abuseTracker,
};
