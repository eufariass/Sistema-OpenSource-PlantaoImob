const db = require('../../db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') return res.json(await db.getAttendanceToday());
    if (req.method === 'DELETE') {
      await db.clearAttendance();
      return res.json({ success: true });
    }
    return res.status(405).end();
  } catch (e) {
    console.error('attendance error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
