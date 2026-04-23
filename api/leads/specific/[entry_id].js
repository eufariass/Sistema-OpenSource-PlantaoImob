const db = require('../../../db');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const result = await db.assignLead({ entry_id: req.query.entry_id });
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    console.error('leads/specific error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
