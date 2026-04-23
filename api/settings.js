const db = require('../db');
const { readJsonBody } = require('../src/http/request');
const { withApiHandler } = require('../src/http/handler');
const { errorResponse } = require('../src/http/errors');

module.exports = withApiHandler('api/settings', async (req, res) => {
  if (req.method === 'GET') {
    const s = await db.getSettings();
    return res.json({ tv_theme: 'dark', ...s });
  }
  if (req.method === 'PUT') {
    const data = await readJsonBody(req);
    const entries = Object.entries(data);
    for (const [k, v] of entries) await db.setSetting(k, v);
    return res.json({ success: true, ...(await db.getSettings()) });
  }
  return errorResponse(res, 405, 'method_not_allowed', 'Método não permitido');
}, { adminWrite: true });
