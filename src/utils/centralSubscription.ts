const apiBase = String(import.meta.env.VITE_CENTRAL_API_URL || '').replace(/\/$/, '')
const tokenKey = 'safarpro-installation-token'
const fingerprintKey = 'safarpro-device-fingerprint-lite'
const accessCacheKey = 'safarpro-access-cache-v2'
const legacyAccessCacheKeys = ['safarpro-access-cache-v1']
const lastObservedClockKey = 'safarpro-last-observed-clock-v1'
const referralKey = 'safarpro-referral-code-v1'
const clockRollbackToleranceMs = 2 * 60 * 1000

export type CustomerRegistrationProfile = {
  businessName: string
  ownerName: string
  phone: string
  email: string
  whatsapp?: string
  country?: string
  city?: string
  address?: string
  businessType?: string
  licenseNumber?: string
  smartOfficeId?: string
}

export type CustomerAccessSnapshot = {
  allowed: boolean
  smartOfficeId?: string
  accessStatus: string
  serverTime?: string
  remainingSeconds?: number
  trialStartedAt?: string | null
  trialEndsAt?: string | null
  subscriptionExpiresAt?: string | null
  licenseExpiresAt?: string | null
  isLifetime?: boolean
  offlineGraceSeconds?: number
  nextOnlineCheckAt?: string | null
  customerProfileComplete?: boolean
  customerProfile?: CustomerRegistrationProfile | null
  deviceApprovalStatus?: string
  blockReason?: string
  accountProtected?: boolean
}

type AccessCache = {
  savedAt: number
  savedClientAt: number
  trustedServerTime: number
  deviceBinding: string
  snapshot: CustomerAccessSnapshot
}

function migrateLegacyAccessCache() {
  try {
    if (localStorage.getItem(accessCacheKey)) return
    for (const key of legacyAccessCacheKeys) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const legacy = JSON.parse(raw) as Partial<AccessCache> & { savedAt?: number; snapshot?: CustomerAccessSnapshot; deviceBinding?: string }
      if (!legacy?.snapshot) continue
      const savedClientAt = Number(legacy.savedClientAt || legacy.savedAt || Date.now())
      const trustedServerTime = legacy.snapshot.serverTime ? new Date(legacy.snapshot.serverTime).getTime() : savedClientAt
      const migrated: AccessCache = {
        savedAt: savedClientAt,
        savedClientAt,
        trustedServerTime: Number.isFinite(trustedServerTime) ? trustedServerTime : savedClientAt,
        deviceBinding: String(legacy.deviceBinding || physicalFingerprintParts().strong),
        snapshot: legacy.snapshot,
      }
      localStorage.setItem(accessCacheKey, JSON.stringify(migrated))
      return
    }
  } catch {
    // Legacy cache migration is best-effort. Online sync remains authoritative.
  }
}

function fingerprint() {
  let id = localStorage.getItem(fingerprintKey)
  if (!id) {
    id = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(fingerprintKey, id)
  }
  return id
}

async function request(path: string, options: RequestInit = {}, timeoutMs = 8000) {
  const token = localStorage.getItem(tokenKey)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data?.error || data?.message || `Request failed (${response.status})`) as Error & { status?: number; code?: string }
      error.status = response.status
      error.code = data?.code
      throw error
    }
    return data
  } finally {
    window.clearTimeout(timeout)
  }
}

function isMobileBrowser() {
  const ua = String(navigator.userAgent || '')
  const touch = Number(navigator.maxTouchPoints || 0) > 0
  const shortSide = typeof window !== 'undefined' && window.screen
    ? Math.min(Number(window.screen.width || 0), Number(window.screen.height || 0))
    : 0
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (touch && shortSide > 0 && shortSide <= 1024)
}

function physicalFingerprintParts() {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const screenInfo = typeof window !== 'undefined' ? window.screen : null

  // Mobile browsers can report different screen dimensions after orientation,
  // browser chrome changes, display zoom or OS updates. Binding mobile access to
  // those values can make the same phone look like a different device. Use the
  // persistent browser installation id instead, so ordinary mobile use remains
  // stable while another browser still counts as a separate device.
  if (isMobileBrowser()) {
    const browserId = fingerprint()
    const mobileBase = [
      'MOBILE_BROWSER_V2',
      browserId,
      navigator.platform || '',
      String(nav.hardwareConcurrency || ''),
      String(nav.deviceMemory || ''),
      String(navigator.maxTouchPoints || 0),
    ].join('|')
    return { strong: mobileBase, coarse: mobileBase, strength: 8 }
  }

  const common = [
    navigator.platform || '',
    String(nav.hardwareConcurrency || ''),
    String(nav.deviceMemory || ''),
    String(navigator.maxTouchPoints || 0),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    String(screenInfo?.colorDepth || ''),
  ]
  const coarse = common.join('|')
  const strong = [
    ...common,
    String(screenInfo?.width || ''),
    String(screenInfo?.height || ''),
    String(window.devicePixelRatio || 1),
  ].join('|')
  return { strong, coarse, strength: coarse.replace(/\|/g, '').length > 12 ? 6 : 4 }
}

