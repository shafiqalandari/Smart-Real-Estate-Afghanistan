import { createPrivateKey, sign as cryptoSign, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, pgPool } from '../central/database.js';
import { deviceDay, deviceExpiry, deviceMatches, deviceMetrics } from '../central/device-metrics.js';
import { ensureCreditAccount, getCreditSummary, transferCredit, redeemPlanCredit, awardReferralSignup, awardReferralPlanPurchase, finalizePlanPaymentWithCredit } from '../central/credit.js';
import { json, method, bearer } from '../central/http.js';
import { randomToken, hashToken, deviceCode, makeAdminToken, readCookie, verifyAdminToken } from '../central/security.js';
import { installationFromRequest, accessPayload } from '../central/access.js';
import { requireAdmin } from '../central/admin.js';
import { createRealtimeTicket, broadcastConversationEvent, isCustomerOnline, dispatchRealtimeEvent } from '../realtime/chat-hub.js';

function routeFromRequest(req) {
  const q = req.query?.route;
  if (Array.isArray(q)) return q.join('/').replace(/^\/+|\/+$/g, '');
  if (typeof q === 'string' && q.trim()) return q.replace(/^\/+|\/+$/g, '');
  const url = new URL(req.url || '/', 'http://localhost');
  return url.pathname.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
}

function adminCookie(token, maxAge = 43200) {
  return `sp_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function recordAdminAudit(req, session, { action, category = 'GENERAL', entityType = '', entityId = '', summary = '', metadata = {}, severity = 'INFO' } = {}) {
  if (!session?.email || !action) return;
  try {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded || String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || '').trim();
    const { error } = await db().from('admin_audit_logs').insert({
      admin_email: session.email,
      admin_role: session.role || 'SUPER_ADMIN',
      action: String(action).slice(0, 80),
      category: String(category || 'GENERAL').slice(0, 60),
      entity_type: String(entityType || '').slice(0, 80),
      entity_id: entityId ? String(entityId).slice(0, 160) : null,
      summary: String(summary || '').slice(0, 1000),
      severity: String(severity || 'INFO').toUpperCase().slice(0, 20),
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      ip_address: ip ? ip.slice(0, 120) : null,
      user_agent: String(req.headers?.['user-agent'] || '').slice(0, 500),
    });
    if (error && !['42P01','PGRST205'].includes(String(error?.code || ''))) console.error('recordAdminAudit', error);
  } catch (error) {
    console.error('recordAdminAudit', error);
  }
}

async function adminAuditLogs(req, res) {
  const session = requireAdmin(req, res);
  if (!session || !method(req, res, ['GET'])) return;
  try {
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query?.pageSize || 30)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const q = String(req.query?.q || '').trim();
    const category = String(req.query?.category || '').trim();
    const action = String(req.query?.action || '').trim();
    let query = db().from('admin_audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (category && category !== 'ALL') query = query.eq('category', category);
    if (action && action !== 'ALL') query = query.eq('action', action);
    if (q) {
      const safe = q.replace(/[,%()]/g, ' ').trim();
      if (safe) query = query.or(`summary.ilike.%${safe}%,entity_id.ilike.%${safe}%,entity_type.ilike.%${safe}%,admin_email.ilike.%${safe}%,action.ilike.%${safe}%`);
    }
    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    const { data: facets } = await db().from('admin_audit_logs').select('action,category').order('created_at', { ascending: false }).limit(1000);
    const categories = [...new Set((facets || []).map(row => row.category).filter(Boolean))].sort();
    const actions = [...new Set((facets || []).map(row => row.action).filter(Boolean))].sort();
    return json(res, 200, {
      rows: (data || []).map(row => ({
        id: row.id, adminEmail: row.admin_email, adminRole: row.admin_role, action: row.action, category: row.category,
        entityType: row.entity_type, entityId: row.entity_id, summary: row.summary, metadata: row.metadata || {},
        severity: row.severity || 'INFO', ipAddress: row.ip_address || '', userAgent: row.user_agent || '', createdAt: row.created_at,
      })),
      page, pageSize, total: Number(count || 0), categories, actions,
    });
  } catch (error) {
    console.error('adminAuditLogs', error);
    if (['42P01','PGRST205'].includes(String(error?.code || ''))) return json(res, 500, { error: 'Audit Log database is not installed. Check the PostgreSQL admin_audit_logs schema.' });
    return json(res, 500, { error: 'Unable to load admin audit log.' });
  }
}


function vapidConfig() {
  const publicKey = String(process.env.ADMIN_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.ADMIN_PUSH_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.ADMIN_PUSH_VAPID_SUBJECT || 'mailto:info@afghanpower.com').trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

function makeVapidJwt(endpoint, config) {
  const publicBytes = Buffer.from(config.publicKey, 'base64url');
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error('Invalid VAPID public key.');
  const x = publicBytes.subarray(1, 33).toString('base64url');
  const y = publicBytes.subarray(33, 65).toString('base64url');
  const privateKey = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x, y, d: config.privateKey },
    format: 'jwk',
  });
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60),
    sub: config.subject,
  })).toString('base64url');
  const input = `${header}.${payload}`;
  const signature = cryptoSign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${input}.${signature}`;
}

async function sendAdminPushSignal() {
  const config = vapidConfig();
  if (!config) return;
  try {
    const { data, error } = await db().from('admin_push_subscriptions').select('id,endpoint');
    if (error) {
      const code = String(error?.code || '');
      if (['42P01','PGRST205'].includes(code)) return;
      throw error;
    }
    const staleIds = [];
    await Promise.all((data || []).map(async (subscription) => {
      try {
        const token = makeVapidJwt(subscription.endpoint, config);
        const response = await fetch(subscription.endpoint, {
          method: 'POST',
          headers: {
            TTL: '90',
            Urgency: 'high',
            Authorization: `vapid t=${token}, k=${config.publicKey}`,
          },
        });
        if ([404, 410].includes(response.status)) staleIds.push(subscription.id);
      } catch (error) {
        console.error('sendAdminPushSignal subscription', error);
      }
    }));
    if (staleIds.length) await db().from('admin_push_subscriptions').delete().in('id', staleIds);
  } catch (error) {
    console.error('sendAdminPushSignal', error);
  }
}

async function adminPushSubscriptions(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!method(req, res, ['POST', 'DELETE'])) return;
  try {
    const endpoint = String(req.body?.subscription?.endpoint || req.body?.endpoint || '').trim();
    if (!endpoint || !/^https:\/\//i.test(endpoint)) return json(res, 400, { error: 'Valid push subscription endpoint is required.' });
    if (req.method === 'DELETE') {
      const { error } = await db().from('admin_push_subscriptions').delete().eq('endpoint', endpoint);
      if (error) throw error;
      return json(res, 200, { success: true });
    }
    const keys = req.body?.subscription?.keys || {};
    const { error } = await db().from('admin_push_subscriptions').upsert({
      endpoint,
      p256dh: cleanText(keys.p256dh, 500),
      auth: cleanText(keys.auth, 500),
      user_agent: cleanText(req.headers?.['user-agent'], 500),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    return json(res, 200, { success: true, pushConfigured: Boolean(vapidConfig()) });
  } catch (error) {
    console.error('adminPushSubscriptions', error);
    const code = String(error?.code || '');
    if (['42P01','PGRST205'].includes(code)) return json(res, 500, { error: 'Admin push database is not installed. Check the PostgreSQL admin_push_subscriptions schema.' });
    return json(res, 500, { error: 'Unable to save admin push subscription.' });
  }
}



const ADMIN_BACKUP_TABLES = [
  // Parent / lookup tables first. This order is also used during restore.
  'service_customers',
  'subscription_plans',
  'payment_methods',
  'installations',
  'browser_installations',
  'registered_companies',
  'customer_accounts',
  'customer_login_events',
  'company_device_registrations',
  'company_registration_requests',
  'payment_requests',
  'subscriptions',
  'provider_messages',
  'customer_notifications',
  'device_events',
  'access_events',
  'innovations',
  'innovation_feedback',
  'admin_push_subscriptions',
  'admin_audit_logs',
  'company_backup_events',
];

const ADMIN_BACKUP_BUCKETS = ['support-attachments', 'payment-receipts'];
const ADMIN_BACKUP_FORMAT = 'safarpro-admin-backup';
const ADMIN_BACKUP_FORMAT_VERSION = 2;
const ADMIN_BACKUP_SCHEMA_VERSION = 'central-2026-09-30-v3';
const ADMIN_RESTORE_BATCH_SIZE = 250;

function adminBackupTableIsAllowed(table) {
  return ADMIN_BACKUP_TABLES.includes(String(table || '').trim());
}

function adminBackupBucketIsAllowed(bucket) {
  return ADMIN_BACKUP_BUCKETS.includes(String(bucket || '').trim());
}

function adminBackupCounts(tables = {}) {
  return Object.fromEntries(ADMIN_BACKUP_TABLES.map((table) => [table, Array.isArray(tables?.[table]) ? tables[table].length : 0]));
}

function validateAdminBackupMeta(meta = {}) {
  if (!meta || meta.format !== ADMIN_BACKUP_FORMAT) return 'This file is not a Real Estate Office Admin Backup.';
  const version = Number(meta.formatVersion || 0);
  if (!Number.isFinite(version) || version < 1 || version > ADMIN_BACKUP_FORMAT_VERSION) {
    return `Unsupported backup format version: ${meta.formatVersion || 'unknown'}.`;
  }
  return '';
}

async function backupAllRows(table) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db().from(table).select('*').range(from, from + pageSize - 1);
    if (error) {
      const code = String(error?.code || '');
      if (['42P01', 'PGRST205'].includes(code)) return { rows: [], unavailable: true };
      throw error;
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return { rows, unavailable: false };
}

async function listBackupBucketFiles(bucket, prefix = '') {
  const files = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await db().storage.from(bucket).list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      const status = Number(error?.statusCode || error?.status || 0);
      if ([400, 404].includes(status)) return files;
      throw error;
    }
    const rows = data || [];
    for (const item of rows) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      const looksLikeFolder = !item.id && !item.metadata;
      if (looksLikeFolder) {
        files.push(...await listBackupBucketFiles(bucket, path));
      } else {
        const { data: signed, error: signError } = await db().storage.from(bucket).createSignedUrl(path, 60 * 60);
        if (!signError && signed?.signedUrl) {
          files.push({
            bucket,
            path,
            signedUrl: signed.signedUrl,
            size: Number(item.metadata?.size || 0),
            contentType: item.metadata?.mimetype || item.metadata?.contentType || '',
            updatedAt: item.updated_at || item.created_at || null,
          });
        }
      }
    }
    if (rows.length < limit) break;
    offset += limit;
  }
  return files;
}

async function adminBackupExport(req, res) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession) return;
  if (!method(req, res, ['GET'])) return;
  try {
    const includeStorage = String(req.query?.storage || '') === '1';
    const tables = {};
    const unavailableTables = [];
    let recordCount = 0;
    for (const table of ADMIN_BACKUP_TABLES) {
      const result = await backupAllRows(table);
      tables[table] = result.rows;
      recordCount += result.rows.length;
      if (result.unavailable) unavailableTables.push(table);
    }

    let storageFiles = [];
    if (includeStorage) {
      for (const bucket of ADMIN_BACKUP_BUCKETS) {
        storageFiles.push(...await listBackupBucketFiles(bucket));
      }
    }

    await recordAdminAudit(req, adminSession, {
      action: 'BACKUP_CREATED', category: 'BACKUP', entityType: 'backup',
      summary: `Created ${includeStorage ? 'full' : 'database'} backup`,
      metadata: { includesStorage: includeStorage, recordCount, tableCount: Object.keys(tables).length, storageFileCount: storageFiles.length }
    });
    return json(res, 200, {
      meta: {
        format: ADMIN_BACKUP_FORMAT,
        formatVersion: ADMIN_BACKUP_FORMAT_VERSION,
        schemaVersion: ADMIN_BACKUP_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        recordCount,
        tableCount: Object.keys(tables).length,
        expectedTables: [...ADMIN_BACKUP_TABLES],
        tableCounts: adminBackupCounts(tables),
        unavailableTables,
        includesStorage: includeStorage,
        expectedBuckets: [...ADMIN_BACKUP_BUCKETS],
        storageFileCount: storageFiles.length,
      },
      tables,
      storageFiles,
    });
  } catch (error) {
    console.error('adminBackupExport', error);
    return json(res, 500, { error: 'Unable to create backup. Please try again.' });
  }
}


async function clearBackupStorageBucket(bucket) {
  const files = await listBackupBucketFiles(bucket);
  const paths = files.map((item) => item.path).filter(Boolean);
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100);
    if (!batch.length) continue;
    const { error } = await db().storage.from(bucket).remove(batch);
    if (error) {
      const status = Number(error?.statusCode || error?.status || 0);
      if (![400, 404].includes(status)) throw error;
    }
  }
  return paths.length;
}

async function clearAdminBackupTables() {
  const unavailable = [];
  const cleared = [];
  for (const table of [...ADMIN_BACKUP_TABLES].reverse()) {
    // Use a broad not-null filter instead of relying on the primary-key column
    // name. Every SafarPro table has at least one id or created_at value,
    // but the schemas are not identical across migrations.
    let response = await db().from(table).delete().not('id', 'is', null);
    if (response.error && ['42703', 'PGRST204'].includes(String(response.error?.code || ''))) {
      response = await db().from(table).delete().not('created_at', 'is', null);
    }
    if (response.error) {
      const code = String(response.error?.code || '');
      if (['42P01', 'PGRST205'].includes(code)) {
        unavailable.push(table);
        continue;
      }
      throw response.error;
    }
    cleared.push(table);
  }
  return { cleared, unavailable };
}

async function adminBackupRestorePrepare(req, res) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession || !method(req, res, ['POST'])) return;
  try {
    const meta = req.body?.meta || {};
    const validationError = validateAdminBackupMeta(meta);
    if (validationError) return json(res, 400, { error: validationError });
    const mode = String(req.body?.mode || 'merge').toLowerCase() === 'replace' ? 'replace' : 'merge';
    const includeStorage = Boolean(req.body?.includeStorage);
    const tableCounts = req.body?.tableCounts && typeof req.body.tableCounts === 'object' ? req.body.tableCounts : {};
    const unknownTables = Object.keys(tableCounts).filter((table) => !adminBackupTableIsAllowed(table));
    if (unknownTables.length) return json(res, 400, { error: `Backup contains unsupported tables: ${unknownTables.join(', ')}` });

    let cleared = { cleared: [], unavailable: [] };
    let clearedStorageFiles = 0;
    if (mode === 'replace') {
      cleared = await clearAdminBackupTables();
      if (includeStorage) {
        for (const bucket of ADMIN_BACKUP_BUCKETS) clearedStorageFiles += await clearBackupStorageBucket(bucket);
      }
    }

    await recordAdminAudit(req, adminSession, {
      action: 'BACKUP_RESTORE_STARTED', category: 'BACKUP', entityType: 'backup',
      summary: `Started ${mode} restore from admin backup`,
      metadata: { mode, includeStorage, schemaVersion: meta.schemaVersion || null, expectedRecordCount: Number(meta.recordCount || 0), clearedTables: cleared.cleared, unavailableTables: cleared.unavailable, clearedStorageFiles },
      severity: mode === 'replace' ? 'WARNING' : 'INFO',
    });

    return json(res, 200, {
      success: true,
      mode,
      acceptedFormatVersion: ADMIN_BACKUP_FORMAT_VERSION,
      supportedTables: [...ADMIN_BACKUP_TABLES],
      supportedBuckets: [...ADMIN_BACKUP_BUCKETS],
      clearedTables: cleared.cleared,
      unavailableTables: cleared.unavailable,
      clearedStorageFiles,
    });
  } catch (error) {
    console.error('adminBackupRestorePrepare', error);
    return json(res, 500, { error: 'Unable to prepare restore.' });
  }
}

async function adminBackupRestoreTable(req, res) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession || !method(req, res, ['POST'])) return;
  try {
    const table = String(req.body?.table || '').trim();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!adminBackupTableIsAllowed(table)) return json(res, 400, { error: `Unsupported restore table: ${table || 'unknown'}` });
    if (rows.length > ADMIN_RESTORE_BATCH_SIZE) return json(res, 400, { error: `Restore batch is too large. Maximum ${ADMIN_RESTORE_BATCH_SIZE} rows per request.` });
    if (!rows.length) return json(res, 200, { success: true, table, restored: 0 });

    const { error } = await db().from(table).upsert(rows, { ignoreDuplicates: false });
    if (error) {
      const code = String(error?.code || '');
      if (['42P01', 'PGRST205'].includes(code)) return json(res, 409, { error: `Table ${table} does not exist on the destination database. Install the matching PostgreSQL schema first.`, code: 'RESTORE_TABLE_MISSING', table });
      throw error;
    }
    return json(res, 200, { success: true, table, restored: rows.length });
  } catch (error) {
    console.error('adminBackupRestoreTable', error);
    return json(res, 500, { error: `Unable to restore ${String(req.body?.table || 'table')}.`, detail: String(error?.message || '') });
  }
}

function base64ToBuffer(value) {
  const input = String(value || '').trim();
  if (!input) return Buffer.alloc(0);
  return Buffer.from(input, 'base64');
}

async function adminBackupRestoreStorage(req, res) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession || !method(req, res, ['POST'])) return;
  try {
    const bucket = String(req.body?.bucket || '').trim();
    const path = String(req.body?.path || '').replace(/^\/+/, '').trim();
    const dataBase64 = String(req.body?.dataBase64 || '');
    const contentType = cleanText(req.body?.contentType || 'application/octet-stream', 200);
    if (!adminBackupBucketIsAllowed(bucket)) return json(res, 400, { error: `Unsupported storage bucket: ${bucket || 'unknown'}` });
    if (!path || path.includes('..')) return json(res, 400, { error: 'Invalid storage path.' });
    if (!dataBase64) return json(res, 400, { error: 'Backup file data is missing.' });
    const buffer = base64ToBuffer(dataBase64);
    const { error } = await db().storage.from(bucket).upload(path, buffer, { contentType, upsert: true });
    if (error) throw error;
    return json(res, 200, { success: true, bucket, path, bytes: buffer.length });
  } catch (error) {
    console.error('adminBackupRestoreStorage', error);
    return json(res, 500, { error: `Unable to restore storage file ${String(req.body?.path || '')}.`, detail: String(error?.message || '') });
  }
}

async function adminBackupRestoreFinalize(req, res) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession || !method(req, res, ['POST'])) return;
  try {
    const meta = req.body?.meta || {};
    const validationError = validateAdminBackupMeta(meta);
    if (validationError) return json(res, 400, { error: validationError });
    const expectedCounts = req.body?.tableCounts && typeof req.body.tableCounts === 'object' ? req.body.tableCounts : {};
    const mode = String(req.body?.mode || 'merge').toLowerCase() === 'replace' ? 'replace' : 'merge';
    const checks = {};
    const mismatches = [];
    for (const table of ADMIN_BACKUP_TABLES) {
      const expected = Math.max(0, Number(expectedCounts?.[table] || 0));
      const { count, error } = await db().from(table).select('*', { count: 'exact', head: true });
      if (error) {
        if (['42P01', 'PGRST205'].includes(String(error?.code || ''))) {
          checks[table] = { expected, actual: null, unavailable: true };
          if (expected > 0) mismatches.push(table);
          continue;
        }
        throw error;
      }
      const actual = Number(count || 0);
      // Restore activity itself writes to admin_audit_logs, so that table can
      // legitimately contain extra rows even after an otherwise exact Replace restore.
      const ok = mode === 'replace' && table !== 'admin_audit_logs' ? actual === expected : actual >= expected;
      checks[table] = { expected, actual, ok };
      if (!ok) mismatches.push(table);
    }

    await recordAdminAudit(req, adminSession, {
      action: mismatches.length ? 'BACKUP_RESTORE_VERIFY_WARNING' : 'BACKUP_RESTORE_COMPLETED', category: 'BACKUP', entityType: 'backup',
      summary: mismatches.length ? `Restore completed with ${mismatches.length} verification warning(s)` : 'Admin backup restore completed and verified',
      metadata: { mode, schemaVersion: meta.schemaVersion || null, checks, mismatches, restoredStorageFiles: Number(req.body?.restoredStorageFiles || 0), skippedStorageFiles: Number(req.body?.skippedStorageFiles || 0) },
      severity: mismatches.length ? 'WARNING' : 'INFO',
    });

    return json(res, mismatches.length ? 207 : 200, { success: !mismatches.length, verified: !mismatches.length, checks, mismatches });
  } catch (error) {
    console.error('adminBackupRestoreFinalize', error);
    return json(res, 500, { error: 'Restore finished, but verification failed.', detail: String(error?.message || '') });
  }
}

async function logDeviceEvent(installationId, eventType, title, description = '', metadata = {}) {
  try {
    const { error } = await db().from('device_events').insert({
      installation_id: installationId,
      event_type: eventType,
      title,
      description: description || null,
      metadata: metadata || {},
    });
    if (error) console.error('logDeviceEvent', error);
  } catch (error) {
    // Stage 4 migration may not be installed yet; audit logging must not break access.
    console.error('logDeviceEvent unavailable', error);
  }
}


async function accessPayloadWithBlockReason(row, options = {}) {
  const payload = accessPayload(row, options);
  const status = String(payload?.accessStatus || '').toUpperCase();
  if (!status.includes('BLOCKED') || !row?.id) return payload;

  const eventType = status.includes('CUSTOMER_BLOCKED') ? 'CUSTOMER_BLOCKED' : 'BLOCKED';
  try {
    const { data, error } = await db()
      .from('device_events')
      .select('description,created_at')
      .eq('installation_id', row.id)
      .eq('event_type', eventType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const reason = cleanText(data?.description || '', 500);
    if (reason) payload.blockReason = reason;
  } catch (error) {
    // Reason display is helpful metadata only. Never block access checks if
    // an older database does not have device_events available.
    console.error('block reason lookup unavailable', error);
  }
  return payload;
}


async function notifyInstallation(installationId, type, title, message, targetPath = '/', metadata = {}) {
  try {
    if (!installationId) return;
    const { error } = await db().from('customer_notifications').insert({
      installation_id: installationId,
      notification_type: String(type || 'INFO').slice(0, 80),
      title: String(title || 'Real Estate Office').slice(0, 180),
      message: String(message || '').slice(0, 1200),
      target_path: String(targetPath || '/').slice(0, 500),
      metadata: metadata || {},
    });
    if (error) console.error('notifyInstallation', error);
  } catch (error) {
    // Notifications must never break access/payment operations if the migration
    // has not been installed yet.
    console.error('notifyInstallation unavailable', error);
  }
}

async function maybeNotifySubscriptionExpiry(installation) {
  try {
    if (!installation?.subscription_expires_at || installation.status === 'BLOCKED') return;
    const expires = new Date(installation.subscription_expires_at);
    const remaining = expires.getTime() - Date.now();
    if (remaining <= 0 || remaining > 3 * 24 * 60 * 60 * 1000) return;
    const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    const { data } = await db().from('customer_notifications').select('id').eq('installation_id', installation.id).eq('notification_type', 'SUBSCRIPTION_EXPIRING').gte('created_at', since).limit(1);
    if (data?.length) return;
    const hours = Math.max(1, Math.ceil(remaining / 3600000));
    await notifyInstallation(installation.id, 'SUBSCRIPTION_EXPIRING', 'Subscription ending soon', `Your real estate office access expires in about ${hours} hour${hours === 1 ? '' : 's'}.`, '/subscription', { expiresAt: expires.toISOString() });
  } catch (error) {
    console.error('maybeNotifySubscriptionExpiry', error);
  }
}

function mapCustomerNotification(row) {
  return {
    id: row.id,
    type: row.notification_type || 'INFO',
    title: row.title || 'Real Estate Office',
    message: row.message || '',
    targetPath: row.target_path || '/',
    metadata: row.metadata || {},
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  };
}

async function customerNotifications(req, res, markRead = false) {
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
    if (!markRead && req.method === 'GET') {
      const { data, error } = await db().from('customer_notifications')
        .select('*').eq('installation_id', installation.id)
        .order('created_at', { ascending: false }).limit(60);
      if (error) throw error;
      return json(res, 200, { notifications: (data || []).map(mapCustomerNotification) });
    }
    if (markRead && req.method === 'POST') {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean).slice(0, 100) : [];
      let query = db().from('customer_notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('installation_id', installation.id);
      if (ids.length) query = query.in('id', ids);
      const { error } = await query;
      if (error) throw error;
      return json(res, 200, { success: true });
    }
    return json(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('customerNotifications', error);
    const code = String(error?.code || '');
    if (['42P01','42703','PGRST204','PGRST205'].includes(code)) {
      return json(res, 500, { error: 'Notification database is not installed. Check the PostgreSQL customer_notifications schema.' });
    }
    return json(res, 500, { error: 'Unable to load notifications.' });
  }
}

function cleanText(value, max = 2000) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}


const COMPANY_SCHEMA_MISSING_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);

function companySchemaMissing(error) {
  return COMPANY_SCHEMA_MISSING_CODES.has(String(error?.code || ''));
}

function companyBackupSecret() {
  const secret = String(process.env.COMPANY_BACKUP_SECRET || process.env.ADMIN_SESSION_SECRET || '').trim();
  if (!secret) throw new Error('COMPANY_BACKUP_SECRET or ADMIN_SESSION_SECRET is required.');
  return secret;
}

function companyCode() {
  return `CMP-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function normalizeCompanyEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 240);
}

function hashCompanyPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password || ''), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyCompanyPassword(password, salt, expectedHash) {
  try {
    const actual = Buffer.from(scryptSync(String(password || ''), String(salt || ''), 64).toString('hex'), 'hex');
    const expected = Buffer.from(String(expectedHash || ''), 'hex');
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function isGenericCustomerName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || [
    'smart office customer',
    'smart office',
    'customer',
    'smart office management system',
  ].includes(normalized);
}

function resolveCompanyDisplayName(...values) {
  const clean = values.map((value) => String(value || '').trim()).filter(Boolean);
  return clean.find((value) => !isGenericCustomerName(value)) || clean[0] || 'Customer';
}

function companyPublic(row) {
  if (!row) return null;
  return {
    companyId: row.id,
    companyCode: row.company_code,
    companyName: row.company_name,
    ownerName: row.owner_name,
    email: String(row.email || "").endsWith("@safarpro.local") ? "" : row.email,
    phone: row.phone || '',
    country: row.country || '',
    city: row.city || '',
    address: row.address || '',
    status: row.status || 'ACTIVE',
    registeredAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


async function registeredCompanyIdentityMap(installationIds = []) {
  const ids = Array.from(new Set((installationIds || []).filter(Boolean).map(String)));
  if (!ids.length) return new Map();
  try {
    const { data: links, error: linkError } = await db()
      .from('company_device_registrations')
      .select('installation_id,company_id')
      .in('installation_id', ids);
    if (linkError) throw linkError;
    const companyIds = Array.from(new Set((links || []).map((row) => row.company_id).filter(Boolean)));
    if (!companyIds.length) return new Map();
    const { data: companies, error: companyError } = await db()
      .from('registered_companies')
      .select('id,company_code,company_name,owner_name,email,phone,country,city,address,status,created_at,updated_at')
      .in('id', companyIds);
    if (companyError) throw companyError;
    const companyById = new Map((companies || []).map((row) => [String(row.id), row]));
    const result = new Map();
    for (const link of links || []) {
      const company = companyById.get(String(link.company_id));
      if (company) result.set(String(link.installation_id), company);
    }
    return result;
  } catch (error) {
    if (!companySchemaMissing(error)) console.warn('registeredCompanyIdentityMap', error);
    return new Map();
  }
}

function encodeCompanyRecoveryToken(company) {
  const payload = Buffer.from(JSON.stringify({
    companyId: company.id,
    email: company.email,
    exp: Date.now() + 15 * 60 * 1000,
  })).toString('base64url');
  const signature = createHmac('sha256', companyBackupSecret()).update(`company-recovery:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

function decodeCompanyRecoveryToken(token) {
  try {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) return null;
    const expected = createHmac('sha256', companyBackupSecret()).update(`company-recovery:${payload}`).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data?.companyId || Number(data.exp || 0) <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function backupSignature({ companyId, backupId, exportedAt, digest, format }) {
  const body = ['v1', companyId, backupId, exportedAt, digest, format || 'safarpro-backup-v2'].join('|');
  return createHmac('sha256', companyBackupSecret()).update(`company-backup:${body}`).digest('base64url');
}

function backupSignatureMatches(input) {
  const provided = String(input.signature || '');
  if (!provided) return false;
  const expected = backupSignature(input);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function companyForInstallation(installationId) {
  if (!installationId) return null;
  const { data: link, error: linkError } = await db().from('company_device_registrations')
    .select('company_id,registered_at,last_verified_at')
    .eq('installation_id', installationId)
    .maybeSingle();
  if (linkError) throw linkError;
  if (!link?.company_id) return null;
  const { data: company, error } = await db().from('registered_companies').select('*').eq('id', link.company_id).maybeSingle();
  if (error) throw error;
  return company ? { company, link } : null;
}

async function logCompanyBackupEvent({ companyId = null, installationId = null, backupId = null, eventType, metadata = {} }) {
  try {
    await db().from('company_backup_events').insert({
      company_id: companyId,
      installation_id: installationId,
      backup_id: backupId,
      event_type: eventType,
      metadata: metadata || {},
    });
  } catch (error) {
    if (!companySchemaMissing(error)) console.error('logCompanyBackupEvent', error);
  }
}


const FIRST_RUN_LEGACY_PREFIX = '__SMART_OFFICE_FIRST_RUN__:';

function parseFirstRunLegacyDescription(value = '') {
  const text = String(value || '');
  if (!text.startsWith(FIRST_RUN_LEGACY_PREFIX)) return null;
  try { return JSON.parse(text.slice(FIRST_RUN_LEGACY_PREFIX.length)); } catch { return null; }
}

function mapCompanyRegistrationRequest(row, installation = null) {
  if (!row) return null;
  const legacy = parseFirstRunLegacyDescription(row.description) || {};
  return {
    id: row.id,
    installationId: row.installation_id,
    companyName: row.company_name || '',
    firstName: row.first_name || legacy.firstName || '',
    lastName: row.last_name || legacy.lastName || '',
    fullName: [row.first_name, row.last_name].filter(Boolean).join(' '),
    logo: row.logo_data || row.logo || '',
    phone: row.phone || '',
    email: row.email || '',
    country: row.country || '',
    city: row.city || '',
    address: row.address || '',
    jobTitle: row.job_title || legacy.jobTitle || '',
    businessType: row.business_type || legacy.businessType || '',
    employeeCount: row.employee_count ?? legacy.employeeCount ?? null,
    website: row.website || legacy.website || '',
    description: legacy.description ?? row.description ?? '',
    registrationSource: row.registration_source || legacy.registrationSource || '',
    entryMode: String(row.registration_source || legacy.registrationSource || '').toUpperCase() === 'MANUAL' ? 'MANUAL' : 'DYNAMIC',
    status: row.status || 'PENDING',
    submittedAt: row.submitted_at || row.created_at || null,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || '',
    reviewNote: row.review_note || '',
    deviceCode: installation?.device_code || '',
    deviceName: installation?.display_name || installation?.device_name || installation?.device_type || 'Browser / PWA',
    operatingSystem: installation?.operating_system || '',
    installationType: installation?.installation_type || '',
    lastSeenAt: installation?.last_seen_at || null,
  };
}

async function customerCompanyRegistrationRequest(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });

    if (req.method === 'GET') {
      const { data, error } = await db().from('company_registration_requests')
        .select('*')
        .eq('installation_id', installation.id)
        .maybeSingle();
      if (error) throw error;
      return json(res, 200, { request: mapCompanyRegistrationRequest(data, installation) });
    }

    const body = req.body || {};
    const companyName = cleanText(body.companyName, 180);
    const firstName = cleanText(body.firstName, 120);
    const lastName = cleanText(body.lastName, 120);
    const phone = cleanText(body.phone, 80);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 240);
    const country = cleanText(body.country, 120) || '';
    const city = cleanText(body.city, 120) || '';
    const address = cleanText(body.address, 500) || '';
    const jobTitle = cleanText(body.jobTitle, 160) || '';
    const businessType = cleanText(body.businessType, 200) || '';
    const employeeCountRaw = body.employeeCount;
    const employeeCount = employeeCountRaw === null || employeeCountRaw === undefined || employeeCountRaw === '' ? null : Math.max(0, Math.min(1000000, Number.parseInt(employeeCountRaw, 10) || 0));
    const website = cleanText(body.website, 400) || '';
    const description = cleanText(body.description, 4000) || '';
    const registrationSource = cleanText(body.registrationSource, 40) || 'FIRST_RUN';
    const logo = String(body.logo || '');

    if (!companyName || !firstName || !lastName || !phone || !email || !country || !city) {
      return json(res, 400, { error: 'First name, last name, company name, phone, email, country and city are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, { error: 'Enter a valid company email address.' });
    }
    if (logo && !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(logo)) {
      return json(res, 400, { error: 'Upload a valid company logo image.' });
    }
    if (logo.length > 2_200_000) {
      return json(res, 413, { error: 'Company logo must not exceed 1.5 MB.' });
    }

    const now = new Date().toISOString();
    const payload = {
      installation_id: installation.id,
      company_name: companyName,
      first_name: firstName,
      last_name: lastName,
      logo_data: logo || null,
      logo: logo || null,
      phone,
      email,
      country,
      city,
      address,
      job_title: jobTitle,
      business_type: businessType,
      employee_count: employeeCount,
      website,
      description,
      registration_source: registrationSource,
      status: 'PENDING',
      submitted_at: now,
      reviewed_at: null,
      reviewed_by: null,
      review_note: null,
      updated_at: now,
    };
    let { data, error } = await db().from('company_registration_requests')
      .upsert(payload, { onConflict: 'installation_id' })
      .select('*')
      .single();

    // Backward-compatible fallback for servers where Stage 20 has not been applied yet.
    // The extra first-run fields are preserved inside description and decoded for the admin UI.
    if (error && /first_name|last_name|country|city|address|job_title|business_type|employee_count|registration_source|schema cache/i.test(String(error.message || error.details || ''))) {
      const legacyDescription = `${FIRST_RUN_LEGACY_PREFIX}${JSON.stringify({
        firstName, lastName, country, city, address, jobTitle, businessType, employeeCount, website, description, registrationSource,
      })}`;
      const legacyPayload = {
        installation_id: installation.id, company_name: companyName, logo_data: logo || null, logo: logo || null, phone, email, website,
        description: legacyDescription, status: 'PENDING', submitted_at: now, reviewed_at: null, reviewed_by: null, review_note: null, updated_at: now,
      };
      ({ data, error } = await db().from('company_registration_requests')
        .upsert(legacyPayload, { onConflict: 'installation_id' })
        .select('*')
        .single());
    }
    if (error) throw error;

    await db().from('installations').update({
      profile_name: companyName,
      ...(logo ? { profile_logo: logo } : {}),
      last_seen_at: now,
    }).eq('id', installation.id);

    return json(res, 200, { success: true, request: mapCompanyRegistrationRequest(data, installation) });
  } catch (error) {
    console.error('customerCompanyRegistrationRequest', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration request database is not installed. Check the PostgreSQL company directory schema.', code: 'COMPANY_REQUEST_SCHEMA_MISSING' });
    return json(res, 500, { error: 'Unable to save company registration request.' });
  }
}


async function customerRegisteredCompanies(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });

    const { data: rows, error } = await db().from('company_registration_requests')
      .select('id,company_name,logo_data,website,description,reviewed_at,submitted_at')
      .eq('status', 'APPROVED')
      .order('reviewed_at', { ascending: false, nullsFirst: false })
      .order('submitted_at', { ascending: false })
      .limit(1000);
    if (error) throw error;

    const { count: installationCount, error: installationCountError } = await db()
      .from('installations')
      .select('id', { count: 'exact', head: true })
      .is('merged_into_installation_id', null);
    if (installationCountError) throw installationCountError;

    return json(res, 200, {
      count: (rows || []).length,
      stats: {
        totalInstallations: Number(installationCount || 0),
        totalVerified: (rows || []).length,
      },
      companies: (rows || []).map((row) => ({
        id: row.id,
        companyName: row.company_name || '',
        logo: row.logo_data || row.logo || '',
        website: row.website || '',
        description: row.description || '',
        approvedAt: row.reviewed_at || null,
      })),
    });
  } catch (error) {
    console.error('customerRegisteredCompanies', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration request database is not installed. Check the PostgreSQL company directory schema.' });
    return json(res, 500, { error: 'Unable to load registered companies.' });
  }
}

