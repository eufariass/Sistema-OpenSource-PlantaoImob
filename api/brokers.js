const db = require('../db');
const { readJsonBody } = require('../src/http/request');
const { withApiHandler } = require('../src/http/handler');
const { errorResponse } = require('../src/http/errors');

module.exports = withApiHandler('api/brokers', async (req, res) => {
  if (req.method === 'GET') return res.json(await db.getBrokers());
  if (req.method === 'POST') {
      const { name, phone, photo_url } = await readJsonBody(req);
      if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
      return res.json(await db.createBroker({ name, phone, photo_url }));
  }
  return errorResponse(res, 405, 'method_not_allowed', 'Método não permitido');
}, { adminWrite: true });
