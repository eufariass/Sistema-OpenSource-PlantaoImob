require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT id FROM schema_migrations');
  return new Set(rows.map(row => row.id));
}

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não definida');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  await ensureMigrationsTable(client);

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter(file => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const applied = await getAppliedMigrations(client);
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✅ Migração aplicada: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  await client.end();
}

run().catch(err => {
  console.error('Falha ao rodar migrações:', err.message);
  process.exit(1);
});
