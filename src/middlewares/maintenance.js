const state = require('../config/state');

const checkMaintenance = (req, res, next) => {
  if (state.isMaintenanceMode) {
    return res.status(503).json({
      success: false,
      error: 'MAINTENANCE_MODE',
      message: 'System maintenance in progress. Back in 2 minutes.',
    });
  }
  next();
};

module.exports = { checkMaintenance };
