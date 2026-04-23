const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBrokerId } = require('../src/validators/attendance');

test('validateBrokerId retorna erro quando broker_id não existe', () => {
  assert.equal(validateBrokerId({}), 'broker_id é obrigatório');
});

test('validateBrokerId retorna null quando broker_id existe', () => {
  assert.equal(validateBrokerId({ broker_id: 'abc' }), null);
});
