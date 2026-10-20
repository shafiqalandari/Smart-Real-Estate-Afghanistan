import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { pgPool } from '../central/database.js';

const TICKET_TTL_MS = 60_000;
const REALTIME_EVENTS = ['message:new','message:seen','typing:start','typing:stop','presence:online','presence:offline','conversation:update'];
const tickets = new Map();
const adminSockets = new Set();
const customerSockets = new Map();
const adminStreams = new Set();
const customerStreams = new Map();
let attached = false;

function cleanupTickets() {
  const now = Date.now();
  for (const [token, record] of tickets.entries()) {
    if (!record || record.expiresAt <= now) tickets.delete(token);
  }
}

export function createRealtimeTicket({ role, installationId = null, adminEmail = '' }) {
  cleanupTickets();
  const token = randomBytes(32).toString('base64url');
  tickets.set(token, {
    role: role === 'admin' ? 'admin' : 'customer',
    installationId: installationId ? String(installationId) : null,
    adminEmail: String(adminEmail || ''),
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return { ticket: token, expiresInSeconds: Math.floor(TICKET_TTL_MS / 1000) };
}

function consumeTicket(token) {
  cleanupTickets();
  const record = tickets.get(String(token || ''));
  if (!record) return null;
  tickets.delete(String(token || ''));
  if (record.expiresAt <= Date.now()) return null;
  return record;
}

function send(ws, event) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(event)); } catch {}
}

function sendStream(res, event) {
  if (!res || res.writableEnded || res.destroyed) return;
  try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
}

function customerSet(installationId) {
  const id = String(installationId || '');
  if (!customerSockets.has(id)) customerSockets.set(id, new Set());
  return customerSockets.get(id);
}

function customerStreamSet(installationId) {
  const id = String(installationId || '');
  if (!customerStreams.has(id)) customerStreams.set(id, new Set());
  return customerStreams.get(id);
}

function adminConnectionCount() { return adminSockets.size + adminStreams.size; }
function customerConnectionCount(installationId) {
  const id = String(installationId || '');
  return (customerSockets.get(id)?.size || 0) + (customerStreams.get(id)?.size || 0);
}

export function isCustomerOnline(installationId) {
  return customerConnectionCount(installationId) > 0;
}

export function broadcastConversationEvent(installationId, type, payload = {}, target = 'all') {
  const id = String(installationId || '');
  const event = { type, installationId: id, payload, at: new Date().toISOString() };
  if (target === 'all' || target === 'admin') {
    for (const ws of adminSockets) send(ws, event);
    for (const res of adminStreams) sendStream(res, event);
  }
  if (target === 'all' || target === 'customer') {
    for (const ws of customerSockets.get(id) || []) send(ws, event);
    for (const res of customerStreams.get(id) || []) sendStream(res, event);
  }
}

function broadcastAdminPresence(online) {
  const event = { type: online ? 'presence:online' : 'presence:offline', scope: 'provider', at: new Date().toISOString() };
  for (const sockets of customerSockets.values()) for (const ws of sockets) send(ws, event);
  for (const streams of customerStreams.values()) for (const res of streams) sendStream(res, event);
}

async function touchInstallation(installationId) {
  if (!installationId) return;
  try { await pgPool().query('UPDATE installations SET last_seen_at = NOW() WHERE id = $1', [installationId]); } catch (error) { console.error('realtime touch installation', error); }
}

async function markSeen(identity, installationId) {
  const id = String(identity.role === 'customer' ? identity.installationId : installationId || '');
  if (!id) return;
  const sender = identity.role === 'customer' ? 'provider' : 'customer';
  try {
    await pgPool().query(
      `UPDATE provider_messages
       SET is_read = TRUE, seen_at = COALESCE(seen_at, NOW())
       WHERE installation_id = $1 AND sender = $2 AND COALESCE(is_read, FALSE) = FALSE`,
      [id, sender],
    );
    broadcastConversationEvent(id, 'message:seen', { seenBy: identity.role, seenAt: new Date().toISOString() }, 'all');
  } catch (error) {
    if (String(error?.code || '') !== '42703') console.error('realtime mark seen', error);
  }
}

function allowedInstallation(identity, requested) {
  if (identity.role === 'admin') return String(requested || '');
  return String(identity.installationId || '');
}

export function dispatchRealtimeEvent(identity, event) {
  const type = String(event?.type || '');
  if (!['typing:start', 'typing:stop', 'message:seen'].includes(type)) return;
  const installationId = allowedInstallation(identity, event?.installationId);
  if (!installationId) return;
  if (type === 'message:seen') {
    void markSeen(identity, installationId);
    return;
  }
  const target = identity.role === 'admin' ? 'customer' : 'admin';
  broadcastConversationEvent(installationId, type, { actor: identity.role }, target);
}

