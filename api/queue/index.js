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
    if (req.method === 'GET') return res.json(await db.getQueue());
    if (req.method === 'POST') {
      const { broker_id, entered_at, external_shift, admin_override } = await body(req);
      if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório' });
      const result = await db.addToQueue(broker_id, entered_at || null, external_shift || null, { admin_override: Boolean(admin_override) });
      if (result.error) return res.status(400).json(result);
      return res.json(result);
    }
    if (req.method === 'DELETE') { await db.clearQueue(); return res.json({ success: true }); }
    res.status(405).end();
  } catch (e) {
    console.error('queue error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
