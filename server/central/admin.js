import { bearer, json } from './http.js';
import { readCookie, verifyAdminToken } from './security.js';
export function requireAdmin(req, res) {
  const session = verifyAdminToken(bearer(req) || readCookie(req, 'so_admin'));
  if (!session) { json(res, 401, { error: 'Management session expired.' }); return null; }
  return session;
}
