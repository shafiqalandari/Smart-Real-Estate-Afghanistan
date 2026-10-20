import { db } from './database.js';
import { bearer } from './http.js';
import { hashToken } from './security.js';

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isMissingDeviceIdentitySchema(error) {
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(error?.code || ''));
}

async function installationById(id) {
  if (!id) return null;
  const { data, error } = await db()
    .from('installations')
    .select('*, service_customers(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // A legacy browser token can still point at an installation that has already
  // been merged into a canonical physical device. Follow the canonical row.
  if (data.merged_into_installation_id && data.merged_into_installation_id !== data.id) {
    const { data: canonical, error: canonicalError } = await db()
      .from('installations')
      .select('*, service_customers(*)')
      .eq('id', data.merged_into_installation_id)
      .maybeSingle();
    if (canonicalError) throw canonicalError;
    return canonical || data;
  }
  return data;
}

export async function installationFromRequest(req) {
  const token = bearer(req);
  if (!token) return null;
  const tokenHash = hashToken(token);

  // Version 3+: a physical device can have multiple browser-installation
  // tokens. This lookup runs first so Chrome/Edge/Firefox can resolve to one
  // canonical installation row.
  try {
    const { data: browserInstallation, error: browserError } = await db()
      .from('browser_installations')
      .select('installation_id,session_state')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (browserError && !isMissingDeviceIdentitySchema(browserError)) throw browserError;
    if (browserInstallation?.installation_id) {
      if (String(browserInstallation.session_state || 'ACTIVE').toUpperCase() === 'REVOKED') return null;
      const resolved = await installationById(browserInstallation.installation_id);
      if (String(resolved?.session_state || 'ACTIVE').toUpperCase() === 'REVOKED') return null;
      return resolved;
    }
  } catch (error) {
    if (!isMissingDeviceIdentitySchema(error)) throw error;
  }

  // Backward compatibility for installations created before the Version 3
  // device-identity migration has been run.
  const { data, error } = await db()
    .from('installations')
    .select('*, service_customers(*)')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (String(data.session_state || 'ACTIVE').toUpperCase() === 'REVOKED') return null;
  if (data.merged_into_installation_id && data.merged_into_installation_id !== data.id) {
    return installationById(data.merged_into_installation_id);
  }
  return data;
}

export function accessPayload(row, { now = new Date() } = {}) {
  const customer = row?.service_customers || null;
  const recordedTrialEnd = asDate(customer?.trial_ends_at || row?.trial_ends_at);
  const trialStart = asDate(customer?.trial_started_at || row?.trial_started_at);
  // Never lengthen a server-issued trial. The expiry saved on the server is
  // authoritative, including when an administrator selects fewer than 7 days.
  const trialEnd = recordedTrialEnd;
  const subscriptionEnd = asDate(row?.subscription_expires_at);
  const lifetimeAccess = Boolean(row?.lifetime_access);
  const customerStatus = String(customer?.account_status || 'ACTIVE').toUpperCase();
  const rowStatus = String(row?.status || '').toUpperCase();
  const approvalStatus = String(row?.approval_status || 'APPROVED').toUpperCase();
  const customerBlocked = customerStatus === 'BLOCKED';
  const customerSuspended = customerStatus === 'SUSPENDED';
  const blocked = rowStatus === 'BLOCKED';
  const suspended = rowStatus === 'SUSPENDED';
  const pendingApproval = approvalStatus === 'PENDING' || rowStatus === 'PENDING';
  const rejectedApproval = approvalStatus === 'REJECTED';

  let allowed = false;
  let accessStatus = 'TRIAL_EXPIRED';
  let entitlementExpiresAt = trialEnd;
  let offlineGraceSeconds = 0;

  if (customerBlocked) {
    accessStatus = 'CUSTOMER_BLOCKED';
    entitlementExpiresAt = null;
  } else if (customerSuspended) {
    accessStatus = 'CUSTOMER_SUSPENDED';
    entitlementExpiresAt = null;
  } else if (blocked) {
    accessStatus = 'INSTALLATION_BLOCKED';
    entitlementExpiresAt = null;
  } else if (suspended) {
    accessStatus = 'INSTALLATION_SUSPENDED';
    entitlementExpiresAt = null;
  } else if (rejectedApproval) {
    accessStatus = 'DEVICE_REJECTED';
    entitlementExpiresAt = null;
  } else if (pendingApproval) {
    accessStatus = 'DEVICE_PENDING';
    entitlementExpiresAt = null;
  } else if (lifetimeAccess) {
    allowed = true;
    accessStatus = 'LIFETIME_ACTIVE';
    entitlementExpiresAt = null;
    // Lifetime access never expires. Keep offline access valid without an expiry lock.
    offlineGraceSeconds = 0;
  } else if (subscriptionEnd && subscriptionEnd > now) {
    allowed = true;
    accessStatus = 'LICENSE_ACTIVE';
    entitlementExpiresAt = subscriptionEnd;
    // Paid access may remain offline until the paid entitlement itself ends.
    // The next mandatory online verification therefore matches the license expiry.
    offlineGraceSeconds = Math.max(
      0,
      Math.floor((subscriptionEnd.getTime() - now.getTime()) / 1000),
    );
  } else if (trialEnd && trialEnd > now) {
    allowed = true;
    accessStatus = 'TRIAL_ACTIVE';
    entitlementExpiresAt = trialEnd;
    // During the initial trial, offline use may continue only until the
    // server-issued trial expiry. It is never extended by the client clock.
    offlineGraceSeconds = Math.max(
      0,
      Math.floor((trialEnd.getTime() - now.getTime()) / 1000),
    );
  } else if (subscriptionEnd && subscriptionEnd <= now) {
    accessStatus = 'SUBSCRIPTION_EXPIRED';
    entitlementExpiresAt = subscriptionEnd;
  }

  const remainingSeconds = entitlementExpiresAt
    ? Math.max(0, Math.floor((entitlementExpiresAt.getTime() - now.getTime()) / 1000))
    : 0;

  return {
    success: true,
    allowed,
    accessStatus,
    serverTime: now.toISOString(),
    accessVersion: Number(row?.access_version || 1),
    remainingSeconds,
    trialStartedAt: customer?.trial_started_at || row?.trial_started_at || null,
    trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
    deviceApprovalStatus: approvalStatus,
    subscriptionExpiresAt: row?.subscription_expires_at || null,
    licenseExpiresAt: row?.subscription_expires_at || null,
    isLifetime: lifetimeAccess,
    offlineGraceSeconds,
    nextOnlineCheckAt: lifetimeAccess ? null : (subscriptionEnd && subscriptionEnd > now ? subscriptionEnd.toISOString() : (trialEnd && trialEnd > now ? trialEnd.toISOString() : null)),
    lastLicenseCheckAt: row?.last_license_check_at || null,
    smartOfficeId: customer?.smart_office_id || null,
    deviceCode: row?.device_code || null,
    physicalDeviceId: row?.physical_device_id || row?.id || null,
  };
}
