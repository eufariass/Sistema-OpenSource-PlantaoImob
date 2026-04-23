require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/mobile', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'mobile.html')));
app.get('/tv', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));

// ─────────── WebSocket Broadcast (fire-and-forget) ───────────

function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

function broadcastQueueUpdate(extra = {}) {
  Promise.all([
    db.getQueue(),
    db.getExternalQueues(),
    db.getExternalShifts(),
    db.getStats(),
    db.getSettings(),
    db.getBrokers(),
    db.getDropsHoje(),
    db.getAttendanceToday(),
  ])
    .then(([queue, external_queues, external_shifts, stats, settings, brokers, drops_hoje, attendance]) => {
      broadcast({ type: 'queue_update', queue, external_queues, external_shifts, stats, settings, brokers, drops_hoje, attendance, ...extra });
    })
    .catch(err => console.error('broadcast error:', err.message));
}

wss.on('connection', async ws => {
  try {
    const [queue, external_queues, external_shifts, stats, settings, brokers, drops_hoje, attendance] = await Promise.all([
      db.getQueue(),
      db.getExternalQueues(),
      db.getExternalShifts(),
      db.getStats(),
      db.getSettings(),
      db.getBrokers(),
      db.getDropsHoje(),
      db.getAttendanceToday(),
    ]);
    ws.send(JSON.stringify({ type: 'queue_update', queue, external_queues, external_shifts, stats, settings, brokers, drops_hoje, attendance }));
  } catch (err) {
    console.error('ws connection error:', err.message);
  }
});

// ─────────── Settings ───────────

app.get('/api/realtime-config', async (_req, res) => {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  res.json({
    enabled: Boolean(url && key),
    url: url || null,
    key: key || null,
  });
});

