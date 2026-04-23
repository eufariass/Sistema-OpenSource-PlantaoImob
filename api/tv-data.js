const db = require('../db');

const DEFAULT_TTL_MS = process.env.VERCEL ? 0 : 15000;
const TTL_MS = Math.max(0, Number(process.env.TV_DATA_CACHE_TTL_MS || DEFAULT_TTL_MS));
const STALE_MS = 120000;
let cache = { data: null, ts: 0 };

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();
  const now = Date.now();
  const age = now - cache.ts;
  if (process.env.VERCEL) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10, stale-while-revalidate=30');
  }

  if (cache.data && age < TTL_MS) {
    return res.json({ ...cache.data, _cache: 'hit' });
  }

  try {
    const [queue, externalQueues, stats, drops_hoje, settings, brokers] = await Promise.all([
      db.getQueue(),
      db.getExternalQueues(),
      db.getStats(),
      db.getDropsHoje(),
      db.getSettings(),
      db.getBrokers(),
    ]);
    const payload = { queue, externalQueues, stats, drops_hoje, settings, brokers };
    cache = { data: payload, ts: now };
    res.json({ ...payload, _cache: 'miss' });
  } catch (e) {
    if (cache.data && age < STALE_MS) {
      return res.json({ ...cache.data, _cache: 'stale', _stale_error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
};
