const { internalError } = require('./errors');
const { requireAdmin } = require('./auth');

function withApiHandler(context, handler, options = {}) {
  const { adminWrite = false } = options;

  return async function wrapped(req, res) {
    try {
      if (adminWrite && !requireAdmin(req, res)) return;
      await handler(req, res);
    } catch (err) {
      internalError(res, context, err);
    }
  };
}

module.exports = {
  withApiHandler,
};
