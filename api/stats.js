const db = require('../db');
const { withApiHandler } = require('../src/http/handler');
const { errorResponse } = require('../src/http/errors');

module.exports = withApiHandler('api/stats', async (req, res) => {
  if (req.method !== 'GET') return errorResponse(res, 405, 'method_not_allowed', 'Método não permitido');
  res.json(await db.getStats());
});