async function adminCompanyRegistrationRequests(req, res, status = '') {
  const session = requireAdmin(req, res);
  if (!session || !method(req, res, ['GET', 'POST'])) return;
  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      const companyName = cleanText(body.companyName, 180);
      const phone = cleanText(body.phone, 80);
      const email = String(body.email || '').trim().toLowerCase().slice(0, 240);
      const website = cleanText(body.website, 400) || '';
      const country = cleanText(body.country, 120) || '';
      const city = cleanText(body.city, 120) || '';
      const description = cleanText(body.description, 4000) || '';
      const logo = String(body.logo || '').trim();
      if (!companyName || !phone || !email) return json(res, 400, { error: 'Company name, phone and email are required.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Enter a valid company email address.' });
      if (logo && !/^https?:\/\//i.test(logo) && !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(logo)) return json(res, 400, { error: 'Logo must be a valid image URL or image data.' });
      if (logo.length > 2_200_000) return json(res, 413, { error: 'Company logo is too large.' });
      const now = new Date().toISOString();
      const payload = {
        installation_id: null,
        company_name: companyName,
        logo_data: logo || null,
        logo: logo || null,
        phone, email, website, country, city, description,
        registration_source: 'MANUAL',
        status: 'APPROVED',
        submitted_at: now,
        reviewed_at: now,
        reviewed_by: session.email || 'admin',
        review_note: 'Added manually by admin',
        created_at: now,
        updated_at: now,
      };
      const { data, error } = await db().from('company_registration_requests').insert(payload).select('*').single();
      if (error) throw error;
      await recordAdminAudit(req, session, {
        action: 'COMPANY_DIRECTORY_MANUAL_ADDED',
        category: 'COMPANY',
        entityType: 'company_registration_request',
        entityId: data.id,
        summary: `Added company manually: ${companyName}`,
        metadata: { email, phone, registrationSource: 'MANUAL' },
      });
      return json(res, 201, { success: true, request: mapCompanyRegistrationRequest(data) });
    }
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize || 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const q = cleanText(req.query?.q, 160);
    let query = db().from('company_registration_requests').select('*', { count: 'exact' }).order('submitted_at', { ascending: false });
    const normalized = String(status || req.query?.status || '').trim().toUpperCase();
    if (normalized && normalized !== 'ALL') query = query.eq('status', normalized);
    if (q) {
      const safe = q.replace(/[,%()]/g, ' ').trim();
      if (safe) query = query.or(`company_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`);
    }
    const { data: rows, error, count } = await query.range(from, to);
    if (error) throw error;
    const installationIds = [...new Set((rows || []).map((row) => row.installation_id).filter(Boolean))];
    const { data: installations, error: installationError } = installationIds.length
      ? await db().from('installations').select('*').in('id', installationIds)
      : { data: [], error: null };
    if (installationError) throw installationError;
    const installationMap = new Map((installations || []).map((row) => [String(row.id), row]));
    return json(res, 200, {
      rows: (rows || []).map((row) => mapCompanyRegistrationRequest(row, installationMap.get(String(row.installation_id)))),
      total: Number(count || 0), page, pageSize,
    });
  } catch (error) {
    console.error('adminCompanyRegistrationRequests', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration request database is not installed. Check the PostgreSQL company directory schema.' });
    return json(res, 500, { error: 'Unable to load company registration requests.' });
  }
}

async function adminDeleteCompanyRegistration(req, res, requestId) {
  const session = requireAdmin(req, res);
  if (!session || !method(req, res, ['DELETE'])) return;
  try {
    const { data: row, error: readError } = await db().from('company_registration_requests').select('*').eq('id', requestId).maybeSingle();
    if (readError) throw readError;
    if (!row || row.status !== 'APPROVED') return json(res, 404, { error: 'Registered company not found.' });
    const { error } = await db().from('company_registration_requests').delete().eq('id', requestId);
    if (error) throw error;
    await recordAdminAudit(req, session, { action: 'COMPANY_DIRECTORY_DELETED', category: 'COMPANY', entityType: 'company_registration_request', entityId: requestId, summary: `Removed registered company ${row.company_name}`, metadata: { installationId: row.installation_id }, severity: 'WARNING' });
    return json(res, 200, { success: true });
  } catch (error) {
    console.error('adminDeleteCompanyRegistration', error);
    return json(res, 500, { error: 'Unable to delete registered company.' });
  }
}