function devicePayload() {
  const physical = physicalFingerprintParts()
  const mobile = isMobileBrowser()
  return {
    deviceName: navigator.userAgent.slice(0, 200),
    deviceType: mobile ? 'MOBILE' : 'BROWSER',
    installationType: mobile ? 'MOBILE_WEB' : 'WEB',
    operatingSystem: navigator.platform || '',
    browser: navigator.userAgent.slice(0, 300),
    appVersion: '1.0.0',
    browserFingerprint: fingerprint(),
    deviceFingerprint: fingerprint(),
    physicalFingerprint: physical.strong,
    coarseFingerprint: physical.coarse,
    // Version 2 marks the stable mobile fingerprint introduced after the
    // original screen-based mobile identity. The API uses this version to
    // perform a safe one-time upgrade for already registered mobile devices.
    fingerprintVersion: mobile ? 2 : 1,
    fingerprintStrength: physical.strength,
    termsAccepted: true,
    privacyAccepted: true,
  }
}

function entitlementExpiry(snapshot: CustomerAccessSnapshot) {
  if (snapshot.isLifetime) return null

  const status = String(snapshot.accessStatus || '').toUpperCase()
  const toMs = (value?: string | null) => {
    if (!value) return null
    const ms = new Date(String(value)).getTime()
    return Number.isFinite(ms) ? ms : null
  }

  const subscriptionValues = [
    toMs(snapshot.subscriptionExpiresAt),
    toMs(snapshot.licenseExpiresAt),
    status.includes('LICENSE') || status.includes('SUBSCRIPTION') ? toMs(snapshot.nextOnlineCheckAt) : null,
  ].filter((value): value is number => value != null)

  // Once paid/admin-granted access is active, an older expired trial must never
  // shorten the current entitlement. This is especially important after an
  // administrator grants access to a device whose free trial has already ended.
  if ((status.includes('LICENSE_ACTIVE') || status.includes('SUBSCRIPTION_ACTIVE')) && subscriptionValues.length) {
    return Math.min(...subscriptionValues)
  }

  const trialValues = [
    toMs(snapshot.trialEndsAt),
    status.includes('TRIAL') ? toMs(snapshot.nextOnlineCheckAt) : null,
  ].filter((value): value is number => value != null)
  if (status.includes('TRIAL_ACTIVE') && trialValues.length) return Math.min(...trialValues)

  // Compatibility fallback for older API responses that may not include a
  // normalized accessStatus yet. Prefer a subscription expiry over trial expiry.
  if (subscriptionValues.length) return Math.min(...subscriptionValues)
  if (trialValues.length) return Math.min(...trialValues)
  return null
}

function rememberObservedClock(now = Date.now()) {
  try {
    const previous = Number(localStorage.getItem(lastObservedClockKey) || 0)
    if (!Number.isFinite(previous) || now > previous) localStorage.setItem(lastObservedClockKey, String(now))
  } catch {
    // Best-effort anti-rollback marker only.
  }
}

function cacheAccess(snapshot: CustomerAccessSnapshot) {
  try {
    const savedClientAt = Date.now()
    const trustedServerTime = snapshot.serverTime ? new Date(snapshot.serverTime).getTime() : savedClientAt
    const binding = physicalFingerprintParts().strong
    const payload: AccessCache = {
      savedAt: savedClientAt,
      savedClientAt,
      trustedServerTime: Number.isFinite(trustedServerTime) ? trustedServerTime : savedClientAt,
      deviceBinding: binding,
      snapshot,
    }
    localStorage.setItem(accessCacheKey, JSON.stringify(payload))
    rememberObservedClock(savedClientAt)
  } catch {
    // Access cache is an optimization only.
  }
}

