const db = require('../db');
const { readJsonBody } = require('../src/http/request');
const { withApiHandler } = require('../src/http/handler');
const { errorResponse } = require('../src/http/errors');

module.exports = withApiHandler('api/external-shifts', async (req, res) => {
  if (req.method === 'GET') return res.json(await db.getExternalShifts());
  if (req.method === 'POST') {
      const { name, color } = await readJsonBody(req);
      if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
      try { return res.json(await db.createExternalShift({ name, color })); }
      catch { return res.status(400).json({ error: 'Já existe um plantão com esse nome' }); }
  }
  return errorResponse(res, 405, 'method_not_allowed', 'Método não permitido');
}, { adminWrite: true });
