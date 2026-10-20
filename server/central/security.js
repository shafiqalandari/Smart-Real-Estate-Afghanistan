import crypto from 'node:crypto';
export const hashToken = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export function deviceCode() { return `SP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`; }
const b64 = (v) => Buffer.from(v).toString('base64url');
export function makeAdminToken(email) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is missing.');
  const payload = b64(JSON.stringify({ email, exp: Date.now() + 12 * 60 * 60 * 1000 }));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function verifyAdminToken(token) {
  try {
    const [payload, sig] = String(token || '').split('.');
    const secret = process.env.ADMIN_SESSION_SECRET;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
export function readCookie(req, name) {
  const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
}