async function adminApproveCompanyRegistration(req, res, requestId) {
  const session = requireAdmin(req, res);
  if (!session || !method(req, res, ['POST'])) return;
  try {
    const { data: current, error: currentError } = await db().from('company_registration_requests')
      .select('*').eq('id', requestId).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return json(res, 404, { error: 'Company registration request not found.' });

    const now = new Date().toISOString();
    const { data: updated, error } = await db().from('company_registration_requests')
      .update({ status: 'APPROVED', review_note: null, reviewed_at: now, reviewed_by: session.email || 'admin', updated_at: now })
      .eq('id', requestId)
      .select('*')
      .single();
    if (error) throw error;

    if (current.installation_id) {
      await db().from('installations').update({
        profile_name: current.company_name,
        profile_logo: current.logo_data,
        last_seen_at: now,
      }).eq('id', current.installation_id);
    }

    try {
      const { data: installation } = current.installation_id
        ? await db().from('installations').select('customer_id').eq('id', current.installation_id).maybeSingle()
        : { data: null };
      if (installation?.customer_id) {
        await db().from('service_customers').update({
          business_name: current.company_name,
          email: current.email,
          phone: current.phone,
        }).eq('id', installation.customer_id);
      }
    } catch (syncError) {
      console.warn('adminApproveCompanyRegistration customer sync', syncError);
    }

    if (current.installation_id) await notifyInstallation(current.installation_id, 'COMPANY_REGISTRATION_APPROVED', 'Company registration approved', 'Your real estate office registration has been approved.', '/my-account');
    await recordAdminAudit(req, session, {
      action: 'COMPANY_REGISTRATION_APPROVED',
      category: 'COMPANY',
      entityType: 'company_registration_request',
      entityId: requestId,
      summary: `Approved company registration: ${current.company_name}`,
      metadata: { installationId: current.installation_id, email: current.email },
    });
    return json(res, 200, { success: true, request: mapCompanyRegistrationRequest(updated) });
  } catch (error) {
    console.error('adminApproveCompanyRegistration', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration request database is not installed. Check the PostgreSQL company directory schema.' });
    return json(res, 500, { error: 'Unable to approve company registration.' });
  }
}

async function adminRejectCompanyRegistration(req, res, requestId) {
  const session = requireAdmin(req, res);
  if (!session || !method(req, res, ['POST'])) return;
  try {
    const note = cleanText(req.body?.note, 2000);
    if (!note) return json(res, 400, { error: 'Explain what the customer needs to correct before rejecting.' });

    const { data: current, error: currentError } = await db().from('company_registration_requests')
      .select('*').eq('id', requestId).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return json(res, 404, { error: 'Company registration request not found.' });

    const now = new Date().toISOString();
    const { data: updated, error } = await db().from('company_registration_requests')
      .update({ status: 'REJECTED', review_note: note, reviewed_at: now, reviewed_by: session.email || 'admin', updated_at: now })
      .eq('id', requestId)
      .select('*')
      .single();
    if (error) throw error;

    if (current.installation_id) await notifyInstallation(
      current.installation_id,
      'COMPANY_REGISTRATION_REJECTED',
      'Company registration needs correction',
      note,
      '/my-account'
    );
    await recordAdminAudit(req, session, {
      action: 'COMPANY_REGISTRATION_REJECTED',
      category: 'COMPANY',
      entityType: 'company_registration_request',
      entityId: requestId,
      summary: `Rejected company registration: ${current.company_name}`,
      metadata: { installationId: current.installation_id, email: current.email, note },
    });
    return json(res, 200, { success: true, request: mapCompanyRegistrationRequest(updated) });
  } catch (error) {
    console.error('adminRejectCompanyRegistration', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration request database is not installed. Check the PostgreSQL company directory schema.' });
    return json(res, 500, { error: 'Unable to reject company registration.' });
  }
}

async function customerCompanyProfile(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
    const linked = await companyForInstallation(installation.id);
    return json(res, 200, { registered: Boolean(linked?.company), company: companyPublic(linked?.company), registeredAt: linked?.link?.registered_at || null });
  } catch (error) {
    console.error('customerCompanyProfile', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration database is not installed. Check the PostgreSQL company registration schema.', code: 'COMPANY_SCHEMA_MISSING' });
    return json(res, 500, { error: 'Unable to load company registration.' });
  }
}


async function customerCompanyProfileSync(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });

    const body = req.body || {};
    const companyName = cleanText(body.companyName, 180);
    const ownerName = cleanText(body.ownerName, 180) || companyName;
    const address = cleanText(body.address, 500);
    const phone = cleanText(body.phone, 80);
    const country = cleanText(body.country, 120);
    const city = cleanText(body.city, 120);
    const emailInput = normalizeCompanyEmail(body.email);
    const password = String(body.password || '');
    const logo = String(body.logo || '');

    if (!companyName || !address || !phone) {
      return json(res, 400, {
        error: 'Company name, address and phone number are required.',
        code: 'COMPANY_PROFILE_INCOMPLETE',
      });
    }
    if (emailInput && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
      return json(res, 400, { error: 'Enter a valid company email address.' });
    }
    // 1.5 MiB image becomes roughly 2 MiB after base64 encoding.
    if (logo.length > 2_200_000) {
      return json(res, 413, { error: 'Company logo must not exceed 1.5 MB.', code: 'COMPANY_LOGO_TOO_LARGE' });
    }

    let linked = await companyForInstallation(installation.id);
    let company = linked?.company || null;

    if (company) {
      const nextEmail = emailInput || company.email;
      if (emailInput && String(company.email || '').toLowerCase() !== emailInput) {
        const { data: emailRows, error: emailError } = await db()
          .from('registered_companies')
          .select('id,email')
          .ilike('email', emailInput)
          .neq('id', company.id)
          .limit(1);
        if (emailError) throw emailError;
        if ((emailRows || []).length) {
          return json(res, 409, { error: 'This email is already used by another company.', code: 'EMAIL_ALREADY_REGISTERED' });
        }
      }
      let passwordUpdate = {};
      if (password) {
        if (password.length < 8 || password.length > 200) {
          return json(res, 400, { error: 'Company password must contain at least 8 characters.' });
        }
        const passwordRecord = hashCompanyPassword(password);
        passwordUpdate = { password_salt: passwordRecord.salt, password_hash: passwordRecord.hash };
      }
      const { data: updated, error: updateError } = await db()
        .from('registered_companies')
        .update({
          company_name: companyName,
          owner_name: ownerName,
          email: nextEmail,
          phone,
          country,
          city,
          address,
          ...passwordUpdate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', company.id)
        .select()
        .single();
      if (updateError) throw updateError;
      company = updated;
    } else {
      if (!emailInput) {
        return json(res, 400, { error: 'Email Address is required to register your company.', code: 'COMPANY_EMAIL_REQUIRED' });
      }
      if (password.length < 8 || password.length > 200) {
        return json(res, 400, { error: 'Company password must contain at least 8 characters.', code: 'COMPANY_PASSWORD_REQUIRED' });
      }
      const internalEmail = emailInput;
      if (emailInput) {
        const { data: emailRows, error: emailError } = await db()
          .from('registered_companies')
          .select('id,email')
          .ilike('email', emailInput)
          .limit(1);
        if (emailError) throw emailError;
        if ((emailRows || []).length) {
          return json(res, 409, { error: 'This email is already used by another company.', code: 'EMAIL_ALREADY_REGISTERED' });
        }
      }
      const passwordRecord = hashCompanyPassword(password);
      const { data: created, error: createError } = await db()
        .from('registered_companies')
        .insert({
          company_code: companyCode(),
          company_name: companyName,
          owner_name: ownerName,
          email: internalEmail,
          phone,
          country,
          city,
          address,
          password_salt: passwordRecord.salt,
          password_hash: passwordRecord.hash,
        })
        .select()
        .single();
      if (createError) throw createError;
      company = created;

      const { error: linkError } = await db().from('company_device_registrations').insert({
        company_id: company.id,
        installation_id: installation.id,
      });
      if (linkError && String(linkError.code || '') !== '23505') throw linkError;
      linked = await companyForInstallation(installation.id);
    }

    if (installation.customer_id) {
      const { error: customerError } = await db()
        .from('service_customers')
        .update({
          business_name: companyName,
          owner_name: ownerName,
          email: emailInput || null,
          phone,
          country: country || null,
          city: city || null,
        })
        .eq('id', installation.customer_id);
      if (customerError) throw customerError;
    }

    const installationUpdate = {
      profile_name: companyName,
      last_seen_at: new Date().toISOString(),
    };
    if (logo) installationUpdate.profile_logo = logo;
    const { error: installationError } = await db()
      .from('installations')
      .update(installationUpdate)
      .eq('id', installation.id);
    if (installationError) throw installationError;

    await db()
      .from('company_device_registrations')
      .update({ last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('installation_id', installation.id);

    await logCompanyBackupEvent({
      companyId: company.id,
      installationId: installation.id,
      eventType: 'COMPANY_PROFILE_SYNCED',
      metadata: { source: 'settings-company-information' },
    });

    return json(res, 200, {
      success: true,
      registered: true,
      company: companyPublic(company),
      profileLogo: logo || '',
    });
  } catch (error) {
    console.error('customerCompanyProfileSync', error);
    if (companySchemaMissing(error)) {
      return json(res, 500, {
        error: 'Company profile database is not installed. Check the PostgreSQL company registration schema.',
        code: 'COMPANY_SCHEMA_MISSING',
      });
    }
    return json(res, 500, { error: 'Unable to sync company information.' });
  }
}

async function customerCompanyRegister(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
    if (!accessPayload(installation).allowed) return json(res, 403, { error: 'Renew access before registering a company.', code: 'ACCESS_EXPIRED' });
    const body = req.body || {};
    const companyName = String(body.companyName || '').trim().slice(0, 180);
    const ownerName = String(body.ownerName || '').trim().slice(0, 180);
    const email = normalizeCompanyEmail(body.email);
    const password = String(body.password || '');
    if (!companyName || !ownerName || !email) return json(res, 400, { error: 'Company name, owner name and email are required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Enter a valid company email address.' });
    if (password.length < 8 || password.length > 200) return json(res, 400, { error: 'Password must contain at least 8 characters.' });

    const existingLink = await companyForInstallation(installation.id);
    if (existingLink?.company) return json(res, 409, { error: 'This device is already registered to a company.', code: 'DEVICE_ALREADY_REGISTERED', company: companyPublic(existingLink.company) });

    const { data: emailRows, error: emailError } = await db().from('registered_companies').select('id,email').ilike('email', email).limit(2);
    if (emailError) throw emailError;
    if ((emailRows || []).some((row) => String(row.email || '').toLowerCase() === email)) {
      return json(res, 409, { error: 'This email is already registered. Use the company login when recovering a backup.', code: 'EMAIL_ALREADY_REGISTERED' });
    }

    const passwordRecord = hashCompanyPassword(password);
    const { data: company, error: companyError } = await db().from('registered_companies').insert({
      company_code: companyCode(),
      company_name: companyName,
      owner_name: ownerName,
      email,
      phone: cleanText(body.phone, 80),
      country: cleanText(body.country, 120),
      city: cleanText(body.city, 120),
      address: cleanText(body.address, 500),
      password_salt: passwordRecord.salt,
      password_hash: passwordRecord.hash,
    }).select().single();
    if (companyError) throw companyError;

    const { error: linkError } = await db().from('company_device_registrations').insert({ company_id: company.id, installation_id: installation.id });
    if (linkError) {
      try { await db().from('registered_companies').delete().eq('id', company.id); } catch { /* best-effort rollback */ }
      throw linkError;
    }
    await logCompanyBackupEvent({ companyId: company.id, installationId: installation.id, eventType: 'COMPANY_REGISTERED' });
    return json(res, 201, { success: true, company: companyPublic(company) });
  } catch (error) {
    console.error('customerCompanyRegister', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration database is not installed. Check the PostgreSQL company registration schema.', code: 'COMPANY_SCHEMA_MISSING' });
    return json(res, 500, { error: 'Unable to register this company.' });
  }
}

async function customerCompanyLogin(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const email = normalizeCompanyEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const linkDevice = Boolean(req.body?.linkDevice);
    if (!email || !password) return json(res, 400, { error: 'Email and password are required.' });
    const { data: rows, error } = await db().from('registered_companies').select('*').ilike('email', email).limit(3);
    if (error) throw error;
    const company = (rows || []).find((row) => String(row.email || '').toLowerCase() === email);
    if (!company || company.status === 'BLOCKED' || !verifyCompanyPassword(password, company.password_salt, company.password_hash)) {
      return json(res, 401, { error: 'Invalid company email or password.' });
    }

    let companyLogo = '';
    try {
      const { data: companyLinks } = await db()
        .from('company_device_registrations')
        .select('installation_id')
        .eq('company_id', company.id)
        .order('registered_at', { ascending: false })
        .limit(12);
      const ids = (companyLinks || []).map((row) => row.installation_id).filter(Boolean);
      if (ids.length) {
        const { data: linkedDevices } = await db().from('installations').select('id,profile_logo').in('id', ids);
        companyLogo = String((linkedDevices || []).find((row) => row.profile_logo)?.profile_logo || '');
      }
    } catch (logoError) {
      console.warn('Unable to load registered company logo', logoError);
    }

    let linkedInstallation = null;
    if (linkDevice) {
      const installation = await installationFromRequest(req);
      if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
      const access = accessPayload(installation);
      if (!access.allowed) return json(res, 403, { error: 'Renew access before connecting this device to a registered company.', code: 'ACCESS_EXPIRED' });

      const existingLink = await companyForInstallation(installation.id);
      if (existingLink?.company && String(existingLink.company.id) !== String(company.id)) {
        return json(res, 409, { error: 'This device is already registered to a different company.', code: 'DEVICE_COMPANY_CONFLICT', company: companyPublic(existingLink.company) });
      }

      if (!existingLink?.company) {
        const { error: linkError } = await db().from('company_device_registrations').insert({ company_id: company.id, installation_id: installation.id });
        if (linkError && String(linkError.code || '') !== '23505') throw linkError;
        await logCompanyBackupEvent({ companyId: company.id, installationId: installation.id, eventType: 'COMPANY_DEVICE_LINKED_BY_LOGIN' });
      } else {
        await db().from('company_device_registrations').update({ last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('installation_id', installation.id);
      }
      linkedInstallation = installation;
    }

    await db().from('registered_companies').update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', company.id);
    return json(res, 200, {
      success: true,
      company: { ...companyPublic(company), logo: companyLogo },
      linkedDevice: Boolean(linkedInstallation),
      installationId: linkedInstallation?.id || null,
      recoveryToken: encodeCompanyRecoveryToken(company),
      expiresInSeconds: 900,
    });
  } catch (error) {
    console.error('customerCompanyLogin', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration database is not installed. Check the PostgreSQL company registration schema.', code: 'COMPANY_SCHEMA_MISSING' });
    return json(res, 500, { error: 'Unable to verify company login.' });
  }
}

async function customerBackupSign(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
    const access = accessPayload(installation);
    if (!access.allowed) return json(res, 403, { error: 'Your access has expired. Renew your subscription before creating a new backup.', code: 'ACCESS_EXPIRED' });
    const linked = await companyForInstallation(installation.id);
    if (!linked?.company) return json(res, 409, { error: 'Add your Company Information in Settings before creating a backup.', code: 'COMPANY_REGISTRATION_REQUIRED' });
    const backupId = String(req.body?.backupId || '').trim().slice(0, 180);
    const exportedAt = String(req.body?.exportedAt || '').trim().slice(0, 80);
    const digest = String(req.body?.digest || '').trim().slice(0, 200);
    const format = String(req.body?.format || 'safarpro-backup-v2').trim().slice(0, 100);
    if (!backupId || !exportedAt || !/^[a-f0-9]{64}$/i.test(digest)) return json(res, 400, { error: 'Invalid backup verification data.' });
    const signature = backupSignature({ companyId: linked.company.id, backupId, exportedAt, digest, format });
    await db().from('company_device_registrations').update({ last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('installation_id', installation.id);
    await logCompanyBackupEvent({ companyId: linked.company.id, installationId: installation.id, backupId, eventType: 'BACKUP_SIGNED', metadata: { format, counts: req.body?.counts || {} } });
    return json(res, 200, { company: companyPublic(linked.company), backupAuth: { version: 1, algorithm: 'HMAC-SHA256', format, backupId, exportedAt, digest, signature } });
  } catch (error) {
    console.error('customerBackupSign', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration database is not installed. Check the PostgreSQL company registration schema.', code: 'COMPANY_SCHEMA_MISSING' });
    return json(res, 500, { error: 'Unable to secure this backup.' });
  }
}

async function customerBackupVerify(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const body = req.body || {};
    const companyId = String(body.companyId || '').trim();
    const input = {
      companyId,
      backupId: String(body.backupId || '').trim(),
      exportedAt: String(body.exportedAt || '').trim(),
      digest: String(body.digest || '').trim(),
      signature: String(body.signature || '').trim(),
      format: String(body.format || 'safarpro-backup-v2').trim(),
    };
    if (!companyId || !input.backupId || !input.exportedAt || !/^[a-f0-9]{64}$/i.test(input.digest) || !input.signature) {
      return json(res, 400, { error: 'Backup verification data is incomplete.' });
    }
    if (!backupSignatureMatches(input)) return json(res, 400, { error: 'This backup was changed or cannot be verified.', code: 'BACKUP_SIGNATURE_INVALID' });

    let installation = null;
    try { installation = await installationFromRequest(req); } catch { installation = null; }
    let linked = null;
    if (installation?.id) linked = await companyForInstallation(installation.id);

    const { data: company, error } = await db().from('registered_companies').select('*').eq('id', companyId).maybeSingle();
    if (error) throw error;
    if (!company) return json(res, 404, { error: 'Registered company not found.' });
    if (company.status === 'BLOCKED') return json(res, 403, { error: 'This company account is blocked. Contact support.', code: 'COMPANY_BLOCKED' });
    const access = installation ? accessPayload(installation) : null;

    // A valid server-signed backup is the ownership proof. On an ACTIVE device,
    // link the restored company automatically so Settings remains the single
    // source of company identity. Expired devices can inspect the backup but
    // cannot import until access is renewed.
    if (installation?.id && access?.allowed) {
      if (linked?.company && String(linked.company.id) !== companyId) {
        return json(res, 409, { error: 'This device is already linked to a different company profile.', code: 'DEVICE_COMPANY_CONFLICT' });
      }
      if (!linked?.company) {
        const { error: linkError } = await db().from('company_device_registrations').insert({ company_id: companyId, installation_id: installation.id });
        if (linkError && String(linkError.code || '') !== '23505') throw linkError;
        linked = await companyForInstallation(installation.id);
        await logCompanyBackupEvent({ companyId, installationId: installation.id, backupId: input.backupId, eventType: 'RECOVERY_DEVICE_LINKED', metadata: { source: 'signed-backup' } });
      }
    }

    if (installation?.id && String(linked?.company?.id || '') === companyId) {
      await db().from('company_device_registrations').update({ last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('installation_id', installation.id);
    }
    await logCompanyBackupEvent({ companyId, installationId: installation?.id || null, backupId: input.backupId, eventType: 'BACKUP_VERIFIED', metadata: { accessStatus: access?.accessStatus || null } });
    return json(res, 200, { success: true, verified: true, company: companyPublic(company), access, canImport: Boolean(access?.allowed) });
  } catch (error) {
    console.error('customerBackupVerify', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration database is not installed. Check the PostgreSQL company registration schema.', code: 'COMPANY_SCHEMA_MISSING' });
    return json(res, 500, { error: 'Unable to verify this backup.' });
  }
}

async function adminRegisteredDevices(req, res) {
  const session = requireAdmin(req, res);
  if (!session || !method(req, res, ['GET'])) return;
  try {
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize || 20)));
    const q = String(req.query?.q || '').trim().toLowerCase();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = db().from('installations').select('*,service_customers(*)', { count: 'exact' }).is('merged_into_installation_id', null).order('created_at', { ascending: false });
    if (q) {
      const safe = q.replace(/[,%()]/g, ' ').trim();
      if (safe) {
        const { data: customers, error: customerError } = await db().from('service_customers').select('id').ilike('smart_office_id', `%${safe}%`);
        if (customerError) throw customerError;
        const ids = (customers || []).map(row => row.id);
        query = query.or(`device_code.ilike.%${safe}%,display_name.ilike.%${safe}%,device_name.ilike.%${safe}%,profile_name.ilike.%${safe}%,operating_system.ilike.%${safe}%${ids.map(id => `,customer_id.eq.${id}`).join('')}`);
      }
    }
    const filter = String(req.query?.filter || '');
    const date = String(req.query?.date || '');
    const expiryDate = String(req.query?.expiryDate || '');
    const filtered = Boolean(filter || date || expiryDate);
    const result = await (filtered ? query : query.range(from, to));
    const { error, count } = result;
    if (error) throw error;
    const matches = filtered ? (result.data || []).filter(row => {
      const access = accessPayload(row);
      return deviceMatches(row, filter, date, access) && (!expiryDate || deviceDay(deviceExpiry(row, access)) === expiryDate);
    }) : result.data || [];
    const installations = filtered ? matches.slice(from, to + 1) : matches;
    const companyIdentity = await registeredCompanyIdentityMap((installations || []).map((row) => row.id));
    const mappedRows = (installations || []).map((installation) => {
      const company = companyIdentity.get(String(installation.id));
      const access = installation ? accessPayload(installation) : null;
      return {
        id: installation.id,
        company: company ? { ...companyPublic(company), logo: installation?.profile_logo || '' } : null,
        companyName: resolveCompanyDisplayName(installation?.profile_name, installation?.service_customers?.business_name, company?.company_name, installation?.service_customers?.owner_name, installation?.display_name, installation?.device_code),
        ownerName: company?.owner_name || installation?.service_customers?.owner_name || '',
        smartOfficeId: installation?.service_customers?.smart_office_id || '',
        profileLogo: installation?.profile_logo || '',
        installationId: installation?.id,
        deviceCode: installation?.device_code || '',
        deviceName: installation?.device_name || installation?.browser || installation?.display_name || installation?.device_type || 'Browser / PWA',
        browser: installation?.browser || installation?.device_name || '',
        operatingSystem: installation?.operating_system || '',
        installationType: installation?.installation_type || '',
        accessStatus: access?.accessStatus || 'UNKNOWN',
        approvalStatus: installation?.approval_status || 'APPROVED',
        customerId: installation?.customer_id || null,
        customerName: installation?.service_customers?.business_name || '',
        allowed: Boolean(access?.allowed),
        subscriptionExpiresAt: installation?.subscription_expires_at || null,
        trialEndsAt: installation?.trial_ends_at || null,
        lastSeenAt: installation?.last_seen_at || null,
        registeredAt: installation?.created_at,
        lastVerifiedAt: installation?.last_license_check_at,
      };
    });
    const filteredRows = mappedRows;
    const rows = filteredRows;
    const total = filtered ? matches.length : Number(count || 0);
    return json(res, 200, { rows, total, page, pageSize });
  } catch (error) {
    console.error('adminRegisteredDevices', error);
    if (companySchemaMissing(error)) return json(res, 500, { error: 'Company registration database is not installed. Check the PostgreSQL company registration schema.' });
    return json(res, 500, { error: 'Unable to load registered devices.' });
  }
}


function mapPlan(row) {
  return {
    id: row.id,
    title: row.title,
    amount: Number(row.amount || 0),
    requestedCreditAfn: Number(row.requested_credit_afn || 0),
    creditAppliedAfn: Number(row.credit_applied_afn || 0),
    currency: row.currency || 'AFN',
    durationValue: Number(row.duration_value || 1),
    durationUnit: row.duration_unit || 'MONTH',
    isLifetime: Boolean(row.is_lifetime || row.duration_unit === 'LIFETIME'),
    description: row.description || '',
    deviceLimit: Math.max(1, Number(row.device_limit || 1)),
    isActive: Boolean(row.is_active),
    isPopular: Boolean(row.is_popular),
    referralRewardAfn: Number(row.referral_reward_afn || 0),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPaymentMethod(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    paymentDetails: row.payment_details || '',
    instructions: row.instructions || '',
    logoUrl: row.logo_url || '',
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


function mapPaymentRequest(row) {
  const plan = row.subscription_plans || row.plan || null;
  const method = row.payment_methods || row.payment_method || null;
  const installation = row.installations || row.installation || null;
  return {
    id: row.id,
    installationId: row.installation_id,
    planId: row.plan_id,
    paymentMethodId: row.payment_method_id,
    amount: Number(row.amount || 0),
    requestedCreditAfn: Number(row.requested_credit_afn || 0),
    creditAppliedAfn: Number(row.credit_applied_afn || 0),
    currency: row.currency || 'AFN',
    transactionReference: row.transaction_reference || '',
    customerNote: row.customer_note || '',
    receiptPath: row.receipt_path || '',
    hasReceiptFallback: Boolean(row.receipt_fallback_data),
    receiptMime: row.receipt_mime || '',
    status: row.status || 'PENDING',
    adminNote: row.admin_note || '',
    reviewedAt: row.reviewed_at,
    approvedExpiresAt: row.approved_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    plan: plan ? mapPlan(plan) : null,
    paymentMethod: method ? mapPaymentMethod(method) : null,
    device: installation ? {
      id: installation.id,
      deviceCode: installation.device_code,
      displayName: installation.display_name || '',
      deviceName: installation.device_name || '',
      businessName: installation.service_customers?.business_name || '',
      ownerName: installation.service_customers?.owner_name || '',
      smartOfficeId: installation.service_customers?.smart_office_id || '',
    } : null,
  };
}


let paymentReceiptBucketReady = false;
async function ensurePaymentReceiptBucket() {
  if (paymentReceiptBucketReady) return;
  const storage = db().storage;
  const { data: existing, error: readError } = await storage.getBucket('payment-receipts');
  if (readError && !String(readError.message || '').toLowerCase().includes('not found')) {
    console.error('payment receipt bucket lookup', readError);
  }
  if (!existing) {
    const { error: createError } = await storage.createBucket('payment-receipts', {
      public: false,
      fileSizeLimit: 2097152,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    });
    if (createError && !String(createError.message || '').toLowerCase().includes('already')) throw createError;
  }
  paymentReceiptBucketReady = true;
}



let supportAttachmentBucketReady = false;
async function ensureSupportAttachmentBucket() {
  if (supportAttachmentBucketReady) return;
  const storage = db().storage;
  const { data: existing, error: readError } = await storage.getBucket('support-attachments');
  if (readError && !String(readError.message || '').toLowerCase().includes('not found')) {
    console.error('support attachment bucket lookup', readError);
  }
  if (!existing) {
    const { error: createError } = await storage.createBucket('support-attachments', {
      public: false,
      fileSizeLimit: 2097152,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });
    if (createError && !String(createError.message || '').toLowerCase().includes('already')) throw createError;
  }
  supportAttachmentBucketReady = true;
}

function parseSupportImageDataUrl(dataUrl) {
  const value = String(dataUrl || '');
  if (!value) return null;
  const match = value.match(/^data:(image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Screenshot must be a JPG, PNG or WEBP image.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error('Screenshot must be smaller than 2 MB.');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
  return { buffer, mime: match[1], ext };
}

async function signedSupportAttachment(row) {
  if (!row?.attachment_path) return null;
  try {
    const { data, error } = await db().storage.from('support-attachments').createSignedUrl(row.attachment_path, 900);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch (error) {
    console.error('support attachment signed url', error);
    return null;
  }
}

async function mapProviderMessage(row) {
  return {
    id: row.id,
    sender: row.sender,
    message: row.message || '',
    createdAt: row.created_at,
    editedAt: row.edited_at,
    reactions: normalizeReactionMap(row.reactions),
    attachmentUrl: await signedSupportAttachment(row),
    attachmentName: row.attachment_name || '',
    attachmentType: row.attachment_type || '',
    attachmentSize: Number(row.attachment_size || 0),
    isRead: Boolean(row.is_read),
    seenAt: row.seen_at || null,
  };
}
function parseReceiptDataUrl(dataUrl) {
  const value = String(dataUrl || '');
  if (!value) return null;
  const match = value.match(/^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Receipt must be a JPG, PNG, WEBP or PDF file.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error('Receipt must be smaller than 2 MB.');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[match[1]];
  return { buffer, mime: match[1], ext };
}


const DEVICE_IDENTITY_SCHEMA_MISSING_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);
let deviceIdentitySchemaConfirmed = false;

function missingDeviceIdentitySchema(error) {
  return DEVICE_IDENTITY_SCHEMA_MISSING_CODES.has(String(error?.code || ''));
}

async function hasDeviceIdentitySchema() {
  if (deviceIdentitySchemaConfirmed) return true;
  const { error } = await db().from('browser_installations').select('id').limit(1);
  if (error) {
    if (missingDeviceIdentitySchema(error)) return false;
    throw error;
  }
  deviceIdentitySchemaConfirmed = true;
  return true;
}

function requestNetworkHash(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const value = forwarded || String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || '').trim();
  return value ? hashToken(value) : null;
}

function deviceIdentityFromRequest(req) {
  const body = req.body || {};
  const strength = Math.max(0, Math.min(10, Number(body.fingerprintStrength || 0)));
  const version = Math.max(1, Math.min(20, Number(body.fingerprintVersion || 1)));
  const strongRaw = String(body.physicalFingerprint || '').slice(0, 1600);
  const coarseRaw = String(body.coarseFingerprint || '').slice(0, 1200);
  return {
    strongHash: strongRaw && strength >= 5 ? hashToken(strongRaw) : null,
    coarseHash: coarseRaw && strength >= 4 ? hashToken(coarseRaw) : null,
    version,
    strength,
    networkHash: requestNetworkHash(req),
    ipAddress: customerRequestIp(req),
    browser: String(body.browser || req.headers?.['user-agent'] || '').slice(0, 800) || null,
    operatingSystem: String(body.operatingSystem || '').slice(0, 200) || null,
    appVersion: String(body.appVersion || '').slice(0, 120) || null,
    installationType: String(body.installationType || '').slice(0, 120) || null,
  };
}

function createdAtValue(row) {
  const value = row?.created_at ? new Date(row.created_at).getTime() : Number.MAX_SAFE_INTEGER;
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function chooseCanonicalInstallation(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aTime = createdAtValue(a);
  const bTime = createdAtValue(b);
  if (aTime !== bTime) return aTime < bTime ? a : b;
  return String(a.id) < String(b.id) ? a : b;
}

async function findPhysicalDeviceMatch(identity, excludeId = null) {
  if (!identity?.strongHash && !(identity?.coarseHash && identity?.networkHash)) return null;

  const run = async (filters) => {
    let query = db().from('installations')
      .select('*,service_customers(*)')
      .is('merged_into_installation_id', null)
      .limit(3);
    if (excludeId) query = query.neq('id', excludeId);
    for (const [field, value] of Object.entries(filters)) query = query.eq(field, value);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    return rows.length === 1 ? rows[0] : null;
  };

  if (identity.strongHash) {
    const exact = await run({ physical_fingerprint_hash: identity.strongHash });
    if (exact) return exact;
  }

  // A screen/resolution change may alter the strong fingerprint. In that case
  // use the coarser hardware signature only when the public network also
  // matches, reducing accidental links between different computers.
  if (identity.coarseHash && identity.networkHash) {
    return run({ coarse_fingerprint_hash: identity.coarseHash, last_network_hash: identity.networkHash });
  }
  return null;
}

async function upsertBrowserInstallation(token, installationId, identity) {
  if (!token || !installationId) return null;
  const now = new Date().toISOString();
  const payload = {
    installation_id: installationId,
    token_hash: hashToken(token),
    fingerprint_hash: identity?.strongHash || null,
    coarse_fingerprint_hash: identity?.coarseHash || null,
    fingerprint_version: identity?.version || 1,
    fingerprint_strength: identity?.strength || 0,
    network_hash: identity?.networkHash || null,
    browser: identity?.browser || null,
    operating_system: identity?.operatingSystem || null,
    app_version: identity?.appVersion || null,
    installation_type: identity?.installationType || null,
    session_state: 'ACTIVE',
    revoked_at: null,
    revoked_reason: null,
    ip_address: identity?.ipAddress || null,
    last_seen_at: now,
    updated_at: now,
  };
  const { data, error } = await db().from('browser_installations')
    .upsert(payload, { onConflict: 'token_hash' })
    .select('id,installation_id')
    .single();
  if (error) throw error;
  return data;
}

async function updatePhysicalIdentity(installationId, identity, extra = {}) {
  const now = new Date().toISOString();
  const patch = {
    physical_device_id: installationId,
    fingerprint_version: identity?.version || 1,
    fingerprint_strength: identity?.strength || 0,
    last_network_hash: identity?.networkHash || null,
    last_seen_at: now,
    ...extra,
  };
  if (identity?.strongHash) patch.physical_fingerprint_hash = identity.strongHash;
  if (identity?.coarseHash) patch.coarse_fingerprint_hash = identity.coarseHash;
  if (identity?.appVersion) patch.app_version = identity.appVersion;
  if (identity?.installationType) patch.installation_type = identity.installationType;
  const { data, error } = await db().from('installations')
    .update(patch)
    .eq('id', installationId)
    .select('*,service_customers(*)')
    .single();
  if (error) throw error;
  return data;
}

async function mergePhysicalDevices(source, target, identity, token) {
  if (!source?.id || !target?.id || source.id === target.id) return target || source;
  const { data: mergedId, error } = await db().rpc('merge_physical_installations', {
    source_id: source.id,
    target_id: target.id,
  });
  if (error) throw error;
  const canonicalId = mergedId || target.id;
  await upsertBrowserInstallation(token, canonicalId, identity);
  const updated = await updatePhysicalIdentity(canonicalId, identity, { last_license_check_at: new Date().toISOString() });
  await logDeviceEvent(canonicalId, 'BROWSER_MERGED', 'Browser linked to existing device', 'A legacy browser installation was consolidated into this physical device.', {
    mergedInstallationId: source.id,
    mergedDeviceCode: source.device_code || '',
  });
  return updated;
}

async function syncPhysicalDeviceIdentity(req, row) {
  if (!row) return row;
  let schemaReady = false;
  try { schemaReady = await hasDeviceIdentitySchema(); }
  catch (error) {
    console.error('device identity schema check', error);
    return row;
  }
  if (!schemaReady) return row;

  const token = bearer(req);
  if (!token) return row;
  const identity = deviceIdentityFromRequest(req);

  try {
    const match = await findPhysicalDeviceMatch(identity, row.id);
    if (match) {
      const canonical = chooseCanonicalInstallation(row, match);
      const source = canonical.id === row.id ? match : row;
      const target = canonical.id === row.id ? row : match;
      return await mergePhysicalDevices(source, target, identity, token);
    }

    await upsertBrowserInstallation(token, row.id, identity);
    return await updatePhysicalIdentity(row.id, identity);
  } catch (error) {
    // Device-identity migration must never lock an existing licensed customer
    // out if the new helper schema has not been applied correctly yet.
    console.error('syncPhysicalDeviceIdentity', error);
    return row;
  }
}


function customerProfileFromRow(customer) {
  if (!customer) return null;
  return {
    businessName: customer.business_name || '',
    ownerName: customer.owner_name || '',
    phone: customer.phone || '',
    email: customer.email || '',
    whatsapp: customer.whatsapp || '',
    country: customer.country || '',
    city: customer.city || '',
    address: customer.address || '',
    businessType: customer.business_type || '',
    licenseNumber: customer.license_number || '',
    smartOfficeId: customer.smart_office_id || '',
  };
}

async function ensureSmartOfficeId(customerOrId) {
  const customerId = typeof customerOrId === 'string' ? customerOrId : customerOrId?.id;
  if (!customerId) return '';
  const existing = typeof customerOrId === 'object' ? String(customerOrId?.smart_office_id || '') : '';
  if (existing) return existing;
  const smartOfficeId = `SP-${String(customerId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const { data, error } = await db().from('service_customers').update({ smart_office_id: smartOfficeId }).eq('id', customerId).select('smart_office_id').single();
  if (error) throw error;
  await ensureCreditAccount(customerId);
  return data?.smart_office_id || smartOfficeId;
}

async function applyReferralForCustomer(referralCode, referredCustomerId) {
  const code = cleanText(referralCode, 40).toUpperCase();
  if (!code || !/^SP-[A-Z0-9]{6,16}$/.test(code)) return null;
  const { data: referrer, error: referrerError } = await db().from('service_customers').select('id,smart_office_id').ilike('smart_office_id', code).maybeSingle();
  if (referrerError) throw referrerError;
  if (!referrer || String(referrer.id) === String(referredCustomerId)) return null;
  let created = false;
  try {
    const { error } = await db().from('referral_relationships').insert({ referrer_customer_id: referrer.id, referred_customer_id: referredCustomerId, referral_code: code });
    if (error) throw error;
    created = true;
  } catch (error) {
    if (String(error?.code || '') !== '23505') throw error;
  }
  if (created) await awardReferralSignup(db(), { referrerCustomerId: referrer.id, referredCustomerId });
  return { referrerCustomerId: referrer.id, created };
}

async function awardPlanReferralForCustomer(customerId, plan, paymentRequestId) {
  if (!customerId || !plan || Number(plan.referral_reward_afn || 0) <= 0) return null;
  const { data: relationship, error } = await db().from('referral_relationships').select('referrer_customer_id').eq('referred_customer_id', customerId).maybeSingle();
  if (error) throw error;
  if (!relationship?.referrer_customer_id) return null;
  return awardReferralPlanPurchase(db(), {
    referrerCustomerId: relationship.referrer_customer_id,
    referredCustomerId: customerId,
    planId: plan.id,
    paymentRequestId,
    rewardAfn: Number(plan.referral_reward_afn || 0),
  });
}

function customerProfileComplete(customer) {
  return Boolean(
    String(customer?.business_name || '').trim()
    && String(customer?.owner_name || '').trim()
    && String(customer?.phone || '').trim()
    && /^\S+@\S+\.\S+$/.test(String(customer?.email || '').trim()),
  );
}

function normalizeCustomerProfileInput(body = {}) {
  const profile = {
    business_name: cleanText(body.businessName, 160),
    owner_name: cleanText(body.ownerName, 160),
    phone: cleanText(body.phone, 80),
    email: cleanText(body.email, 240).toLowerCase(),
    whatsapp: cleanText(body.whatsapp, 80) || null,
    country: cleanText(body.country, 120) || null,
    city: cleanText(body.city, 120) || null,
    address: cleanText(body.address, 500) || null,
    business_type: cleanText(body.businessType, 160) || null,
    license_number: cleanText(body.licenseNumber, 160) || null,
  };
  if (!profile.business_name || !profile.owner_name || !profile.phone || !profile.email) {
    return { error: 'Company name, responsible person, phone and email are required.' };
  }
  if (!/^\S+@\S+\.\S+$/.test(profile.email)) return { error: 'Enter a valid email address.' };
  return { profile };
}

async function findExistingCustomerByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const { data, error } = await db().from('service_customers')
    .select('*')
    .ilike('email', normalized)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

async function customerTrialWindow(customerId) {
  const { data: customer, error } = await db().from('service_customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!customer) return null;
  if (customer.trial_started_at && customer.trial_ends_at) return customer;
  const { data: installs, error: installsError } = await db().from('installations')
    .select('trial_started_at,trial_ends_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (installsError) throw installsError;
  const first = (installs || [])[0] || null;
  if (!first) return customer;
  const patch = {
    trial_started_at: customer.trial_started_at || first.trial_started_at,
    trial_ends_at: customer.trial_ends_at || first.trial_ends_at,
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error: updateError } = await db().from('service_customers')
    .update(patch).eq('id', customerId).select('*').single();
  if (updateError) throw updateError;
  return updated;
}

async function ensureAutomaticCompanyRegistration({ installationId, customerId, profile }) {
  if (!installationId || !customerId || !profile) return null;
  const { data: existing, error: existingError } = await db().from('company_registration_requests')
    .select('*')
    .eq('service_customer_id', customerId)
    .order('submitted_at', { ascending: true })
    .limit(1);
  if (existingError) throw existingError;
  const current = (existing || [])[0] || null;
  const now = new Date().toISOString();
  if (current) {
    if (String(current.status || '').toUpperCase() === 'PENDING') {
      const { data: updated, error: updateError } = await db().from('company_registration_requests').update({
        company_name: profile.business_name,
        phone: profile.phone,
        email: profile.email,
        country: profile.country || null,
        city: profile.city || null,
        address: profile.address || null,
        business_type: profile.business_type || null,
        description: profile.business_type ? `Business type: ${profile.business_type}` : current.description,
        updated_at: now,
      }).eq('id', current.id).select('*').single();
      if (updateError) throw updateError;
      return updated;
    }
    return current;
  }
  const payload = {
    installation_id: installationId,
    service_customer_id: customerId,
    company_name: profile.business_name,
    phone: profile.phone,
    email: profile.email,
    country: profile.country || null,
    city: profile.city || null,
    address: profile.address || null,
    business_type: profile.business_type || null,
    description: profile.business_type ? `Business type: ${profile.business_type}` : null,
    status: 'PENDING',
    submitted_at: now,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await db().from('company_registration_requests')
    .insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function companyActiveEntitlementExpiry(customerId) {
  const now = new Date();
  const { data, error } = await db().from('installations')
    .select('subscription_expires_at,approval_status,status')
    .eq('customer_id', customerId)
    .is('merged_into_installation_id', null);
  if (error) throw error;
  const expiries = (data || [])
    .filter((row) => String(row.approval_status || 'APPROVED').toUpperCase() === 'APPROVED')
    .filter((row) => String(row.status || '').toUpperCase() !== 'BLOCKED')
    .map((row) => row.subscription_expires_at ? new Date(row.subscription_expires_at) : null)
    .filter((value) => value && value > now);
  if (!expiries.length) return null;
  return new Date(Math.max(...expiries.map((value) => value.getTime())));
}

async function propagateCompanyEntitlement(customerId, expiresAt) {
  if (!customerId || !expiresAt) return;
  const iso = typeof expiresAt === 'string' ? expiresAt : expiresAt.toISOString();
  const { error } = await db().from('installations').update({
    subscription_expires_at: iso,
    access_version: Date.now(),
  }).eq('customer_id', customerId).eq('approval_status', 'APPROVED').is('merged_into_installation_id', null);
  if (error) throw error;
}

async function propagateCompanyLifetimeAccess(customerId) {
  if (!customerId) return;
  const { error } = await db().from('installations').update({
    lifetime_access: true,
    subscription_expires_at: null,
    access_version: Date.now(),
  }).eq('customer_id', customerId).eq('approval_status', 'APPROVED').is('merged_into_installation_id', null);
  if (error) throw error;
}

async function approvedDeviceAllowance(customerId) {
  const { data: devices, error: deviceError } = await db().from('installations')
    .select('id,status,approval_status')
    .eq('customer_id', customerId)
    .is('merged_into_installation_id', null);
  if (deviceError) throw deviceError;
  const approved = (devices || []).filter((row) => String(row.approval_status || 'APPROVED').toUpperCase() === 'APPROVED' && String(row.status || '').toUpperCase() !== 'BLOCKED');
  const ids = approved.map((row) => row.id);
  let limit = 1;
  if (ids.length) {
    const now = new Date();
    const { data: subscriptions, error: subError } = await db().from('subscriptions')
      .select('plan_id,expires_at,is_lifetime,created_at')
      .in('installation_id', ids)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(100);
    if (subError) throw subError;
    const activeSubscriptions = (subscriptions || []).filter((sub) => sub.is_lifetime || (sub.expires_at && new Date(sub.expires_at) > now));
    const lifetimeSubscription = activeSubscriptions.find((sub) => sub.is_lifetime);
    const planId = lifetimeSubscription?.plan_id || activeSubscriptions[0]?.plan_id;
    if (planId) {
      const { data: plan, error: planError } = await db().from('subscription_plans')
        .select('device_limit')
        .eq('id', planId)
        .maybeSingle();
      if (planError) throw planError;
      limit = Math.max(1, Number(plan?.device_limit || 1));
    }
  }
  return { limit, approvedCount: approved.length };
}

async function saveCustomerProfile(customerId, body) {
  const normalized = normalizeCustomerProfileInput(body);
  if (normalized.error) return normalized;
  const { data, error } = await db().from('service_customers').update(normalized.profile).eq('id', customerId).select('*').single();
  if (error) throw error;
  return { customer: data };
}


function deviceIdentityMatchesInstallation(row, identity) {
  const storedStrong = String(row?.physical_fingerprint_hash || '');
  const storedCoarse = String(row?.coarse_fingerprint_hash || '');
  if (!storedStrong && !storedCoarse) return true;
  if (storedStrong && identity?.strongHash && storedStrong === identity.strongHash) return true;
  if (storedCoarse && identity?.coarseHash && storedCoarse === identity.coarseHash) {
    const storedNetwork = String(row?.last_network_hash || '');
    const incomingNetwork = String(identity?.networkHash || '');
    if (storedNetwork && incomingNetwork && storedNetwork === incomingNetwork) return true;
  }
  return false;
}

function installationLooksMobile(row) {
  const deviceType = String(row?.device_type || '').toUpperCase();
  const installationType = String(row?.installation_type || '').toUpperCase();
  const browser = String(row?.browser || row?.device_name || '');
  return deviceType === 'MOBILE'
    || installationType.includes('MOBILE')
    || /Android|iPhone|iPad|iPod|Mobile/i.test(browser);
}

async function enforceDeviceBinding(req, row, { touch = true } = {}) {
  if (!row) return row;
  let schemaReady = false;
  try { schemaReady = await hasDeviceIdentitySchema(); }
  catch (error) { console.error('device binding schema check', error); return row; }
  if (!schemaReady) return row;
  const identity = deviceIdentityFromRequest(req);
  const hasStoredIdentity = Boolean(row.physical_fingerprint_hash || row.coarse_fingerprint_hash);
  if (hasStoredIdentity && !deviceIdentityMatchesInstallation(row, identity)) {
    // Mobile fingerprint v2 deliberately stopped using screen size/orientation.
    // Existing phones registered by older releases therefore have a different
    // stored hash even though the bearer token still belongs to the same browser.
    // Allow exactly this forward-only mobile migration once, then persist v2.
    const storedVersion = Math.max(1, Number(row.fingerprint_version || 1));
    const incomingVersion = Math.max(1, Number(identity?.version || 1));
    const incomingMobile = String(identity?.installationType || '').toUpperCase().includes('MOBILE');
    if (incomingMobile && installationLooksMobile(row) && incomingVersion > storedVersion) {
      const upgraded = await updatePhysicalIdentity(row.id, identity, {
        device_type: 'MOBILE',
        installation_type: 'MOBILE_WEB',
        last_license_check_at: new Date().toISOString(),
      });
      const token = bearer(req);
      if (token) {
        try { await upsertBrowserInstallation(token, upgraded.id, identity); }
        catch (aliasError) { console.error('device binding mobile upgrade alias', aliasError); }
      }
      await logDeviceEvent(upgraded.id, 'MOBILE_IDENTITY_UPGRADED', 'Mobile device identity upgraded', 'The registered mobile browser was upgraded to the stable mobile fingerprint without creating a new device.', { fromVersion: storedVersion, toVersion: incomingVersion });
      return upgraded;
    }

    const error = new Error('This installation token belongs to a different physical device.');
    error.code = 'DEVICE_IDENTITY_MISMATCH';
    throw error;
  }
  if (!hasStoredIdentity) {
    // One-time binding for legacy installations. Once bound, access-sync stays
    // read-only and only verifies the physical device fingerprint.
    return updatePhysicalIdentity(row.id, identity);
  }
  if (!touch) return row;
  const token = bearer(req);
  if (token) {
    try { await upsertBrowserInstallation(token, row.id, identity); }
    catch (aliasError) { console.error('device binding browser alias', aliasError); }
  }
  return updatePhysicalIdentity(row.id, identity);
}

async function customerProfile(req, res) {
  if (!method(req, res, ['GET', 'PATCH'])) return;
  try {
    const row = await installationFromRequest(req);
    if (!row) return json(res, 401, { error: 'Invalid installation token.' });
    if (req.method === 'PATCH') {
      const saved = await saveCustomerProfile(row.customer_id, req.body || {});
      if (saved.error) return json(res, 400, { error: saved.error });
      try {
        await ensureAutomaticCompanyRegistration({ installationId: row.id, customerId: row.customer_id, profile: {
          business_name: saved.customer.business_name,
          owner_name: saved.customer.owner_name,
          phone: saved.customer.phone,
          email: saved.customer.email,
          country: saved.customer.country,
          city: saved.customer.city,
          address: saved.customer.address,
          business_type: saved.customer.business_type,
        } });
      } catch (companyError) { console.warn('customerProfile company registration', companyError); }
      const smartOfficeId = await ensureSmartOfficeId(saved.customer);
      const profile = customerProfileFromRow({ ...saved.customer, smart_office_id: smartOfficeId });
      return json(res, 200, {
        success: true,
        customerProfileComplete: customerProfileComplete(saved.customer),
        customerProfile: profile,
        access: await accessPayloadWithBlockReason({ ...row, service_customers: saved.customer }, { now: new Date() }),
      });
    }
    const customer = row.service_customers || null;
    if (customer?.id && !customer.smart_office_id) customer.smart_office_id = await ensureSmartOfficeId(customer);
    return json(res, 200, {
      success: true,
      customerProfileComplete: customerProfileComplete(customer),
      customerProfile: customerProfileFromRow(customer),
      access: await accessPayloadWithBlockReason(row, { now: new Date() }),
    });
  } catch (e) {
    console.error('customerProfile', e);
    return json(res, 500, { error: 'Unable to load customer profile.' });
  }
}


function customerRequestIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || '').trim()).slice(0, 120) || null;
}

function normalizeCustomerAccountEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 240);
}

function customerAccountPasswordRecord(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(password || ''), salt, 64).toString('hex') };
}

function verifyCustomerAccountPassword(password, salt, expectedHash) {
  try {
    const actual = Buffer.from(scryptSync(String(password || ''), String(salt || ''), 64).toString('hex'), 'hex');
    const expected = Buffer.from(String(expectedHash || ''), 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

async function logCustomerLoginEvent(req, { customerId = null, installationId = null, email = '', eventType = 'LOGIN', success = true, reason = '', identity = null, metadata = {} } = {}) {
  try {
    const { error } = await db().from('customer_login_events').insert({
      customer_id: customerId || null,
      installation_id: installationId || null,
      email: normalizeCustomerAccountEmail(email) || null,
      event_type: String(eventType || 'LOGIN').slice(0, 80),
      success: Boolean(success),
      ip_address: customerRequestIp(req),
      user_agent: String(req.headers?.['user-agent'] || '').slice(0, 800),
      browser: cleanText(identity?.browser || req.headers?.['user-agent'], 800) || null,
      operating_system: cleanText(identity?.operatingSystem, 200) || null,
      reason: cleanText(reason, 500) || null,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });
    if (error && !['42P01','PGRST205'].includes(String(error?.code || ''))) console.error('logCustomerLoginEvent', error);
  } catch (error) { console.error('logCustomerLoginEvent unavailable', error); }
}

async function revokeCustomerSessions(customerId, { exceptInstallationId = null, reason = 'Account activated on another browser or device.' } = {}) {
  if (!customerId) return [];
  let query = db().from('installations').select('id,device_code,browser,operating_system,last_ip,login_ip').eq('customer_id', customerId).is('merged_into_installation_id', null);
  if (exceptInstallationId) query = query.neq('id', exceptInstallationId);
  const { data: rows, error } = await query;
  if (error) throw error;
  const ids = (rows || []).map((row) => row.id).filter(Boolean);
  if (!ids.length) return [];
  const now = new Date().toISOString();
  const { error: revokeError } = await db().from('installations').update({
    session_state: 'REVOKED',
    revoked_at: now,
    revoked_reason: cleanText(reason, 500),
    access_version: Date.now(),
  }).in('id', ids);
  if (revokeError) throw revokeError;
  try {
    const { error: browserError } = await db().from('browser_installations').update({
      session_state: 'REVOKED', revoked_at: now, revoked_reason: cleanText(reason, 500), updated_at: now,
    }).in('installation_id', ids);
    if (browserError && !missingDeviceIdentitySchema(browserError)) throw browserError;
  } catch (error) {
    if (!missingDeviceIdentitySchema(error)) throw error;
  }
  for (const row of rows || []) {
    await logDeviceEvent(row.id, 'SESSION_REVOKED', 'Browser session deactivated', reason, { customerId });
    // Push the revocation to the old browser immediately. The realtime hub keeps
    // the already-authenticated socket/SSE stream alive long enough to deliver
    // this event even though the installation token has just been revoked.
    broadcastConversationEvent(row.id, 'access:revoked', {
      reason: cleanText(reason, 500),
      customerId: String(customerId),
    }, 'customer');
  }
  return rows || [];
}

async function createAccountInstallation(req, customer, { token, identity, source = 'SIGN_IN' } = {}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const trialMs = (await defaultTrialDays()) * 24 * 60 * 60 * 1000;
  const hydrated = await customerTrialWindow(customer.id) || customer;
  const trialStart = new Date(hydrated.trial_started_at || nowIso);
  const trialEnd = new Date(hydrated.trial_ends_at || new Date(trialStart.getTime() + trialMs).toISOString());
  const { data: previous, error: previousError } = await db().from('installations')
    .select('*').eq('customer_id', customer.id).is('merged_into_installation_id', null).order('created_at', { ascending: false }).limit(50);
  if (previousError) throw previousError;
  const lifetimeAccess = (previous || []).some((row) => Boolean(row.lifetime_access));
  const expiryMs = (previous || []).map((row) => row.subscription_expires_at ? new Date(row.subscription_expires_at).getTime() : 0).filter((value) => Number.isFinite(value) && value > now.getTime());
  const subscriptionExpiresAt = expiryMs.length ? new Date(Math.max(...expiryMs)).toISOString() : null;
  const latestProfile = (previous || []).find((row) => row.profile_name || row.profile_logo || row.display_name) || null;
  const ip = customerRequestIp(req);
  const payload = {
    customer_id: customer.id,
    token_hash: hashToken(token),
    device_code: deviceCode(),
    device_name: String(identity?.deviceName || req.headers?.['user-agent'] || '').slice(0, 500),
    device_type: identity?.deviceType || null,
    installation_type: identity?.installationType || null,
    operating_system: String(identity?.operatingSystem || '').slice(0, 200),
    browser: String(identity?.browser || req.headers?.['user-agent'] || '').slice(0, 800),
    app_version: identity?.appVersion || null,
    display_name: latestProfile?.display_name || null,
    profile_name: latestProfile?.profile_name || customer.business_name || null,
    profile_logo: latestProfile?.profile_logo || null,
    status: 'ACTIVE',
    approval_status: 'APPROVED',
    trial_started_at: trialStart.toISOString(),
    trial_ends_at: trialEnd.toISOString(),
    subscription_expires_at: lifetimeAccess ? null : subscriptionExpiresAt,
    lifetime_access: lifetimeAccess,
    last_seen_at: nowIso,
    last_license_check_at: nowIso,
    session_state: 'ACTIVE',
    login_ip: ip,
    last_ip: ip,
  };
  if (identity?.strongHash) {
    payload.physical_fingerprint_hash = identity.strongHash;
    payload.coarse_fingerprint_hash = identity.coarseHash;
    payload.fingerprint_version = identity.version;
    payload.fingerprint_strength = identity.strength;
    payload.last_network_hash = identity.networkHash;
  }
  const { data: row, error } = await db().from('installations').insert(payload).select('*,service_customers(*)').single();
  if (error) throw error;
  try { await upsertBrowserInstallation(token, row.id, identity); } catch (browserError) { console.error('account browser installation', browserError); }
  try {
    const { data: account } = await db().from('customer_accounts').select('id,registered_company_id').eq('customer_id', customer.id).maybeSingle();
    let companyId = account?.registered_company_id || null;
    if (!companyId) {
      for (const old of previous || []) {
        try {
          const linked = await companyForInstallation(old.id);
          if (linked?.company?.id) { companyId = linked.company.id; break; }
        } catch {}
      }
    }
    if (companyId) {
      const { error: linkError } = await db().from('company_device_registrations').insert({ company_id: companyId, installation_id: row.id });
      if (linkError && String(linkError.code || '') !== '23505') throw linkError;
      if (account?.id && !account.registered_company_id) await db().from('customer_accounts').update({ registered_company_id: companyId, updated_at: nowIso }).eq('id', account.id);
    }
  } catch (linkError) { console.warn('account company device link', linkError); }
  await logDeviceEvent(row.id, source === 'SIGN_UP' ? 'ACCOUNT_REGISTERED' : 'ACCOUNT_LOGIN', source === 'SIGN_UP' ? 'Customer account created' : 'Customer signed in', source === 'SIGN_UP' ? 'This browser became the active real estate office session.' : 'A successful account login activated this browser and deactivated older sessions.', { ip });
  return row;
}

// Persisted trial length is server-side, never trusted from a public signup request.
async function defaultTrialDays(client = null) {
  const query = 'SELECT trial_days FROM public.safarpro_access_settings WHERE id = 1';
  const result = client ? await client.query(query) : await pgPool().query(query);
  return Math.max(1, Math.min(365, Number(result.rows[0]?.trial_days || 7)));
}

async function adminTrialSettings(req, res) {
  const session = requireAdmin(req, res);
  if (!session || !method(req, res, ['GET', 'PUT'])) return;
  try {
    if (req.method === 'GET') return json(res, 200, { trialDays: await defaultTrialDays() });
    const value = Number(req.body?.trialDays);
    if (!Number.isInteger(value) || value < 1 || value > 365) return json(res, 400, { error: 'مدت آزمایشی باید بین ۱ تا ۳۶۵ روز باشد.' });
    await pgPool().query('INSERT INTO public.safarpro_access_settings (id,trial_days) VALUES (1,$1) ON CONFLICT (id) DO UPDATE SET trial_days=EXCLUDED.trial_days,updated_at=now()', [value]);
    await recordAdminAudit(req, session, { action:'TRIAL_SETTINGS_UPDATED', category:'SETTINGS', summary:`Default trial set to ${value} days` });
    return json(res, 200, { trialDays: value });
  } catch (error) {
    console.error('adminTrialSettings', error);
    return json(res, 500, { error:'Unable to load or save trial settings. Run central database migration 010 first.' });
  }
}

// SafarPro 011: server-owned, persistent evidence of prior free-trial usage.
// Browser fingerprints are not guaranteed unique or permanent; a match requests
// manual review rather than permanently banning a person or company.
function trialIdentityKeys(profile, identity) {
  const phone = String(profile?.phone || '').replace(/[^0-9+]/g, '');
  const keys = [];
  if (phone.length >= 7) keys.push({kind:'PHONE', digest:hashToken(phone)});
  if (identity?.strongHash && identity.strength >= 5) keys.push({kind:'STRONG_DEVICE', digest:identity.strongHash});
  return keys;
}

async function trialPreviouslyUsed(profile, identity, currentCustomerId = null) {
  const keys = trialIdentityKeys(profile, identity);
  if (!keys.length) return false;
  const result = await pgPool().query(
    `SELECT customer_id FROM public.safarpro_trial_identity_history
     WHERE (kind, identity_hash) IN (${keys.map((_,i)=>`($${i*2+1},$${i*2+2})`).join(',')}) LIMIT 10`,
    keys.flatMap(k=>[k.kind,k.digest]));
  return result.rows.some(r => !currentCustomerId || String(r.customer_id) !== String(currentCustomerId));
}

async function recordTrialIdentity(profile, identity, customerId) {
  const keys = trialIdentityKeys(profile, identity);
  if (!keys.length) return false; // insufficient identity evidence: request review
  const client = await pgPool().connect();
  try {
    await client.query('BEGIN');
    // Stable order and transaction locks prevent concurrent free-trial issuance.
    for (const key of keys.sort((a,b)=>a.kind.localeCompare(b.kind))) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key.kind+':'+key.digest]);
      const previous = await client.query(
        'SELECT customer_id FROM public.safarpro_trial_identity_history WHERE kind=$1 AND identity_hash=$2',
        [key.kind,key.digest]);
      if (previous.rows.some(r=>String(r.customer_id)!==String(customerId))) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO public.safarpro_trial_identity_history(kind,identity_hash,customer_id)
         VALUES ($1,$2,$3) ON CONFLICT (kind,identity_hash) DO NOTHING`,
        [key.kind,key.digest,customerId]);
    }
    await client.query('COMMIT');
    return true;
  } catch(e) {
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally { client.release(); }
}

async function customerAccountSignUp(req, res) {
  if (!method(req, res, ['POST'])) return;
  const b = req.body || {};
  const normalized = normalizeCustomerProfileInput(b);
  if (normalized.error) return json(res, 400, { error: normalized.error });
  const password = String(b.password || '');
  if (password.length < 8 || password.length > 200) return json(res, 400, { error: 'Password must contain at least 8 characters.', code: 'PASSWORD_TOO_SHORT' });
  const email = normalizeCustomerAccountEmail(normalized.profile.email);
  const identity = deviceIdentityFromRequest(req);
  try {
    const [{ data: accountRows, error: accountError }, { data: legacyRows, error: legacyError }] = await Promise.all([
      db().from('customer_accounts').select('id,customer_id,email').ilike('email', email).limit(2),
      db().from('service_customers').select('id,email,business_name,owner_name').ilike('email', email).limit(3),
    ]);
    if (accountError) throw accountError;
    if (legacyError) throw legacyError;
    if ((accountRows || []).length) return json(res, 409, { error: 'This email already has a real estate office account. Use Sign In.', code: 'ACCOUNT_ALREADY_EXISTS' });
    if ((legacyRows || []).length) return json(res, 409, { error: 'This email belongs to an existing real estate office customer. Open the real estate system on the previously authorized browser and secure the account from Profile, then use Sign In here.', code: 'LEGACY_ACCOUNT_NEEDS_CLAIM' });
    if (await trialPreviouslyUsed(normalized.profile, identity)) return json(res, 409, { error: 'A previous trial is associated with this contact or device. Contact the real estate office administrator to review or activate a subscription.', code: 'TRIAL_REVIEW_REQUIRED' });

    const now = new Date();
    const trialEnd = new Date(now.getTime() + (await defaultTrialDays()) * 24 * 60 * 60 * 1000);
    const customerPayload = { ...normalized.profile, trial_started_at: now.toISOString(), trial_ends_at: trialEnd.toISOString(), updated_at: now.toISOString() };
    const { data: customer, error: customerError } = await db().from('service_customers').insert(customerPayload).select('*').single();
    if (customerError) throw customerError;
    const smartOfficeId = await ensureSmartOfficeId(customer);
    const securedCustomer = { ...customer, smart_office_id: smartOfficeId };
    const pwd = customerAccountPasswordRecord(password);
    const { data: account, error: createAccountError } = await db().from('customer_accounts').insert({ customer_id: customer.id, email, password_salt: pwd.salt, password_hash: pwd.hash, last_login_at: now.toISOString() }).select('*').single();
    if (createAccountError) {
      try { await db().from('service_customers').delete().eq('id', customer.id); } catch {}
      throw createAccountError;
    }
    if (!await recordTrialIdentity(normalized.profile, identity, customer.id)) {
      // Collision during concurrent sign-up: do not issue an additional trial.
      await db().from('service_customers').delete().eq('id', customer.id);
      return json(res, 409, { error:'A previous trial is associated with this contact or device. Contact the administrator.', code:'TRIAL_REVIEW_REQUIRED' });
    }
    const token = randomToken();
    const row = await createAccountInstallation(req, securedCustomer, { token, identity, source: 'SIGN_UP' });
    try { await ensureAutomaticCompanyRegistration({ installationId: row.id, customerId: customer.id, profile: normalized.profile }); } catch (companyError) { console.warn('automatic company registration', companyError); }
    try { await applyReferralForCustomer(b.referralCode, customer.id); } catch (referralError) { console.warn('referral signup', referralError); }
    await logCustomerLoginEvent(req, { customerId: customer.id, installationId: row.id, email, eventType: 'SIGN_UP', success: true, identity, metadata: { accountId: account.id } });
    return json(res, 201, { success: true, installationToken: token, installation: { ...await accessPayloadWithBlockReason({ ...row, service_customers: securedCustomer }), customerProfileComplete: true, customerProfile: customerProfileFromRow(securedCustomer), accountProtected: true } });
  } catch (error) {
    console.error('customerAccountSignUp', error);
    const code = String(error?.code || '');
    if (['42P01','42703','PGRST204','PGRST205'].includes(code)) return json(res, 500, { error: 'Customer account database is not installed. Apply server/db/migrations/009_customer_account_sessions.sql.', code: 'ACCOUNT_SCHEMA_MISSING' });
    await logCustomerLoginEvent(req, { email, eventType: 'SIGN_UP', success: false, reason: String(error?.message || 'Unable to create account.'), identity });
    return json(res, 500, { error: 'Unable to create customer account.' });
  }
}

async function customerAccountSignIn(req, res) {
  if (!method(req, res, ['POST'])) return;
  const email = normalizeCustomerAccountEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const identity = deviceIdentityFromRequest(req);
  if (!email || !password) return json(res, 400, { error: 'Email and password are required.' });
  try {
    const { data: rows, error } = await db().from('customer_accounts').select('*').ilike('email', email).limit(2);
    if (error) throw error;
    const account = (rows || []).find((row) => normalizeCustomerAccountEmail(row.email) === email);
    if (!account || String(account.status || 'ACTIVE').toUpperCase() !== 'ACTIVE' || !verifyCustomerAccountPassword(password, account.password_salt, account.password_hash)) {
      await logCustomerLoginEvent(req, { customerId: account?.customer_id || null, email, eventType: 'SIGN_IN_FAILED', success: false, reason: 'Invalid email or password.', identity });
      return json(res, 401, { error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
    }
    const { data: customer, error: customerError } = await db().from('service_customers').select('*').eq('id', account.customer_id).maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return json(res, 404, { error: 'Customer profile not found.' });
    if (String(customer.account_status || 'ACTIVE').toUpperCase() === 'BLOCKED') {
      await logCustomerLoginEvent(req, { customerId: customer.id, email, eventType: 'SIGN_IN_BLOCKED', success: false, reason: 'Customer account is blocked.', identity });
      return json(res, 403, { error: 'This real estate office account is blocked. Contact support.', code: 'CUSTOMER_BLOCKED' });
    }
    const token = randomToken();
    const row = await createAccountInstallation(req, customer, { token, identity, source: 'SIGN_IN' });
    const revoked = await revokeCustomerSessions(customer.id, { exceptInstallationId: row.id, reason: 'Deactivated automatically because the account was signed in from a new browser or device.' });
    await db().from('customer_accounts').update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', account.id);
    await logCustomerLoginEvent(req, { customerId: customer.id, installationId: row.id, email, eventType: 'SIGN_IN', success: true, identity, metadata: { revokedInstallationIds: revoked.map((item) => item.id) } });
    return json(res, 200, { success: true, installationToken: token, revokedSessions: revoked.length, installation: { ...await accessPayloadWithBlockReason({ ...row, service_customers: customer }), customerProfileComplete: customerProfileComplete(customer), customerProfile: customerProfileFromRow(customer), accountProtected: true } });
  } catch (error) {
    console.error('customerAccountSignIn', error);
    const code = String(error?.code || '');
    if (['42P01','42703','PGRST204','PGRST205'].includes(code)) return json(res, 500, { error: 'Customer account database is not installed. Apply server/db/migrations/009_customer_account_sessions.sql.', code: 'ACCOUNT_SCHEMA_MISSING' });
    await logCustomerLoginEvent(req, { email, eventType: 'SIGN_IN_FAILED', success: false, reason: String(error?.message || 'Unable to sign in.'), identity });
    return json(res, 500, { error: 'Unable to sign in.' });
  }
}

async function customerAccountClaim(req, res) {
  if (!method(req, res, ['POST'])) return;
  const installation = await installationFromRequest(req);
  if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
  const customer = installation.service_customers;
  const email = normalizeCustomerAccountEmail(req.body?.email || customer?.email);
  const password = String(req.body?.password || '');
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'A valid email is required.' });
  if (password.length < 8 || password.length > 200) return json(res, 400, { error: 'Password must contain at least 8 characters.' });
  try {
    const { data: existing, error: existingError } = await db().from('customer_accounts').select('*').eq('customer_id', installation.customer_id).maybeSingle();
    if (existingError) throw existingError;
    if (existing) return json(res, 409, { error: 'This customer already has a secured account. Use Sign In on new browsers.', code: 'ACCOUNT_ALREADY_CLAIMED' });
    const { data: emailRows, error: emailError } = await db().from('customer_accounts').select('id,customer_id,email').ilike('email', email).limit(2);
    if (emailError) throw emailError;
    if ((emailRows || []).length) return json(res, 409, { error: 'This email is already linked to another real estate office account.', code: 'EMAIL_ALREADY_USED' });
    const pwd = customerAccountPasswordRecord(password);
    let registeredCompanyId = null;
    try { registeredCompanyId = (await companyForInstallation(installation.id))?.company?.id || null; } catch {}
    const { data: account, error } = await db().from('customer_accounts').insert({ customer_id: installation.customer_id, email, password_salt: pwd.salt, password_hash: pwd.hash, registered_company_id: registeredCompanyId, last_login_at: new Date().toISOString() }).select('*').single();
    if (error) throw error;
    if (normalizeCustomerAccountEmail(customer?.email) !== email) await db().from('service_customers').update({ email, updated_at: new Date().toISOString() }).eq('id', installation.customer_id);
    await logCustomerLoginEvent(req, { customerId: installation.customer_id, installationId: installation.id, email, eventType: 'ACCOUNT_CLAIMED', success: true, identity: deviceIdentityFromRequest(req) });
    await logDeviceEvent(installation.id, 'ACCOUNT_SECURED', 'Customer account secured', 'Email and password sign-in was enabled for this existing real estate office customer.', { accountId: account.id });
    return json(res, 200, { success: true, account: { email: account.email, status: account.status, createdAt: account.created_at } });
  } catch (error) {
    console.error('customerAccountClaim', error);
    const code = String(error?.code || '');
    if (['42P01','42703','PGRST204','PGRST205'].includes(code)) return json(res, 500, { error: 'Customer account database is not installed. Apply server/db/migrations/009_customer_account_sessions.sql.', code: 'ACCOUNT_SCHEMA_MISSING' });
    return json(res, 500, { error: 'Unable to secure this customer account.' });
  }
}

async function customerAccountSecurity(req, res) {
  if (!method(req, res, ['GET'])) return;
  const installation = await installationFromRequest(req);
  if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
  try {
    const [{ data: account, error: accountError }, { data: devices, error: deviceError }, { data: events, error: eventError }] = await Promise.all([
      db().from('customer_accounts').select('id,email,status,created_at,updated_at,last_login_at').eq('customer_id', installation.customer_id).maybeSingle(),
      db().from('installations').select('id,device_code,device_name,browser,operating_system,status,approval_status,session_state,login_ip,last_ip,revoked_at,revoked_reason,last_seen_at,created_at').eq('customer_id', installation.customer_id).is('merged_into_installation_id', null).order('created_at', { ascending: false }).limit(100),
      db().from('customer_login_events').select('*').eq('customer_id', installation.customer_id).order('created_at', { ascending: false }).limit(100),
    ]);
    if (accountError) throw accountError;
    if (deviceError) throw deviceError;
    if (eventError) throw eventError;
    return json(res, 200, {
      account: account ? { email: account.email, status: account.status, createdAt: account.created_at, updatedAt: account.updated_at, lastLoginAt: account.last_login_at } : null,
      currentInstallationId: installation.id,
      devices: (devices || []).map((row) => ({ id: row.id, deviceCode: row.device_code, deviceName: row.device_name || '', browser: row.browser || '', operatingSystem: row.operating_system || '', status: row.status, approvalStatus: row.approval_status, sessionState: row.session_state || 'ACTIVE', loginIp: row.login_ip || '', lastIp: row.last_ip || '', revokedAt: row.revoked_at, revokedReason: row.revoked_reason || '', lastSeenAt: row.last_seen_at, createdAt: row.created_at })),
      events: (events || []).map((row) => ({ id: row.id, eventType: row.event_type, success: row.success, ipAddress: row.ip_address || '', browser: row.browser || '', operatingSystem: row.operating_system || '', reason: row.reason || '', createdAt: row.created_at, installationId: row.installation_id })),
    });
  } catch (error) {
    console.error('customerAccountSecurity', error);
    const code = String(error?.code || '');
    if (['42P01','42703','PGRST204','PGRST205'].includes(code)) return json(res, 500, { error: 'Customer account database is not installed. Apply server/db/migrations/009_customer_account_sessions.sql.', code: 'ACCOUNT_SCHEMA_MISSING' });
    return json(res, 500, { error: 'Unable to load account security information.' });
  }
}

async function adminCustomerSecurity(req, res, customerId) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const [{ data: account, error: ae }, { data: devices, error: de }, { data: events, error: ee }, { data: customer, error: ce }] = await Promise.all([
      db().from('customer_accounts').select('id,email,status,created_at,updated_at,last_login_at').eq('customer_id', customerId).maybeSingle(),
      db().from('installations').select('id,device_code,device_name,browser,operating_system,status,approval_status,session_state,login_ip,last_ip,revoked_at,revoked_reason,last_seen_at,created_at').eq('customer_id', customerId).is('merged_into_installation_id', null).order('created_at', { ascending: false }).limit(150),
      db().from('customer_login_events').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(150),
      db().from('service_customers').select('*').eq('id', customerId).maybeSingle(),
    ]);
    if (ae) throw ae; if (de) throw de; if (ee) throw ee; if (ce) throw ce;
    if (!customer) return json(res, 404, { error: 'Customer not found.' });
    return json(res, 200, {
      customer: { id: customer.id, businessName: customer.business_name || '', ownerName: customer.owner_name || '', email: customer.email || '', phone: customer.phone || '', accountStatus: customer.account_status || 'ACTIVE', smartOfficeId: customer.smart_office_id || '' },
      account: account ? { email: account.email, status: account.status, createdAt: account.created_at, updatedAt: account.updated_at, lastLoginAt: account.last_login_at } : null,
      devices: (devices || []).map((row) => ({ id: row.id, deviceCode: row.device_code, deviceName: row.device_name || '', browser: row.browser || '', operatingSystem: row.operating_system || '', status: row.status, approvalStatus: row.approval_status, sessionState: row.session_state || 'ACTIVE', loginIp: row.login_ip || '', lastIp: row.last_ip || '', revokedAt: row.revoked_at, revokedReason: row.revoked_reason || '', lastSeenAt: row.last_seen_at, createdAt: row.created_at })),
      events: (events || []).map((row) => ({ id: row.id, eventType: row.event_type, success: row.success, email: row.email || '', ipAddress: row.ip_address || '', userAgent: row.user_agent || '', browser: row.browser || '', operatingSystem: row.operating_system || '', reason: row.reason || '', createdAt: row.created_at, installationId: row.installation_id })),
    });
  } catch (error) {
    console.error('adminCustomerSecurity', error);
    const code = String(error?.code || '');
    if (['42P01','42703','PGRST204','PGRST205'].includes(code)) return json(res, 500, { error: 'Customer account database is not installed. Apply server/db/migrations/009_customer_account_sessions.sql.', code: 'ACCOUNT_SCHEMA_MISSING' });
    return json(res, 500, { error: 'Unable to load customer security profile.' });
  }
}

async function recoverInstallation(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    let schemaReady = false;
    try { schemaReady = await hasDeviceIdentitySchema(); }
    catch (schemaError) { console.error('recoverInstallation identity schema', schemaError); }
    if (!schemaReady) return json(res, 404, { error: 'Device recovery is not available until the production migration is applied.', code: 'DEVICE_RECOVERY_UNAVAILABLE' });
    const identity = deviceIdentityFromRequest(req);
    const existingDevice = await findPhysicalDeviceMatch(identity);
    if (!existingDevice || String(existingDevice.session_state || 'ACTIVE').toUpperCase() === 'REVOKED') return json(res, 404, { error: 'This computer does not have an active session. Sign in with your real estate office account.', code: 'DEVICE_NOT_FOUND' });
    const token = randomToken();
    await upsertBrowserInstallation(token, existingDevice.id, identity);
    const linked = await updatePhysicalIdentity(existingDevice.id, identity, { last_license_check_at: new Date().toISOString() });
    await logDeviceEvent(linked.id, 'DEVICE_RECOVERED', 'Device session recovered', 'Real estate system restored this registered computer without asking for company registration again.', { browser: identity.browser || '' });
    return json(res, 200, {
      success: true,
      installationToken: token,
      installation: {
        ...await accessPayloadWithBlockReason(linked),
        customerProfileComplete: customerProfileComplete(linked.service_customers),
        customerProfile: customerProfileFromRow(linked.service_customers),
      },
    });
  } catch (error) {
    console.error('recoverInstallation', error);
    return json(res, 500, { error: 'Unable to recover this registered device.' });
  }
}

async function registerInstallation(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const b = req.body || {};
    const normalizedCustomer = normalizeCustomerProfileInput(b);
    if (normalizedCustomer.error) return json(res, 400, { error: normalizedCustomer.error, code: 'CUSTOMER_PROFILE_REQUIRED' });
    const token = randomToken();
    const identity = deviceIdentityFromRequest(req);
    let identitySchemaReady = false;
    try { identitySchemaReady = await hasDeviceIdentitySchema(); }
    catch (schemaError) { console.error('registerInstallation identity schema', schemaError); }

    // First, reconnect the same physical computer. Clearing browser storage must
    // not create a new company, trial or device approval request.
    if (identitySchemaReady) {
      const existingDevice = await findPhysicalDeviceMatch(identity);
      if (existingDevice) {
        await upsertBrowserInstallation(token, existingDevice.id, identity);
        const linked = await updatePhysicalIdentity(existingDevice.id, identity, {
          last_license_check_at: new Date().toISOString(),
        });
        await logDeviceEvent(linked.id, 'BROWSER_LINKED', 'Browser reconnected', 'This browser was reconnected to an existing real estate office device.', {
          browser: identity.browser || '',
          installationType: identity.installationType || '',
        });
        const savedProfile = await saveCustomerProfile(linked.customer_id, b);
        if (savedProfile.error) return json(res, 400, { error: savedProfile.error, code: 'CUSTOMER_PROFILE_REQUIRED' });
        try { await ensureAutomaticCompanyRegistration({ installationId: linked.id, customerId: linked.customer_id, profile: normalizedCustomer.profile }); } catch (companyError) { console.warn('automatic company registration', companyError); }
        const linkedWithCustomer = { ...linked, service_customers: savedProfile.customer };
        return json(res, 200, {
          success: true,
          linkedExistingDevice: true,
          installationToken: token,
          installation: { ...await accessPayloadWithBlockReason(linkedWithCustomer), customerProfileComplete: true, customerProfile: customerProfileFromRow(savedProfile.customer) },
        });
      }
    }

    if (b.recoveryOnly === true) {
      return json(res, 409, {
        error: 'This device could not be safely reconnected. Connect to the internet and contact support if the problem continues.',
        code: 'DEVICE_RELINK_REQUIRED',
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const trialMilliseconds = (await defaultTrialDays()) * 24 * 60 * 60 * 1000;
    let customer = await findExistingCustomerByEmail(normalizedCustomer.profile.email);
    let isExistingCustomer = Boolean(customer);

    // A second computer using the same company identity never receives a fresh
    // trial. It is registered as PENDING and requires provider approval.
    if (customer) {
      const samePhone = String(customer.phone || '').trim() === String(normalizedCustomer.profile.phone || '').trim();
      const sameCompany = String(customer.business_name || '').trim().toLowerCase() === String(normalizedCustomer.profile.business_name || '').trim().toLowerCase();
      if (!samePhone || !sameCompany) {
        return json(res, 409, {
          error: 'This email is already registered to another company profile. Contact the provider to connect a new device.',
          code: 'CUSTOMER_IDENTITY_MISMATCH',
        });
      }
      customer = await customerTrialWindow(customer.id) || customer;
    } else {
      if (await trialPreviouslyUsed(normalizedCustomer.profile, identity)) {
        return json(res, 409, { error:'This contact or device has already used a free trial. Contact the administrator.', code:'TRIAL_REVIEW_REQUIRED' });
      }
      const reportedLocalStartMs = b.localTrialStartedAt ? new Date(b.localTrialStartedAt).getTime() : 0;
      const validReportedLocalStart = Number.isFinite(reportedLocalStartMs) && reportedLocalStartMs > 0 && reportedLocalStartMs <= now.getTime();
      const trialStart = validReportedLocalStart ? new Date(reportedLocalStartMs) : now;
      const trialEnd = new Date(trialStart.getTime() + trialMilliseconds);
      const customerPayload = {
        ...normalizedCustomer.profile,
        trial_started_at: trialStart.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
        updated_at: nowIso,
      };
      const { data: createdCustomer, error: ce } = await db().from('service_customers').insert(customerPayload).select().single();
      if (ce) throw ce;
      const smartOfficeId = await ensureSmartOfficeId(createdCustomer);
      customer = { ...createdCustomer, smart_office_id: smartOfficeId };
      isExistingCustomer = false;
    }

    const customerTrialStart = new Date(customer.trial_started_at || nowIso);
    const customerTrialEnd = new Date(customer.trial_ends_at || new Date(customerTrialStart.getTime() + trialMilliseconds).toISOString());
    const pending = isExistingCustomer;
    const installPayload = {
      customer_id: customer.id,
      token_hash: hashToken(token),
      device_code: deviceCode(),
      device_name: String(b.deviceName || '').slice(0, 500),
      device_type: b.deviceType || null,
      installation_type: b.installationType || null,
      operating_system: String(b.operatingSystem || '').slice(0, 200),
      browser: String(b.browser || '').slice(0, 800),
      app_version: b.appVersion || null,
      status: pending ? 'PENDING' : 'ACTIVE',
      approval_status: pending ? 'PENDING' : 'APPROVED',
      trial_started_at: customerTrialStart.toISOString(),
      trial_ends_at: customerTrialEnd.toISOString(),
      last_seen_at: nowIso,
      last_license_check_at: nowIso,
    };
    if (identitySchemaReady) {
      installPayload.physical_fingerprint_hash = identity.strongHash;
      installPayload.coarse_fingerprint_hash = identity.coarseHash;
      installPayload.fingerprint_version = identity.version;
      installPayload.fingerprint_strength = identity.strength;
      installPayload.last_network_hash = identity.networkHash;
    }

    const { data: row, error } = await db().from('installations').insert(installPayload).select('*,service_customers(*)').single();
    if (error) throw error;

    if (identitySchemaReady) {
      try { await upsertBrowserInstallation(token, row.id, identity); }
      catch (browserError) { console.error('registerInstallation browser alias', browserError); }
    }

    if (!isExistingCustomer) {
      try { await ensureAutomaticCompanyRegistration({ installationId: row.id, customerId: customer.id, profile: normalizedCustomer.profile }); }
      catch (companyError) { console.warn('automatic company registration', companyError); }
      try { await applyReferralForCustomer(b.referralCode, customer.id); }
      catch (referralError) { console.warn('referral registration', referralError); }
      await logDeviceEvent(row.id, 'REGISTERED', 'Company and device registered', 'The first real estate office device was registered for this company.', { deviceCode: row.device_code });
    } else {
      await logDeviceEvent(row.id, 'DEVICE_APPROVAL_PENDING', 'New device awaiting approval', 'A second device requested access to this company account.', { deviceCode: row.device_code });
    }

    if (!isExistingCustomer && !await recordTrialIdentity(normalizedCustomer.profile, identity, customer.id)) {
      // Mark the newly-created installation pending; never grant another demo.
      await db().from('installations').update({ status:'PENDING', approval_status:'PENDING', trial_ends_at:nowIso }).eq('id',row.id);
      await db().from('service_customers').update({ trial_ends_at:nowIso }).eq('id',customer.id);
      return json(res, 409, {error:'Previous trial detected. Contact the administrator.',code:'TRIAL_REVIEW_REQUIRED'});
    }
    const statusCode = pending ? 202 : 201;
    return json(res, statusCode, {
      success: true,
      linkedExistingDevice: false,
      pendingDeviceApproval: pending,
      installationToken: token,
      installation: {
        ...accessPayload({ ...row, service_customers: customer }),
        customerProfileComplete: true,
        customerProfile: customerProfileFromRow(customer),
      },
    });
  } catch (e) {
    console.error('registerInstallation', e);
    return json(res, 500, { error: 'Unable to register this device.' });
  }
}

async function heartbeat(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    let row = await installationFromRequest(req);
    if (!row) return json(res, 401, { error: 'Invalid installation token.' });
    row = await enforceDeviceBinding(req, row);

    const now = new Date();
    const nowIso = now.toISOString();
    const { data: updated, error } = await db().from('installations').update({
      last_seen_at: nowIso,
      last_license_check_at: nowIso,
      app_version: req.body?.appVersion || row.app_version,
      installation_type: req.body?.installationType || row.installation_type,
      last_ip: customerRequestIp(req),
    }).eq('id', row.id).select('*,service_customers(*)').single();
    if (error) throw error;

    await maybeNotifySubscriptionExpiry(updated);
    return json(res, 200, {
      ...await accessPayloadWithBlockReason(updated, { now }),
      heartbeat: true,
    });
  } catch (e) {
    console.error('heartbeat', e);
    if (e?.code === 'DEVICE_IDENTITY_MISMATCH') return json(res, 403, { error: e.message, code: e.code });
    return json(res, 500, { error: 'Heartbeat failed.' });
  }
}

async function accessCheck(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    let row = await installationFromRequest(req);
    if (!row) return json(res, 401, { error: 'Invalid installation token.' });
    row = await enforceDeviceBinding(req, row);

    const now = new Date();
    const nowIso = now.toISOString();
    const { data: updated, error } = await db().from('installations').update({
      last_seen_at: nowIso,
      last_license_check_at: nowIso,
      last_ip: customerRequestIp(req),
    }).eq('id', row.id).select('*,service_customers(*)').single();
    if (error) throw error;

    await maybeNotifySubscriptionExpiry(updated);
    const payload = await accessPayloadWithBlockReason(updated, { now });
    await db().from('access_events').insert({
      installation_id: row.id,
      access_status: payload.accessStatus,
      allowed: payload.allowed,
    });
    return json(res, 200, payload);
  } catch (e) {
    console.error('accessCheck', e);
    if (e?.code === 'DEVICE_IDENTITY_MISMATCH') return json(res, 403, { error: e.message, code: e.code });
    return json(res, 500, { error: 'Unable to check access.' });
  }
}

async function accessSync(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    let row = await installationFromRequest(req);
    if (!row) return json(res, 401, { error: 'Invalid installation token.' });
    row = await enforceDeviceBinding(req, row, { touch: false });
    // Deliberately read-only after the one-time legacy-device binding: this endpoint is polled by online customer apps
    // so provider block/unblock/grant actions arrive quickly without writing to
    // the database every few seconds. Heartbeat/access-check remain responsible for
    // last-seen and identity maintenance.
    return json(res, 200, {
      ...await accessPayloadWithBlockReason(row, { now: new Date() }),
      customerProfileComplete: customerProfileComplete(row.service_customers),
      customerProfile: customerProfileFromRow(row.service_customers),
    });
  } catch (e) {
    console.error('accessSync', e);
    if (e?.code === 'DEVICE_IDENTITY_MISMATCH') return json(res, 403, { error: e.message, code: e.code });
    return json(res, 500, { error: 'Unable to synchronize access.' });
  }
}

async function customerMessages(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    const row = await installationFromRequest(req);
    if (!row) return json(res, 401, { error: 'Invalid installation token.' });
    if (req.method === 'POST') {
      const message = String(req.body?.message || '').trim();
      let attachment = null;
      try { attachment = parseSupportImageDataUrl(req.body?.attachmentDataUrl); }
      catch (error) { return json(res, 400, { error: error.message }); }
      if ((!message && !attachment) || message.length > 2000) return json(res, 400, { error: 'Add a message or screenshot. Messages can be up to 2000 characters.' });

      let attachmentPath = null;
      if (attachment) {
        await ensureSupportAttachmentBucket();
        attachmentPath = `${row.id}/${Date.now()}-${randomToken().slice(0, 12)}.${attachment.ext}`;
        const bytes = new Uint8Array(attachment.buffer);
        const { error: uploadError } = await db().storage.from('support-attachments').upload(attachmentPath, bytes, { contentType: attachment.mime, upsert: false });
        if (uploadError) throw uploadError;
      }

      const payload = {
        installation_id: row.id,
        sender: 'customer',
        message: message || 'Shared a screenshot',
        attachment_path: attachmentPath,
        attachment_name: cleanText(req.body?.attachmentName, 240),
        attachment_type: attachment?.mime || null,
        attachment_size: attachment?.buffer?.length || null,
      };
      const { data: insertedMessage, error } = await db().from('provider_messages').insert(payload).select('*').single();
      if (error) {
        if (attachmentPath) await db().storage.from('support-attachments').remove([attachmentPath]).catch(() => {});
        throw error;
      }
      const realtimeMessage = await mapProviderMessage(insertedMessage || payload);
      broadcastConversationEvent(row.id, 'message:new', { message: realtimeMessage }, 'admin');
      broadcastConversationEvent(row.id, 'conversation:update', { lastMessage: realtimeMessage.message, lastMessageAt: realtimeMessage.createdAt, unreadDelta: 1 }, 'admin');
      await sendAdminPushSignal();
    }
    const { data, error } = await db().from('provider_messages').select('id,sender,message,created_at,edited_at,reactions,attachment_path,attachment_name,attachment_type,attachment_size,is_read,seen_at').eq('installation_id', row.id).order('created_at', { ascending: true }).limit(500);
    if (error) throw error;
    const seenAt = new Date().toISOString();
    await db().from('provider_messages').update({ is_read: true, seen_at: seenAt }).eq('installation_id', row.id).eq('sender', 'provider').eq('is_read', false);
    broadcastConversationEvent(row.id, 'message:seen', { seenBy: 'customer', seenAt }, 'admin');
    const messages = await Promise.all((data || []).map(mapProviderMessage));
    return json(res, 200, { messages });
  } catch (e) {
    console.error('customerMessages', e);
    const code = String(e?.code || '');
    if (['42703','PGRST204'].includes(code)) return json(res, 500, { error: 'Support attachments schema is not installed. Apply server/db/migrations/003_production_hardening.sql.' });
    return json(res, 500, { error: 'Unable to load messages.' });
  }
}


function normalizeReactionMap(current) {
  const source = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const next = {};
  const seenActors = new Set();
  for (const [emoji, values] of Object.entries(source)) {
    const actors = Array.isArray(values) ? values.filter((actor) => {
      if (!actor || seenActors.has(actor)) return false;
      seenActors.add(actor);
      return true;
    }) : [];
    if (actors.length) next[emoji] = actors;
  }
  return next;
}

function toggleReactionMap(current, emoji, actor) {
  const next = normalizeReactionMap(current);
  const wasSelected = Array.isArray(next[emoji]) && next[emoji].includes(actor);

  // A customer/provider can have only one active reaction per message.
  for (const key of Object.keys(next)) {
    const actors = Array.isArray(next[key]) ? next[key].filter((value) => value !== actor) : [];
    if (actors.length) next[key] = actors;
    else delete next[key];
  }

  // Clicking the currently selected emoji removes it; choosing another replaces it.
  if (!wasSelected) {
    const actors = Array.isArray(next[emoji]) ? [...next[emoji]] : [];
    actors.push(actor);
    next[emoji] = Array.from(new Set(actors));
  }

  return next;
}

async function customerMessageAction(req, res, messageId, reaction = false) {
  if (!method(req, res, reaction ? ['POST'] : ['PATCH', 'DELETE'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
    const { data: messageRow, error: readError } = await db().from('provider_messages').select('*').eq('id', messageId).eq('installation_id', installation.id).maybeSingle();
    if (readError) throw readError;
    if (!messageRow) return json(res, 404, { error: 'Message not found.' });
    if (reaction) {
      const emoji = String(req.body?.emoji || '').trim().slice(0, 16);
      if (!emoji) return json(res, 400, { error: 'Emoji is required.' });
      const reactions = toggleReactionMap(messageRow.reactions, emoji, 'customer');
      const { error } = await db().from('provider_messages').update({ reactions }).eq('id', messageId);
      if (error) throw error;
      return json(res, 200, { success: true, reactions });
    }
    if (messageRow.sender !== 'customer') return json(res, 403, { error: 'You can only change your own messages.' });
    if (req.method === 'DELETE') {
      const { error } = await db().from('provider_messages').delete().eq('id', messageId);
      if (error) throw error;
      if (messageRow.attachment_path) await db().storage.from('support-attachments').remove([messageRow.attachment_path]).catch(() => {});
      return json(res, 200, { success: true });
    }
    const message = String(req.body?.message || '').trim();
    if (!message || message.length > 2000) return json(res, 400, { error: 'Message must be between 1 and 2000 characters.' });
    const { error } = await db().from('provider_messages').update({ message, edited_at: new Date().toISOString() }).eq('id', messageId);
    if (error) throw error;
    return json(res, 200, { success: true });
  } catch (e) {
    console.error('customerMessageAction', e);
    return json(res, 500, { error: 'Unable to update message.' });
  }
}


async function customerPaymentRequests(req, res) {
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });

    if (req.method === 'GET') {
      const { data, error } = await db().from('payment_requests')
        .select('*,subscription_plans(*),payment_methods(*)')
        .eq('installation_id', installation.id)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return json(res, 200, { paymentRequests: (data || []).map(mapPaymentRequest) });
    }
    if (!method(req, res, ['POST'])) return;

    const body = req.body || {};
    const planId = String(body.planId || '').trim();
    const paymentMethodId = String(body.paymentMethodId || '').trim();
    const reference = cleanText(body.transactionReference, 180);
    const note = cleanText(body.note, 1000);
    if (!planId || !paymentMethodId) return json(res, 400, { error: 'Select a plan and payment method.' });

    const [{ data: plan, error: pe }, { data: paymentMethod, error: me }] = await Promise.all([
      db().from('subscription_plans').select('*').eq('id', planId).eq('is_active', true).maybeSingle(),
      db().from('payment_methods').select('*').eq('id', paymentMethodId).eq('is_active', true).maybeSingle(),
    ]);
    if (pe) throw pe;
    if (me) throw me;
    if (!plan || !paymentMethod) return json(res, 400, { error: 'The selected plan or payment method is unavailable.' });

    const requestedCreditAfn = Math.max(0, Number(body.creditToApply || 0));
    const creditSummary = await getCreditSummary(db(), installation.customer_id);
    if (requestedCreditAfn > Number(plan.amount || 0)) return json(res, 400, { error: 'Credit cannot be greater than the plan price.' });
    if (requestedCreditAfn > Number(creditSummary.balance || 0)) return json(res, 400, { error: 'Your available credit is not enough.' });
    const cashAmountDue = Math.max(0, Number(plan.amount || 0) - requestedCreditAfn);

    const { data: existing, error: ee } = await db().from('payment_requests')
      .select('id,status')
      .eq('installation_id', installation.id)
      .in('status', ['PENDING','PROCESSING'])
      .limit(1)
      .maybeSingle();
    if (ee) throw ee;
    if (existing) return json(res, 409, { error: 'You already have a payment request waiting for review.' });

    let receipt = null;
    try { receipt = parseReceiptDataUrl(body.receiptDataUrl); }
    catch (error) { return json(res, 400, { error: error.message }); }
    if (cashAmountDue > 0 && !reference && !receipt) return json(res, 400, { error: 'Add a transaction/reference number or upload a payment receipt.' });

    let receiptPath = null;
    let receiptFallbackData = null;
    let receiptMime = null;
    let receiptWarning = '';

    if (receipt) {
      receiptMime = receipt.mime;
      receiptPath = `${installation.id}/${Date.now()}-${randomToken().slice(0, 12)}.${receipt.ext}`;
      try {
        await ensurePaymentReceiptBucket();
        const bytes = new Uint8Array(receipt.buffer);
        const { error: uploadError } = await db().storage.from('payment-receipts').upload(receiptPath, bytes, { contentType: receipt.mime, upsert: false });
        if (uploadError) throw uploadError;
      } catch (uploadError) {
        console.error('payment receipt upload fallback', uploadError);
        receiptFallbackData = String(body.receiptDataUrl || '');
        receiptPath = null;
        receiptWarning = 'Receipt storage used the secure database fallback.';
      }
    }

    const { data, error } = await db().from('payment_requests').insert({
      installation_id: installation.id,
      plan_id: plan.id,
      payment_method_id: paymentMethod.id,
      amount: cashAmountDue,
      requested_credit_afn: requestedCreditAfn,
      currency: plan.currency || 'AFN',
      transaction_reference: reference,
      customer_note: note,
      receipt_path: receiptPath,
      receipt_fallback_data: receiptFallbackData,
      receipt_mime: receiptMime,
      status: 'PENDING',
    }).select('*,subscription_plans(*),payment_methods(*)').single();
    if (error) {
      if (receiptPath) await db().storage.from('payment-receipts').remove([receiptPath]).catch(()=>{});
      console.error('payment request insert', error);
      const code = String(error.code || '');
      if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) {
        return json(res, 500, { error: 'Payment database is not fully upgraded. Apply server/db/migrations/001_central_schema.sql to PostgreSQL.' });
      }
      return json(res, 500, { error: 'Unable to save the payment request. Please try again.' });
    }
    await logDeviceEvent(installation.id, 'PAYMENT_SUBMITTED', 'Payment submitted', `Payment request submitted for ${plan.title}.`, { paymentRequestId: data.id, planId: plan.id, amount: Number(plan.amount || 0), currency: plan.currency || 'AFN' });
    return json(res, 201, { success: true, paymentRequest: mapPaymentRequest(data), warning: receiptWarning || undefined });
  } catch (e) {
    console.error('customerPaymentRequests', e);
    const code = String(e?.code || '');
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) {
      return json(res, 500, { error: 'Payment database is not fully upgraded. Apply server/db/migrations/001_central_schema.sql to PostgreSQL.' });
    }
    return json(res, 500, { error: 'Unable to submit payment request. Please retry.' });
  }
}

async function adminPaymentRequests(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const status = String(req.query?.status || '').toUpperCase();
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize || 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query = db().from('payment_requests')
      .select('*,subscription_plans(*),payment_methods(*),installations(id,device_code,display_name,device_name,profile_name,profile_logo,service_customers(smart_office_id,business_name,owner_name))', { count: 'exact' })
      .order('created_at', { ascending: false });
    if (['PENDING','PROCESSING','APPROVED','REJECTED'].includes(status)) query = query.eq('status', status);
    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    const installationIds = (data || []).map((row) => row.installation_id).filter(Boolean);
    const companyIdentity = await registeredCompanyIdentityMap(installationIds);
    const paymentRequests = (data || []).map((row) => {
      const mapped = mapPaymentRequest(row);
      const company = companyIdentity.get(String(row.installation_id));
      if (mapped.device) {
        mapped.device.businessName = company?.company_name || mapped.device.businessName || row.installations?.profile_name || '';
        mapped.device.ownerName = company?.owner_name || mapped.device.ownerName || '';
        mapped.device.profileLogo = row.installations?.profile_logo || '';
      }
      return mapped;
    });
    return json(res, 200, { paymentRequests, total: Number(count || 0), page, pageSize });
  } catch (e) {
    console.error('adminPaymentRequests', e);
    return json(res, 500, { error: 'Unable to load payment requests.' });
  }
}

async function adminPaymentReceipt(req, res, requestId) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const { data: row, error } = await db().from('payment_requests').select('receipt_path,receipt_fallback_data,receipt_mime').eq('id', requestId).maybeSingle();
    if (error) throw error;
    if (row?.receipt_path) {
      const { data, error: signError } = await db().storage.from('payment-receipts').createSignedUrl(row.receipt_path, 300);
      if (!signError && data?.signedUrl) return json(res, 200, { url: data.signedUrl, expiresIn: 300 });
      console.error('receipt signed url', signError);
    }
    if (row?.receipt_fallback_data) return json(res, 200, { url: row.receipt_fallback_data, fallback: true, mime: row.receipt_mime || null });
    return json(res, 404, { error: 'No receipt is attached.' });
  } catch (e) {
    console.error('adminPaymentReceipt', e);
    return json(res, 500, { error: 'Unable to open payment receipt.' });
  }
}

