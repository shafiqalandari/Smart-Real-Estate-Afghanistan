import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const { Pool } = pg;

let pool;
const columnCache = new Map();

function getPool() {
  if (pool) return pool;
  pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'safarpro',
    user: process.env.PGUSER || 'safarpro_user',
    password: process.env.PGPASSWORD || '',
    max: Number(process.env.PGPOOL_MAX || 20),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (error) => console.error('PostgreSQL pool error:', error));
  return pool;
}

export { getPool as pgPool };

function safeIdent(value) {
  const text = String(value || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) throw new Error(`Unsafe SQL identifier: ${text}`);
  return `"${text}"`;
}

async function tableColumns(table) {
  if (columnCache.has(table)) return columnCache.get(table);
  const result = await getPool().query(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  const map = new Map(result.rows.map((row) => [row.column_name, row]));
  columnCache.set(table, map);
  return map;
}

function splitTopLevel(input) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = input.slice(start).trim();
  if (last) out.push(last);
  return out;
}

function parseSelect(selectText = '*') {
  const items = splitTopLevel(String(selectText || '*'));
  const base = [];
  const relations = [];
  for (const item of items) {
    const match = item.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/s);
    if (match) relations.push({ name: match[1], select: match[2] || '*' });
    else base.push(item);
  }
  return { base: base.length ? base : ['*'], relations };
}

const relationMap = {
  service_customers: { local: 'customer_id', foreign: 'id' },
  installations: { local: 'installation_id', foreign: 'id' },
  subscription_plans: { local: 'plan_id', foreign: 'id' },
  payment_methods: { local: 'payment_method_id', foreign: 'id' },
  registered_companies: { local: 'company_id', foreign: 'id' },
};

async function fetchRelationRows(rows, relation) {
  const mapping = relationMap[relation.name];
  if (!mapping || !rows.length) {
    for (const row of rows) row[relation.name] = null;
    return;
  }
  const ids = [...new Set(rows.map((row) => row?.[mapping.local]).filter(Boolean))];
  if (!ids.length) {
    for (const row of rows) row[relation.name] = null;
    return;
  }
  const nested = parseSelect(relation.select);
  const required = new Set(nested.base.includes('*') ? [] : nested.base);
  required.add(mapping.foreign);
  for (const child of nested.relations) {
    const childMap = relationMap[child.name];
    if (childMap) required.add(childMap.local);
  }
  const relColumns = nested.base.includes('*') ? '*' : [...required].map(safeIdent).join(', ');
  const result = await getPool().query(
    `SELECT ${relColumns} FROM ${safeIdent(relation.name)} WHERE ${safeIdent(mapping.foreign)} = ANY($1::uuid[])`,
    [ids],
  );
  if (nested.relations.length) {
    for (const child of nested.relations) await fetchRelationRows(result.rows, child);
  }
  const byId = new Map(result.rows.map((row) => [String(row[mapping.foreign]), row]));
  for (const row of rows) row[relation.name] = byId.get(String(row[mapping.local])) || null;
}

function mapDbError(error) {
  if (!error) return null;
  if (error.code === '42P01') return { ...error, code: '42P01' };
  if (error.code === '42703') return { ...error, code: '42703' };
  return error;
}

