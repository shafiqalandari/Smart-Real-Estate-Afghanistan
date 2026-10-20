import type { AdminSession, PageResult } from './adminTypes'

const baseUrl = String(import.meta.env.VITE_CENTRAL_API_URL || '').replace(/\/$/, '')
const TOKEN_KEY='safarpro-admin-access-token'
const ADMIN_KEY='safarpro-admin-session'
let accessToken = sessionStorage.getItem(TOKEN_KEY) || ''
let currentAdmin: AdminSession | null = (()=>{try{return JSON.parse(sessionStorage.getItem(ADMIN_KEY)||'null')}catch{return null}})()

async function rawRequest(path: string, options: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 12000, ...requestOptions } = options
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...requestOptions,
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(requestOptions.headers || {}),
      },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data?.error || data?.message || `Request failed (${response.status})`) as Error & { status?: number; data?: any }
      error.status = response.status
      error.data = data
      throw error
    }
    return data
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Management request timed out. Please try again.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function saveSession(data: any): AdminSession {
  if (!data?.accessToken || !data?.admin?.id) throw new Error('Invalid management session.')
  const admin = data.admin as AdminSession
  accessToken = data.accessToken
  currentAdmin = admin
  sessionStorage.setItem(TOKEN_KEY, accessToken)
  sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin))
  return admin
}

async function withRefresh<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (error: any) {
    if (error?.status !== 401) throw error
    await getSession()
    return fn()
  }
}

export function getApiBaseUrl() { return baseUrl }
export function getCurrentAdmin() { return currentAdmin }
export async function getSession() {
  if (accessToken && currentAdmin) return currentAdmin
  const data = await rawRequest('/api/admin/auth/refresh', { method: 'POST' })
  return saveSession(data)
}
export async function signIn(email: string, password: string) {
  try {
    const data = await rawRequest('/api/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    return { ok: true as const, session: saveSession(data) }
  } catch (error: any) {
    return { ok: false as const, error: error?.message || 'Unable to sign in.' }
  }
}
export async function signOut() {
  try { if (accessToken) await rawRequest('/api/admin/auth/logout', { method: 'POST' }) } catch {}
  accessToken = ''; currentAdmin = null; sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(ADMIN_KEY)
}

export const adminGet = <T = any>(path: string) => withRefresh(() => rawRequest(path)) as Promise<T>
export const adminPost = <T = any>(path: string, payload: any = {}) => withRefresh(() => rawRequest(path, { method: 'POST', body: JSON.stringify(payload) })) as Promise<T>
export const adminPatch = <T = any>(path: string, payload: any = {}) => withRefresh(() => rawRequest(path, { method: 'PATCH', body: JSON.stringify(payload) })) as Promise<T>
export const adminDelete = <T = any>(path: string) => withRefresh(() => rawRequest(path, { method: 'DELETE' })) as Promise<T>
export const adminRequest = <T = any>(path: string, options: RequestInit & { timeoutMs?: number } = {}) => withRefresh(() => rawRequest(path, options)) as Promise<T>

export function normalizePage<T = any>(payload: any, page = 1, pageSize = 20): PageResult<T> {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.customers) ? payload.customers : Array.isArray(payload?.devices) ? payload.devices : Array.isArray(payload?.companies) ? payload.companies : Array.isArray(payload?.plans) ? payload.plans : Array.isArray(payload?.subscriptions) ? payload.subscriptions : Array.isArray(payload?.payments) ? payload.payments : Array.isArray(payload?.licenses) ? payload.licenses : Array.isArray(payload?.paymentRequests) ? payload.paymentRequests : Array.isArray(payload?.methods) ? payload.methods : Array.isArray(payload?.paymentMethods) ? payload.paymentMethods : Array.isArray(payload?.conversations) ? payload.conversations : Array.isArray(payload?.innovations) ? payload.innovations : []
  return { rows, total: Number(payload?.total ?? payload?.count ?? rows.length), page: Number(payload?.page ?? page), pageSize: Number(payload?.pageSize ?? pageSize) }
}

export async function fetchPaged<T = any>(path: string, params: Record<string,string|number|undefined> = {}, page = 1, pageSize = 20): Promise<PageResult<T>> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && String(v).trim() !== '') query.set(k, String(v)) })
  const join = path.includes('?') ? '&' : '?'
  const data = await adminGet(`${path}${join}${query}`)
  return normalizePage<T>(data, page, pageSize)
}

export const endpoints = {
  summary: '/api/admin/dashboard/summary',
  reports: '/api/admin/dashboard/reports',
  companies: '/api/admin/registered-companies',
  companyRequests: '/api/admin/company-registration-requests',
  devices: '/api/admin/registered-devices',
  deviceProfile: (id: string) => `/api/admin/installations/${encodeURIComponent(id)}/profile`,
  licenses: '/api/admin/licenses',
  plans: '/api/admin/billing/plans',
  credits: '/api/admin/credits',
  subscriptions: '/api/admin/billing/subscriptions',
  payments: '/api/admin/billing/payments',
  paymentRequests: '/api/admin/billing/payment-requests',
  paymentMethods: '/api/admin/billing/payment-methods',
  messages: '/api/admin/messages',
  innovations: '/api/admin/innovations',
  audit: '/api/admin/audit-logs',
}

export async function exportBackup(includeStorage = false) {
  return withRefresh(() => rawRequest(`/api/admin/backup/export?storage=${includeStorage ? '1' : '0'}`, { timeoutMs: 120000 }))
}

export async function getAdminRealtimeTicket() {
  return adminPost<{ ticket:string; expiresInSeconds:number }>('/api/admin/realtime-ticket', {})
}

export async function sendAdminRealtimeEvent(type:string, payload:Record<string,any> = {}) {
  return adminPost('/api/admin/realtime-event', { type, ...payload })
}