app.get('/api/settings', async (req, res) => {
  try { res.json(await db.getSettings()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings', async (req, res) => {
  try {
    const saved = await db.setSettings(req.body || {});
    broadcast({ type: 'settings_update', settings: saved });
    res.json({ success: true, settings: saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/plantonistas', async (req, res) => {
  try {
    const { plantonistas } = req.body;
    const saved = await db.setSettings({ plantonistas: plantonistas || [] });
    broadcast({ type: 'settings_update', settings: saved });
    res.json({ success: true, plantonistas: saved.plantonistas || [] });
  } catch (e) {
    console.error('PUT /api/plantonistas error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────── External Shifts ───────────

app.get('/api/external-shifts', async (req, res) => {
  try { res.json(await db.getExternalShifts()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/external-shifts', async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const shift = await db.createExternalShift({ name, color });
    broadcastQueueUpdate();
    res.json(shift);
  } catch {
    res.status(400).json({ error: 'Já existe um plantão com esse nome' });
  }
});

app.put('/api/external-shifts/:id', async (req, res) => {
  try {
    const shift = await db.updateExternalShift(req.params.id, req.body);
    broadcastQueueUpdate();
    res.json(shift);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/external-shifts/:id', async (req, res) => {
  try {
    await db.deleteExternalShift(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────── Brokers ───────────

app.get('/api/brokers', async (req, res) => {
  try {
    const data = await db.getBrokers();
    res.json(data);
  } catch (err) {
    console.error('GET /api/brokers error:', err.message);
    res.status(500).json({ error: 'Falha ao buscar corretores' });
  }
});

app.post('/api/brokers', async (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const broker = await db.createBroker({ name, phone });
    broadcastQueueUpdate();
    res.json(broker);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/brokers/:id', async (req, res) => {
  try {
    const broker = await db.updateBroker(req.params.id, req.body);
    broadcastQueueUpdate();
    res.json(broker);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/brokers/:id', async (req, res) => {
  try {
    await db.deleteBroker(req.params.id);
    broadcastQueueUpdate();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────── Attendance ───────────

app.get('/api/attendance', async (_req, res) => {
  try {
    res.json(await db.getAttendanceToday());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/attendance/insights', async (req, res) => {
  try {
    res.json(await db.getAttendanceInsights(req.query.month));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/attendance/:brokerId', async (req, res) => {
  try {
    const attendance = await db.getAttendanceByBrokerForDate(req.params.brokerId);
    res.json(attendance || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/attendance', async (req, res) => {
  try {
    await db.clearAttendance();
    broadcastQueueUpdate();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attendance/check-in', async (req, res) => {
  const { broker_id, entered_at, external_shift } = req.body || {};
  if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório' });
  try {
    const result = await db.registerBrokerPresence(broker_id, { entered_at, external_shift: external_shift || null });
    if (result.error) return res.status(400).json(result);
    broadcastQueueUpdate();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/attendance/checkout', async (req, res) => {
  const { broker_id, reason } = req.body || {};
  if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório' });
  try {
    const result = await db.checkoutBrokerAttendance(broker_id, reason);
    if (result.error) return res.status(400).json(result);
    broadcastQueueUpdate();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/attendance/return', async (req, res) => {
  const { broker_id, reason } = req.body || {};
  if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório' });
  try {
    const result = await db.returnBrokerAttendance(broker_id, reason);
    if (result.error) return res.status(400).json(result);
    broadcastQueueUpdate();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────── Queue ───────────

app.get('/api/queue', async (req, res) => {
  try { res.json(await db.getQueue()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/queue/external', async (req, res) => {
  try { res.json(await db.getExternalQueues()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/queue', async (req, res) => {
  const { broker_id, entered_at, external_shift, admin_override } = req.body;
  if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório' });
  try {
    const result = await db.addToQueue(
      broker_id,
      entered_at || null,
      external_shift || null,
      { admin_override: Boolean(admin_override) }
    );
    if (result.error) return res.status(400).json(result);
    broadcastQueueUpdate();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/queue/reorder', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids deve ser array' });
  try {
    await db.setQueueOrder(ids);
    broadcastQueueUpdate();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/queue/external/:name', async (req, res) => {
  try {
    await db.clearExternalQueue(decodeURIComponent(req.params.name));
    broadcastQueueUpdate();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/queue/:id', async (req, res) => {
  try {
    await db.removeFromQueue(req.params.id);
    broadcastQueueUpdate();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/queue', async (req, res) => {
  try {
    await db.clearQueue();
    broadcastQueueUpdate();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/queue/:id/move-to-end', async (req, res) => {
  try {
    await db.moveToEnd(req.params.id);
    broadcastQueueUpdate();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────── Leads ───────────

app.get('/api/leads', async (req, res) => {
  try { res.json(await db.getLeads()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leads', async (req, res) => {
  try {
    const result = await db.assignLead(req.body);
    if (result.error) return res.status(400).json(result);
    broadcastQueueUpdate({ type: 'lead_assigned', lead: result.lead, broker: result.broker });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leads/specific/:entry_id', async (req, res) => {
  try {
    const result = await db.assignLead({ entry_id: req.params.entry_id });
    if (result.error) return res.status(400).json(result);
    broadcastQueueUpdate({ type: 'lead_assigned', lead: result.lead, broker: result.broker });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/leads', async (req, res) => {
  try {
    const result = await db.clearLeads(req.query.scope);
    broadcastQueueUpdate();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/leads/:id/status', async (req, res) => {
  try {
    const lead = await db.updateLeadStatus(req.params.id, req.body.status);
    broadcastQueueUpdate();
    res.json(lead);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────── Drops ───────────

app.post('/api/drops', async (req, res) => {
  try {
    const count = await db.addDrop();
    broadcast({ type: 'drops_update', drops_hoje: count });
    res.json({ drops_hoje: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/drops/last', async (req, res) => {
  try {
    const count = await db.removeDrop();
    broadcast({ type: 'drops_update', drops_hoje: count });
    res.json({ drops_hoje: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/drops', async (req, res) => {
  try { res.json({ drops_hoje: await db.getDropsHoje() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────── Stats ───────────

app.get('/api/stats', async (req, res) => {
  try { res.json(await db.getStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────── Health ───────────

app.get('/api/health', async (req, res) => {
  try {
    const brokers = await db.getBrokers();
    const settings = await db.getSettings();
    res.json({
      status: 'ok',
      database: brokers !== null ? 'connected' : 'error',
      brokers_count: Array.isArray(brokers) ? brokers.length : 0,
      settings_keys: Object.keys(settings),
      env_check: {
        database_url: !!process.env.DATABASE_URL,
      },
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────── Start ───────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🏢 Sistema de Plantão - Geum Imobiliária`);
  console.log(`\n  Admin:  http://localhost:${PORT}`);
  console.log(`  TV:     http://localhost:${PORT}/tv.html\n`);
});
