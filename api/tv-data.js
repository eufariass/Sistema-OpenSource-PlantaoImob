const { withApiHandler } = require('../src/http/handler');
const { loadTvData } = require('../src/services/tv-data-service');

const DEFAULT_TTL_MS = process.env.VERCEL ? 0 : 15000;
const TTL_MS = Math.max(0, Number(process.env.TV_DATA_CACHE_TTL_MS || DEFAULT_TTL_MS));
const STALE_MS = 120000;
let cache = { data: null, ts: 0 };

module.exports = withApiHandler('api/tv-data', async (req, res) => {
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
    const payload = await loadTvData();
    cache = { data: payload, ts: now };
    res.json({ ...payload, _cache: 'miss' });
  } catch (e) {
    if (cache.data && age < STALE_MS) {
      return res.json({ ...cache.data, _cache: 'stale', _stale_error: 'stale_data_fallback' });
    }
    throw e;
  }
});
