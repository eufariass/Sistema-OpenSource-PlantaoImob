const db = require('../../db');

async function body(req) {
  if (req.body) return req.body;
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; });
    req.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve({}); } });
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const { broker_id, entered_at, external_shift } = await body(req);
    if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório' });
    const result = await db.registerBrokerPresence(broker_id, { entered_at, external_shift: external_shift || null });
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    console.error('attendance/check-in error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
