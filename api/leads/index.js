const db = require('../../db');
const { readJsonBody } = require('../../src/http/request');
const { withApiHandler } = require('../../src/http/handler');
const { errorResponse } = require('../../src/http/errors');

module.exports = withApiHandler('api/leads/index', async (req, res) => {
  if (req.method === 'GET') return res.json(await db.getLeads());
  if (req.method === 'POST') {
    const result = await db.assignLead(await readJsonBody(req));
    if (result.error) return res.status(400).json(result);
    return res.json(result);
  }
  if (req.method === 'DELETE') return res.json(await db.clearLeads(req.query?.scope));
  return errorResponse(res, 405, 'method_not_allowed', 'Método não permitido');
}, { adminWrite: true });