export type OfflineAccessDecision = {
  allowed: boolean
  reason: 'allowed' | 'missing' | 'device-mismatch' | 'clock-rollback' | 'expired' | 'not-allowed'
  snapshot: CustomerAccessSnapshot | null
  effectiveNow: number
  expiresAt: number | null
}

export function getOfflineAccessDecision(now = Date.now()): OfflineAccessDecision {
  migrateLegacyAccessCache()
  try {
    const parsed = JSON.parse(localStorage.getItem(accessCacheKey) || 'null') as AccessCache | null
    if (!parsed?.snapshot) return { allowed: false, reason: 'missing', snapshot: null, effectiveNow: now, expiresAt: null }
    if (parsed.deviceBinding && parsed.deviceBinding !== physicalFingerprintParts().strong) {
      return { allowed: false, reason: 'device-mismatch', snapshot: null, effectiveNow: now, expiresAt: null }
    }

    const savedClientAt = Number(parsed.savedClientAt || parsed.savedAt || 0)
    const lastObserved = Number(localStorage.getItem(lastObservedClockKey) || 0)
    const rollbackAnchor = Math.max(savedClientAt || 0, Number.isFinite(lastObserved) ? lastObserved : 0)
    if (rollbackAnchor && now + clockRollbackToleranceMs < rollbackAnchor) {
      return { allowed: false, reason: 'clock-rollback', snapshot: parsed.snapshot, effectiveNow: rollbackAnchor, expiresAt: entitlementExpiry(parsed.snapshot) }
    }

    rememberObservedClock(now)
    const trustedServerTime = Number(parsed.trustedServerTime || new Date(parsed.snapshot.serverTime || 0).getTime() || savedClientAt || now)
    const elapsedSinceSync = savedClientAt ? Math.max(0, now - savedClientAt) : 0
    const trustedProgress = Number.isFinite(trustedServerTime) ? trustedServerTime + elapsedSinceSync : now
    const effectiveNow = Math.max(now, trustedProgress)
    const expiresAt = entitlementExpiry(parsed.snapshot)

    if (!parsed.snapshot.allowed) return { allowed: false, reason: 'not-allowed', snapshot: parsed.snapshot, effectiveNow, expiresAt }
    if (expiresAt && expiresAt <= effectiveNow) return { allowed: false, reason: 'expired', snapshot: parsed.snapshot, effectiveNow, expiresAt }
    return { allowed: true, reason: 'allowed', snapshot: parsed.snapshot, effectiveNow, expiresAt }
  } catch {
    return { allowed: false, reason: 'missing', snapshot: null, effectiveNow: now, expiresAt: null }
  }
}

export function readCachedCustomerAccess(): CustomerAccessSnapshot | null {
  const decision = getOfflineAccessDecision()
  return decision.allowed ? decision.snapshot : null
}

export function hasInstallationToken() {
  return Boolean(localStorage.getItem(tokenKey))
}



export function clearCustomerInstallationSession() {
  try {
    localStorage.removeItem(tokenKey)
    localStorage.removeItem(accessCacheKey)
    for (const key of legacyAccessCacheKeys) localStorage.removeItem(key)
  } catch {}
}

export async function signUpCustomerAccount(profile: CustomerRegistrationProfile, password: string) {
  const result = await request('/api/customer-auth/signup', {
    method: 'POST',
    body: JSON.stringify({ ...profile, password, ...devicePayload(), referralCode: currentReferralCode() }),
  }, 15000)
  if (!result?.installationToken) throw new Error('Central server did not return an installation token.')
  localStorage.setItem(tokenKey, result.installationToken)
  try { localStorage.removeItem(referralKey) } catch {}
  const snapshot = result.installation as CustomerAccessSnapshot
  cacheAccess(snapshot)
  return snapshot
}

export async function signInCustomerAccount(email: string, password: string) {
  const result = await request('/api/customer-auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password, ...devicePayload() }),
  }, 15000)
  if (!result?.installationToken) throw new Error('Central server did not return an installation token.')
  localStorage.setItem(tokenKey, result.installationToken)
  const snapshot = result.installation as CustomerAccessSnapshot
  cacheAccess(snapshot)
  return snapshot
}

export async function claimCustomerAccount(email: string, password: string) {
  return request('/api/customer-auth/claim', { method: 'POST', body: JSON.stringify({ email, password, ...devicePayload() }) }, 12000)
}

export async function fetchCustomerAccountSecurity() {
  return request('/api/customer-auth/security')
}