function prepareValue(meta, value) {
  if (value === undefined) return null;
  if (!meta) return value;
  if ((meta.data_type === 'json' || meta.data_type === 'jsonb') && value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.operation = 'select';
    this.selectText = '*';
    this.selectOptions = {};
    this.payload = null;
    this.filters = [];
    this.orders = [];
    this.limitValue = null;
    this.rangeValue = null;
    this.singleMode = null;
    this.upsertOptions = {};
  }

  select(columns = '*', options = {}) { this.selectText = columns || '*'; this.selectOptions = options || {}; return this; }
  insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload) { this.operation = 'update'; this.payload = payload; return this; }
  delete() { this.operation = 'delete'; return this; }
  upsert(payload, options = {}) { this.operation = 'upsert'; this.payload = payload; this.upsertOptions = options || {}; return this; }
  eq(column, value) { this.filters.push({ type: 'eq', column, value }); return this; }
  neq(column, value) { this.filters.push({ type: 'neq', column, value }); return this; }
  is(column, value) { this.filters.push({ type: 'is', column, value }); return this; }
  not(column, operator, value) { this.filters.push({ type: 'not', column, operator, value }); return this; }
  in(column, values) { this.filters.push({ type: 'in', column, value: Array.isArray(values) ? values : [] }); return this; }
  ilike(column, value) { this.filters.push({ type: 'ilike', column, value }); return this; }
  gte(column, value) { this.filters.push({ type: 'gte', column, value }); return this; }
  or(expression) { this.filters.push({ type: 'or', expression: String(expression || '') }); return this; }
  order(column, { ascending = true } = {}) { this.orders.push({ column, ascending }); return this; }
  limit(value) { this.limitValue = Math.max(0, Number(value || 0)); return this; }
  range(from, to) { this.rangeValue = [Math.max(0, Number(from || 0)), Math.max(0, Number(to || 0))]; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }

  then(resolve, reject) { return this.execute().then(resolve, reject); }

  async whereClause(values, meta) {
    const clauses = [];
    const add = (value) => { values.push(value); return `$${values.length}`; };
    for (const filter of this.filters) {
      if (filter.type === 'or') {
        const pieces = splitTopLevel(filter.expression).map((piece) => {
          const m = piece.match(/^([A-Za-z_][A-Za-z0-9_]*)\.(ilike|eq)\.(.*)$/s);
          if (!m) return null;
          const [, column, op, raw] = m;
          const p = add(raw);
          return op === 'ilike' ? `${safeIdent(column)} ILIKE ${p}` : `${safeIdent(column)} = ${p}`;
        }).filter(Boolean);
        if (pieces.length) clauses.push(`(${pieces.join(' OR ')})`);
        continue;
      }
      const column = safeIdent(filter.column);
      if (filter.type === 'is') {
        clauses.push(filter.value === null ? `${column} IS NULL` : `${column} IS NOT DISTINCT FROM ${add(filter.value)}`);
      } else if (filter.type === 'not') {
        if (filter.operator === 'is' && filter.value === null) clauses.push(`${column} IS NOT NULL`);
        else clauses.push(`NOT (${column} IS NOT DISTINCT FROM ${add(filter.value)})`);
      } else if (filter.type === 'in') {
        if (!filter.value.length) clauses.push('FALSE');
        else {
          const colMeta = meta.get(filter.column);
          const cast = colMeta?.udt_name === 'uuid' ? '::uuid[]' : '';
          clauses.push(`${column} = ANY(${add(filter.value)}${cast})`);
        }
      } else if (filter.type === 'eq') clauses.push(`${column} = ${add(prepareValue(meta.get(filter.column), filter.value))}`);
      else if (filter.type === 'neq') clauses.push(`${column} <> ${add(prepareValue(meta.get(filter.column), filter.value))}`);
      else if (filter.type === 'ilike') clauses.push(`${column} ILIKE ${add(filter.value)}`);
      else if (filter.type === 'gte') clauses.push(`${column} >= ${add(prepareValue(meta.get(filter.column), filter.value))}`);
    }
    return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  }

  async execute() {
    try {
      const meta = await tableColumns(this.table);
      if (!meta.size) {
        const err = new Error(`relation "${this.table}" does not exist`);
        err.code = '42P01';
        throw err;
      }
      const parsed = parseSelect(this.selectText);
      const values = [];
      let sql = '';
      let where = '';
      if (this.operation === 'select') where = await this.whereClause(values, meta);
      let wantsRows = this.operation === 'select' || Boolean(this.selectText);

      if (this.operation === 'select') {
        const required = new Set(parsed.base.includes('*') ? [] : parsed.base);
        for (const relation of parsed.relations) {
          const mapping = relationMap[relation.name];
          if (mapping) required.add(mapping.local);
        }
        const cols = parsed.base.includes('*') ? '*' : [...required].map(safeIdent).join(', ');
        sql = `SELECT ${cols} FROM ${safeIdent(this.table)}${where}`;
        if (this.orders.length) sql += ` ORDER BY ${this.orders.map((o) => `${safeIdent(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ')}`;
        if (this.rangeValue) {
          const [from, to] = this.rangeValue;
          sql += ` LIMIT ${Math.max(0, to - from + 1)} OFFSET ${from}`;
        } else if (this.limitValue !== null) sql += ` LIMIT ${this.limitValue}`;
      } else if (this.operation === 'insert' || this.operation === 'upsert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        if (!rows.length) return { data: [], error: null, count: 0 };
        const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
        const tuples = rows.map((row) => {
          const placeholders = columns.map((column) => {
            values.push(prepareValue(meta.get(column), row?.[column] ?? null));
            return `$${values.length}`;
          });
          return `(${placeholders.join(', ')})`;
        });
        sql = `INSERT INTO ${safeIdent(this.table)} (${columns.map(safeIdent).join(', ')}) VALUES ${tuples.join(', ')}`;
        if (this.operation === 'upsert') {
          const conflict = String(this.upsertOptions.onConflict || 'id').split(',').map((x) => x.trim()).filter(Boolean);
          const updateCols = columns.filter((c) => !conflict.includes(c));
          sql += ` ON CONFLICT (${conflict.map(safeIdent).join(', ')}) DO ${updateCols.length ? `UPDATE SET ${updateCols.map((c) => `${safeIdent(c)} = EXCLUDED.${safeIdent(c)}`).join(', ')}` : 'NOTHING'}`;
        }
        sql += ' RETURNING *';
      } else if (this.operation === 'update') {
        const entries = Object.entries(this.payload || {}).filter(([, v]) => v !== undefined);
        if (!entries.length) return { data: [], error: null, count: 0 };
        const sets = entries.map(([column, value]) => {
          values.push(prepareValue(meta.get(column), value));
          return `${safeIdent(column)} = $${values.length}`;
        });
        const updateWhere = await this.whereClause(values, meta);
        sql = `UPDATE ${safeIdent(this.table)} SET ${sets.join(', ')}${updateWhere} RETURNING *`;
      } else if (this.operation === 'delete') {
        const deleteWhere = await this.whereClause(values, meta);
        sql = `DELETE FROM ${safeIdent(this.table)}${deleteWhere} RETURNING *`;
      }

      if (this.selectOptions?.head && this.selectOptions?.count === 'exact' && this.operation === 'select') {
        const countValues = [];
        const countWhere = await this.whereClause(countValues, meta);
        const counted = await getPool().query(`SELECT COUNT(*)::bigint AS count FROM ${safeIdent(this.table)}${countWhere}`, countValues);
        return { data: null, error: null, count: Number(counted.rows[0]?.count || 0) };
      }

      const result = await getPool().query(sql, values);
      let data = result.rows;
      if (parsed.relations.length && data.length) {
        for (const relation of parsed.relations) await fetchRelationRows(data, relation);
      }
      let count = null;
      if (this.selectOptions?.count === 'exact' && this.operation === 'select') {
        const countValues = [];
        const countWhere = await this.whereClause(countValues, meta);
        const counted = await getPool().query(`SELECT COUNT(*)::bigint AS count FROM ${safeIdent(this.table)}${countWhere}`, countValues);
        count = Number(counted.rows[0]?.count || 0);
      }
      if (this.singleMode === 'single') {
        if (data.length !== 1) {
          const err = new Error(data.length ? 'Multiple rows returned' : 'No rows returned');
          err.code = data.length ? 'PGRST116' : 'PGRST116';
          return { data: null, error: err, count };
        }
        data = data[0];
      } else if (this.singleMode === 'maybe') {
        if (data.length > 1) {
          const err = new Error('Multiple rows returned');
          err.code = 'PGRST116';
          return { data: null, error: err, count };
        }
        data = data[0] || null;
      }
      return { data, error: null, count };
    } catch (error) {
      return { data: null, error: mapDbError(error), count: null };
    }
  }
}

function storageRoot() {
  return path.resolve(process.env.STORAGE_ROOT || path.join(process.cwd(), 'storage'));
}

function safeStoragePath(bucket, objectPath = '') {
  const safeBucket = String(bucket || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeBucket) throw new Error('Invalid storage bucket.');
  const normalized = String(objectPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').some((part) => part === '..')) throw new Error('Invalid storage path.');
  const full = path.resolve(storageRoot(), safeBucket, normalized);
  const root = path.resolve(storageRoot(), safeBucket);
  if (!(full === root || full.startsWith(`${root}${path.sep}`))) throw new Error('Invalid storage path.');
  return { full, root, bucket: safeBucket, objectPath: normalized };
}

function storageSecret() {
  return String(process.env.STORAGE_SIGNING_SECRET || process.env.ADMIN_SESSION_SECRET || 'change-me-storage-secret');
}

function signStorage(bucket, objectPath, expiresAt) {
  return crypto.createHmac('sha256', storageSecret()).update(`${bucket}\n${objectPath}\n${expiresAt}`).digest('base64url');
}

export function verifyStorageSignature(bucket, objectPath, expiresAt, signature) {
  const exp = Number(expiresAt || 0);
  if (!exp || exp < Date.now()) return false;
  const expected = signStorage(bucket, objectPath, exp);
  try {
    return crypto.timingSafeEqual(Buffer.from(String(signature || '')), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function resolveStoragePath(bucket, objectPath) {
  return safeStoragePath(bucket, objectPath).full;
}

class StorageBucket {
  constructor(bucket) { this.bucket = bucket; }

  async upload(objectPath, bytes, { upsert = false } = {}) {
    try {
      const { full } = safeStoragePath(this.bucket, objectPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      if (!upsert) {
        try { await fs.access(full); return { data: null, error: Object.assign(new Error('Object already exists'), { statusCode: 409 }) }; }
        catch { /* not found */ }
      }
      await fs.writeFile(full, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
      return { data: { path: objectPath }, error: null };
    } catch (error) { return { data: null, error }; }
  }

  async remove(paths = []) {
    try {
      for (const objectPath of paths) {
        const { full } = safeStoragePath(this.bucket, objectPath);
        await fs.rm(full, { force: true });
      }
      return { data: paths.map((p) => ({ name: p })), error: null };
    } catch (error) { return { data: null, error }; }
  }

  async createSignedUrl(objectPath, expiresIn = 900) {
    try {
      const { full } = safeStoragePath(this.bucket, objectPath);
      await fs.access(full);
      const expiresAt = Date.now() + Math.max(1, Number(expiresIn || 900)) * 1000;
      const signature = signStorage(this.bucket, objectPath, expiresAt);
      const encodedPath = String(objectPath).split('/').map(encodeURIComponent).join('/');
      return { data: { signedUrl: `/api/storage/${encodeURIComponent(this.bucket)}/${encodedPath}?expires=${expiresAt}&sig=${encodeURIComponent(signature)}` }, error: null };
    } catch (error) { return { data: null, error: Object.assign(error, { statusCode: 404 }) }; }
  }

  async list(prefix = '', { limit = 1000, offset = 0 } = {}) {
    try {
      const { full } = safeStoragePath(this.bucket, prefix);
      await fs.mkdir(full, { recursive: true });
      const entries = await fs.readdir(full, { withFileTypes: true });
      const sliced = entries.sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit);
      const rows = [];
      for (const entry of sliced) {
        if (entry.isDirectory()) {
          rows.push({ name: entry.name, id: null, metadata: null });
          continue;
        }
        const filePath = path.join(full, entry.name);
        const stat = await fs.stat(filePath);
        rows.push({
          id: crypto.createHash('sha1').update(`${this.bucket}/${prefix}/${entry.name}`).digest('hex'),
          name: entry.name,
          created_at: stat.birthtime.toISOString(),
          updated_at: stat.mtime.toISOString(),
          metadata: { size: stat.size, mimetype: '' },
        });
      }
      return { data: rows, error: null };
    } catch (error) { return { data: null, error }; }
  }
}

const databaseFacade = {
  from(table) { return new QueryBuilder(String(table || '')); },
  async rpc(name, args = {}) {
    try {
      if (name !== 'merge_physical_installations') throw Object.assign(new Error(`Unsupported PostgreSQL function: ${name}`), { code: '42883' });
      const result = await getPool().query('SELECT public.merge_physical_installations($1, $2) AS value', [args.source_id, args.target_id]);
      return { data: result.rows[0]?.value ?? null, error: null };
    } catch (error) { return { data: null, error }; }
  },
  storage: { from(bucket) { return new StorageBucket(bucket); } },
};

export function db() { return databaseFacade; }
