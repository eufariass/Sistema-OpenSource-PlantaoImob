const db = require('../../../db');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'DELETE') return res.status(405).end();
    await db.removeFromQueue(req.query.id);
    res.json({ success: true });
  } catch (e) {
    console.error('queue/[id] error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
