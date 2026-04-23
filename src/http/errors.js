function errorResponse(res, status, code, message) {
  return res.status(status).json({
    error: message,
    error_code: code,
  });
}

function internalError(res, context, err) {
  console.error(`${context}:`, err?.message || err);
  return errorResponse(res, 500, 'internal_error', 'Erro interno do servidor');
}

module.exports = {
  errorResponse,
  internalError,
};
