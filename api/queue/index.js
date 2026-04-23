const db = require('../../db');
const { readJsonBody } = require('../../src/http/request');
const { withApiHandler } = require('../../src/http/handler');
const { errorResponse } = require('../../src/http/errors');

module.exports = withApiHandler('api/queue/index', async (req, res) => {
  if (req.method === 'GET') return res.json(await db.getQueue());
  if (req.method === 'POST') {
      const { broker_id, entered_at, external_shift, admin_override } = await readJsonBody(req);
      if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório' });
      const result = await db.addToQueue(broker_id, entered_at || null, external_shift || null, { admin_override: Boolean(admin_override) });
      if (result.error) return res.status(400).json(result);
      return res.json(result);
  }
  if (req.method === 'DELETE') { await db.clearQueue(); return res.json({ success: true }); }
  return errorResponse(res, 405, 'method_not_allowed', 'Método não permitido');
}, { adminWrite: true });
