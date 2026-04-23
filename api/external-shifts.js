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
    if (req.method === 'GET') return res.json(await db.getExternalShifts());
    if (req.method === 'POST') {
      const { name, color } = await body(req);
      if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
      try { return res.json(await db.createExternalShift({ name, color })); }
      catch { return res.status(400).json({ error: 'Já existe um plantão com esse nome' }); }
    }
    res.status(405).end();
  } catch (e) {
    console.error('external-shifts error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
