#!/usr/bin/env node
/**
 * Smoke test opcional: exige DATABASE_URL e testa leituras principais do db.js.
 * Uso: DATABASE_URL=... node scripts/verify-db-smoke.js
 */
require('dotenv').config();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('[verify-db-smoke] SKIP: defina DATABASE_URL para executar.');
    process.exit(0);
  }
  const db = require('../db');
  const [brokers, settings, queue, ext, stats, drops] = await Promise.all([
    db.getBrokers(),
    db.getSettings(),
    db.getQueue(),
    db.getExternalQueues(),
    db.getStats(),
    db.getDropsHoje(),
  ]);
  if (!Array.isArray(brokers)) throw new Error('getBrokers deve retornar array');
  if (typeof settings !== 'object') throw new Error('getSettings deve retornar objeto');
  if (!Array.isArray(queue)) throw new Error('getQueue deve retornar array');
  if (!Array.isArray(ext)) throw new Error('getExternalQueues deve retornar array');
  if (typeof stats?.total_geral !== 'number') throw new Error('getStats inválido');
  if (typeof drops !== 'number') throw new Error('getDropsHoje deve retornar número');
  console.log('[verify-db-smoke] OK');
}

main().catch(err => {
  console.error('[verify-db-smoke] ERRO:', err.message);
  process.exit(1);
});
