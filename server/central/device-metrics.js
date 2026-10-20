const kabulOffset = 270 * 60 * 1000;

export function deviceDay(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time + kabulOffset).toISOString().slice(0, 10) : '';
}

export function deviceExpiry(row, access = {}) {
  return access.subscriptionExpiresAt || row.subscription_expires_at || access.trialEndsAt || row.trial_ends_at || null;
}

export function deviceMatches(row, filter = '', date = '', access, now = Date.now()) {
  if (row.merged_into_installation_id) return false;
  if (date && deviceDay(row.created_at) !== date) return false;
  if (!filter || filter === 'all') return true;
  const status = String(access.accessStatus || '').toUpperCase();
  if (filter === 'allowed') return Boolean(access.allowed);
  if (filter === 'expired') return status.includes('EXPIRED');
  if (filter === 'blocked') return status.includes('BLOCKED');
  if (filter === 'pending') return String(row.approval_status).toUpperCase() === 'PENDING';
  if (filter === 'trial') return Boolean(access.allowed) && status.includes('TRIAL');
  if (filter === 'online') return new Date(row.last_seen_at).getTime() >= now - 600000;
  if (filter === 'other') return !access.allowed && !status.includes('EXPIRED') && !status.includes('BLOCKED');
  return false;
}

export function deviceMetrics(rows, getAccess, now = Date.now()) {
  const devices = rows.filter(row => !row.merged_into_installation_id);
  const today = deviceDay(now);
  const yesterday = deviceDay(now - 86400000);
  const daily = Array.from({ length: 14 }, (_, i) => {
    const date = deviceDay(now - (13 - i) * 86400000);
    return { date, registrations: devices.filter(row => deviceDay(row.created_at) === date).length,
      expired: devices.filter(row => deviceMatches(row, 'expired', '', getAccess(row), now) && deviceDay(deviceExpiry(row, getAccess(row))) === date).length };
  });
  const counts = Object.fromEntries(['allowed', 'expired', 'blocked', 'pending', 'trial', 'online'].map(filter =>
    [filter, devices.filter(row => deviceMatches(row, filter, '', getAccess(row), now)).length]));
  return { ...counts, total: devices.length, today, yesterday,
    todayDevices: devices.filter(row => deviceDay(row.created_at) === today).length,
    yesterdayDevices: devices.filter(row => deviceDay(row.created_at) === yesterday).length, daily };
}