async function adminReviewPaymentRequest(req, res, requestId, action) {
  const adminSession = requireAdmin(req, res);
  if (!method(req, res, ['POST']) || !adminSession) return;
  try {
    const { data: requestRow, error: re } = await db().from('payment_requests')
      .select('*,subscription_plans(*),payment_methods(*)').eq('id', requestId).maybeSingle();
    if (re) throw re;
    if (!requestRow) return json(res, 404, { error: 'Payment request not found.' });
    if (requestRow.status === 'APPROVED') return json(res, 200, { success: true, alreadyApproved: true, paymentRequest: mapPaymentRequest(requestRow) });
    if (requestRow.status === 'REJECTED') return json(res, 409, { error: 'This request was already rejected.' });

    const { data: existingSubscription, error: existingSubError } = await db().from('subscriptions')
      .select('id,installation_id,starts_at,expires_at').eq('payment_request_id', requestId).maybeSingle();
    if (existingSubError) throw existingSubError;
    if (existingSubscription) {
      const { data: healInstallation, error: healLookupError } = await db().from('installations').select('customer_id').eq('id', existingSubscription.installation_id).maybeSingle();
      if (healLookupError) throw healLookupError;
      const { error: healError } = await db().from('installations').update({
        status: 'ACTIVE', approval_status: 'APPROVED', subscription_expires_at: existingSubscription.expires_at, access_version: Date.now(),
      }).eq('id', existingSubscription.installation_id);
      if (healError) throw healError;
      if (healInstallation?.customer_id) await propagateCompanyEntitlement(healInstallation.customer_id, existingSubscription.expires_at);
      const reviewedAt = new Date().toISOString();
      const { data: healed, error: healRequestError } = await db().from('payment_requests').update({
        status: 'APPROVED', reviewed_at: reviewedAt, approved_expires_at: existingSubscription.expires_at, updated_at: reviewedAt,
      }).eq('id', requestId).select('*,subscription_plans(*),payment_methods(*)').single();
      if (healRequestError) throw healRequestError;
      return json(res, 200, { success: true, alreadyApproved: true, paymentRequest: mapPaymentRequest(healed), access: { startsAt: existingSubscription.starts_at, expiresAt: existingSubscription.expires_at } });
    }

    const adminNote = cleanText(req.body?.note, 1000);
    if (action === 'reject') {
      const { data, error } = await db().from('payment_requests').update({ status: 'REJECTED', admin_note: adminNote, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', requestId).in('status', ['PENDING','PROCESSING']).select('*,subscription_plans(*),payment_methods(*)').single();
      if (error) throw error;
      await logDeviceEvent(requestRow.installation_id, 'PAYMENT_REJECTED', 'Payment rejected', adminNote || `Payment request for ${requestRow.subscription_plans?.title || 'a plan'} was rejected.`, { paymentRequestId: requestId });
      await recordAdminAudit(req, adminSession, { action: 'PAYMENT_REJECTED', category: 'PAYMENT', entityType: 'payment_request', entityId: requestId, summary: `Rejected payment request ${requestId}`, metadata: { installationId: requestRow.installation_id, amount: Number(requestRow.amount || 0), currency: requestRow.currency || 'AFN', note: adminNote }, severity: 'WARNING' });
      await notifyInstallation(requestRow.installation_id, 'PAYMENT_REJECTED', 'Payment was not approved', adminNote || `Your payment for ${requestRow.subscription_plans?.title || 'the selected plan'} was rejected.`, '/subscription', { paymentRequestId: requestId });
      return json(res, 200, { success: true, paymentRequest: mapPaymentRequest(data) });
    }

    const { data: claimed, error: claimError } = await db().from('payment_requests').update({ status: 'PROCESSING', updated_at: new Date().toISOString() }).eq('id', requestId).eq('status', 'PENDING').select('id').maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return json(res, 409, { error: 'This payment request is already being processed.' });

    try {
      const plan = requestRow.subscription_plans;
      if (!plan) throw new Error('Subscription plan is missing.');
      const { data: installation, error: ie } = await db().from('installations').select('*').eq('id', requestRow.installation_id).maybeSingle();
      if (ie) throw ie;
      if (!installation) throw new Error('Installation not found.');
      const now = new Date();
      const isLifetime = Boolean(plan.is_lifetime || plan.duration_unit === 'LIFETIME');
      const existingExpiry = installation.subscription_expires_at ? new Date(installation.subscription_expires_at) : null;
      const start = isLifetime ? now : (existingExpiry && existingExpiry > now ? existingExpiry : now);
      const expires = isLifetime ? null : addAccessDuration(start, Number(plan.duration_value || 1), plan.duration_unit || 'MONTH');

      const finalized = await finalizePlanPaymentWithCredit({
        requestId,
        installationId: installation.id,
        customerId: installation.customer_id,
        planId: plan.id,
        paymentMethodId: requestRow.payment_method_id,
        cashAmount: Number(requestRow.amount || 0),
        currency: requestRow.currency || plan.currency || 'AFN',
        requestedCreditAfn: Number(requestRow.requested_credit_afn || 0),
        startsAt: start.toISOString(),
        expiresAt: expires ? expires.toISOString() : null,
        isLifetime,
        note: `Payment approved: ${plan.title}`,
      });
      try { if (isLifetime) await propagateCompanyLifetimeAccess(installation.customer_id); else await propagateCompanyEntitlement(installation.customer_id, expires); } catch (propagateError) { console.error('propagateCompanyEntitlement after payment', propagateError); }
      await db().from('payment_requests').update({ admin_note: adminNote }).eq('id', requestId);
      const { data: approved, error: ae } = await db().from('payment_requests').select('*,subscription_plans(*),payment_methods(*)').eq('id', requestId).single();
      if (ae) throw ae;
      try { await awardPlanReferralForCustomer(installation.customer_id, plan, requestId); } catch (rewardError) { console.error('referral plan reward', rewardError); }
      await logDeviceEvent(installation.id, 'PAYMENT_APPROVED', 'Payment approved & access activated', adminNote || `${plan.title} approved. Access activated automatically.`, { paymentRequestId: requestId, planId: plan.id, startsAt: start.toISOString(), expiresAt: expires ? expires.toISOString() : null, isLifetime, amount: Number(requestRow.amount || 0), currency: requestRow.currency || 'AFN' });
      await recordAdminAudit(req, adminSession, { action: 'PAYMENT_APPROVED', category: 'PAYMENT', entityType: 'payment_request', entityId: requestId, summary: `Approved payment for ${plan.title}`, metadata: { installationId: installation.id, planId: plan.id, amount: Number(requestRow.amount || 0), currency: requestRow.currency || 'AFN', expiresAt: expires ? expires.toISOString() : null, isLifetime } });
      await notifyInstallation(installation.id, 'PAYMENT_APPROVED', 'Payment approved', `${plan.title} has been activated. Your access is ready now.`, '/', { paymentRequestId: requestId, expiresAt: expires ? expires.toISOString() : null, isLifetime });
      return json(res, 200, { success: true, paymentRequest: mapPaymentRequest(approved), access: { startsAt: start.toISOString(), expiresAt: expires ? expires.toISOString() : null, isLifetime } });
    } catch (inner) {
      await db().from('payment_requests').update({ status: 'PENDING', updated_at: new Date().toISOString() }).eq('id', requestId).eq('status', 'PROCESSING');
      throw inner;
    }
  } catch (e) {
    console.error('adminReviewPaymentRequest', e);
    return json(res, 500, { error: 'Unable to review payment request.' });
  }
}

async function customerSubscription(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const row = await installationFromRequest(req);
    if (!row) return json(res, 401, { error: 'Invalid installation token.' });
    const [{ data: plans, error: planError }, { data: methods, error: methodError }] = await Promise.all([
      db().from('subscription_plans').select('*').eq('is_active', true).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      db().from('payment_methods').select('*').eq('is_active', true).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    ]);
    if (planError) throw planError;
    if (methodError) throw methodError;
    const { data: companyInstallations, error: companyInstallationsError } = await db().from('installations').select('id').eq('customer_id', row.customer_id);
    if (companyInstallationsError) throw companyInstallationsError;
    const companyInstallationIds = (companyInstallations || []).map((item) => item.id).filter(Boolean);
    const { data: requests } = companyInstallationIds.length
      ? await db().from('payment_requests').select('*,subscription_plans(*),payment_methods(*)').in('installation_id', companyInstallationIds).order('created_at', { ascending: false }).limit(20)
      : { data: [] };
    const { data: activeSubs } = companyInstallationIds.length
      ? await db().from('subscriptions').select('*,subscription_plans(*)').in('installation_id', companyInstallationIds).order('created_at', { ascending: false }).limit(50)
      : { data: [] };
    const credit = await getCreditSummary(db(), row.customer_id);
    const currentSub = (activeSubs || []).find((x) => x.is_lifetime) || (activeSubs || [])[0] || null;
    return json(res, 200, {
      plans: (plans || []).map(mapPlan),
      paymentMethods: (methods || []).map(mapPaymentMethod),
      paymentRequests: (requests || []).map(mapPaymentRequest),
      creditBalance: Number(credit.balance || 0),
      creditSummary: credit,
      subscription: row.lifetime_access ? {
        status: 'ACTIVE',
        startsAt: currentSub?.starts_at || null,
        expiresAt: null,
        isLifetime: true,
        plan: currentSub?.subscription_plans ? mapPlan(currentSub.subscription_plans) : null,
      } : row.subscription_expires_at ? {
        status: new Date(row.subscription_expires_at) > new Date() ? 'ACTIVE' : 'EXPIRED',
        startsAt: currentSub?.starts_at || null,
        expiresAt: row.subscription_expires_at,
        isLifetime: false,
        plan: currentSub?.subscription_plans ? mapPlan(currentSub.subscription_plans) : null,
      } : null,
      access: accessPayload(row),
    });
  } catch (e) {
    console.error('customerSubscription', e);
    return json(res, 500, { error: 'Unable to load subscription.' });
  }
}

async function customerCreditSummary(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
    await ensureSmartOfficeId(installation.customer_id);
    return json(res, 200, { summary: await getCreditSummary(db(), installation.customer_id) });
  } catch (error) { console.error('customerCreditSummary', error); return json(res, 500, { error: 'Unable to load credit summary.' }); }
}

