const db = require('../db');

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
    if (req.method === 'GET') return res.json(await db.getBrokers());
    if (req.method === 'POST') {
      const { name, phone, photo_url } = await body(req);
      if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
      return res.json(await db.createBroker({ name, phone, photo_url }));
    }
    res.status(405).end();
  } catch (e) {
    console.error('brokers error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
