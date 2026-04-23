require('dotenv').config();
const { Client } = require('pg');

const sql = `
CREATE TABLE IF NOT EXISTS external_shifts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drops (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brokers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  photo_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queue_entries (
  id TEXT PRIMARY KEY,
  broker_id TEXT NOT NULL REFERENCES brokers(id),
  position INTEGER NOT NULL,
  status TEXT DEFAULT 'waiting',
  entered_at TIMESTAMPTZ DEFAULT NOW(),
  external_shift TEXT DEFAULT NULL,
  queue_rule TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS broker_attendance (
  id TEXT PRIMARY KEY,
  broker_id TEXT NOT NULL REFERENCES brokers(id),
  attendance_date DATE NOT NULL,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'waiting',
  presence_mode TEXT DEFAULT NULL,
  last_reason TEXT DEFAULT NULL,
  checkout_at TIMESTAMPTZ DEFAULT NULL,
  return_at TIMESTAMPTZ DEFAULT NULL,
  lunch_started_at TIMESTAMPTZ DEFAULT NULL,
  lunch_returned_at TIMESTAMPTZ DEFAULT NULL,
  assigned_shift TEXT DEFAULT NULL,
  shift_doubled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (broker_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  broker_id TEXT NOT NULL REFERENCES brokers(id),
  queue_entry_id TEXT,
  client_name TEXT,
  phone TEXT,
  source TEXT,
  notes TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'novo'
);

ALTER TABLE brokers ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS queue_rule TEXT;
ALTER TABLE broker_attendance ADD COLUMN IF NOT EXISTS presence_mode TEXT;
ALTER TABLE broker_attendance ADD COLUMN IF NOT EXISTS last_reason TEXT;
ALTER TABLE broker_attendance ADD COLUMN IF NOT EXISTS checkout_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE broker_attendance ADD COLUMN IF NOT EXISTS return_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE broker_attendance ADD COLUMN IF NOT EXISTS lunch_started_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE broker_attendance ADD COLUMN IF NOT EXISTS lunch_returned_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE broker_attendance ADD COLUMN IF NOT EXISTS assigned_shift TEXT DEFAULT NULL;
ALTER TABLE broker_attendance ADD COLUMN IF NOT EXISTS shift_doubled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE broker_attendance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
`;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Conectado ao banco...');
  await client.query(sql);
  console.log('✅ Tabelas criadas com sucesso!');
  await client.end();
}

main().catch(err => { console.error('Erro:', err.message); process.exit(1); });
