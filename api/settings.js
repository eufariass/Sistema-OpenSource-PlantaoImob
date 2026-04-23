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
    if (req.method === 'GET') {
      const s = await db.getSettings();
      return res.json({ tv_theme: 'dark', ...s });
    }
    if (req.method === 'PUT') {
      const data = await body(req);
      const entries = Object.entries(data);
      for (const [k, v] of entries) await db.setSetting(k, v);
      return res.json({ success: true, ...(await db.getSettings()) });
    }
    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