async function customerCreditLedger(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
    const page=Math.max(1,Number(req.query?.page||1)); const pageSize=Math.min(100,Math.max(10,Number(req.query?.pageSize||20))); const offset=(page-1)*pageSize;
    const result=await pgPool().query(`SELECT l.*, c.smart_office_id AS related_smart_office_id, c.business_name AS related_company_name, c.owner_name AS related_owner_name
      FROM public.credit_ledger l LEFT JOIN public.service_customers c ON c.id=l.related_customer_id
      WHERE l.customer_id=$1 ORDER BY l.created_at DESC LIMIT $2 OFFSET $3`,[installation.customer_id,pageSize,offset]);
    const count=await pgPool().query('SELECT count(*)::int AS n FROM public.credit_ledger WHERE customer_id=$1',[installation.customer_id]);
    return json(res,200,{rows:result.rows.map(r=>({id:r.id,transactionId:r.transaction_id,type:r.entry_type,direction:r.direction,amount:Number(r.amount||0),balanceAfter:Number(r.balance_after||0),relatedSmartOfficeId:r.related_smart_office_id||'',relatedCompanyName:r.related_company_name||'',relatedOwnerName:r.related_owner_name||'',note:r.note||'',createdAt:r.created_at})),page,pageSize,total:Number(count.rows[0]?.n||0)});
  } catch(error){console.error('customerCreditLedger',error);return json(res,500,{error:'Unable to load credit history.'});}
}

async function customerReferrals(req,res){
  if(!method(req,res,['GET']))return;
  try{const installation=await installationFromRequest(req);if(!installation)return json(res,401,{error:'Invalid installation token.'});
    const result=await pgPool().query(`SELECT r.id,r.registered_at,c.smart_office_id,c.business_name,c.owner_name,
      EXISTS(SELECT 1 FROM public.credit_ledger l WHERE l.customer_id=r.referrer_customer_id AND l.related_customer_id=r.referred_customer_id AND l.entry_type='REFERRAL_PLAN_REWARD') AS purchased_plan
      FROM public.referral_relationships r JOIN public.service_customers c ON c.id=r.referred_customer_id WHERE r.referrer_customer_id=$1 ORDER BY r.created_at DESC`,[installation.customer_id]);
    return json(res,200,{referrals:result.rows.map(r=>({id:r.id,smartOfficeId:r.smart_office_id||'',companyName:r.business_name||'',displayName:r.owner_name||r.business_name||'',registeredAt:r.registered_at,purchasedPlan:Boolean(r.purchased_plan)}))});
  }catch(error){console.error('customerReferrals',error);return json(res,500,{error:'Unable to load referrals.'});}
}

async function customerCreditRecipient(req,res,smartOfficeId){
  if(!method(req,res,['GET']))return;
  try{const installation=await installationFromRequest(req);if(!installation)return json(res,401,{error:'Invalid installation token.'}); const code=String(smartOfficeId||'').trim().toUpperCase();
    const {data,error}=await db().from('service_customers').select('id,smart_office_id,business_name,owner_name').ilike('smart_office_id',code).maybeSingle(); if(error)throw error; if(!data)return json(res,404,{error:'Real Estate Office ID was not found.'}); if(String(data.id)===String(installation.customer_id))return json(res,400,{error:'You cannot transfer credit to your own account.'});
    return json(res,200,{recipient:{smartOfficeId:data.smart_office_id,displayName:data.owner_name||data.business_name||'',companyName:data.business_name||''}});
  }catch(error){console.error('customerCreditRecipient',error);return json(res,500,{error:'Unable to find this Real Estate Office ID.'});}
}

async function customerCreditTransfer(req,res){
  if(!method(req,res,['POST']))return;
  try{const installation=await installationFromRequest(req);if(!installation)return json(res,401,{error:'Invalid installation token.'}); const result=await transferCredit(db(),{senderCustomerId:installation.customer_id,recipientSmartOfficeId:req.body?.recipientSmartOfficeId,amount:req.body?.amount}); return json(res,201,{success:true,transfer:result,summary:await getCreditSummary(db(),installation.customer_id)});
  }catch(error){console.error('customerCreditTransfer',error);const status=['RECIPIENT_NOT_FOUND'].includes(String(error?.code||''))?404:['SELF_TRANSFER','INVALID_AMOUNT','INSUFFICIENT_CREDIT'].includes(String(error?.code||''))?400:500;return json(res,status,{error:error?.message||'Unable to transfer credit.',code:error?.code});}
}

