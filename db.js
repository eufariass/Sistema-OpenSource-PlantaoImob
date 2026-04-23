require('dotenv').config();
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');

let pool;
let attendanceSchemaReadyPromise = null;
const DEFAULT_READ_CACHE_TTL_MS = process.env.VERCEL ? 0 : 15000;
const READ_CACHE_TTL_MS = Math.max(0, Number(process.env.DB_READ_CACHE_TTL_MS || DEFAULT_READ_CACHE_TTL_MS));
const APP_TIMEZONE = String(process.env.APP_TIMEZONE || 'America/Sao_Paulo');
const SQL_TIME_ZONE = APP_TIMEZONE.replace(/'/g, "''");
const readCache = new Map();

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL não definida. Defina a connection string do Postgres (ex.: painel Supabase → Settings → Database → Connection string URI).'
    );
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 8000),
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function ensureAttendanceSchema() {
  if (!attendanceSchemaReadyPromise) {
    attendanceSchemaReadyPromise = query(
      `ALTER TABLE broker_attendance
       ADD COLUMN IF NOT EXISTS assigned_shift TEXT DEFAULT NULL`
    ).catch(err => {
      attendanceSchemaReadyPromise = null;
      throw err;
    });
  }
  return attendanceSchemaReadyPromise;
}

async function cachedRead(key, loader) {
  if (!READ_CACHE_TTL_MS) return loader();
  const now = Date.now();
  const cached = readCache.get(key);
  if (cached && cached.expires_at > now) return cached.value;
  const value = await loader();
  readCache.set(key, { value, expires_at: now + READ_CACHE_TTL_MS });
  return value;
}

function invalidateReadCache() {
  readCache.clear();
}

// ─── Date helpers ───

function timeZoneDateKey(date = new Date(), timeZone = APP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = {};
  parts.forEach(part => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });
  return `${map.year}-${map.month}-${map.day}`;
}

function weekAgo() {
  return new Date(Date.now() - 7 * 86400000).toISOString();
}

function sameAppDaySql(column, reference = 'now()') {
  return `timezone('${SQL_TIME_ZONE}', ${column})::date = timezone('${SQL_TIME_ZONE}', ${reference})::date`;
}

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function minutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function secondsOfDay(date = new Date()) {
  return (date.getHours() * 3600) + (date.getMinutes() * 60) + date.getSeconds();
}

function parseDbDate(value) {
  if (!value) return null;
  const raw = String(value);
  if (raw.includes('T') || raw.endsWith('Z') || raw.includes('+')) return new Date(raw);
  return new Date(raw.replace(' ', 'T') + 'Z');
}

