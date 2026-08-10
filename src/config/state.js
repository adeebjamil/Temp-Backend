const NodeCache = require('node-cache');

const mailCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });
const activeInboxesStore = new Map();
const socketLogsStore = [];
const jwtAuditLogsStore = [];
let blocklistStore = []; // In-Memory Cache for IPs/Domains

module.exports = {
  mailCache,
  activeInboxesStore,
  socketLogsStore,
  jwtAuditLogsStore,
  blocklistStore,
};
