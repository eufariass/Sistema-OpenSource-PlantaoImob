const db = require('../../db');

module.exports = {
  getQueue: db.getQueue,
  getExternalQueues: db.getExternalQueues,
  getStats: db.getStats,
  getDropsHoje: db.getDropsHoje,
  getSettings: db.getSettings,
  getBrokers: db.getBrokers,
  getAttendanceInsights: db.getAttendanceInsights,
};
