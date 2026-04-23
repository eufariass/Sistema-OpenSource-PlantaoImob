const db = require('../../../db');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    await db.moveToEnd(req.query.id);
    res.json({ success: true });
  } catch (e) {
    console.error('queue/move-to-end error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
