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
    const { id } = req.query;
    if (req.method === 'PUT') return res.json(await db.updateBroker(id, await body(req)));
    if (req.method === 'DELETE') { await db.deleteBroker(id); return res.json({ success: true }); }
    res.status(405).end();
  } catch (e) {
    console.error('brokers/[id] error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
