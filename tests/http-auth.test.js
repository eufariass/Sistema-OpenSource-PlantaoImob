const test = require('node:test');
const assert = require('node:assert/strict');
const { requireAdmin } = require('../src/http/auth');

function makeReq(method, headers = {}) {
  return { method, headers };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('deve permitir métodos seguros sem token', () => {
  delete process.env.ADMIN_API_TOKEN;
  const req = makeReq('GET');
  const res = makeRes();
  assert.equal(requireAdmin(req, res), true);
});

test('deve bloquear escrita sem token válido', () => {
  process.env.ADMIN_API_TOKEN = 'segredo';
  const req = makeReq('POST', {});
  const res = makeRes();
  assert.equal(requireAdmin(req, res), false);
  assert.equal(res.statusCode, 401);
});

test('deve permitir escrita com x-admin-token', () => {
  process.env.ADMIN_API_TOKEN = 'segredo';
  const req = makeReq('POST', { 'x-admin-token': 'segredo' });
  const res = makeRes();
  assert.equal(requireAdmin(req, res), true);
});
