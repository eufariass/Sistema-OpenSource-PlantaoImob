const db = require('../../db');
const { withApiHandler } = require('../../src/http/handler');
const { errorResponse } = require('../../src/http/errors');

module.exports = withApiHandler('api/drops/index', async (req, res) => {
  if (req.method === 'GET') return res.json({ drops_hoje: await db.getDropsHoje() });
  if (req.method === 'POST') {
    const count = await db.addDrop();
    return res.json({ drops_hoje: count });
  }
  return errorResponse(res, 405, 'method_not_allowed', 'Método não permitido');
}, { adminWrite: true });
