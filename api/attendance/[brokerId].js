const db = require('../../db');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).end();
    res.json(await db.getAttendanceByBrokerForDate(req.query.brokerId));
  } catch (e) {
    console.error('attendance/[brokerId] error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
