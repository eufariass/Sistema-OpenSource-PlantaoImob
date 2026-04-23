module.exports = async (req, res) => {
  const dbUrl = process.env.DATABASE_URL || '';
  const deep = req.query?.deep === '1';

  const result = {
    status: 'ok',
    env: {
      database_url: dbUrl ? dbUrl.substring(0, 28) + '...' : 'MISSING',
    },
    node_version: process.version,
    timestamp: new Date().toISOString(),
  };

  if (!dbUrl) {
    result.status = 'env_missing';
    return res.json(result);
  }

  if (!deep) return res.json(result);

  try {
    const db = require('../db');
    const timeout = (p, ms) => Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
    const brokers = await timeout(db.getBrokers(), 8000);
    const settings = await timeout(db.getSettings(), 8000);
    result.database = 'connected';
    result.brokers_count = Array.isArray(brokers) ? brokers.length : 0;
    result.settings_keys = Object.keys(settings);
  } catch (e) {
    result.status = 'db_error';
    result.error = e.message;
  }

  res.json(result);
};
