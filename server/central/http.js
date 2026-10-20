export function json(res, status, payload) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(payload);
}
export function method(req, res, allowed) {
  if (!allowed.includes(req.method)) { res.setHeader('Allow', allowed.join(', ')); json(res, 405, { error: 'Method not allowed.' }); return false; }
  return true;
}
export function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}