async function adminCredits(req, res) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession || !method(req, res, ['GET'])) return;
  try {
    const page=Math.max(1,Number(req.query?.page||1)); const pageSize=Math.min(100,Math.max(10,Number(req.query?.pageSize||20))); const offset=(page-1)*pageSize; const q=String(req.query?.q||'').trim();
    const params=[]; let where='';
    if(q){params.push(`%${q}%`);where=`WHERE c.business_name ILIKE $1 OR c.owner_name ILIKE $1 OR c.email ILIKE $1 OR c.smart_office_id ILIKE $1`;}
    params.push(pageSize,offset); const limitIndex=params.length-1, offsetIndex=params.length;
    const rows=await pgPool().query(`SELECT c.id,c.smart_office_id,c.business_name,c.owner_name,c.email,COALESCE(a.balance,0) balance,
      COALESCE((SELECT sum(l.amount) FROM public.credit_ledger l WHERE l.customer_id=c.id AND l.direction='credit' AND l.entry_type<>'TRANSFER_RECEIVED'),0) total_earned,
      COALESCE((SELECT sum(l.amount) FROM public.credit_ledger l WHERE l.customer_id=c.id AND l.entry_type='PLAN_CREDIT_REDEMPTION'),0) total_redeemed,
      COALESCE((SELECT sum(l.amount) FROM public.credit_ledger l WHERE l.customer_id=c.id AND l.entry_type='TRANSFER_SENT'),0) total_sent,
      COALESCE((SELECT sum(l.amount) FROM public.credit_ledger l WHERE l.customer_id=c.id AND l.entry_type='TRANSFER_RECEIVED'),0) total_received,
      (SELECT count(*) FROM public.referral_relationships r WHERE r.referrer_customer_id=c.id) referral_registrations,
      (SELECT count(*) FROM public.credit_ledger l WHERE l.customer_id=c.id AND l.entry_type='REFERRAL_PLAN_REWARD') referral_purchases
      FROM public.service_customers c LEFT JOIN public.credit_accounts a ON a.customer_id=c.id ${where} ORDER BY c.created_at DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,params);
    const countParams=q?[`%${q}%`]:[]; const count=await pgPool().query(`SELECT count(*)::int n FROM public.service_customers c ${where}`,countParams);
    return json(res,200,{rows:rows.rows.map(r=>({id:r.id,smartOfficeId:r.smart_office_id||'',companyName:r.business_name||'',displayName:r.owner_name||'',email:r.email||'',balance:Number(r.balance||0),totalEarned:Number(r.total_earned||0),totalRedeemed:Number(r.total_redeemed||0),totalSent:Number(r.total_sent||0),totalReceived:Number(r.total_received||0),referralRegistrations:Number(r.referral_registrations||0),referralPurchases:Number(r.referral_purchases||0)})),page,pageSize,total:Number(count.rows[0]?.n||0)});
  } catch(error){console.error('adminCredits',error);return json(res,500,{error:'Unable to load credit accounts.'});}
}

async function adminCreditDetail(req,res,customerId){
  const adminSession=requireAdmin(req,res); if(!adminSession||!method(req,res,['GET']))return;
  try{const summary=await getCreditSummary(db(),customerId); const customer=await pgPool().query('SELECT id,smart_office_id,business_name,owner_name,email,phone FROM public.service_customers WHERE id=$1',[customerId]); if(!customer.rows[0])return json(res,404,{error:'Customer not found.'}); const ledger=await pgPool().query('SELECT * FROM public.credit_ledger WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 250',[customerId]); return json(res,200,{customer:{id:customer.rows[0].id,smartOfficeId:customer.rows[0].smart_office_id||'',companyName:customer.rows[0].business_name||'',displayName:customer.rows[0].owner_name||'',email:customer.rows[0].email||'',phone:customer.rows[0].phone||''},summary,ledger:ledger.rows.map(r=>({id:r.id,transactionId:r.transaction_id,type:r.entry_type,direction:r.direction,amount:Number(r.amount||0),balanceAfter:Number(r.balance_after||0),note:r.note||'',createdAt:r.created_at}))});}catch(error){console.error('adminCreditDetail',error);return json(res,500,{error:'Unable to load credit account.'});}
}

async function adminCreditAdjustment(req,res,customerId){
  const adminSession=requireAdmin(req,res); if(!adminSession||!method(req,res,['POST']))return;
  const direction=String(req.body?.direction||'').toLowerCase(); const amount=Math.round(Math.abs(Number(req.body?.amount||0))*100)/100; const reason=cleanText(req.body?.reason,500);
  if(!['credit','debit'].includes(direction)||!(amount>0)||!reason)return json(res,400,{error:'Direction, positive amount and reason are required.'});
  const client=await pgPool().connect();
  try{await client.query('BEGIN');await client.query('INSERT INTO public.credit_accounts(customer_id,balance) VALUES($1,0) ON CONFLICT(customer_id) DO NOTHING',[customerId]);const locked=await client.query('SELECT balance FROM public.credit_accounts WHERE customer_id=$1 FOR UPDATE',[customerId]);if(!locked.rows[0])throw new Error('Customer credit account not found.');const current=Number(locked.rows[0].balance||0);const next=direction==='credit'?current+amount:current-amount;if(next<0){await client.query('ROLLBACK');return json(res,400,{error:'Debit cannot exceed the available balance.'});}await client.query('UPDATE public.credit_accounts SET balance=$2,updated_at=now() WHERE customer_id=$1',[customerId,next]);const entry=await client.query(`INSERT INTO public.credit_ledger(customer_id,entry_type,direction,amount,balance_after,note,actor_admin_id) VALUES($1,'ADMIN_ADJUSTMENT',$2,$3,$4,$5,$6) RETURNING *`,[customerId,direction,amount,next,reason,adminSession.email]);await client.query('COMMIT');await recordAdminAudit(req,adminSession,{action:'CREDIT_ADJUSTMENT',category:'BILLING',entityType:'service_customer',entityId:customerId,summary:`${direction} ${amount} AFN credit`,metadata:{direction,amount,reason,balanceAfter:next}});return json(res,201,{success:true,entry:entry.rows[0],balance:next});}catch(error){try{await client.query('ROLLBACK')}catch{}console.error('adminCreditAdjustment',error);return json(res,500,{error:'Unable to adjust credit.'});}finally{client.release();}
}

async function adminLogin(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (email !== String(process.env.ADMIN_EMAIL || '').trim().toLowerCase() || password !== String(process.env.ADMIN_PASSWORD || '')) {
      return json(res, 401, { error: 'Invalid admin email or password.' });
    }
    const token = makeAdminToken(email);
    res.setHeader('Set-Cookie', adminCookie(token));
    await recordAdminAudit(req, { email, role: 'SUPER_ADMIN' }, { action: 'ADMIN_LOGIN', category: 'SECURITY', entityType: 'admin', entityId: email, summary: 'Provider admin signed in' });
    return json(res, 200, { accessToken: token, admin: { id: 'provider-admin', email, role: 'SUPER_ADMIN', name: 'Provider Admin' } });
  } catch (e) {
    console.error('adminLogin', e);
    return json(res, 500, { error: 'Unable to start admin session.' });
  }
}

function adminLogout(req, res) {
  if (!method(req, res, ['POST'])) return;
  res.setHeader('Set-Cookie', adminCookie('', 0));
  return json(res, 200, { success: true });
}

function adminRefresh(req, res) {
  if (!method(req, res, ['POST'])) return;
  const old = verifyAdminToken(readCookie(req, 'sp_admin'));
  if (!old) return json(res, 401, { error: 'Management session expired.' });
  const token = makeAdminToken(old.email);
  res.setHeader('Set-Cookie', adminCookie(token));
  return json(res, 200, { accessToken: token, admin: { id: 'provider-admin', email: old.email, role: 'SUPER_ADMIN', name: 'Provider Admin' } });
}

async function adminInstallations(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const { data, error } = await db().from('installations').select('*,service_customers(*)').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    const visibleRows = (data || []).filter((r) => !r.merged_into_installation_id);
    let browserCounts = new Map();
    try {
      if (await hasDeviceIdentitySchema()) {
        const { data: browserRows, error: browserError } = await db().from('browser_installations').select('installation_id');
        if (browserError) throw browserError;
        browserCounts = new Map();
        for (const item of browserRows || []) browserCounts.set(item.installation_id, (browserCounts.get(item.installation_id) || 0) + 1);
      }
    } catch (browserError) {
      console.error('adminInstallations browser count', browserError);
    }
    const companyIdentity = await registeredCompanyIdentityMap(visibleRows.map((row) => row.id));
    return json(res, 200, visibleRows.map(r => {
      const company = companyIdentity.get(String(r.id));
      const companyName = company?.company_name || r.service_customers?.business_name || '';
      return ({
      id: r.id,
      customerId: r.customer_id,
      deviceCode: r.device_code,
      companyId: company?.id || null,
      companyCode: company?.company_code || '',
      businessName: companyName,
      ownerName: company?.owner_name || r.service_customers?.owner_name,
      email: company?.email && !String(company.email).endsWith('@safarpro.local') ? company.email : (r.service_customers?.email || ''),
      phone: company?.phone || r.service_customers?.phone,
      address: company?.address || '',
      country: company?.country || r.service_customers?.country,
      city: company?.city || r.service_customers?.city,
      deviceName: r.device_name,
      displayName: r.display_name || '',
      profileName: companyName || r.profile_name || r.service_customers?.owner_name || r.display_name || r.device_code || '',
      profileLogo: r.profile_logo || '',
      deviceType: r.device_type,
      installationType: r.installation_type,
      operatingSystem: r.operating_system,
      browser: r.browser,
      appVersion: r.app_version,
      status: r.status,
      lastSeenAt: r.last_seen_at,
      trialEndsAt: r.trial_ends_at,
      subscriptionExpiresAt: r.subscription_expires_at,
      approximateOnlineStatus: r.last_seen_at && Date.now() - new Date(r.last_seen_at).getTime() < 90000 ? 'Online' : 'Offline',
      physicalDeviceId: r.physical_device_id || r.id,
      browserCount: browserCounts.get(r.id) || 1,
      ...accessPayload(r),
    });
    }));
  } catch (e) {
    console.error('adminInstallations', e);
    return json(res, 500, { error: 'Unable to load installations.' });
  }
}


// Create a real customer account. Manual company directory entries are not login accounts.
// Keep this separate from company registration; do not create a session/device for the admin's browser.
async function adminCreateCustomer(req, res) {
  const session = requireAdmin(req, res);
  if (!session || !method(req, res, ['POST'])) return;
  const normalized = normalizeCustomerProfileInput(req.body || {});
  if (normalized.error) return json(res, 400, { error: normalized.error });
  const password = String(req.body?.password || '');
  if (password.length < 8 || password.length > 200) return json(res, 400, { error: 'Password must contain 8 to 200 characters.' });
  const profile = normalized.profile;
  const passwordRecord = customerAccountPasswordRecord(password);
  const client = await pgPool().connect();
  let customerId;
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT 1 FROM public.service_customers WHERE lower(email)=lower($1)
       UNION ALL SELECT 1 FROM public.customer_accounts WHERE lower(email)=lower($1) LIMIT 1`,
      [profile.email]
    );
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return json(res, 409, { error: 'A customer already uses this email. Open that account instead.' });
    }
    const trialDays = await defaultTrialDays(client);
    const customer = await client.query(
      `INSERT INTO public.service_customers
       (business_name, owner_name, phone, email, country, city, trial_started_at, trial_ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now() + ($7 * interval '1 day')) RETURNING id`,
      [profile.business_name, profile.owner_name, profile.phone, profile.email, profile.country, profile.city,trialDays]
    );
    customerId = customer.rows[0].id;
    await client.query(
      `INSERT INTO public.customer_accounts (customer_id,email,password_salt,password_hash)
       VALUES ($1,$2,$3,$4)`,
      [customerId,profile.email,passwordRecord.salt,passwordRecord.hash]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('adminCreateCustomer', error);
    if (String(error?.code) === '23505') return json(res, 409, { error: 'This email is already registered.' });
    return json(res, 500, { error: 'Unable to create customer account.' });
  } finally {
    client.release();
  }
  try { await recordAdminAudit(req, session, { action:'CUSTOMER_CREATED', category:'CUSTOMER', entityType:'service_customer', entityId:customerId, summary:`Created customer account: ${profile.business_name}` }); }
  catch (error) { console.error('admin customer audit', error); }
  return json(res, 201, { success: true, id:customerId, email:profile.email, message:'Customer account created. The customer must sign in on their own device; approve the device and grant access separately.' });
}

async function adminCustomers(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize || 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const q = cleanText(req.query?.q, 160);
    let customerQuery = db().from('service_customers').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (q) {
      const safe = q.replace(/[,%()]/g, ' ').trim();
      if (safe) customerQuery = customerQuery.or(`business_name.ilike.%${safe}%,owner_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`);
    }
    const { data: customers, error: ce, count } = await customerQuery.range(from, to);
    if (ce) throw ce;
    const customerIds = (customers || []).map((row) => row.id).filter(Boolean);
    const { data: installations, error: ie } = customerIds.length
      ? await db().from('installations').select('*').in('customer_id', customerIds).order('created_at', { ascending: false })
      : { data: [], error: null };
    if (ie) throw ie;
    const now = Date.now();
    const canonicalInstallations = (installations || []).filter((row) => !row.merged_into_installation_id);
    const companyIdentity = await registeredCompanyIdentityMap(canonicalInstallations.map((row) => row.id));
    const rows = (customers || []).map((customer) => {
      const devices = canonicalInstallations.filter((row) => row.customer_id === customer.id);
      const company = devices.map((row) => companyIdentity.get(String(row.id))).find(Boolean) || null;
      const logoDevice = devices.find((row) => row.profile_logo) || null;
      const active = devices.filter((row) => row.status !== 'BLOCKED' && row.subscription_expires_at && new Date(row.subscription_expires_at).getTime() > now).length;
      const trial = devices.filter((row) => row.status !== 'BLOCKED' && (!row.subscription_expires_at || new Date(row.subscription_expires_at).getTime() <= now) && row.trial_ends_at && new Date(row.trial_ends_at).getTime() > now).length;
      const blocked = devices.filter((row) => row.status === 'BLOCKED').length;
      const latestSeen = devices.map((row) => row.last_seen_at).filter(Boolean).sort().at(-1) || null;
      return {
        id: customer.id,
        companyId: company?.id || null,
        companyCode: company?.company_code || '',
        businessName: company?.company_name || customer.business_name || '',
        ownerName: company?.owner_name || customer.owner_name || '',
        email: company?.email && !String(company.email).endsWith('@safarpro.local') ? company.email : (customer.email || ''),
        phone: company?.phone || customer.phone || '',
        whatsapp: customer.whatsapp || '',
        address: company?.address || customer.address || '',
        country: company?.country || customer.country || '',
        city: company?.city || customer.city || '',
        businessType: customer.business_type || '',
        licenseNumber: customer.license_number || '',
        profileLogo: logoDevice?.profile_logo || '',
        createdAt: customer.created_at,
        deviceCount: devices.length,
        activeDeviceCount: active,
        trialDeviceCount: trial,
        blockedDeviceCount: blocked,
        lastSeenAt: latestSeen,
        accountStatus: customer.account_status || 'ACTIVE',
      };
    });
    return json(res, 200, { customers: rows, total: Number(count || 0), page, pageSize });
  } catch (e) {
    console.error('adminCustomers', e);
    return json(res, 500, { error: 'Unable to load customers.' });
  }
}

async function adminSetCustomerBlock(req, res, customerId, blocked) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession || !method(req, res, ['POST'])) return;
  try {
    const reason = cleanText(req.body?.reason, 500);
    if (blocked && !reason) return json(res, 400, { error: 'A block reason is required.' });
    const nextStatus = blocked ? 'BLOCKED' : 'ACTIVE';
    const { data: customer, error } = await db().from('service_customers').update({ account_status: nextStatus, updated_at: new Date().toISOString() }).eq('id', customerId).select('*').single();
    if (error) throw error;
    const { data: devices, error: deviceError } = await db().from('installations').select('id').eq('customer_id', customerId).is('merged_into_installation_id', null);
    if (deviceError) throw deviceError;
    if ((devices || []).length) {
      const ids = devices.map((row) => row.id);
      await db().from('installations').update({ access_version: Date.now() }).in('id', ids);
      for (const device of devices) {
        await logDeviceEvent(device.id, blocked ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED', blocked ? 'Company account blocked' : 'Company account unblocked', blocked ? reason : (reason || 'Company access restored by provider admin.'), { customerId });
        await notifyInstallation(device.id, blocked ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED', blocked ? 'Account access paused' : 'Account access restored', blocked ? reason : 'The provider restored access for this company.', '/', { blocked, reason: blocked ? reason : '' });
      }
    }
    await recordAdminAudit(req, adminSession, { action: blocked ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED', category: 'CUSTOMER', entityType: 'service_customer', entityId: customerId, summary: blocked ? 'Blocked company account' : 'Unblocked company account', metadata: { businessName: customer.business_name || '', reason }, severity: blocked ? 'WARNING' : 'INFO' });
    return json(res, 200, { success: true, accountStatus: nextStatus });
  } catch (error) {
    console.error('adminSetCustomerBlock', error);
    return json(res, 500, { error: 'Unable to update customer access.' });
  }
}

async function adminGrantCustomerAccess(req, res, customerId) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession || !method(req, res, ['POST'])) return;
  try {
    const body = req.body || {};
    const value = Math.max(1, Number(body.value || 1));
    const unit = ['DAY','MONTH','YEAR'].includes(String(body.unit || '').toUpperCase()) ? String(body.unit).toUpperCase() : 'MONTH';
    const { data: customer, error: customerError } = await db().from('service_customers').select('*').eq('id', customerId).maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return json(res, 404, { error: 'Customer not found.' });
    const currentExpiry = await companyActiveEntitlementExpiry(customerId);
    const now = new Date();
    const start = currentExpiry && currentExpiry > now ? currentExpiry : now;
    const expires = addAccessDuration(start, value, unit);
    await propagateCompanyEntitlement(customerId, expires);
    await db().from('service_customers').update({ account_status: 'ACTIVE', updated_at: new Date().toISOString() }).eq('id', customerId);
    const { data: devices } = await db().from('installations').select('id').eq('customer_id', customerId).eq('approval_status', 'APPROVED').is('merged_into_installation_id', null);
    for (const device of devices || []) await notifyInstallation(device.id, 'ACCESS_GRANTED', 'Access activated', `real estate office access is active until ${expires.toLocaleDateString()}.`, '/', { expiresAt: expires.toISOString(), value, unit });
    await recordAdminAudit(req, adminSession, { action: 'CUSTOMER_ACCESS_GRANTED', category: 'LICENSE', entityType: 'service_customer', entityId: customerId, summary: 'Granted company-wide access', metadata: { value, unit, expiresAt: expires.toISOString() } });
    return json(res, 200, { success: true, startsAt: start.toISOString(), expiresAt: expires.toISOString() });
  } catch (error) {
    console.error('adminGrantCustomerAccess', error);
    return json(res, 500, { error: 'Unable to grant customer access.' });
  }
}

async function adminCustomerProfile(req, res, customerId) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const [{ data: customer, error: ce }, { data: installations, error: ie }] = await Promise.all([
      db().from('service_customers').select('*').eq('id', customerId).maybeSingle(),
      db().from('installations').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
    ]);
    if (ce) throw ce;
    if (ie) throw ie;
    if (!customer) return json(res, 404, { error: 'Customer not found.' });
    const canonicalInstallations = (installations || []).filter((row) => !row.merged_into_installation_id);
    const companyIdentity = await registeredCompanyIdentityMap(canonicalInstallations.map((row) => row.id));
    const company = canonicalInstallations.map((row) => companyIdentity.get(String(row.id))).find(Boolean) || null;
    const logoDevice = canonicalInstallations.find((row) => row.profile_logo) || null;
    const installationIds = (installations || []).map((row) => row.id);
    let subscriptions = [];
    let payments = [];
    if (installationIds.length) {
      const [{ data: subRows, error: se }, { data: payRows, error: pe }] = await Promise.all([
        db().from('subscriptions').select('*,subscription_plans(title,amount,currency,duration_value,duration_unit),payment_methods(title)').in('installation_id', installationIds).order('created_at', { ascending: false }).limit(250),
        db().from('payment_requests').select('*,subscription_plans(title,amount,currency),payment_methods(title)').in('installation_id', installationIds).order('created_at', { ascending: false }).limit(250),
      ]);
      if (se) throw se;
      if (pe) throw pe;
      subscriptions = subRows || [];
      payments = payRows || [];
    }
    return json(res, 200, {
      customer: {
        id: customer.id,
        companyId: company?.id || null,
        companyCode: company?.company_code || '',
        businessName: company?.company_name || customer.business_name || '',
        ownerName: company?.owner_name || customer.owner_name || '',
        email: company?.email && !String(company.email).endsWith('@safarpro.local') ? company.email : (customer.email || ''),
        phone: company?.phone || customer.phone || '',
        whatsapp: customer.whatsapp || '',
        address: company?.address || customer.address || '',
        country: company?.country || customer.country || '',
        city: company?.city || customer.city || '',
        businessType: customer.business_type || '',
        licenseNumber: customer.license_number || '',
        profileLogo: logoDevice?.profile_logo || '',
        createdAt: customer.created_at,
        accountStatus: customer.account_status || 'ACTIVE',
      },
      devices: canonicalInstallations.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        deviceCode: r.device_code,
        displayName: r.display_name || '',
        deviceName: r.device_name || '',
        status: r.status,
        trialEndsAt: r.trial_ends_at,
        subscriptionExpiresAt: r.subscription_expires_at,
        lastSeenAt: r.last_seen_at,
        createdAt: r.created_at,
        ...accessPayload(r),
      })),
      subscriptions: subscriptions.map((row) => ({
        id: row.id,
        installationId: row.installation_id,
        status: row.status,
        startsAt: row.starts_at,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        plan: row.subscription_plans || null,
        paymentMethod: row.payment_methods || null,
      })),
      payments: payments.map((row) => ({
        id: row.id,
        installationId: row.installation_id,
        status: row.status,
        amount: Number(row.amount || 0),
        currency: row.currency || 'AFN',
        transactionReference: row.transaction_reference || '',
        customerNote: row.customer_note || '',
        adminNote: row.admin_note || '',
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        plan: row.subscription_plans || null,
        paymentMethod: row.payment_methods || null,
      })),
    });
  } catch (e) {
    console.error('adminCustomerProfile', e);
    return json(res, 500, { error: 'Unable to load customer profile.' });
  }
}

async function adminSummary(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const { data, error } = await db().from('installations').select('*');
    if (error) throw error;
    const now = Date.now();
    const rows = (data || []).filter((row) => !row.merged_into_installation_id);
    const blocked = rows.filter(x => x.status === 'BLOCKED').length;
    const activeAccess = rows.filter(x => x.status !== 'BLOCKED' && x.subscription_expires_at && new Date(x.subscription_expires_at).getTime() > now).length;
    const trialActive = rows.filter(x => x.status !== 'BLOCKED' && new Date(x.trial_ends_at).getTime() > now && !(x.subscription_expires_at && new Date(x.subscription_expires_at).getTime() > now)).length;
    const expired = rows.filter(x => x.status !== 'BLOCKED' && !(x.subscription_expires_at && new Date(x.subscription_expires_at).getTime() > now) && !(new Date(x.trial_ends_at).getTime() > now)).length;
    return json(res, 200, {
      customers: new Set(rows.map(x => x.customer_id).filter(Boolean)).size,
      totalInstallations: rows.length,
      blocked,
      trialActive,
      activeAccess,
      licensed: activeAccess,
      expired,
    });
  } catch (e) {
    console.error('adminSummary', e);
    return json(res, 500, { error: 'Unable to load dashboard summary.' });
  }
}

async function adminAnalytics(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const { data, error } = await db().from('installations').select('*,service_customers(*)');
    if (error) throw error;
    const definitions = [
      ['companies', 'company_registration_requests', 'APPROVED'],
      ['requests', 'company_registration_requests', 'PENDING'],
      ['plans', 'subscription_plans'], ['credits', 'service_customers'],
      ['subscriptions', 'subscriptions'],
      ['innovations', 'innovations'], ['audit', 'admin_audit_logs'],
      ['paymentMethods', 'payment_methods'],
    ];
    const sections = {};
    for (const [key, table, status] of definitions) {
      let query = db().from(table).select('id', { count: 'exact', head: true });
      if (status) query = query.eq('status', status);
      const result = await query;
      if (result.error) throw result.error;
      sections[key] = Number(result.count || 0);
    }
    const devices = deviceMetrics(data || [], accessPayload);
    sections.messages = devices.total;
    return json(res, 200, { devices, sections, timezone: 'Asia/Kabul' });
  } catch (error) {
    console.error('adminAnalytics', error);
    return json(res, 500, { error: 'Unable to load dashboard analytics.' });
  }
}

async function adminReports(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const fourteenDaysAgo = new Date(now.getTime() - 13 * 86400000);
    fourteenDaysAgo.setUTCHours(0, 0, 0, 0);

    const [installResult, paymentResult, eventResult] = await Promise.all([
      db().from('installations').select('*'),
      db().from('payment_requests').select('id,status,amount,currency,created_at,reviewed_at').order('created_at', { ascending: false }).limit(1000),
      db().from('device_events').select('id,event_type,title,description,created_at,installation_id,installations(device_code,display_name)').order('created_at', { ascending: false }).limit(40),
    ]);
    if (installResult.error) throw installResult.error;
    if (paymentResult.error) throw paymentResult.error;
    if (eventResult.error && !['42P01','PGRST205'].includes(String(eventResult.error.code || ''))) throw eventResult.error;

    const installations = (installResult.data || []).filter((row) => !row.merged_into_installation_id);
    const payments = paymentResult.data || [];
    const events = eventResult.data || [];
    const approved = payments.filter((row) => row.status === 'APPROVED');
    const pending = payments.filter((row) => row.status === 'PENDING' || row.status === 'PROCESSING');
    const rejected = payments.filter((row) => row.status === 'REJECTED');
    const monthlyRevenue = approved.filter((row) => new Date(row.reviewed_at || row.created_at) >= monthStart).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalRevenue = approved.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const pendingAmount = pending.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const onlineCutoff = Date.now() - 10 * 60 * 1000;
    const onlineDevices = installations.filter((row) => row.last_seen_at && new Date(row.last_seen_at).getTime() >= onlineCutoff).length;
    const expiringSoon = installations.filter((row) => {
      if (!row.subscription_expires_at || row.status === 'BLOCKED') return false;
      const diff = new Date(row.subscription_expires_at).getTime() - Date.now();
      return diff > 0 && diff <= 7 * 86400000;
    }).length;

    const daily = [];
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(fourteenDaysAgo.getTime() + i * 86400000);
      const key = d.toISOString().slice(0, 10);
      daily.push({ date: key, installations: 0, revenue: 0, approvedPayments: 0 });
    }
    const dailyMap = new Map(daily.map((row) => [row.date, row]));
    for (const row of installations) {
      const key = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '';
      if (dailyMap.has(key)) dailyMap.get(key).installations += 1;
    }
    for (const row of approved) {
      const date = row.reviewed_at || row.created_at;
      const key = date ? new Date(date).toISOString().slice(0, 10) : '';
      if (dailyMap.has(key)) {
        dailyMap.get(key).revenue += Number(row.amount || 0);
        dailyMap.get(key).approvedPayments += 1;
      }
    }

    return json(res, 200, {
      monthlyRevenue,
      totalRevenue,
      pendingAmount,
      pendingCount: pending.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      onlineDevices,
      expiringSoon,
      currency: payments.find((row) => row.currency)?.currency || 'AFN',
      daily,
      recentEvents: events.map((event) => ({
        id: event.id,
        type: event.event_type,
        title: event.title,
        description: event.description || '',
        createdAt: event.created_at,
        deviceCode: event.installations?.device_code || '',
        deviceName: event.installations?.display_name || '',
      })),
    });
  } catch (e) {
    console.error('adminReports', e);
    return json(res, 500, { error: 'Unable to load management reports.' });
  }
}

async function adminApproveDevice(req, res, id) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession || !method(req, res, ['POST'])) return;
  try {
    const { data: current, error: currentError } = await db().from('installations')
      .select('*,service_customers(*)').eq('id', id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return json(res, 404, { error: 'Installation not found.' });
    if (String(current.approval_status || 'APPROVED').toUpperCase() === 'APPROVED') {
      return json(res, 200, { success: true, device: { ...accessPayload(current), approvalStatus: 'APPROVED' } });
    }
    const allowance = await approvedDeviceAllowance(current.customer_id);
    if (allowance.approvedCount >= allowance.limit) {
      return json(res, 409, {
        error: `This company plan allows ${allowance.limit} approved device(s). Block or remove an old device, or increase the plan device limit.`,
        code: 'DEVICE_LIMIT_REACHED',
        deviceLimit: allowance.limit,
        approvedDeviceCount: allowance.approvedCount,
      });
    }
    const now = new Date().toISOString();
    const companyExpiry = await companyActiveEntitlementExpiry(current.customer_id);
    const { data: updated, error } = await db().from('installations').update({
      approval_status: 'APPROVED',
      status: 'ACTIVE',
      ...(companyExpiry ? { subscription_expires_at: companyExpiry.toISOString() } : {}),
      access_version: Number(current.access_version || 1) + 1,
      last_license_check_at: now,
      last_seen_at: now,
    }).eq('id', id).select('*,service_customers(*)').single();
    if (error) throw error;
    await logDeviceEvent(id, 'DEVICE_APPROVED', 'Device approved', 'Provider approved this device for the company account.', { deviceLimit: allowance.limit });
    await notifyInstallation(id, 'DEVICE_APPROVED', 'Device activated', 'This device has been approved and can now use the real estate system.', '/', { approved: true });
    await recordAdminAudit(req, adminSession, { action: 'DEVICE_APPROVED', category: 'DEVICE', entityType: 'installation', entityId: id, summary: 'Approved company device', metadata: { deviceLimit: allowance.limit, approvedDeviceCountBefore: allowance.approvedCount } });
    return json(res, 200, { success: true, device: { ...accessPayload(updated), approvalStatus: 'APPROVED' } });
  } catch (error) {
    console.error('adminApproveDevice', error);
    return json(res, 500, { error: 'Unable to approve this device.' });
  }
}

async function adminSetBlock(req, res, id, blocked) {
  const adminSession = requireAdmin(req, res);
  if (!method(req, res, ['POST']) || !adminSession) return;
  try {
    const reason = cleanText(req.body?.reason, 500);
    if (blocked && !reason) return json(res, 400, { error: 'A block reason is required.' });
    const { data, error } = await db().from('installations').update({
      status: blocked ? 'BLOCKED' : 'ACTIVE',
      access_version: Date.now(),
    }).eq('id', id).select().single();
    if (error) throw error;
    await logDeviceEvent(id, blocked ? 'BLOCKED' : 'UNBLOCKED', blocked ? 'Device blocked' : 'Device unblocked', reason || (blocked ? 'Blocked by provider admin.' : 'Unblocked by provider admin.'));
    await recordAdminAudit(req, adminSession, { action: blocked ? 'DEVICE_BLOCKED' : 'DEVICE_UNBLOCKED', category: 'DEVICE', entityType: 'installation', entityId: id, summary: blocked ? 'Blocked customer device' : 'Unblocked customer device', metadata: { reason }, severity: blocked ? 'WARNING' : 'INFO' });
    await notifyInstallation(id, blocked ? 'DEVICE_BLOCKED' : 'DEVICE_UNBLOCKED', blocked ? 'Access paused' : 'Access restored', blocked ? reason : 'Real estate system restored access for this device.', '/', { blocked, reason: blocked ? reason : '' });
    return json(res, 200, { success: true, installation: data });
  } catch (e) {
    console.error('adminSetBlock', e);
    return json(res, 500, { error: 'Unable to update installation.' });
  }
}


