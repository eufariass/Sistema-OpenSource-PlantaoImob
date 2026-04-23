const { withApiHandler } = require('../src/http/handler');

module.exports = withApiHandler('api/health', async (req, res) => {
  const dbUrl = process.env.DATABASE_URL || '';
  const deep = req.query?.deep === '1';

  const result = {
    status: 'ok',
    env: {
      database_url_configured: Boolean(dbUrl),
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
    result.error = 'database_unavailable';
  }

  res.json(result);
});