function parseMonthInput(value) {
  if (!value) return monthKey();
  const match = String(value).match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('Mês inválido. Use o formato YYYY-MM.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error('Mês inválido. Use o formato YYYY-MM.');
  return `${year}-${String(month).padStart(2, '0')}`;
}

const MAIN_QUEUE_WINDOWS = [
  { name: 'morning', lottery_start: 510, lottery_end: 541, final_end: 546, trigger_at: 541 },
  { name: 'afternoon', lottery_start: 720, lottery_end: 786, final_end: 786, trigger_at: 786 },
];

const ATTENDANCE_EXIT_REASONS = {
  atendimento: 'service',
  nao_volto: 'gone',
  almoco_retorno: 'lunch',
};

const AFTERNOON_QUEUE_RESET_MINUTE = 12 * 60;

function classifyMainQueueWindow(entryDate, now, queueRuleOverride = null) {
  if (queueRuleOverride === 'lottery_window' || queueRuleOverride === 'final_queue_window') {
    return queueRuleOverride;
  }
  if (!entryDate || Number.isNaN(entryDate.getTime()) || !isSameLocalDay(entryDate, now)) {
    return 'regular';
  }
  for (const window of MAIN_QUEUE_WINDOWS) {
    if (isLotteryCandidateInWindow(entryDate, now, window)) return 'lottery_window';
    if (isFinalQueueWindow(entryDate, now, window)) return 'final_queue_window';
  }
  return 'regular';
}

function classifyAttendanceWindow(now = new Date()) {
  const secs = secondsOfDay(now);
  if (secs >= ((8 * 3600) + (30 * 60)) && secs <= ((9 * 3600) + 59)) return 'lottery_window';
  if (secs > ((9 * 3600) + 59) && secs < ((9 * 3600) + (6 * 60))) return 'final_queue_window';
  if (secs >= (12 * 3600) && secs < ((13 * 3600) + (6 * 60))) return 'lottery_window';
  return 'presence_only';
}

function shouldAutoJoinMainQueue(now = new Date()) {
  const mins = minutesOfDay(now);
  if (mins >= 510 && mins < 546) return true;
  if (mins >= AFTERNOON_QUEUE_RESET_MINUTE && mins < 786) return true;
  return false;
}

function attendanceStatusLabel(status, shiftDoubled) {
  const labels = {
    waiting: 'Na fila',
    present_only: 'Presente via QR',
    service: 'Em atendimento',
    lunch: 'Em almoço',
    gone: 'Não volta',
  };
  const base = labels[status] || 'Presente';
  return shiftDoubled ? `${base} • plantão dobrado` : base;
}

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function isLotteryCandidateInWindow(entryDate, now, window) {
  if (!entryDate || Number.isNaN(entryDate.getTime())) return false;
  if (!isSameLocalDay(entryDate, now)) return false;
  const mins = minutesOfDay(entryDate);
  return mins >= window.lottery_start && mins < window.lottery_end;
}

function isFinalQueueWindow(entryDate, now, window) {
  if (!entryDate || Number.isNaN(entryDate.getTime())) return false;
  if (!isSameLocalDay(entryDate, now)) return false;
  const mins = minutesOfDay(entryDate);
  return mins >= window.lottery_end && mins < window.final_end;
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isAllowedMainQueueEntryMinute(mins) {
  return MAIN_QUEUE_WINDOWS.some(window => mins >= window.lottery_start && mins < window.final_end);
}

function mapQueueRow(row) {
  const broker_name = row.broker_name;
  const broker_phone = row.broker_phone;
  const broker_photo_url = row.broker_photo_url || null;
  return {
    id: row.id,
    broker_id: row.broker_id,
    position: row.position,
    status: row.status,
    entered_at: row.entered_at,
    external_shift: row.external_shift,
    queue_rule: row.queue_rule || null,
    brokers: { name: broker_name, phone: broker_phone, photo_url: broker_photo_url },
    broker_name,
    broker_phone,
    broker_photo_url,
  };
}

function mapAttendanceRow(row) {
  const assignedShift = row.assigned_shift || null;
  return {
    id: row.id,
    broker_id: row.broker_id,
    broker_name: row.broker_name,
    broker_photo_url: row.broker_photo_url || null,
    attendance_date: row.attendance_date,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    status: row.status,
    presence_mode: row.presence_mode || null,
    last_reason: row.last_reason || null,
    checkout_at: row.checkout_at,
    return_at: row.return_at,
    lunch_started_at: row.lunch_started_at,
    lunch_returned_at: row.lunch_returned_at,
    shift_doubled: Boolean(row.shift_doubled),
    assigned_shift: assignedShift,
    assigned_shift_label: row.id ? (assignedShift || 'Souza Naves') : null,
    status_label: attendanceStatusLabel(row.status, Boolean(row.shift_doubled)),
  };
}

// ─── Queue ordering ───

async function reorderShift(external_shift) {
  let sql = `
    SELECT id, entered_at, queue_rule FROM queue_entries
    WHERE status = 'waiting'
  `;
  const params = [];
  if (external_shift !== null && external_shift !== undefined) {
    sql += ' AND external_shift = $1';
    params.push(external_shift);
  } else {
    sql += ' AND external_shift IS NULL';
  }
  sql += ' ORDER BY entered_at ASC, id ASC';

  const { rows: entries } = await query(sql, params);
  if (!entries?.length) return;

  let ordered = [...entries];

  if (external_shift === null || external_shift === undefined) {
    const now = new Date();
    const nowMins = minutesOfDay(now);
    const todayKey = localDateKey(now);
    const settings = await getSettings();
    const lotteryMap = settings.morning_lottery_orders || {};

    for (const window of MAIN_QUEUE_WINDOWS) {
      const lotteryKey = `${todayKey}:${window.name}`;
      if (nowMins >= window.trigger_at && !lotteryMap[lotteryKey]) {
        const candidates = ordered
          .filter(e => classifyMainQueueWindow(parseDbDate(e.entered_at), now, e.queue_rule) === 'lottery_window')
          .map(e => e.id);
        if (candidates.length) {
          lotteryMap[lotteryKey] = shuffleArray(candidates);
        }
      }
    }
    await setSetting('morning_lottery_orders', lotteryMap);

    const lotteryRankByWindow = {};
    MAIN_QUEUE_WINDOWS.forEach(window => {
      const key = `${todayKey}:${window.name}`;
      const ids = lotteryMap[key] || [];
      const rank = {};
      ids.forEach((id, idx) => { rank[id] = idx; });
      lotteryRankByWindow[window.name] = rank;
    });

    if (MAIN_QUEUE_WINDOWS.some(window => nowMins >= window.trigger_at)) {
      ordered.sort((a, b) => {
        const da = parseDbDate(a.entered_at);
        const db = parseDbDate(b.entered_at);

        let aLotteryWindow = null;
        let bLotteryWindow = null;
        let aFinalWindow = null;
        let bFinalWindow = null;

        for (const window of MAIN_QUEUE_WINDOWS) {
          if (nowMins < window.trigger_at) continue;
          if (!aLotteryWindow && classifyMainQueueWindow(da, now, a.queue_rule) === 'lottery_window') aLotteryWindow = window.name;
          if (!bLotteryWindow && classifyMainQueueWindow(db, now, b.queue_rule) === 'lottery_window') bLotteryWindow = window.name;
          if (!aFinalWindow && classifyMainQueueWindow(da, now, a.queue_rule) === 'final_queue_window') aFinalWindow = window.name;
          if (!bFinalWindow && classifyMainQueueWindow(db, now, b.queue_rule) === 'final_queue_window') bFinalWindow = window.name;
        }

        const aCandidate = Boolean(aLotteryWindow);
        const bCandidate = Boolean(bLotteryWindow);
        if (aCandidate !== bCandidate) return aCandidate ? -1 : 1;

        const aLate = Boolean(aFinalWindow);
        const bLate = Boolean(bFinalWindow);
        if (aLate !== bLate) return aLate ? 1 : -1;

        if (aCandidate && bCandidate) {
          if (aLotteryWindow !== bLotteryWindow) {
            const ai = MAIN_QUEUE_WINDOWS.findIndex(w => w.name === aLotteryWindow);
            const bi = MAIN_QUEUE_WINDOWS.findIndex(w => w.name === bLotteryWindow);
            if (ai !== bi) return ai - bi;
          }
          const ra = lotteryRankByWindow[aLotteryWindow]?.[a.id] ?? Number.MAX_SAFE_INTEGER;
          const rb = lotteryRankByWindow[bLotteryWindow]?.[b.id] ?? Number.MAX_SAFE_INTEGER;
          if (ra !== rb) return ra - rb;
        }

        return new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime();
      });
    }
  }

  await Promise.all(
    ordered.map((e, i) =>
      query('UPDATE queue_entries SET position = $1 WHERE id = $2', [i + 1, e.id])
    )
  );
}

// ─── External Shifts ───

async function getExternalShifts() {
  return cachedRead('external_shifts', async () => {
    const { rows } = await query(
      `SELECT * FROM external_shifts WHERE active = true ORDER BY name ASC`
    );
    return rows || [];
  });
}

async function createExternalShift({ name, color }) {
  const id = randomUUID();
  try {
    const { rows } = await query(
      `INSERT INTO external_shifts (id, name, color)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, name, color || '#3b82f6']
    );
    invalidateReadCache();
    return rows[0];
  } catch (e) {
    if (e.code === '23505') throw new Error('Já existe um plantão com esse nome');
    throw e;
  }
}

async function updateExternalShift(id, { name, color }) {
  const patch = [];
  const vals = [];
  let i = 1;
  if (name !== undefined && name !== null) {
    patch.push(`name = $${i++}`);
    vals.push(name);
  }
  if (color !== undefined && color !== null) {
    patch.push(`color = $${i++}`);
    vals.push(color);
  }
  if (!patch.length) {
    const { rows } = await query('SELECT * FROM external_shifts WHERE id = $1', [id]);
    return rows[0];
  }
  vals.push(id);
  const { rows } = await query(
    `UPDATE external_shifts SET ${patch.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  invalidateReadCache();
  return rows[0];
}

async function deleteExternalShift(id) {
  await query('UPDATE external_shifts SET active = false WHERE id = $1', [id]);
  invalidateReadCache();
}

// ─── Brokers ───

async function getBrokers() {
  try {
    return cachedRead('brokers', async () => {
      const { rows } = await query(
        `SELECT * FROM brokers WHERE active = true ORDER BY name ASC`
      );
      return rows || [];
    });
  } catch (err) {
    console.error('getBrokers error:', err.message);
    return [];
  }
}

async function createBroker({ name, phone, photo_url }) {
  const id = randomUUID();
  const { rows } = await query(
    `INSERT INTO brokers (id, name, phone, photo_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, name, phone || null, photo_url || null]
  );
  invalidateReadCache();
  return rows[0];
}

async function updateBroker(id, { name, phone, active, photo_url }) {
  const patch = [];
  const vals = [];
  let i = 1;
  if (name !== undefined && name !== null) {
    patch.push(`name = $${i++}`);
    vals.push(name);
  }
  if (phone !== undefined && phone !== null) {
    patch.push(`phone = $${i++}`);
    vals.push(phone);
  }
  if (active !== undefined && active !== null) {
    patch.push(`active = $${i++}`);
    vals.push(active);
  }
  if (photo_url !== undefined) {
    patch.push(`photo_url = $${i++}`);
    vals.push(photo_url);
  }
  if (!patch.length) {
    const { rows } = await query(`SELECT * FROM brokers WHERE id = $1`, [id]);
    return rows[0];
  }
  vals.push(id);
  const { rows } = await query(
    `UPDATE brokers SET ${patch.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  invalidateReadCache();
  return rows[0];
}

async function deleteBroker(id) {
  const { rows: entries } = await query(
    `SELECT id, external_shift FROM queue_entries
     WHERE broker_id = $1 AND status = 'waiting'`,
    [id]
  );

  await query(`DELETE FROM queue_entries WHERE broker_id = $1 AND status = 'waiting'`, [id]);
  await query(`UPDATE brokers SET active = false WHERE id = $1`, [id]);

  const shifts = new Set((entries || []).map(e => e.external_shift));
  await Promise.all([...shifts].map(s => reorderShift(s)));
  invalidateReadCache();
}

async function getWaitingEntryByBroker(broker_id) {
  const { rows } = await query(
    `SELECT q.id, q.external_shift
     FROM queue_entries q
     WHERE q.broker_id = $1 AND q.status = 'waiting'
     ORDER BY q.position ASC
     LIMIT 1`,
    [broker_id]
  );
  return rows[0] || null;
}

async function getAttendanceByBrokerForDate(broker_id, attendanceDate = localDateKey()) {
  await ensureAttendanceSchema();
  if (attendanceDate === localDateKey()) await ensureAfternoonQueueReset();
  const { rows } = await query(
    `SELECT a.*, b.name AS broker_name, b.photo_url AS broker_photo_url
     FROM broker_attendance a
     INNER JOIN brokers b ON b.id = a.broker_id
     WHERE a.broker_id = $1 AND a.attendance_date = $2::date
     LIMIT 1`,
    [broker_id, attendanceDate]
  );
  return rows[0] ? mapAttendanceRow(rows[0]) : null;
}

async function ensureAttendanceRow(broker_id, now = new Date()) {
  await ensureAttendanceSchema();
  const attendanceDate = localDateKey(now);
  const existing = await getAttendanceByBrokerForDate(broker_id, attendanceDate);
  if (existing) return existing;

  const { rows } = await query(
    `INSERT INTO broker_attendance (id, broker_id, attendance_date, first_seen_at, last_seen_at, updated_at)
     VALUES ($1, $2, $3::date, $4::timestamptz, $4::timestamptz, $4::timestamptz)
     RETURNING *`,
    [randomUUID(), broker_id, attendanceDate, now.toISOString()]
  );

  const { rows: joined } = await query(
    `SELECT a.*, b.name AS broker_name, b.photo_url AS broker_photo_url
     FROM broker_attendance a
     INNER JOIN brokers b ON b.id = a.broker_id
     WHERE a.id = $1`,
    [rows[0].id]
  );

  return mapAttendanceRow(joined[0]);
}

async function updateAttendanceState(broker_id, patch, attendanceDate = localDateKey()) {
  await ensureAttendanceSchema();
  const keys = Object.keys(patch);
  if (!keys.length) return getAttendanceByBrokerForDate(broker_id, attendanceDate);

  const vals = [];
  const set = keys.map((key, index) => {
    vals.push(patch[key]);
    return `${key} = $${index + 1}`;
  });
  vals.push(broker_id, attendanceDate);

  await query(
    `UPDATE broker_attendance
     SET ${set.join(', ')}, updated_at = NOW()
     WHERE broker_id = $${vals.length - 1} AND attendance_date = $${vals.length}::date`,
    vals
  );

  return getAttendanceByBrokerForDate(broker_id, attendanceDate);
}

async function getAttendanceToday() {
  await ensureAttendanceSchema();
  await ensureAfternoonQueueReset();
  return cachedRead('attendance_today', async () => {
    const attendanceDate = localDateKey();
    const { rows } = await query(
      `SELECT b.id AS broker_id,
              b.name AS broker_name,
              b.photo_url AS broker_photo_url,
              a.id,
              a.attendance_date,
              a.first_seen_at,
              a.last_seen_at,
              a.status,
              a.presence_mode,
              a.last_reason,
              a.checkout_at,
              a.return_at,
              a.lunch_started_at,
              a.lunch_returned_at,
              a.shift_doubled,
              a.assigned_shift
       FROM brokers b
       LEFT JOIN broker_attendance a
         ON a.broker_id = b.id
        AND a.attendance_date = $1::date
       WHERE b.active = true
       ORDER BY b.name ASC`,
      [attendanceDate]
    );
    return (rows || []).map(row => {
      if (!row.id) {
        return {
          id: null,
          broker_id: row.broker_id,
          broker_name: row.broker_name,
          broker_photo_url: row.broker_photo_url || null,
          attendance_date: attendanceDate,
          first_seen_at: null,
          last_seen_at: null,
          status: 'absent',
          presence_mode: null,
          last_reason: null,
          checkout_at: null,
          return_at: null,
          lunch_started_at: null,
          lunch_returned_at: null,
          shift_doubled: false,
          assigned_shift: null,
          assigned_shift_label: null,
          status_label: 'Não registrado',
        };
      }
      return mapAttendanceRow(row);
    });
  });
}

async function getAttendanceInsights(monthInput = monthKey()) {
  await ensureAttendanceSchema();
  const month = parseMonthInput(monthInput);
  return cachedRead(`attendance_insights:${month}`, async () => {
    const [year, monthNumber] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const lastDay = new Date(year, monthNumber, 0).getDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

    const { rows } = await query(
      `SELECT b.id AS broker_id,
              b.name AS broker_name,
              b.photo_url AS broker_photo_url,
              a.attendance_date,
              a.first_seen_at,
              a.last_seen_at,
              a.status,
              a.presence_mode,
              a.last_reason,
              a.checkout_at,
              a.return_at,
              a.lunch_started_at,
              a.lunch_returned_at,
              a.shift_doubled,
              a.assigned_shift
       FROM brokers b
       LEFT JOIN broker_attendance a
         ON a.broker_id = b.id
        AND a.attendance_date BETWEEN $1::date AND $2::date
       WHERE b.active = true
       ORDER BY b.name ASC, a.attendance_date ASC NULLS LAST`,
      [monthStart, monthEnd]
    );

    const brokersMap = new Map();
    const dailyMap = new Map();
    for (let day = 1; day <= lastDay; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      dailyMap.set(date, { date, day, present_count: 0, doubled_count: 0, brokers: [] });
    }

    (rows || []).forEach(row => {
      if (!brokersMap.has(row.broker_id)) {
        brokersMap.set(row.broker_id, {
          broker_id: row.broker_id,
          broker_name: row.broker_name,
          broker_photo_url: row.broker_photo_url || null,
          presence_days: 0,
          waiting_days: 0,
          present_only_days: 0,
          service_days: 0,
          lunch_days: 0,
          gone_days: 0,
          shift_doubled_days: 0,
          last_seen_at: null,
        });
      }
      if (!row.attendance_date) return;

      const broker = brokersMap.get(row.broker_id);
      broker.presence_days += 1;
      if (row.status === 'waiting') broker.waiting_days += 1;
      if (row.status === 'present_only') broker.present_only_days += 1;
      if (row.status === 'service') broker.service_days += 1;
      if (row.status === 'lunch') broker.lunch_days += 1;
      if (row.status === 'gone') broker.gone_days += 1;
      if (row.shift_doubled) broker.shift_doubled_days += 1;
      if (!broker.last_seen_at || (row.last_seen_at && row.last_seen_at > broker.last_seen_at)) {
        broker.last_seen_at = row.last_seen_at || broker.last_seen_at;
      }

      const dateKey = row.attendance_date instanceof Date
        ? row.attendance_date.toISOString().slice(0, 10)
        : String(row.attendance_date).slice(0, 10);
      const dayEntry = dailyMap.get(dateKey);
      if (!dayEntry) return;
      dayEntry.present_count += 1;
      if (row.shift_doubled) dayEntry.doubled_count += 1;
      dayEntry.brokers.push({
        broker_id: row.broker_id,
        broker_name: row.broker_name,
        broker_photo_url: row.broker_photo_url || null,
        status: row.status,
        status_label: attendanceStatusLabel(row.status, Boolean(row.shift_doubled)),
        shift_doubled: Boolean(row.shift_doubled),
        first_seen_at: row.first_seen_at,
        last_seen_at: row.last_seen_at,
      });
    });

    const ranking = Array.from(brokersMap.values())
      .sort((a, b) => b.presence_days - a.presence_days || a.broker_name.localeCompare(b.broker_name, 'pt-BR'));

    const daily = Array.from(dailyMap.values()).map(day => ({
      ...day,
      brokers: day.brokers.sort((a, b) => a.broker_name.localeCompare(b.broker_name, 'pt-BR')),
    }));

    const daysWithAttendance = daily.filter(day => day.present_count > 0).length;
    const totalPresenceRecords = ranking.reduce((sum, broker) => sum + broker.presence_days, 0);
    const totalShiftDoubledRecords = ranking.reduce((sum, broker) => sum + broker.shift_doubled_days, 0);
    const leastPresenceCandidates = [...ranking]
      .sort((a, b) => a.presence_days - b.presence_days || a.broker_name.localeCompare(b.broker_name, 'pt-BR'));

    const monthLabel = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(`${monthStart}T12:00:00-03:00`));

    return {
      month,
      month_label: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
      range: {
        start: monthStart,
        end: monthEnd,
        days_in_month: lastDay,
      },
      summary: {
        active_brokers: ranking.length,
        days_with_attendance: daysWithAttendance,
        total_presence_records: totalPresenceRecords,
        total_shift_doubled_records: totalShiftDoubledRecords,
        average_daily_presence: daysWithAttendance ? Number((totalPresenceRecords / daysWithAttendance).toFixed(1)) : 0,
        broker_most_presence: ranking[0] || null,
        broker_least_presence: leastPresenceCandidates[0] || null,
      },
      daily,
      ranking,
    };
  });
}

// ─── Queue ───

async function getQueue() {
  await ensureAfternoonQueueReset();
  return cachedRead('queue_main', async () => {
    const { rows } = await query(`
      SELECT q.id, q.broker_id, q.position, q.status, q.entered_at, q.external_shift, q.queue_rule,
             b.name AS broker_name, b.phone AS broker_phone, b.photo_url AS broker_photo_url
      FROM queue_entries q
      INNER JOIN brokers b ON b.id = q.broker_id
      WHERE q.status = 'waiting' AND q.external_shift IS NULL
      ORDER BY q.position ASC
    `);
    return (rows || []).map(mapQueueRow);
  });
}

async function getExternalQueues() {
  return cachedRead('queue_external', async () => {
    const [{ rows: entries }, { rows: shifts }] = await Promise.all([
      query(`
        SELECT q.id, q.broker_id, q.position, q.status, q.entered_at, q.external_shift, q.queue_rule,
               b.name AS broker_name, b.phone AS broker_phone, b.photo_url AS broker_photo_url
        FROM queue_entries q
        INNER JOIN brokers b ON b.id = q.broker_id
        WHERE q.status = 'waiting' AND q.external_shift IS NOT NULL
        ORDER BY q.external_shift ASC, q.position ASC
      `),
      query(`SELECT name, color FROM external_shifts WHERE active = true`),
    ]);

    const colorMap = {};
    (shifts || []).forEach(s => { colorMap[s.name] = s.color; });

    const groups = {};
    (entries || []).forEach(e => {
      const key = e.external_shift;
      const mapped = mapQueueRow(e);
      if (!groups[key]) groups[key] = { name: key, color: colorMap[key] || '#3b82f6', entries: [] };
      groups[key].entries.push(mapped);
    });

    return Object.values(groups);
  });
}

async function addToQueue(broker_id, entered_at, external_shift, options = {}) {
  const { admin_override = false, queue_rule: forcedQueueRule = null } = options;
  const shift = external_shift || null;
  if (!shift && !admin_override) {
    const now = new Date();
    if (classifyAttendanceWindow(now) === 'presence_only') {
      return { error: 'Fora das janelas de fila (manhã 08:30–09:06 e tarde 12:00–13:06) o sistema registra apenas presença via QR Code.' };
    }
  }

  const { rows: existingRows } = await query(
    `SELECT id, external_shift FROM queue_entries
     WHERE broker_id = $1 AND status = 'waiting' LIMIT 1`,
    [broker_id]
  );
  const existing = existingRows[0];

  if (existing) {
    const onde = existing.external_shift ? `no plantão "${existing.external_shift}"` : 'na fila principal';
    return { error: `Corretor já está ${onde}. Remova-o primeiro.` };
  }

  const id = randomUUID();
  const params = [id, broker_id, 9999, shift, forcedQueueRule];
  let insertSql = `
    INSERT INTO queue_entries (id, broker_id, position, external_shift, queue_rule)
    VALUES ($1, $2, $3, $4, $5)
  `;
  if (entered_at) {
    insertSql = `
      INSERT INTO queue_entries (id, broker_id, position, external_shift, queue_rule, entered_at)
      VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
    `;
    params.push(entered_at);
  }
  await query(insertSql, params);
  await reorderShift(shift);
  invalidateReadCache();

  const { rows } = await query(
    `SELECT q.*, b.name AS broker_name
     FROM queue_entries q
     INNER JOIN brokers b ON b.id = q.broker_id
     WHERE q.id = $1`,
    [id]
  );
  const data = rows[0];

  let computedQueueRule = 'regular';
  if (!shift) {
    computedQueueRule = classifyMainQueueWindow(parseDbDate(data?.entered_at), new Date(), data?.queue_rule);
  }

  return { ...data, broker_name: data?.broker_name, queue_rule: computedQueueRule };
}

async function setQueueOrder(ids) {
  await Promise.all(
    ids.map((id, i) =>
      query(
        `UPDATE queue_entries SET position = $1 WHERE id = $2 AND status = 'waiting'`,
        [i + 1, id]
      )
    )
  );
  invalidateReadCache();
}

async function clearQueue() {
  await query(
    `UPDATE broker_attendance a
     SET status = 'present_only', updated_at = NOW()
     WHERE a.attendance_date = $1::date
       AND a.status = 'waiting'
       AND EXISTS (
         SELECT 1
         FROM queue_entries q
         WHERE q.broker_id = a.broker_id
           AND q.status = 'waiting'
           AND q.external_shift IS NULL
       )`,
    [localDateKey()]
  );
  await query(`DELETE FROM queue_entries WHERE status = 'waiting' AND external_shift IS NULL`);
  invalidateReadCache();
}

async function ensureAfternoonQueueReset(now = new Date()) {
  if (minutesOfDay(now) < AFTERNOON_QUEUE_RESET_MINUTE) return false;
  const dateKey = localDateKey(now);
  const settings = await getSettings();
  const resets = settings.afternoon_queue_resets || {};
  if (resets[dateKey]) return false;

  await query(
    `UPDATE broker_attendance a
     SET status = 'present_only', updated_at = NOW()
     WHERE a.attendance_date = $1::date
       AND a.status = 'waiting'
       AND EXISTS (
         SELECT 1
         FROM queue_entries q
         WHERE q.broker_id = a.broker_id
           AND q.status = 'waiting'
           AND q.external_shift IS NULL
       )`,
    [dateKey]
  );
  await query(`DELETE FROM queue_entries WHERE status = 'waiting' AND external_shift IS NULL`);
  resets[dateKey] = now.toISOString();
  await setSetting('afternoon_queue_resets', resets);
  invalidateReadCache();
  return true;
}

async function clearExternalQueue(name) {
  await query(
    `DELETE FROM queue_entries WHERE status = 'waiting' AND external_shift = $1`,
    [name]
  );
  invalidateReadCache();
}

async function clearLeads(scope = 'today') {
  scope = scope === 'all' ? 'all' : 'today';
  const sql = scope === 'all'
    ? `DELETE FROM leads RETURNING id`
    : `DELETE FROM leads WHERE ${sameAppDaySql('sent_at')} RETURNING id`;
  const result = await query(sql);
  invalidateReadCache();
  return { success: true, scope, deleted_count: result.rowCount || 0 };
}

async function clearAttendance() {
  await query(`DELETE FROM broker_attendance WHERE attendance_date = $1::date`, [localDateKey()]);
  await query(`DELETE FROM queue_entries WHERE status = 'waiting'`);
  invalidateReadCache();
}

async function removeFromQueue(entry_id) {
  const { rows } = await query(
    `SELECT broker_id, external_shift FROM queue_entries WHERE id = $1`,
    [entry_id]
  );
  const entry = rows[0];

  await query(`DELETE FROM queue_entries WHERE id = $1`, [entry_id]);
  if (entry?.broker_id && !entry.external_shift) {
    await query(
      `UPDATE broker_attendance
       SET status = 'present_only', updated_at = NOW()
       WHERE broker_id = $1 AND attendance_date = $2::date`,
      [entry.broker_id, localDateKey()]
    );
  }
  if (entry) await reorderShift(entry.external_shift);
  invalidateReadCache();
}

async function moveToEnd(entry_id) {
  const { rows } = await query(
    `SELECT external_shift FROM queue_entries WHERE id = $1`,
    [entry_id]
  );
  const entry = rows[0];
  const shift = entry?.external_shift ?? null;

  await query(
    `UPDATE queue_entries SET entered_at = NOW() WHERE id = $1`,
    [entry_id]
  );
  await reorderShift(shift);
  invalidateReadCache();
}

async function registerBrokerPresence(broker_id, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  await ensureAfternoonQueueReset(now);
  const enteredAt = options.entered_at || now.toISOString();
  const attendance = await ensureAttendanceRow(broker_id, now);
  const currentEntry = await getWaitingEntryByBroker(broker_id);
  const requestedShift = options.external_shift || null;

  if (attendance?.status === 'gone') {
    return { error: 'Corretor foi marcado como "não volto" hoje.' };
  }

  const presenceMode = options.presence_mode || classifyAttendanceWindow(now);
  let queueEntry = currentEntry;
  let queueRule = null;
  const isLunchReturnViaQr = attendance?.status === 'lunch';
  const shouldJoinRequestedShift = Boolean(requestedShift);
  const shouldJoinMainQueue = !requestedShift && shouldAutoJoinMainQueue(now);

  if (currentEntry) {
    const currentShift = currentEntry.external_shift || null;
    if (currentShift !== requestedShift) {
      const currentLabel = currentShift || 'Souza Naves';
      return { error: `Corretor já está alocado em "${currentLabel}".` };
    }
  }

  if (!currentEntry && (shouldJoinRequestedShift || shouldJoinMainQueue)) {
    queueRule = requestedShift ? 'external_shift' : (presenceMode === 'presence_only' ? 'regular' : presenceMode);
    const added = await addToQueue(broker_id, enteredAt, requestedShift, {
      admin_override: true,
      queue_rule: queueRule,
    });
    if (added?.error) return added;
    queueEntry = added;
  }

  const nextStatus = queueEntry ? 'waiting' : 'present_only';
  const updatedAttendance = await updateAttendanceState(broker_id, {
    last_seen_at: now.toISOString(),
    status: nextStatus,
    presence_mode: presenceMode,
    last_reason: options.reason || null,
    return_at: options.is_return ? now.toISOString() : null,
    lunch_returned_at: (options.is_lunch_return || isLunchReturnViaQr) ? now.toISOString() : null,
    checkout_at: nextStatus === 'present_only' ? attendance.checkout_at : null,
    shift_doubled: options.shift_doubled === undefined ? (isLunchReturnViaQr ? true : attendance.shift_doubled) : Boolean(options.shift_doubled),
    assigned_shift: requestedShift,
  });

  invalidateReadCache();

  return {
    broker_id,
    queue_entry: queueEntry,
    assigned_shift: requestedShift,
    assigned_shift_label: requestedShift || 'Souza Naves',
    queue_rule: queueEntry?.queue_rule || queueRule || presenceMode,
    attendance: updatedAttendance,
    action: nextStatus === 'waiting' ? 'entered_queue' : 'presence_recorded',
  };
}

async function checkoutBrokerAttendance(broker_id, reason) {
  const mappedReason = ATTENDANCE_EXIT_REASONS[reason];
  if (!mappedReason) return { error: 'Motivo inválido.' };

  const attendance = await ensureAttendanceRow(broker_id);
  const currentEntry = await getWaitingEntryByBroker(broker_id);
  if (currentEntry) await removeFromQueue(currentEntry.id);

  const now = new Date().toISOString();
  const patch = {
    last_seen_at: now,
    checkout_at: now,
    last_reason: reason,
    presence_mode: mappedReason === 'gone' ? 'finished' : attendance.presence_mode,
  };

  if (mappedReason === 'service') patch.status = 'service';
  if (mappedReason === 'gone') patch.status = 'gone';
  if (mappedReason === 'lunch') {
    patch.status = 'lunch';
    patch.lunch_started_at = now;
  }

  const updatedAttendance = await updateAttendanceState(broker_id, patch);
  invalidateReadCache();
  return { success: true, attendance: updatedAttendance };
}

async function returnBrokerAttendance(broker_id, reason) {
  const attendance = await ensureAttendanceRow(broker_id);
  const currentEntry = await getWaitingEntryByBroker(broker_id);
  if (currentEntry) {
    return { success: true, attendance, queue_entry: currentEntry, queue_rule: currentEntry.queue_rule, action: 'already_waiting' };
  }

  if (reason === 'atendimento') {
    return registerBrokerPresence(broker_id, {
      is_return: true,
      reason,
      presence_mode: 'lottery_window',
      entered_at: new Date().toISOString(),
      external_shift: attendance?.assigned_shift || null,
    });
  }

  if (reason === 'almoco_retorno') {
    return { error: 'Após o almoço, leia o QR Code novamente para voltar à fila.' };
  }

  return { error: 'Motivo inválido.' };
}

// ─── Leads ───

async function assignLead({ client_name, phone, source, notes, entry_id } = {}) {
  let next;
  if (entry_id) {
    const { rows } = await query(
      `SELECT q.*, b.name AS broker_name, b.phone AS broker_phone
       FROM queue_entries q
       INNER JOIN brokers b ON b.id = q.broker_id
       WHERE q.id = $1 AND q.status = 'waiting'`,
      [entry_id]
    );
    next = rows[0];
    if (next) {
      next.brokers = { name: next.broker_name, phone: next.broker_phone };
    }
  } else {
    const { rows } = await query(
      `SELECT q.*, b.name AS broker_name, b.phone AS broker_phone
       FROM queue_entries q
       INNER JOIN brokers b ON b.id = q.broker_id
       WHERE q.status = 'waiting' AND q.external_shift IS NULL
       ORDER BY q.position ASC
       LIMIT 1`
    );
    next = rows[0];
    if (next) {
      next.brokers = { name: next.broker_name, phone: next.broker_phone };
    }
  }

  if (!next) return { error: entry_id ? 'Corretor não encontrado na fila' : 'Fila vazia' };

  const lead_id = randomUUID();
  await query(
    `INSERT INTO leads (id, broker_id, queue_entry_id, client_name, phone, source, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      lead_id,
      next.broker_id,
      next.id,
      client_name || null,
      phone || null,
      source || null,
      notes || null,
    ]
  );

  await moveToEnd(next.id);
  invalidateReadCache();

  const { rows: leadRows } = await query(`SELECT * FROM leads WHERE id = $1`, [lead_id]);
  const lead = leadRows[0];
  return {
    lead,
    broker: { id: next.broker_id, name: next.brokers?.name, phone: next.brokers?.phone },
  };
}

function leadSentDay(sent_at) {
  if (!sent_at) return '';
  const d = sent_at instanceof Date ? sent_at : new Date(sent_at);
  if (!Number.isNaN(d.getTime())) return timeZoneDateKey(d);
  return String(sent_at).split('T')[0];
}

async function getLeads(limit = 100) {
  return cachedRead(`leads:${limit}`, async () => {
    const { rows: leads } = await query(
      `SELECT l.*, b.name AS broker_name
       FROM leads l
       LEFT JOIN brokers b ON b.id = l.broker_id
       ORDER BY l.sent_at DESC
       LIMIT $1`,
      [limit]
    );

    if (!leads?.length) return [];

    const dayMap = {};
    leads.forEach(l => {
      const day = leadSentDay(l.sent_at);
      const key = `${l.broker_id}:${day}`;
      dayMap[key] = (dayMap[key] || 0) + 1;
    });

    return leads.map(l => {
      const day = leadSentDay(l.sent_at);
      return {
        ...l,
        broker_name: l.broker_name,
        leads_no_dia: dayMap[`${l.broker_id}:${day}`] || 1,
      };
    });
  });
}

async function updateLeadStatus(lead_id, status) {
  await query(`UPDATE leads SET status = $1 WHERE id = $2`, [status, lead_id]);
  invalidateReadCache();
  const { rows } = await query(
    `SELECT l.*, b.name AS broker_name
     FROM leads l
     LEFT JOIN brokers b ON b.id = l.broker_id
     WHERE l.id = $1`,
    [lead_id]
  );
  const data = rows[0];
  return { ...data, broker_name: data?.broker_name };
}

// ─── Stats ───

async function getStats() {
  return cachedRead('stats', async () => {
    const wa = weekAgo();
    const todayClause = sameAppDaySql('sent_at');

    const { rows: brokers } = await query(
      `SELECT id, name FROM brokers WHERE active = true`
    );

    if (!brokers?.length) {
      return { hoje: [], semana: [], total_hoje: 0, total_semana: 0, total_geral: 0, ultimos: [] };
    }

    const ids = brokers.map(b => b.id);

    const [
      { rows: leadsToday },
      { rows: leadsWeek },
      { rows: totalHojeRow },
      { rows: totalSemanaRow },
      { rows: totalGeralRow },
      { rows: ultimos },
    ] = await Promise.all([
      query(
        `SELECT broker_id FROM leads WHERE broker_id = ANY($1::text[]) AND ${todayClause}`,
        [ids]
      ),
      query(
        `SELECT broker_id FROM leads WHERE broker_id = ANY($1::text[]) AND sent_at >= $2::timestamptz`,
        [ids, wa]
      ),
      query(`SELECT COUNT(*)::int AS c FROM leads WHERE ${todayClause}`),
      query(`SELECT COUNT(*)::int AS c FROM leads WHERE sent_at >= $1::timestamptz`, [wa]),
      query(`SELECT COUNT(*)::int AS c FROM leads`),
      query(
        `SELECT l.*, b.name AS broker_name
         FROM leads l
         LEFT JOIN brokers b ON b.id = l.broker_id
         ORDER BY l.sent_at DESC
         LIMIT 5`
      ),
    ]);

    const total_hoje = totalHojeRow[0]?.c || 0;
    const total_semana = totalSemanaRow[0]?.c || 0;
    const total_geral = totalGeralRow[0]?.c || 0;

    const todayMap = {};
    const weekMap = {};
    leadsToday?.forEach(l => { todayMap[l.broker_id] = (todayMap[l.broker_id] || 0) + 1; });
    leadsWeek?.forEach(l => { weekMap[l.broker_id] = (weekMap[l.broker_id] || 0) + 1; });

    const hoje = brokers.map(b => ({ name: b.name, leads: todayMap[b.id] || 0 })).sort((a, b) => b.leads - a.leads);
    const semana = brokers.map(b => ({ name: b.name, leads: weekMap[b.id] || 0 })).sort((a, b) => b.leads - a.leads);

    return { hoje, semana, total_hoje, total_semana, total_geral, ultimos: (ultimos || []).map(l => ({ ...l, broker_name: l.broker_name })) };
  });
}

// ─── Drops ───

async function addDrop() {
  await query(`INSERT INTO drops (id) VALUES ($1)`, [randomUUID()]);
  invalidateReadCache();
  return getDropsHoje();
}

async function removeDrop() {
  const { rows } = await query(
    `SELECT id FROM drops
     WHERE ${sameAppDaySql('created_at')}
     ORDER BY created_at DESC
     LIMIT 1`
  );
  const last = rows[0];
  if (last) await query(`DELETE FROM drops WHERE id = $1`, [last.id]);
  invalidateReadCache();
  return getDropsHoje();
}

async function getDropsHoje() {
  return cachedRead('drops_hoje', async () => {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS c FROM drops
       WHERE ${sameAppDaySql('created_at')}`
    );
    return rows[0]?.c || 0;
  });
}

// ─── Settings (stored as inactive external_shift with sentinel id) ───

const SETTINGS_ID = '00000000-0000-0000-0000-000000000000';

async function getSettings() {
  return cachedRead('settings', async () => {
    const { rows } = await query(
      `SELECT color FROM external_shifts WHERE id = $1`,
      [SETTINGS_ID]
    );
    try {
      return JSON.parse(rows[0]?.color || '{}');
    } catch {
      return {};
    }
  });
}

async function setSetting(key, value) {
  const current = await getSettings();
  current[key] = value;
  const json = JSON.stringify(current);
  await query(
    `INSERT INTO external_shifts (id, name, color, active)
     VALUES ($1, '__settings__', $2::text, false)
     ON CONFLICT (id) DO UPDATE SET color = EXCLUDED.color, name = EXCLUDED.name, active = false`,
    [SETTINGS_ID, json]
  );
  invalidateReadCache();
}

async function setSettings(obj) {
  const current = await getSettings();
  Object.assign(current, obj);
  const json = JSON.stringify(current);
  try {
    await query(
      `INSERT INTO external_shifts (id, name, color, active)
       VALUES ($1, '__settings__', $2::text, false)
       ON CONFLICT (id) DO UPDATE SET color = EXCLUDED.color, name = EXCLUDED.name, active = false`,
      [SETTINGS_ID, json]
    );
  } catch (e) {
    throw new Error('setSettings: ' + e.message);
  }
  invalidateReadCache();
  return getSettings();
}

module.exports = {
  getExternalShifts, createExternalShift, updateExternalShift, deleteExternalShift,
  getBrokers, createBroker, updateBroker, deleteBroker,
  getQueue, getExternalQueues, addToQueue, removeFromQueue, moveToEnd, setQueueOrder, clearQueue, clearExternalQueue,
  getAttendanceToday, getAttendanceInsights, getAttendanceByBrokerForDate, registerBrokerPresence, checkoutBrokerAttendance, returnBrokerAttendance, clearAttendance,
  assignLead, getLeads, updateLeadStatus, clearLeads, getStats,
  addDrop, removeDrop, getDropsHoje,
  getSettings, setSetting, setSettings,
};
