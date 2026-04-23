const db = require('../../db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') return res.json({ drops_hoje: await db.getDropsHoje() });
    if (req.method === 'POST') {
      const count = await db.addDrop();
      return res.json({ drops_hoje: count });
    }
    res.status(405).end();
  } catch (e) {
    console.error('drops error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
