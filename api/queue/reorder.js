const db = require('../../db');

async function body(req) {
  if (req.body) return req.body;
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => s += c);
    req.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve({}); } });
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const { ids } = await body(req);
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids deve ser array' });
    await db.setQueueOrder(ids);
    res.json({ success: true });
  } catch (e) {
    console.error('queue/reorder error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
