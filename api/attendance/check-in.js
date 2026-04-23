const db = require('../../db');
const { withApiHandler } = require('../../src/http/handler');
const { readJsonBody } = require('../../src/http/request');
const { errorResponse } = require('../../src/http/errors');
const { validateBrokerId } = require('../../src/validators/attendance');

module.exports = withApiHandler('api/attendance/check-in', async (req, res) => {
    if (req.method !== 'POST') return errorResponse(res, 405, 'method_not_allowed', 'Método não permitido');
    const { broker_id, entered_at, external_shift } = await readJsonBody(req);
    const validationError = validateBrokerId({ broker_id });
    if (validationError) return res.status(400).json({ error: validationError });
    const result = await db.registerBrokerPresence(broker_id, { entered_at, external_shift: external_shift || null });
    if (result.error) return res.status(400).json(result);
    res.json(result);
});
