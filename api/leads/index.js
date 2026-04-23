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
    if (req.method === 'GET') return res.json(await db.getLeads());
    if (req.method === 'POST') {
      const result = await db.assignLead(await body(req));
      if (result.error) return res.status(400).json(result);
      return res.json(result);
    }
    if (req.method === 'DELETE') return res.json(await db.clearLeads(req.query?.scope));
    res.status(405).end();
  } catch (e) {
    console.error('leads error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
