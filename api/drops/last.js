const db = require('../../db');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'DELETE') return res.status(405).end();
    const count = await db.removeDrop();
    res.json({ drops_hoje: count });
  } catch (e) {
    console.error('drops/last error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
