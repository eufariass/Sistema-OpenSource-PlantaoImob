const { errorResponse } = require('./errors');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isAdminAuthorized(req) {
  const configuredToken = process.env.ADMIN_API_TOKEN;
  if (!configuredToken) return true;
  const headerToken = req.headers['x-admin-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return headerToken === configuredToken;
}

function requireAdmin(req, res) {
  if (SAFE_METHODS.has(req.method || 'GET')) return true;
  if (isAdminAuthorized(req)) return true;
  errorResponse(res, 401, 'unauthorized', 'Ação administrativa não autorizada');
  return false;
}

module.exports = {
  requireAdmin,
};