export async function recoverCustomerInstallation() {
  if (hasInstallationToken()) return null
  try {
    const result = await request('/api/installations/recover', {
      method: 'POST',
      body: JSON.stringify(devicePayload()),
    }, 7000)
    if (!result?.installationToken || !result?.installation) return null
    localStorage.setItem(tokenKey, result.installationToken)
    const snapshot = result.installation as CustomerAccessSnapshot
    cacheAccess(snapshot)
    return snapshot
  } catch (error: any) {
    if (error?.status === 404 || error?.code === 'DEVICE_NOT_FOUND' || error?.code === 'DEVICE_RECOVERY_UNAVAILABLE') return null
    throw error
  }
}

function currentReferralCode() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase() || ''
    if (/^SP-[A-Z0-9]{6,16}$/.test(fromUrl)) localStorage.setItem(referralKey, fromUrl)
    return localStorage.getItem(referralKey) || ''
  } catch { return '' }
}

export async function registerCustomerInstallation(profile: CustomerRegistrationProfile) {
  const result = await request('/api/installations/register', {
    method: 'POST',
    body: JSON.stringify({ ...profile, ...devicePayload(), referralCode: currentReferralCode() }),
  }, 12000)
  if (!result?.installationToken) throw new Error('Central server did not return an installation token.')
  localStorage.setItem(tokenKey, result.installationToken)
  try { localStorage.removeItem(referralKey) } catch {}
  const snapshot: CustomerAccessSnapshot = {
    ...(result.installation || {}),
    customerProfileComplete: true,
    customerProfile: profile,
  }
  cacheAccess(snapshot)
  return snapshot
}

export async function updateCustomerProfile(profile: CustomerRegistrationProfile) {
  if (!hasInstallationToken()) return registerCustomerInstallation(profile)
  const result = await request('/api/customer/profile', {
    method: 'PATCH',
    body: JSON.stringify(profile),
  })
  const snapshot: CustomerAccessSnapshot = {
    ...(result.access || {}),
    customerProfileComplete: true,
    customerProfile: result.customerProfile || profile,
  }
  cacheAccess(snapshot)
  return snapshot
}

export async function syncCustomerAccess() {
  if (!hasInstallationToken()) return null
  const snapshot = await request('/api/installations/access/sync', { method: 'POST', body: JSON.stringify(devicePayload()) }) as CustomerAccessSnapshot
  cacheAccess(snapshot)
  return snapshot
}

export async function retryCustomerAccess() {
  if (!hasInstallationToken()) return recoverCustomerInstallation()
  const snapshot = await request('/api/installations/access/retry', { method: 'POST', body: JSON.stringify(devicePayload()) }) as CustomerAccessSnapshot
  cacheAccess(snapshot)
  return snapshot
}

export async function ensureSubscriptionInstallation() {
  if (hasInstallationToken()) return
  const error = new Error('Customer registration is required before subscription access.') as Error & { code?: string }
  error.code = 'CUSTOMER_PROFILE_REQUIRED'
  throw error
}

export async function fetchSubscriptionData() {
  await ensureSubscriptionInstallation()
  return request('/api/customer/subscription')
}

export async function submitSubscriptionPayment(payload: any) {
  await ensureSubscriptionInstallation()
  return request('/api/customer/payment-requests', { method: 'POST', body: JSON.stringify(payload) })
}

export async function fetchCustomerProfile() {
  await ensureSubscriptionInstallation()
  return request('/api/customer/profile')
}

export async function fetchCreditSummary() {
  await ensureSubscriptionInstallation()
  return request('/api/customer/credit/summary')
}

export async function fetchCreditLedger(page = 1, pageSize = 20) {
  await ensureSubscriptionInstallation()
  return request(`/api/customer/credit/ledger?page=${page}&pageSize=${pageSize}`)
}

export async function fetchReferralHistory() {
  await ensureSubscriptionInstallation()
  return request('/api/customer/referrals')
}

export async function resolveCreditRecipient(smartOfficeId: string) {
  await ensureSubscriptionInstallation()
  return request(`/api/customer/credit/recipient/${encodeURIComponent(smartOfficeId.trim().toUpperCase())}`)
}

export async function transferCredit(recipientSmartOfficeId: string, amount: number) {
  await ensureSubscriptionInstallation()
  return request('/api/customer/credit/transfers', { method: 'POST', body: JSON.stringify({ recipientSmartOfficeId, amount }) })
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'))
    reader.readAsDataURL(file)
  })
}
