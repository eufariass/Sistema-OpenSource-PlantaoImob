function validateBrokerId(payload) {
  if (!payload || !payload.broker_id) {
    return 'broker_id é obrigatório';
  }
  return null;
}

module.exports = {
  validateBrokerId,
};