function addAccessDuration(baseDate, value, unit) {
  const amount = Math.max(1, Number(value || 1));
  const base = new Date(baseDate);
  if (Number.isNaN(base.getTime())) throw new Error('Invalid access start date.');

  if (unit === 'DAY') {
    base.setUTCDate(base.getUTCDate() + amount);
  } else if (unit === 'YEAR') {
    base.setUTCFullYear(base.getUTCFullYear() + amount);
  } else {
    base.setUTCMonth(base.getUTCMonth() + amount);
  }
  return base;
}

async function adminGrantAccess(req, res, id) {
  const adminSession = requireAdmin(req, res);
  if (!method(req, res, ['POST']) || !adminSession) return;
  try {
    const body = req.body || {};
    const value = Math.max(1, Number(body.value || 1));
    const unit = ['DAY', 'MONTH', 'YEAR'].includes(String(body.unit || '').toUpperCase())
      ? String(body.unit).toUpperCase()
      : 'MONTH';

    const { data: current, error: currentError } = await db()
      .from('installations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return json(res, 404, { error: 'Installation not found.' });

    const note = cleanText(body.note, 500) || `Access granted for ${value} ${unit.toLowerCase()}(s).`;
    const now = new Date();
    const existingExpiry = current.subscription_expires_at ? new Date(current.subscription_expires_at) : null;
    const start = existingExpiry && existingExpiry > now ? existingExpiry : now;
    const expires = addAccessDuration(start, value, unit);

    const { data: updated, error } = await db()
      .from('installations')
      .update({
        status: 'ACTIVE',
        subscription_expires_at: expires.toISOString(),
        access_version: Date.now(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    await propagateCompanyEntitlement(current.customer_id, expires);

    const { error: subError } = await db().from('subscriptions').insert({
      installation_id: id,
      starts_at: start.toISOString(),
      expires_at: expires.toISOString(),
      status: 'ACTIVE',
      note,
    });
    if (subError) console.error('adminGrantAccess subscription audit insert', subError);
    await logDeviceEvent(id, 'ACCESS_GRANTED', 'Access granted / extended', note, { startsAt: start.toISOString(), expiresAt: expires.toISOString(), value, unit });
    await recordAdminAudit(req, adminSession, { action: 'ACCESS_GRANTED', category: 'LICENSE', entityType: 'installation', entityId: id, summary: 'Granted customer access', metadata: { value, unit, note, expiresAt: expires.toISOString() } });
    await notifyInstallation(id, 'ACCESS_GRANTED', 'Access activated', `Your real estate office access is active until ${expires.toLocaleDateString()}.`, '/', { expiresAt: expires.toISOString(), value, unit });

    return json(res, 200, {
      success: true,
      installation: { ...updated, ...accessPayload(updated) },
      access: { startsAt: start.toISOString(), expiresAt: expires.toISOString(), value, unit },
    });
  } catch (e) {
    console.error('adminGrantAccess', e);
    return json(res, 500, { error: 'Unable to grant access.' });
  }
}


async function adminDeviceProfile(req, res, id) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const { data: device, error } = await db().from('installations').select('*,service_customers(*)').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!device) return json(res, 404, { error: 'Installation not found.' });
    const companyIdentity = await registeredCompanyIdentityMap([device.id]);
    const company = companyIdentity.get(String(device.id)) || null;

    const [eventsResult, subsResult, accessResult, paymentResult, auditResult] = await Promise.all([
      db().from('device_events').select('*').eq('installation_id', id).order('created_at', { ascending: false }).limit(200),
      db().from('subscriptions').select('*,subscription_plans(title),payment_methods(title)').eq('installation_id', id).order('created_at', { ascending: false }).limit(150),
      db().from('access_events').select('*').eq('installation_id', id).order('created_at', { ascending: false }).limit(250),
      db().from('payment_requests').select('*,subscription_plans(title),payment_methods(title)').eq('installation_id', id).order('created_at', { ascending: false }).limit(150),
      db().from('admin_audit_logs').select('*').in('entity_id', [String(id), String(device.customer_id || '')]).order('created_at', { ascending: false }).limit(200),
    ]);
    for (const result of [eventsResult, subsResult, accessResult, paymentResult]) {
      if (result.error) throw result.error;
    }
    if (auditResult.error && !['42P01','PGRST205'].includes(String(auditResult.error?.code || ''))) throw auditResult.error;

    const timeline = [
      ...(eventsResult.data || []).map(x => ({
        id: `event-${x.id}`,
        type: x.event_type || 'DEVICE_EVENT',
        title: x.title || 'Device event',
        description: x.description || '',
        status: null,
        amount: null,
        currency: null,
        metadata: x.metadata || {},
        createdAt: x.created_at,
        source: 'device_event',
      })),
      ...(accessResult.data || []).map(x => ({
        id: `access-${x.id}`,
        type: 'ACCESS_CHECK',
        title: x.allowed ? 'Access allowed' : 'Access denied',
        description: `Access status: ${x.access_status || 'UNKNOWN'}`,
        status: x.access_status || null,
        amount: null,
        currency: null,
        metadata: { allowed: Boolean(x.allowed) },
        createdAt: x.created_at,
        source: 'access_event',
      })),
      ...(paymentResult.data || []).flatMap(x => {
        const planTitle = x.subscription_plans?.title || 'plan';
        const base = [{
          id: `payment-created-${x.id}`,
          type: 'PAYMENT_REQUESTED',
          title: 'Payment request submitted',
          description: `Payment request for ${planTitle}${x.transaction_reference ? ` · Ref ${x.transaction_reference}` : ''}`,
          status: x.status || 'PENDING',
          amount: Number(x.amount || 0),
          currency: x.currency || 'AFN',
          metadata: { paymentRequestId: x.id, paymentMethod: x.payment_methods?.title || '', customerNote: x.customer_note || '' },
          createdAt: x.created_at,
          source: 'payment_request',
        }];
        if (x.reviewed_at) base.push({
          id: `payment-reviewed-${x.id}`,
          type: x.status === 'APPROVED' ? 'PAYMENT_APPROVED' : x.status === 'REJECTED' ? 'PAYMENT_REJECTED' : 'PAYMENT_REVIEWED',
          title: x.status === 'APPROVED' ? 'Payment approved' : x.status === 'REJECTED' ? 'Payment rejected' : 'Payment reviewed',
          description: x.admin_note || `Payment request status changed to ${x.status || 'REVIEWED'}.`,
          status: x.status || null,
          amount: Number(x.amount || 0),
          currency: x.currency || 'AFN',
          metadata: { paymentRequestId: x.id, approvedExpiresAt: x.approved_expires_at || null },
          createdAt: x.reviewed_at,
          source: 'payment_request',
        });
        return base;
      }),
      ...(subsResult.data || []).flatMap(x => {
        const rows = [{
          id: `sub-start-${x.id}`,
          type: 'SUBSCRIPTION_STARTED',
          title: 'Paid access started',
          description: x.note || `${x.subscription_plans?.title || 'Subscription'} activated.`,
          status: x.status || 'ACTIVE',
          amount: x.amount == null ? null : Number(x.amount || 0),
          currency: x.currency || null,
          createdAt: x.starts_at,
          metadata: { subscriptionId: x.id, expiresAt: x.expires_at, paymentMethod: x.payment_methods?.title || '' },
          source: 'subscription',
        }];
        if (x.expires_at && new Date(x.expires_at) <= new Date()) rows.push({
          id: `sub-end-${x.id}`,
          type: 'SUBSCRIPTION_EXPIRED',
          title: 'Paid access expired',
          description: 'The paid access period ended.',
          status: 'EXPIRED',
          amount: null,
          currency: null,
          createdAt: x.expires_at,
          metadata: { subscriptionId: x.id },
          source: 'subscription',
        });
        return rows;
      }),
      ...(auditResult.data || []).map(x => ({
        id: `audit-${x.id}`,
        type: x.action || 'ADMIN_ACTION',
        title: x.summary || x.action || 'Admin action',
        description: x.metadata?.reason || x.metadata?.note || '',
        status: x.severity || null,
        amount: x.metadata?.amount == null ? null : Number(x.metadata.amount || 0),
        currency: x.metadata?.currency || null,
        metadata: { ...(x.metadata || {}), adminEmail: x.admin_email || '', category: x.category || '' },
        createdAt: x.created_at,
        source: 'audit',
      })),
      { id: `trial-start-${id}`, type: 'FREE_ACCESS_STARTED', title: 'Free access started', description: 'Initial free access period started.', status: 'TRIAL', amount: null, currency: null, createdAt: device.trial_started_at, metadata: {}, source: 'trial' },
      ...(device.trial_ends_at && new Date(device.trial_ends_at) <= new Date() ? [{ id: `trial-end-${id}`, type: 'FREE_ACCESS_EXPIRED', title: 'Free access ended', description: 'The initial free access period ended.', status: 'EXPIRED', amount: null, currency: null, createdAt: device.trial_ends_at, metadata: {}, source: 'trial' }] : []),
    ].filter(x => x.createdAt).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    return json(res, 200, {
      device: {
        id: device.id,
        deviceCode: device.device_code,
        displayName: device.display_name || '',
        deviceName: device.device_name || '',
        deviceType: device.device_type || '',
        operatingSystem: device.operating_system || '',
        browser: device.browser || '',
        appVersion: device.app_version || '',
        status: device.status,
        approvalStatus: device.approval_status || 'APPROVED',
        trialStartedAt: device.trial_started_at,
        trialEndsAt: device.trial_ends_at,
        subscriptionExpiresAt: device.subscription_expires_at,
        lastSeenAt: device.last_seen_at,
        createdAt: device.created_at,
        companyId: company?.id || null,
        companyName: resolveCompanyDisplayName(device.profile_name, device.service_customers?.business_name, company?.company_name, device.service_customers?.owner_name, device.display_name, device.device_code),
        ownerName: company?.owner_name || device.service_customers?.owner_name || '',
        smartOfficeId: device.service_customers?.smart_office_id || '',
        customer: {
          companyId: company?.id || null,
          companyCode: company?.company_code || '',
          businessName: company?.company_name || device.service_customers?.business_name || '',
          ownerName: company?.owner_name || device.service_customers?.owner_name || '',
          email: company?.email && !String(company.email).endsWith('@safarpro.local') ? company.email : (device.service_customers?.email || ''),
          phone: company?.phone || device.service_customers?.phone || '',
          address: company?.address || '',
          country: company?.country || device.service_customers?.country || '',
          city: company?.city || device.service_customers?.city || '',
          profileLogo: device.profile_logo || '',
        },
        ...accessPayload(device),
      },
      timeline,
    });
  } catch (e) {
    console.error('adminDeviceProfile', e);
    return json(res, 500, { error: 'Unable to load device profile.' });
  }
}


async function adminDeviceDeletePreview(req, res, id) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const { data: device, error: deviceError } = await db()
      .from('installations')
      .select('id,customer_id,device_code,display_name,device_name,status,subscription_expires_at,service_customers(business_name,owner_name,email)')
      .eq('id', id)
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device) return json(res, 404, { error: 'Installation not found.' });
    const companyIdentity = await registeredCompanyIdentityMap([device.id]);
    const company = companyIdentity.get(String(device.id)) || null;

    const countFor = async (table) => {
      const { count, error } = await db().from(table).select('id', { count: 'exact', head: true }).eq('installation_id', id);
      if (error) throw error;
      return Number(count || 0);
    };
    const [subscriptions, messages, payments, events, notifications, accessEvents] = await Promise.all([
      countFor('subscriptions'), countFor('provider_messages'), countFor('payment_requests'), countFor('device_events'), countFor('customer_notifications'), countFor('access_events'),
    ]);
    return json(res, 200, {
      device: {
        id: device.id,
        deviceCode: device.device_code,
        displayName: device.display_name || device.device_name || '',
        status: device.status,
        subscriptionExpiresAt: device.subscription_expires_at,
        customerName: company?.company_name || device.service_customers?.business_name || device.service_customers?.owner_name || 'Customer',
        customerEmail: device.service_customers?.email || '',
      },
      related: { subscriptions, messages, paymentRequests: payments, deviceEvents: events, notifications, accessEvents },
      totalRelated: subscriptions + messages + payments + events + notifications + accessEvents,
    });
  } catch (e) {
    console.error('adminDeviceDeletePreview', e);
    return json(res, 500, { error: 'Unable to prepare device deletion.' });
  }
}

async function adminDeleteDevice(req, res, id) {
  const adminSession = requireAdmin(req, res);
  if (!method(req, res, ['DELETE']) || !adminSession) return;
  try {
    const { data: device, error: deviceError } = await db()
      .from('installations')
      .select('id,customer_id,device_code,display_name,device_name')
      .eq('id', id)
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device) return json(res, 404, { error: 'Installation not found.' });

    const [{ data: messages }, { data: payments }] = await Promise.all([
      db().from('provider_messages').select('attachment_path').eq('installation_id', id),
      db().from('payment_requests').select('receipt_path').eq('installation_id', id),
    ]);
    const supportFiles = (messages || []).map((row) => row.attachment_path).filter(Boolean);
    const receiptFiles = (payments || []).map((row) => row.receipt_path).filter(Boolean);
    if (supportFiles.length) await db().storage.from('support-attachments').remove(supportFiles).catch(() => {});
    if (receiptFiles.length) await db().storage.from('payment-receipts').remove(receiptFiles).catch(() => {});

    const { error } = await db().from('installations').delete().eq('id', id);
    if (error) throw error;

    await recordAdminAudit(req, adminSession, {
      action: 'DEVICE_DELETED', category: 'DEVICE', entityType: 'installation', entityId: id,
      summary: `Deleted device ${device.device_code || id}`,
      metadata: { deviceCode: device.device_code || '', displayName: device.display_name || device.device_name || '', removedFiles: supportFiles.length + receiptFiles.length },
      severity: 'WARNING'
    });
    return json(res, 200, {
      success: true,
      deletedDeviceId: id,
      deviceCode: device.device_code,
      removedFiles: supportFiles.length + receiptFiles.length,
      message: 'Device and its related server records were deleted.',
    });
  } catch (e) {
    console.error('adminDeleteDevice', e);
    return json(res, 500, { error: 'Unable to delete device.' });
  }
}

async function adminRenameDevice(req, res, id) {
  const adminSession = requireAdmin(req, res);
  if (!method(req, res, ['PATCH']) || !adminSession) return;
  try {
    const displayName = cleanText(req.body?.displayName, 120);
    if (!displayName) return json(res, 400, { error: 'Device name is required.' });
    const { data, error } = await db().from('installations').update({ display_name: displayName, access_version: Date.now() }).eq('id', id).select('*').single();
    if (error) throw error;
    await logDeviceEvent(id, 'RENAMED', 'Device name updated', `Device renamed to “${displayName}”.`, { displayName });
    await recordAdminAudit(req, adminSession, { action: 'DEVICE_RENAMED', category: 'DEVICE', entityType: 'installation', entityId: id, summary: `Renamed device to ${displayName}`, metadata: { displayName } });
    return json(res, 200, { success: true, displayName, installation: data });
  } catch (e) {
    console.error('adminRenameDevice', e);
    return json(res, 500, { error: 'Unable to rename device.' });
  }
}



async function adminLicenses(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize || 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const q = cleanText(req.query?.q, 160);
    let query = db().from('installations').select('*,service_customers(*)', { count: 'exact' }).is('merged_into_installation_id', null).order('created_at', { ascending: false });
    if (q) {
      const safe = q.replace(/[,%()]/g, ' ').trim();
      if (safe) {
        const { data: customers, error: customerError } = await db().from('service_customers').select('id').ilike('smart_office_id', `%${safe}%`);
        if (customerError) throw customerError;
        query = query.or(`device_code.ilike.%${safe}%,display_name.ilike.%${safe}%,device_name.ilike.%${safe}%${(customers || []).map(row => `,customer_id.eq.${row.id}`).join('')}`);
      }
    }
    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    const rows = (data || []).map((row) => {
      const access = accessPayload(row);
      return {
        id: row.id,
        licenseKey: row.service_customers?.smart_office_id || '',
        smartOfficeId: row.service_customers?.smart_office_id || '',
        deviceName: row.display_name || row.device_name || row.device_type || 'Browser / PWA',
        customerName: row.profile_name || row.service_customers?.business_name || row.service_customers?.owner_name || '',
        status: access.accessStatus,
        plan: row.subscription_expires_at ? 'Subscription' : 'Trial',
        expiresAt: row.subscription_expires_at || row.trial_ends_at || null,
        allowed: Boolean(access.allowed),
        createdAt: row.created_at,
      };
    });
    return json(res, 200, { licenses: rows, total: Number(count || 0), page, pageSize });
  } catch (error) {
    console.error('adminLicenses', error);
    return json(res, 500, { error: 'Unable to load licenses.' });
  }
}

async function adminSubscriptions(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize || 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await db().from('subscriptions')
      .select('*,subscription_plans(*),payment_methods(*),installations(id,device_code,display_name,device_name,profile_name,service_customers(business_name,owner_name))', { count: 'exact' })
      .order('created_at', { ascending: false }).range(from, to);
    if (error) throw error;
    const rows = (data || []).map((row) => ({
      id: row.id, installationId: row.installation_id, status: row.status || (row.expires_at && new Date(row.expires_at) > new Date() ? 'ACTIVE' : 'EXPIRED'),
      startedAt: row.starts_at, expiresAt: row.expires_at, amount: Number(row.amount || 0), currency: row.currency || row.subscription_plans?.currency || 'AFN',
      plan: row.subscription_plans ? mapPlan(row.subscription_plans) : null,
      paymentMethod: row.payment_methods ? mapPaymentMethod(row.payment_methods) : null,
      customerName: row.installations?.profile_name || row.installations?.service_customers?.business_name || row.installations?.service_customers?.owner_name || row.installations?.display_name || row.installations?.device_code || '',
      deviceCode: row.installations?.device_code || '', createdAt: row.created_at,
    }));
    return json(res, 200, { subscriptions: rows, total: Number(count || 0), page, pageSize });
  } catch (error) {
    console.error('adminSubscriptions', error);
    return json(res, 500, { error: 'Unable to load subscriptions.' });
  }
}

async function adminPayments(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize || 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await db().from('payment_requests')
      .select('*,subscription_plans(*),payment_methods(*),installations(id,device_code,display_name,profile_name,service_customers(business_name,owner_name))', { count: 'exact' })
      .order('created_at', { ascending: false }).range(from, to);
    if (error) throw error;
    const installationIds = (data || []).map((row) => row.installation_id).filter(Boolean);
    const companyIdentity = await registeredCompanyIdentityMap(installationIds);
    const rows = (data || []).map((row) => {
      const mapped = mapPaymentRequest(row);
      const company = companyIdentity.get(String(row.installation_id));
      return { ...mapped, customerName: company?.company_name || mapped.device?.businessName || row.installations?.profile_name || mapped.device?.displayName || '' };
    });
    return json(res, 200, { payments: rows, total: Number(count || 0), page, pageSize });
  } catch (error) {
    console.error('adminPayments', error);
    return json(res, 500, { error: 'Unable to load payments.' });
  }
}

async function adminPlans(req, res, planId = null) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession) return;
  try {
    if (req.method === 'GET' && !planId) {
      const { data, error } = await db().from('subscription_plans').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true });
      if (error) throw error;
      return json(res, 200, { plans: (data || []).map(mapPlan) });
    }
    if (req.method === 'POST' && !planId) {
      const b = req.body || {};
      const title = cleanText(b.title, 120);
      if (!title) return json(res, 400, { error: 'Plan title is required.' });
      const durationUnit = ['DAY','MONTH','YEAR','LIFETIME'].includes(String(b.durationUnit || '').toUpperCase()) ? String(b.durationUnit).toUpperCase() : 'MONTH';
      const wantsPopular = Boolean(b.isPopular);
      if (wantsPopular) {
        const { error: clearPopularError } = await db().from('subscription_plans').update({ is_popular: false, updated_at: new Date().toISOString() }).eq('is_popular', true);
        if (clearPopularError) throw clearPopularError;
      }
      const payload = { title, amount: Math.max(0, Number(b.amount || 0)), currency: cleanText(b.currency, 12) || 'AFN', duration_value: durationUnit === 'LIFETIME' ? 1 : Math.max(1, Number(b.durationValue || 1)), duration_unit: durationUnit, is_lifetime: durationUnit === 'LIFETIME', description: cleanText(b.description, 1000), device_limit: Math.max(1, Math.min(100, Number(b.deviceLimit || 1))), is_active: b.isActive !== false, is_popular: wantsPopular, referral_reward_afn: Math.max(0, Number(b.referralRewardAfn || 0)), sort_order: Number(b.sortOrder || 0), updated_at: new Date().toISOString() };
      const { data, error } = await db().from('subscription_plans').insert(payload).select('*').single();
      if (error) throw error;
      await recordAdminAudit(req, adminSession, { action: 'PLAN_CREATED', category: 'BILLING', entityType: 'subscription_plan', entityId: data.id, summary: `Created plan ${data.title}`, metadata: { amount: data.amount, currency: data.currency, durationValue: data.duration_value, durationUnit: data.duration_unit } });
      return json(res, 201, { plan: mapPlan(data) });
    }
    if (req.method === 'PATCH' && planId) {
      const b = req.body || {};
      const patch = { updated_at: new Date().toISOString() };
      if ('title' in b) patch.title = cleanText(b.title, 120);
      if ('amount' in b) patch.amount = Math.max(0, Number(b.amount || 0));
      if ('currency' in b) patch.currency = cleanText(b.currency, 12) || 'AFN';
      if ('durationValue' in b) patch.duration_value = Math.max(1, Number(b.durationValue || 1));
      if ('durationUnit' in b) { patch.duration_unit = ['DAY','MONTH','YEAR','LIFETIME'].includes(String(b.durationUnit).toUpperCase()) ? String(b.durationUnit).toUpperCase() : 'MONTH'; patch.is_lifetime = patch.duration_unit === 'LIFETIME'; if (patch.is_lifetime) patch.duration_value = 1; }
      if ('description' in b) patch.description = cleanText(b.description, 1000);
      if ('deviceLimit' in b) patch.device_limit = Math.max(1, Math.min(100, Number(b.deviceLimit || 1)));
      if ('isActive' in b) patch.is_active = Boolean(b.isActive);
      if ('isPopular' in b) {
        patch.is_popular = Boolean(b.isPopular);
        if (patch.is_popular) {
          const { error: clearPopularError } = await db().from('subscription_plans').update({ is_popular: false, updated_at: new Date().toISOString() }).neq('id', planId).eq('is_popular', true);
          if (clearPopularError) throw clearPopularError;
        }
      }
      if ('referralRewardAfn' in b) patch.referral_reward_afn = Math.max(0, Number(b.referralRewardAfn || 0));
      if ('sortOrder' in b) patch.sort_order = Number(b.sortOrder || 0);
      const { data, error } = await db().from('subscription_plans').update(patch).eq('id', planId).select('*').single();
      if (error) throw error;
      await recordAdminAudit(req, adminSession, { action: 'PLAN_UPDATED', category: 'BILLING', entityType: 'subscription_plan', entityId: planId, summary: `Updated plan ${data.title}`, metadata: { amount: data.amount, currency: data.currency, isActive: data.is_active, isPopular: data.is_popular } });
      return json(res, 200, { plan: mapPlan(data) });
    }
    if (req.method === 'DELETE' && planId) {
      const { data: beforeDelete } = await db().from('subscription_plans').select('title').eq('id', planId).maybeSingle();
      const { error } = await db().from('subscription_plans').delete().eq('id', planId);
      if (error) throw error;
      await recordAdminAudit(req, adminSession, { action: 'PLAN_DELETED', category: 'BILLING', entityType: 'subscription_plan', entityId: planId, summary: `Deleted plan ${beforeDelete?.title || planId}`, severity: 'WARNING' });
      return json(res, 200, { success: true });
    }
    return json(res, 405, { error: 'Method not allowed.' });
  } catch (e) {
    console.error('adminPlans', e);
    return json(res, 500, { error: 'Unable to manage subscription plans.' });
  }
}

async function adminPaymentMethods(req, res, methodId = null) {
  const adminSession = requireAdmin(req, res);
  if (!adminSession) return;
  try {
    if (req.method === 'GET' && !methodId) {
      const { data, error } = await db().from('payment_methods').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true });
      if (error) throw error;
      return json(res, 200, { paymentMethods: (data || []).map(mapPaymentMethod) });
    }
    if (req.method === 'POST' && !methodId) {
      const b = req.body || {};
      const title = cleanText(b.title, 120);
      if (!title) return json(res, 400, { error: 'Payment method title is required.' });
      const payload = { title, description: cleanText(b.description, 1000), payment_details: cleanText(b.paymentDetails, 2000), instructions: cleanText(b.instructions, 3000), logo_url: cleanText(b.logoUrl, 1200), is_active: b.isActive !== false, sort_order: Number(b.sortOrder || 0), updated_at: new Date().toISOString() };
      const { data, error } = await db().from('payment_methods').insert(payload).select('*').single();
      if (error) throw error;
      await recordAdminAudit(req, adminSession, { action: 'PAYMENT_METHOD_CREATED', category: 'BILLING', entityType: 'payment_method', entityId: data.id, summary: `Created payment method ${data.title}` });
      return json(res, 201, { paymentMethod: mapPaymentMethod(data) });
    }
    if (req.method === 'PATCH' && methodId) {
      const b = req.body || {};
      const patch = { updated_at: new Date().toISOString() };
      for (const [client, dbKey, max] of [['title','title',120],['description','description',1000],['paymentDetails','payment_details',2000],['instructions','instructions',3000],['logoUrl','logo_url',1200]]) if (client in b) patch[dbKey] = cleanText(b[client], max);
      if ('isActive' in b) patch.is_active = Boolean(b.isActive);
      if ('sortOrder' in b) patch.sort_order = Number(b.sortOrder || 0);
      const { data, error } = await db().from('payment_methods').update(patch).eq('id', methodId).select('*').single();
      if (error) throw error;
      await recordAdminAudit(req, adminSession, { action: 'PAYMENT_METHOD_UPDATED', category: 'BILLING', entityType: 'payment_method', entityId: methodId, summary: `Updated payment method ${data.title}`, metadata: { isActive: data.is_active } });
      return json(res, 200, { paymentMethod: mapPaymentMethod(data) });
    }
    if (req.method === 'DELETE' && methodId) {
      const { data: beforeDelete } = await db().from('payment_methods').select('title').eq('id', methodId).maybeSingle();
      const { error } = await db().from('payment_methods').delete().eq('id', methodId);
      if (error) throw error;
      await recordAdminAudit(req, adminSession, { action: 'PAYMENT_METHOD_DELETED', category: 'BILLING', entityType: 'payment_method', entityId: methodId, summary: `Deleted payment method ${beforeDelete?.title || methodId}`, severity: 'WARNING' });
      return json(res, 200, { success: true });
    }
    return json(res, 405, { error: 'Method not allowed.' });
  } catch (e) {
    console.error('adminPaymentMethods', e);
    return json(res, 500, { error: 'Unable to manage payment methods.' });
  }
}

async function customerSupportProfile(req, res) {
  if (!method(req, res, ['PATCH'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
    const profileName = cleanText(req.body?.profileName, 140) || null;
    let profileLogo = String(req.body?.profileLogo || '').trim();
    if (profileLogo && !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(profileLogo)) profileLogo = '';
    if (profileLogo.length > 450000) return json(res, 400, { error: 'Profile logo is too large.' });
    const { error } = await db().from('installations').update({
      profile_name: profileName,
      profile_logo: profileLogo || null,
    }).eq('id', installation.id);
    if (error) throw error;
    return json(res, 200, { success: true });
  } catch (e) {
    console.error('customerSupportProfile', e);
    return json(res, 500, { error: 'Unable to sync support profile.' });
  }
}

async function customerMessageUnread(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
    const { count, error } = await db().from('provider_messages')
      .select('id', { count: 'exact', head: true })
      .eq('installation_id', installation.id)
      .eq('sender', 'provider')
      .eq('is_read', false);
    if (error) throw error;
    return json(res, 200, { unreadCount: Number(count || 0) });
  } catch (e) {
    console.error('customerMessageUnread', e);
    return json(res, 500, { error: 'Unable to check unread messages.' });
  }
}


async function adminMessageUnread(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const { data, count, error } = await db().from('provider_messages')
      .select('id,installation_id,message,created_at,attachment_path', { count: 'exact' })
      .eq('sender', 'customer')
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = data?.[0] || null;
    let customerName = 'Customer';
    if (row?.installation_id) {
      const { data: installation } = await db().from('installations')
        .select('profile_name,profile_logo,display_name,device_code,service_customers(business_name,owner_name)')
        .eq('id', row.installation_id)
        .maybeSingle();
      const companyIdentity = await registeredCompanyIdentityMap([row.installation_id]);
      const company = companyIdentity.get(String(row.installation_id));
      customerName = resolveCompanyDisplayName(installation?.profile_name, installation?.service_customers?.business_name, company?.company_name, installation?.service_customers?.owner_name, installation?.display_name, installation?.device_code);
    }
    return json(res, 200, {
      unreadCount: Number(count || 0),
      latest: row ? {
        id: row.id,
        installationId: row.installation_id,
        message: row.message || (row.attachment_path ? 'Screenshot attached' : 'New customer message'),
        createdAt: row.created_at,
        customerName,
      } : null,
    });
  } catch (error) {
    console.error('adminMessageUnread', error);
    return json(res, 500, { error: 'Unable to check unread customer messages.' });
  }
}

