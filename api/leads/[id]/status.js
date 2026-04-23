const db = require('../../../db');

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
    if (req.method !== 'PUT') return res.status(405).end();
    const { status } = await body(req);
    res.json(await db.updateLeadStatus(req.query.id, status));
  } catch (e) {
    console.error('leads/[id]/status error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
