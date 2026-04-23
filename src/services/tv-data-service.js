const db = require('../../db');

async function loadTvData() {
  const [queue, externalQueues, stats, drops_hoje, settings, brokers] = await Promise.all([
    db.getQueue(),
    db.getExternalQueues(),
    db.getStats(),
    db.getDropsHoje(),
    db.getSettings(),
    db.getBrokers(),
  ]);

  return { queue, externalQueues, stats, drops_hoje, settings, brokers };
}

module.exports = {
  loadTvData,
};