async function adminMessages(req, res) {
  if (!method(req, res, ['GET']) || !requireAdmin(req, res)) return;
  try {
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize || 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const q = cleanText(req.query?.q, 160);
    let query = db().from('installations')
      .select('*,service_customers(business_name,owner_name)', { count: 'exact' })
      .is('merged_into_installation_id', null)
      .order('created_at', { ascending: false });
    if (q) {
      const safe = q.replace(/[,%()]/g, ' ').trim();
      if (safe) query = query.or(`device_code.ilike.%${safe}%,display_name.ilike.%${safe}%,profile_name.ilike.%${safe}%`);
    }
    const { data: inst, error, count } = await query.range(from, to);
    if (error) throw error;
    const ids = (inst || []).map((row) => row.id).filter(Boolean);
    const companyIdentity = await registeredCompanyIdentityMap(ids);
    const { data: msgs, error: me } = ids.length
      ? await db().from('provider_messages').select('*').in('installation_id', ids).order('created_at', { ascending: true })
      : { data: [], error: null };
    if (me) throw me;
    const by = new Map();
    for (const m of msgs || []) {
      if (!by.has(m.installation_id)) by.set(m.installation_id, []);
      by.get(m.installation_id).push(m);
    }
    const conversations = [];
    for (const i of inst || []) {
      const ms = by.get(i.id) || [];
      const access = accessPayload(i);
      const last = ms.at(-1);
      const company = companyIdentity.get(String(i.id));
      const businessName = resolveCompanyDisplayName(i.profile_name, i.service_customers?.business_name, company?.company_name, i.service_customers?.owner_name, i.display_name, i.device_code);
      conversations.push({
        id: i.id,
        installationId: i.id,
        deviceCode: i.device_code,
        displayName: i.display_name || '',
        profileName: businessName,
        profileLogo: i.profile_logo || '',
        businessName,
        customerName: company?.owner_name || i.service_customers?.owner_name,
        companyId: company?.id || null,
        smartOfficeId: i.service_customers?.smart_office_id || '',
        online: isCustomerOnline(i.id),
        lastSeenAt: i.last_seen_at || null,
        isActive: Boolean(access.allowed),
        accessStatus: access.accessStatus,
        lastMessage: last?.message || (last?.attachment_path ? 'Screenshot attached' : ''),
        lastMessageAt: last?.created_at || i.created_at,
        unreadCount: ms.filter(m => m.sender === 'customer' && !m.is_read).length,
        messages: await Promise.all(ms.map(mapProviderMessage)),
      });
    }
    conversations.sort((a, b) => {
      if (b.unreadCount !== a.unreadCount) return b.unreadCount - a.unreadCount;
      return new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0);
    });
    return json(res, 200, { conversations, total: Number(count || 0), page, pageSize });
  } catch (e) {
    console.error('adminMessages', e);
    const code = String(e?.code || '');
    if (['42703','PGRST204'].includes(code)) return json(res, 500, { error: 'Support profile schema is not installed. Apply server/db/migrations/001_central_schema.sql.' });
    return json(res, 500, { error: 'Unable to load provider messages.' });
  }
}


async function adminReply(req, res, id) {
  if (!method(req, res, ['POST']) || !requireAdmin(req, res)) return;
  try {
    const message = String(req.body?.message || '').trim();
    let attachment = null;
    try { attachment = parseSupportImageDataUrl(req.body?.attachmentDataUrl); }
    catch (error) { return json(res, 400, { error: error.message }); }
    if ((!message && !attachment) || message.length > 2000) return json(res, 400, { error: 'Add a message or image. Messages can be up to 2000 characters.' });

    let attachmentPath = null;
    if (attachment) {
      await ensureSupportAttachmentBucket();
      attachmentPath = `${id}/${Date.now()}-${randomToken().slice(0, 12)}.${attachment.ext}`;
      const bytes = new Uint8Array(attachment.buffer);
      const { error: uploadError } = await db().storage.from('support-attachments').upload(attachmentPath, bytes, { contentType: attachment.mime, upsert: false });
      if (uploadError) throw uploadError;
    }
    const payload = {
      installation_id: id,
      sender: 'provider',
      message: message || 'Shared an image',
      attachment_path: attachmentPath,
      attachment_name: cleanText(req.body?.attachmentName, 240),
      attachment_type: attachment?.mime || null,
      attachment_size: attachment?.buffer?.length || null,
    };
    const { data: insertedMessage, error } = await db().from('provider_messages').insert(payload).select('*').single();
    if (error) {
      if (attachmentPath) await db().storage.from('support-attachments').remove([attachmentPath]).catch(() => {});
      throw error;
    }
    const seenAt = new Date().toISOString();
    await db().from('provider_messages').update({ is_read: true, seen_at: seenAt }).eq('installation_id', id).eq('sender', 'customer').eq('is_read', false);
    const realtimeMessage = await mapProviderMessage(insertedMessage || payload);
    broadcastConversationEvent(id, 'message:new', { message: realtimeMessage }, 'customer');
    broadcastConversationEvent(id, 'message:seen', { seenBy: 'admin', seenAt }, 'customer');
    broadcastConversationEvent(id, 'conversation:update', { lastMessage: realtimeMessage.message, lastMessageAt: realtimeMessage.createdAt, unreadDelta: 0 }, 'admin');
    await notifyInstallation(id, 'PROVIDER_MESSAGE', 'New message from the real estate system', message || 'Image received', '/message-to-provider');
    return json(res, 200, { success: true, message: realtimeMessage });
  } catch (e) {
    console.error('adminReply', e);
    return json(res, 500, { error: 'Unable to send reply.' });
  }
}


async function adminMarkConversationRead(req, res, id) {
  if (!method(req, res, ['POST']) || !requireAdmin(req, res)) return;
  try {
    const seenAt = new Date().toISOString();
    const { error } = await db().from('provider_messages')
      .update({ is_read: true, seen_at: seenAt })
      .eq('installation_id', id)
      .eq('sender', 'customer')
      .eq('is_read', false);
    if (error) throw error;
    broadcastConversationEvent(id, 'message:seen', { seenBy: 'admin', seenAt }, 'customer');
    return json(res, 200, { success: true });
  } catch (e) {
    console.error('adminMarkConversationRead', e);
    return json(res, 500, { error: 'Unable to mark conversation as read.' });
  }
}

async function adminBroadcastMessage(req, res) {
  const adminSession = requireAdmin(req, res);
  if (!method(req, res, ['POST']) || !adminSession) return;
  try {
    const message = String(req.body?.message || '').trim();
    const allCustomers = Boolean(req.body?.allCustomers || req.body?.allActive);
    const requestedIds = Array.isArray(req.body?.installationIds) ? [...new Set(req.body.installationIds.map(String))].slice(0, 1000) : [];
    if (!message || message.length > 2000) return json(res, 400, { error: 'Message must be between 1 and 2000 characters.' });
    if (!allCustomers && !requestedIds.length) return json(res, 400, { error: 'Select at least one customer.' });
    let deviceQuery = db().from('installations').select('*');
    if (!allCustomers) deviceQuery = deviceQuery.in('id', requestedIds);
    const { data: devices, error } = await deviceQuery;
    if (error) throw error;
    const targetIds = (devices || []).filter((item) => !item.merged_into_installation_id).map((item) => item.id);
    if (!targetIds.length) return json(res, 400, { error: 'No registered customers were found.' });
    const client = await pgPool().connect();
    let sentMessages;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`INSERT INTO public.provider_messages (installation_id, sender, message)
        SELECT id, 'provider', $2 FROM unnest($1::uuid[]) AS id RETURNING *`, [targetIds, message]);
      await client.query(`INSERT INTO public.customer_notifications (installation_id, notification_type, title, message, target_path)
        SELECT id, 'PROVIDER_MESSAGE', 'Real Estate Office', $2, '/message-to-provider' FROM unnest($1::uuid[]) AS id`, [targetIds, message]);
      await client.query('COMMIT');
      sentMessages = inserted.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    for (const row of sentMessages) {
      broadcastConversationEvent(row.installation_id, 'message:new', { message: await mapProviderMessage(row) }, 'customer');
      broadcastConversationEvent(row.installation_id, 'notification:new', { title: 'Real Estate Office', message, targetPath: '/message-to-provider' }, 'customer');
      broadcastConversationEvent(row.installation_id, 'conversation:update', { lastMessage: message, lastMessageAt: row.created_at, unreadDelta: 0 }, 'admin');
    }
    await recordAdminAudit(req, adminSession, { action: 'BROADCAST_SENT', category: 'MESSAGE', entityType: 'broadcast', entityId: `broadcast-${Date.now()}`, summary: `Sent broadcast to ${targetIds.length} registered customer device${targetIds.length === 1 ? '' : 's'}`, metadata: { sentCount: targetIds.length, audience: allCustomers ? 'ALL_CUSTOMERS' : 'SELECTED', messagePreview: message.slice(0, 180) } });
    return json(res, 200, { success: true, sentCount: targetIds.length });
  } catch (e) {
    console.error('adminBroadcastMessage', e);
    return json(res, 500, { error: 'Unable to send broadcast message.' });
  }
}

async function adminMessageAction(req, res, messageId, reaction = false) {
  if (!method(req, res, reaction ? ['POST'] : ['PATCH', 'DELETE']) || !requireAdmin(req, res)) return;
  try {
    const { data: messageRow, error: readError } = await db().from('provider_messages').select('*').eq('id', messageId).maybeSingle();
    if (readError) throw readError;
    if (!messageRow) return json(res, 404, { error: 'Message not found.' });
    if (reaction) {
      const emoji = String(req.body?.emoji || '').trim().slice(0, 16);
      if (!emoji) return json(res, 400, { error: 'Emoji is required.' });
      const reactions = toggleReactionMap(messageRow.reactions, emoji, 'provider');
      const { error } = await db().from('provider_messages').update({ reactions }).eq('id', messageId);
      if (error) throw error;
      return json(res, 200, { success: true, reactions });
    }
    if (req.method === 'DELETE') {
      const { error } = await db().from('provider_messages').delete().eq('id', messageId);
      if (error) throw error;
      if (messageRow.attachment_path) await db().storage.from('support-attachments').remove([messageRow.attachment_path]).catch(() => {});
      return json(res, 200, { success: true });
    }
    if (messageRow.sender !== 'provider') return json(res, 403, { error: 'Customer messages cannot be edited by the provider.' });
    const message = String(req.body?.message || '').trim();
    if (!message || message.length > 2000) return json(res, 400, { error: 'Message must be between 1 and 2000 characters.' });
    const { error } = await db().from('provider_messages').update({ message, edited_at: new Date().toISOString() }).eq('id', messageId);
    if (error) throw error;
    return json(res, 200, { success: true });
  } catch (e) {
    console.error('adminMessageAction', e);
    return json(res, 500, { error: 'Unable to update message.' });
  }
}


function normalizeInnovationVersion(value) {
  return String(value || '').trim().replace(/^v[-\s]*/i, '').slice(0, 40);
}

function innovationVersionParts(value) {
  return normalizeInnovationVersion(value).split(/[^0-9]+/).filter(Boolean).map((part) => Number(part || 0));
}

function compareInnovationVersions(a, b) {
  const aa = innovationVersionParts(a);
  const bb = innovationVersionParts(b);
  const length = Math.max(aa.length, bb.length, 1);
  for (let i = 0; i < length; i += 1) {
    const diff = Number(aa[i] || 0) - Number(bb[i] || 0);
    if (diff) return diff;
  }
  return String(a || '').localeCompare(String(b || ''));
}

function mapInnovation(row) {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    progress: Number(row.progress || 0),
    requestedByInstallationId: row.requested_by_installation_id || null,
    requesterBusinessName: row.requester_business_name || '',
    requesterProfileName: row.requester_profile_name || '',
    requesterProfileLogo: row.requester_profile_logo || '',
    requesterDeviceCode: row.requester_device_code || '',
    description: row.description || '',
    sortOrder: Number(row.sort_order || 0),
    isPublished: row.is_published !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function innovationRequesterSnapshot(installationId) {
  if (!installationId) return {};
  const { data, error } = await db().from('installations')
    .select('id,device_code,profile_name,profile_logo,display_name,device_name,service_customers(business_name,owner_name)')
    .eq('id', installationId).maybeSingle();
  if (error) throw error;
  if (!data) return {};
  const companyIdentity = await registeredCompanyIdentityMap([data.id]);
  const company = companyIdentity.get(String(data.id));
  const businessName = company?.company_name || data.service_customers?.business_name || '';
  return {
    requested_by_installation_id: data.id,
    requester_business_name: businessName,
    requester_profile_name: businessName || data.profile_name || data.service_customers?.owner_name || data.display_name || data.device_name || data.device_code || '',
    requester_profile_logo: data.profile_logo || '',
    requester_device_code: data.device_code || '',
  };
}

async function innovationFeedbackMap(innovationIds, installationId = null) {
  const ids = [...new Set((innovationIds || []).filter(Boolean))];
  const result = new Map(ids.map((id) => [id, {
    usefulCount: 0,
    notUsefulCount: 0,
    totalCount: 0,
    usefulPercent: 0,
    myVote: null,
  }]));
  if (!ids.length) return result;

  const { data, error } = await db().from('innovation_feedback')
    .select('innovation_id,installation_id,vote')
    .in('innovation_id', ids)
    .limit(10000);
  if (error) throw error;

  (data || []).forEach((row) => {
    const current = result.get(row.innovation_id);
    if (!current) return;
    if (row.vote === 'useful') current.usefulCount += 1;
    if (row.vote === 'not_useful') current.notUsefulCount += 1;
    current.totalCount += 1;
    if (installationId && String(row.installation_id) === String(installationId)) {
      current.myVote = row.vote;
    }
  });

  result.forEach((value) => {
    value.usefulPercent = value.totalCount
      ? Math.round((value.usefulCount / value.totalCount) * 100)
      : 0;
  });
  return result;
}

async function publicInnovationFeedback(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const installation = await installationFromRequest(req);
    if (!installation) return json(res, 401, { error: 'This device is not registered.' });

    const innovationId = String(req.body?.innovationId || '').trim();
    const vote = String(req.body?.vote || '').trim();
    if (!innovationId) return json(res, 400, { error: 'Innovation is required.' });
    if (!['useful', 'not_useful'].includes(vote)) return json(res, 400, { error: 'Invalid feedback vote.' });

    const { data: innovation, error: innovationError } = await db().from('innovations')
      .select('id,is_published')
      .eq('id', innovationId)
      .maybeSingle();
    if (innovationError) throw innovationError;
    if (!innovation || innovation.is_published === false) return json(res, 404, { error: 'Innovation was not found.' });

    const now = new Date().toISOString();
    const { error } = await db().from('innovation_feedback').upsert({
      innovation_id: innovationId,
      installation_id: installation.id,
      vote,
      updated_at: now,
    }, { onConflict: 'innovation_id,installation_id' });
    if (error) throw error;

    const feedbackMap = await innovationFeedbackMap([innovationId], installation.id);
    return json(res, 200, { success: true, feedback: feedbackMap.get(innovationId) });
  } catch (e) {
    console.error('publicInnovationFeedback', e);
    if (['42P01','PGRST205'].includes(String(e?.code || ''))) {
      return json(res, 500, { error: 'Innovation feedback database is not installed. Check the PostgreSQL innovation_feedback schema.' });
    }
    return json(res, 500, { error: 'Unable to save your feedback.' });
  }
}

async function publicInnovations(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const { data, error } = await db().from('innovations').select('*').eq('is_published', true).order('sort_order', { ascending: true }).order('created_at', { ascending: true }).limit(1000);
    if (error) throw error;
    const rows = (data || []).map(mapInnovation);
    const installation = await installationFromRequest(req).catch(() => null);
    let feedbackMap;
    try {
      feedbackMap = await innovationFeedbackMap(rows.map((row) => row.id), installation?.id || null);
    } catch (feedbackError) {
      const code = String(feedbackError?.code || '');
      if (!['42P01', 'PGRST205'].includes(code)) throw feedbackError;
      feedbackMap = new Map(rows.map((row) => [row.id, { usefulCount: 0, notUsefulCount: 0, totalCount: 0, usefulPercent: 0, myVote: null }]));
    }
    const enrichedRows = rows.map((row) => ({ ...row, feedback: feedbackMap.get(row.id) || { usefulCount: 0, notUsefulCount: 0, totalCount: 0, usefulPercent: 0, myVote: null } }));
    const latestVersion = rows.map((r) => r.version).sort(compareInnovationVersions).at(-1) || '0.0.1';
    return json(res, 200, { innovations: enrichedRows, latestVersion });
  } catch (e) {
    console.error('publicInnovations', e);
    if (['42P01','PGRST205'].includes(String(e?.code || ''))) return json(res, 500, { error: 'Innovation database is not installed. Check the PostgreSQL innovations schema.' });
    return json(res, 500, { error: 'Unable to load innovations.' });
  }
}

async function adminInnovations(req, res) {
  const adminSession = requireAdmin(req, res);
  if (!method(req, res, ['GET', 'POST']) || !adminSession) return;
  try {
    if (req.method === 'GET') {
      const { data, error } = await db().from('innovations').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }).limit(1000);
      if (error) throw error;
      const rows = (data || []).map(mapInnovation);
      const latestVersion = rows.map((r) => r.version).sort(compareInnovationVersions).at(-1) || '0.0.1';
      return json(res, 200, { innovations: rows, latestVersion });
    }
    const version = normalizeInnovationVersion(req.body?.version);
    const title = cleanText(req.body?.title, 180);
    const description = cleanText(req.body?.description, 5000);
    const progress = Math.min(100, Math.max(0, Number(req.body?.progress || 0)));
    if (!version) return json(res, 400, { error: 'Version is required.' });
    if (!title) return json(res, 400, { error: 'Title is required.' });
    if (!description) return json(res, 400, { error: 'Description is required.' });
    const requester = await innovationRequesterSnapshot(String(req.body?.requestedByInstallationId || '').trim());
    const payload = {
      version, title, description, progress,
      sort_order: Number(req.body?.sortOrder || 0),
      is_published: req.body?.isPublished !== false,
      ...requester,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db().from('innovations').insert(payload).select('*').single();
    if (error) throw error;
    await recordAdminAudit(req, adminSession, { action: 'INNOVATION_CREATED', category: 'INNOVATION', entityType: 'innovation', entityId: data.id, summary: `Created v${version}: ${title}`, metadata: { version, title, progress, isPublished: payload.is_published } });
    return json(res, 201, { innovation: mapInnovation(data) });
  } catch (e) {
    console.error('adminInnovations', e);
    if (['42P01','PGRST205'].includes(String(e?.code || ''))) return json(res, 500, { error: 'Innovation database is not installed. Check the PostgreSQL innovations schema.' });
    return json(res, 500, { error: 'Unable to manage innovations.' });
  }
}

async function adminInnovationItem(req, res, id) {
  const adminSession = requireAdmin(req, res);
  if (!method(req, res, ['PATCH', 'DELETE']) || !adminSession) return;
  try {
    if (req.method === 'DELETE') {
      const { data: beforeDelete } = await db().from('innovations').select('version,title').eq('id', id).maybeSingle();
      const { error } = await db().from('innovations').delete().eq('id', id);
      if (error) throw error;
      await recordAdminAudit(req, adminSession, { action: 'INNOVATION_DELETED', category: 'INNOVATION', entityType: 'innovation', entityId: id, summary: beforeDelete ? `Deleted innovation ${beforeDelete.version}: ${beforeDelete.title}` : 'Deleted innovation update', severity: 'WARNING' });
      return json(res, 200, { success: true });
    }
    const patch = { updated_at: new Date().toISOString() };
    if ('version' in (req.body || {})) {
      const version = normalizeInnovationVersion(req.body?.version);
      if (!version) return json(res, 400, { error: 'Version is required.' });
      patch.version = version;
    }
    if ('title' in (req.body || {})) patch.title = cleanText(req.body?.title, 180);
    if ('description' in (req.body || {})) patch.description = cleanText(req.body?.description, 5000);
    if ('progress' in (req.body || {})) patch.progress = Math.min(100, Math.max(0, Number(req.body?.progress || 0)));
    if ('sortOrder' in (req.body || {})) patch.sort_order = Number(req.body?.sortOrder || 0);
    if ('isPublished' in (req.body || {})) patch.is_published = req.body?.isPublished !== false;
    if ('requestedByInstallationId' in (req.body || {})) {
      const requesterId = String(req.body?.requestedByInstallationId || '').trim();
      Object.assign(patch, requesterId ? await innovationRequesterSnapshot(requesterId) : {
        requested_by_installation_id: null, requester_business_name: '', requester_profile_name: '', requester_profile_logo: '', requester_device_code: '',
      });
    }
    const { data, error } = await db().from('innovations').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    await recordAdminAudit(req, adminSession, { action: 'INNOVATION_UPDATED', category: 'INNOVATION', entityType: 'innovation', entityId: id, summary: `Updated innovation ${data.version}: ${data.title}`, metadata: { version: data.version, title: data.title, progress: data.progress, isPublished: data.is_published } });
    return json(res, 200, { innovation: mapInnovation(data) });
  } catch (e) {
    console.error('adminInnovationItem', e);
    return json(res, 500, { error: 'Unable to update innovation.' });
  }
}



async function customerRealtimeEvent(req, res) {
  if (!method(req, res, ['POST'])) return;
  const installation = await installationFromRequest(req);
  if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
  dispatchRealtimeEvent({ role: 'customer', installationId: installation.id }, req.body || {});
  return json(res, 200, { success: true });
}

async function adminRealtimeEvent(req, res) {
  const session = requireAdmin(req, res);
  if (!session || !method(req, res, ['POST'])) return;
  dispatchRealtimeEvent({ role: 'admin', adminEmail: session.email || '' }, req.body || {});
  return json(res, 200, { success: true });
}

async function customerRealtimeTicket(req, res) {
  if (!method(req, res, ['POST'])) return;
  const installation = await installationFromRequest(req);
  if (!installation) return json(res, 401, { error: 'Invalid installation token.' });
  return json(res, 200, createRealtimeTicket({ role: 'customer', installationId: installation.id }));
}

async function adminRealtimeTicket(req, res) {
  const session = requireAdmin(req, res);
  if (!session || !method(req, res, ['POST'])) return;
  return json(res, 200, createRealtimeTicket({ role: 'admin', adminEmail: session.email || '' }));
}

export default async function handler(req, res) {
  const route = routeFromRequest(req);

  if (!route || route === 'index' || route === 'health') {
    return json(res, 200, { success: true, service: 'safarpro-central-api' });
  }

  if (route === 'customer-auth/signup') return customerAccountSignUp(req, res);
  if (route === 'customer-auth/signin') return customerAccountSignIn(req, res);
  if (route === 'customer-auth/claim') return customerAccountClaim(req, res);
  if (route === 'customer-auth/security') return customerAccountSecurity(req, res);
  if (route === 'installations/recover') return recoverInstallation(req, res);
  if (route === 'installations/register') return registerInstallation(req, res);
  if (route === 'installations/heartbeat') return heartbeat(req, res);
  if (route === 'installations/access/check') return accessCheck(req, res);
  if (route === 'installations/access/sync') return accessSync(req, res);
  if (route === 'customer/messages') return customerMessages(req, res);
  if (route === 'customer/messages/unread') return customerMessageUnread(req, res);
  if (route === 'customer/support-profile') return customerSupportProfile(req, res);
  if (route === 'customer/profile') return customerProfile(req, res);
  if (route === 'customer/subscription') return customerSubscription(req, res);
  if (route === 'customer/credit/summary') return customerCreditSummary(req, res);
  if (route === 'customer/credit/ledger') return customerCreditLedger(req, res);
  if (route === 'customer/referrals') return customerReferrals(req, res);
  if (route === 'customer/credit/transfers') return customerCreditTransfer(req, res);
  if (route === 'customer/payment-requests') return customerPaymentRequests(req, res);
  if (route === 'customer/notifications') return customerNotifications(req, res);
  if (route === 'customer/notifications/read') return customerNotifications(req, res, true);
  if (route === 'company/profile') return customerCompanyProfile(req, res);
  if (route === 'company/registration-request') return customerCompanyRegistrationRequest(req, res);
  if (route === 'company/registered-companies') return customerRegisteredCompanies(req, res);
  if (route === 'company/profile-sync') return customerCompanyProfileSync(req, res);
  if (route === 'company/register') return customerCompanyRegister(req, res);
  if (route === 'company/login') return customerCompanyLogin(req, res);
  if (route === 'company/backup/sign') return customerBackupSign(req, res);
  if (route === 'company/backup/verify') return customerBackupVerify(req, res);
  if (route === 'innovations') return publicInnovations(req, res);
  if (route === 'innovations/feedback') return publicInnovationFeedback(req, res);
  if (route === 'admin/trial-settings') return adminTrialSettings(req, res);
  if (route === 'admin/auth/login') return adminLogin(req, res);
  if (route === 'admin/auth/logout') return adminLogout(req, res);
  if (route === 'admin/auth/refresh') return adminRefresh(req, res);
  if (route === 'admin/dashboard/installations') return adminInstallations(req, res);
  if (route === 'admin/dashboard/summary') return adminSummary(req, res);
  if (route === 'admin/dashboard/analytics') return adminAnalytics(req, res);
  if (route === 'admin/dashboard/reports') return adminReports(req, res);
  if (route === 'admin/registered-devices') return adminRegisteredDevices(req, res);
  if (route === 'admin/company-registration-requests') return adminCompanyRegistrationRequests(req, res, 'PENDING');
  if (route === 'admin/registered-companies') return adminCompanyRegistrationRequests(req, res, 'APPROVED');
  const companyDelete = route.match(/^admin\/registered-companies\/([^/]+)$/);
  if (companyDelete) return adminDeleteCompanyRegistration(req, res, decodeURIComponent(companyDelete[1]));
  if (route === 'admin/innovations') return adminInnovations(req, res);
  if (route === 'admin/audit-logs') return adminAuditLogs(req, res);
  if (route === 'admin/backup/export') return adminBackupExport(req, res);
  if (route === 'admin/backup/restore/prepare') return adminBackupRestorePrepare(req, res);
  if (route === 'admin/backup/restore/table') return adminBackupRestoreTable(req, res);
  if (route === 'admin/backup/restore/storage') return adminBackupRestoreStorage(req, res);
  if (route === 'admin/backup/restore/finalize') return adminBackupRestoreFinalize(req, res);
  if (route === 'admin/customers/create') return adminCreateCustomer(req, res);
  if (route === 'admin/customers') return adminCustomers(req, res);
  const customerSecurityMatch = route.match(/^admin\/customers\/([^/]+)\/security$/);
  if (customerSecurityMatch) return adminCustomerSecurity(req, res, decodeURIComponent(customerSecurityMatch[1]));
  if (route === 'admin/messages/unread') return adminMessageUnread(req, res);
  if (route === 'admin/realtime-ticket') return adminRealtimeTicket(req, res);
  if (route === 'customer/realtime-ticket') return customerRealtimeTicket(req, res);
  if (route === 'admin/realtime-event') return adminRealtimeEvent(req, res);
  if (route === 'customer/realtime-event') return customerRealtimeEvent(req, res);
  if (route === 'admin/push-subscriptions') return adminPushSubscriptions(req, res);
  if (route === 'admin/messages') return adminMessages(req, res);
  if (route === 'admin/messages/broadcast') return adminBroadcastMessage(req, res);
  if (route === 'admin/licenses') return adminLicenses(req, res);
  if (route === 'admin/billing/plans') return adminPlans(req, res);
  if (route === 'admin/billing/subscriptions') return adminSubscriptions(req, res);
  if (route === 'admin/billing/payments') return adminPayments(req, res);
  if (route === 'admin/billing/payment-methods') return adminPaymentMethods(req, res);
  if (route === 'admin/billing/payment-requests') return adminPaymentRequests(req, res);
  if (route === 'admin/credits') return adminCredits(req, res);

  let match = route.match(/^customer\/credit\/recipient\/([^/]+)$/);
  if (match) return customerCreditRecipient(req, res, decodeURIComponent(match[1]));

  match = route.match(/^admin\/company-registration-requests\/([^/]+)\/approve$/);
  if (match) return adminApproveCompanyRegistration(req, res, decodeURIComponent(match[1]));

  match = route.match(/^admin\/company-registration-requests\/([^/]+)\/reject$/);
  if (match) return adminRejectCompanyRegistration(req, res, decodeURIComponent(match[1]));

  match = route.match(/^admin\/innovations\/([^/]+)$/);
  if (match) return adminInnovationItem(req, res, decodeURIComponent(match[1]));

  match = route.match(/^admin\/credits\/([^/]+)\/adjust$/);
  if (match) return adminCreditAdjustment(req, res, decodeURIComponent(match[1]));
  match = route.match(/^admin\/credits\/([^/]+)$/);
  if (match) return adminCreditDetail(req, res, decodeURIComponent(match[1]));

  match = route.match(/^admin\/customers\/([^/]+)\/(block|unblock)$/);
  if (match) return adminSetCustomerBlock(req, res, decodeURIComponent(match[1]), match[2] === 'block');

  match = route.match(/^admin\/customers\/([^/]+)\/grant-access$/);
  if (match) return adminGrantCustomerAccess(req, res, decodeURIComponent(match[1]));

  match = route.match(/^admin\/customers\/([^/]+)\/profile$/);
  if (match) return adminCustomerProfile(req, res, decodeURIComponent(match[1]));

  match = route.match(/^admin\/installations\/([^/]+)\/approve$/);
  if (match) return adminApproveDevice(req, res, decodeURIComponent(match[1]));

  match = route.match(/^admin\/installations\/([^/]+)\/(block|unblock)$/);
  if (match) return adminSetBlock(req, res, decodeURIComponent(match[1]), match[2] === 'block');

  match = route.match(/^admin\/installations\/([^/]+)\/grant-access$/);
  if (match) return adminGrantAccess(req, res, decodeURIComponent(match[1]));

  match = route.match(/^admin\/installations\/([^/]+)\/profile$/);
  if (match) return adminDeviceProfile(req, res, decodeURIComponent(match[1]));
  match = route.match(/^admin\/installations\/([^/]+)\/delete-preview$/);
  if (match) return adminDeviceDeletePreview(req, res, decodeURIComponent(match[1]));
  match = route.match(/^admin\/installations\/([^/]+)$/);
  if (match) return adminDeleteDevice(req, res, decodeURIComponent(match[1]));
  match = route.match(/^admin\/installations\/([^/]+)\/name$/);
  if (match) return adminRenameDevice(req, res, decodeURIComponent(match[1]));
  match = route.match(/^admin\/billing\/plans\/([^/]+)$/);
  if (match) return adminPlans(req, res, decodeURIComponent(match[1]));
  match = route.match(/^admin\/billing\/payment-methods\/([^/]+)$/);
  if (match) return adminPaymentMethods(req, res, decodeURIComponent(match[1]));
  match = route.match(/^admin\/billing\/payment-requests\/([^/]+)\/(approve|reject)$/);
  if (match) return adminReviewPaymentRequest(req, res, decodeURIComponent(match[1]), match[2]);
  match = route.match(/^admin\/billing\/payment-requests\/([^/]+)\/receipt$/);
  if (match) return adminPaymentReceipt(req, res, decodeURIComponent(match[1]));

  match = route.match(/^admin\/messages\/([^/]+)\/read$/);
  if (match) return adminMarkConversationRead(req, res, decodeURIComponent(match[1]));
  match = route.match(/^admin\/messages\/([^/]+)\/reply$/);
  if (match) return adminReply(req, res, decodeURIComponent(match[1]));

  match = route.match(/^customer\/messages\/([^/]+)\/reaction$/);
  if (match) return customerMessageAction(req, res, decodeURIComponent(match[1]), true);
  match = route.match(/^customer\/messages\/([^/]+)$/);
  if (match) return customerMessageAction(req, res, decodeURIComponent(match[1]), false);
  match = route.match(/^admin\/messages\/message\/([^/]+)\/reaction$/);
  if (match) return adminMessageAction(req, res, decodeURIComponent(match[1]), true);
  match = route.match(/^admin\/messages\/message\/([^/]+)$/);
  if (match) return adminMessageAction(req, res, decodeURIComponent(match[1]), false);

  return json(res, 404, { error: 'API route not found.' });
}
