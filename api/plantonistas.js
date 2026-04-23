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
    if (req.method === 'PUT') {
      const { plantonistas } = await body(req);
      const saved = await db.setSettings({ plantonistas: plantonistas || [] });
      return res.json({ success: true, plantonistas: saved.plantonistas || [] });
    }
    if (req.method === 'GET') {
      const s = await db.getSettings();
      return res.json({ plantonistas: s.plantonistas || [] });
    }
    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