function handleClientEvent(identity, raw) {
  let event;
  try { event = JSON.parse(String(raw || '')); } catch { return; }
  dispatchRealtimeEvent(identity, event);
}

export function handleRealtimeSse(req, res) {
  const identity = consumeTicket(req.query?.ticket);
  if (!identity) {
    res.status(401).json({ error: 'Invalid or expired realtime ticket' });
    return;
  }
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const ready = { type: 'realtime:ready', role: identity.role, installationId: identity.installationId || undefined, transport: 'sse', at: new Date().toISOString() };
  const heartbeat = setInterval(() => { if (!res.writableEnded && !res.destroyed) { try { res.write(': keepalive\n\n'); } catch {} } }, 25_000);
  heartbeat.unref?.();

  if (identity.role === 'admin') {
    const wasOffline = adminConnectionCount() === 0;
    adminStreams.add(res);
    sendStream(res, ready);
    if (wasOffline) broadcastAdminPresence(true);
    const ids = new Set([...customerSockets.keys(), ...customerStreams.keys()]);
    for (const installationId of ids) if (customerConnectionCount(installationId) > 0) sendStream(res, { type: 'presence:online', installationId, scope: 'customer', at: new Date().toISOString() });
  } else {
    const wasOffline = customerConnectionCount(identity.installationId) === 0;
    customerStreamSet(identity.installationId).add(res);
    void touchInstallation(identity.installationId);
    sendStream(res, ready);
    if (wasOffline) broadcastConversationEvent(identity.installationId, 'presence:online', { scope: 'customer' }, 'admin');
    if (adminConnectionCount() > 0) sendStream(res, { type: 'presence:online', scope: 'provider', at: new Date().toISOString() });
  }

  req.on('close', () => {
    clearInterval(heartbeat);
    if (identity.role === 'admin') {
      adminStreams.delete(res);
      if (adminConnectionCount() === 0) broadcastAdminPresence(false);
    } else {
      const set = customerStreams.get(String(identity.installationId));
      if (set) {
        set.delete(res);
        if (!set.size) customerStreams.delete(String(identity.installationId));
      }
      if (customerConnectionCount(identity.installationId) === 0) {
        void touchInstallation(identity.installationId);
        broadcastConversationEvent(identity.installationId, 'presence:offline', { scope: 'customer', lastSeenAt: new Date().toISOString() }, 'admin');
      }
    }
  });
}

export function attachRealtimeChat(server) {
  if (attached) return null;
  attached = true;
  const wss = new WebSocketServer({ server, path: '/api/realtime' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/api/realtime', 'http://localhost');
    const identity = consumeTicket(url.searchParams.get('ticket'));
    if (!identity) {
      ws.close(4401, 'Invalid or expired realtime ticket');
      return;
    }
    ws.__smartOfficeIdentity = identity;

    if (identity.role === 'admin') {
      const wasOffline = adminConnectionCount() === 0;
      adminSockets.add(ws);
      send(ws, { type: 'realtime:ready', role: 'admin', at: new Date().toISOString() });
      if (wasOffline) broadcastAdminPresence(true);
      for (const [installationId, sockets] of customerSockets.entries()) {
        if (sockets.size) send(ws, { type: 'presence:online', installationId, scope: 'customer', at: new Date().toISOString() });
      }
    } else {
      const set = customerSet(identity.installationId);
      const wasOffline = customerConnectionCount(identity.installationId) === 0;
      set.add(ws);
      void touchInstallation(identity.installationId);
      send(ws, { type: 'realtime:ready', role: 'customer', installationId: identity.installationId, at: new Date().toISOString() });
      if (wasOffline) broadcastConversationEvent(identity.installationId, 'presence:online', { scope: 'customer' }, 'admin');
      if (adminConnectionCount()) send(ws, { type: 'presence:online', scope: 'provider', at: new Date().toISOString() });
    }

    ws.on('message', (raw) => handleClientEvent(identity, raw));
    ws.on('pong', () => { ws.__alive = true; });
    ws.on('close', () => {
      if (identity.role === 'admin') {
        adminSockets.delete(ws);
        if (adminConnectionCount() === 0) broadcastAdminPresence(false);
      } else {
        const set = customerSockets.get(String(identity.installationId));
        if (set) {
          set.delete(ws);
          if (!set.size) customerSockets.delete(String(identity.installationId));
          if (customerConnectionCount(identity.installationId) === 0) {
            void touchInstallation(identity.installationId);
            broadcastConversationEvent(identity.installationId, 'presence:offline', { scope: 'customer', lastSeenAt: new Date().toISOString() }, 'admin');
          }
        }
      }
    });
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.__alive === false) { ws.terminate(); continue; }
      ws.__alive = false;
      try { ws.ping(); } catch {}
    }
  }, 30_000);
  interval.unref?.();
  wss.on('close', () => clearInterval(interval));
  return wss;
}
