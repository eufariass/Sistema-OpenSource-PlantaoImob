const db = require('../../../db');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'DELETE') return res.status(405).end();
    await db.clearExternalQueue(decodeURIComponent(req.query.name));
    res.json({ success: true });
  } catch (e) {
    console.error('queue/external/[name] error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
