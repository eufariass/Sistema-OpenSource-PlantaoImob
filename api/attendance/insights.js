const db = require('../../db');
const { withApiHandler } = require('../../src/http/handler');
const { errorResponse } = require('../../src/http/errors');

module.exports = withApiHandler('api/attendance/insights', async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const data = await db.getAttendanceInsights(req.query?.month);
    res.json(data);
  } catch (err) {
    return errorResponse(res, 400, 'invalid_month', err.message || 'Mês inválido');
  }
});
