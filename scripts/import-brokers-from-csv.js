require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { randomUUID } = require('node:crypto');

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  cells.push(current);
  return cells.map(value => value.trim());
}

function parseCsv(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);

  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeServiceAccount(row) {
  const first = normalizeName(row['First Name [Required]']);
  const last = normalizeName(row['Last Name [Required]']);
  const full = `${first} ${last}`.trim();
  const email = normalizeName(row['Email Address [Required]']);
  const emailLocal = email.split('@')[0] || '';

  const blockedTerms = [
    'adm', 'administr', 'financeiro', 'juridico', 'locacao', 'relacionamento',
    'prospeccao', 'inteligencia', 'grupo', 'geum imob', 'geum', 'partners',
    'credit', 'nucleo', 'imob', 'teste', 'fora da casa',
  ];

  if (!first || !last) return true;
  if (blockedTerms.some(term => full.includes(term))) return true;
  if (blockedTerms.some(term => emailLocal.includes(term.replace(/\s+/g, '')))) return true;
  return false;
}

function buildBrokerName(row) {
  return `${row['First Name [Required]']} ${row['Last Name [Required]']}`
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadExistingBrokers(client) {
  const { rows } = await client.query(
    'SELECT id, name, active FROM brokers'
  );
  const byName = new Map();
  rows.forEach(row => {
    byName.set(normalizeName(row.name), row);
  });
  return byName;
}

async function main() {
  const csvArg = process.argv[2] || 'User_Download_13042026_134922.csv';
  const dryRun = process.argv.includes('--dry-run');
  const includeServiceAccounts = process.argv.includes('--include-service-accounts');
  const csvPath = path.resolve(process.cwd(), csvArg);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`Arquivo não encontrado: ${csvPath}`);
  }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const activeRows = rows.filter(row => normalizeName(row['Status [READ ONLY]']) === 'active');
  const selectedRows = includeServiceAccounts
    ? activeRows
    : activeRows.filter(row => !looksLikeServiceAccount(row));

  let client = null;
  let existingByName = new Map();

  if (!dryRun) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL não definida. Use --dry-run para pré-visualizar ou configure o banco para importar.');
    }
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    existingByName = await loadExistingBrokers(client);
  }

  const imported = [];
  const skippedExisting = [];
  const skippedService = activeRows.filter(row => !includeServiceAccounts && looksLikeServiceAccount(row));
  const duplicateRows = [];
  const seenNames = new Set();

  for (const row of selectedRows) {
    const name = buildBrokerName(row);
    const normalized = normalizeName(name);
    if (!normalized) continue;

    if (seenNames.has(normalized)) {
      duplicateRows.push(name);
      continue;
    }
    seenNames.add(normalized);

    if (dryRun) {
      imported.push(name);
      continue;
    }

    const existing = existingByName.get(normalized);
    if (existing?.active) {
      skippedExisting.push(name);
      continue;
    }

    if (existing && !existing.active) {
      await client.query(
        'UPDATE brokers SET active = true WHERE id = $1',
        [existing.id]
      );
      imported.push(`${name} (reativado)`);
      continue;
    }

    await client.query(
      `INSERT INTO brokers (id, name, phone, photo_url, active)
       VALUES ($1, $2, $3, $4, true)`,
      [randomUUID(), name, null, null]
    );
    imported.push(name);
  }

  if (client) await client.end();

  console.log(`CSV: ${path.basename(csvPath)}`);
  console.log(`Ativos na planilha: ${activeRows.length}`);
  console.log(`Filtrados como contas administrativas: ${skippedService.length}`);
  console.log(`Duplicados dentro da planilha: ${duplicateRows.length}`);
  console.log(`${dryRun ? 'Prévia para importar' : 'Importados/reativados'}: ${imported.length}`);
  console.log(`Já existentes no sistema: ${skippedExisting.length}`);

  if (imported.length) {
    console.log('\nNomes processados:');
    imported.forEach(name => console.log(`- ${name}`));
  }

  if (skippedExisting.length) {
    console.log('\nJá existentes:');
    skippedExisting.forEach(name => console.log(`- ${name}`));
  }

  if (skippedService.length) {
    console.log('\nFiltrados como administrativos/serviço:');
    skippedService.forEach(row => console.log(`- ${buildBrokerName(row)} <${row['Email Address [Required]']}>`));
  }
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
