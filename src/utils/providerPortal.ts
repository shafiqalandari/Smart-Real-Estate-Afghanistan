const apiBase = String(import.meta.env.VITE_CENTRAL_API_URL || '').replace(/\/$/, '')
const tokenKey = 'safarpro-installation-token'

async function portalRequest(path: string, options: RequestInit = {}, timeoutMs = 10000) {
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
    if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status})`)
    return data
  } finally {
    window.clearTimeout(timeout)
  }
}

export type CustomerNotification = {
  id: string
  type: string
  title: string
  message: string
  targetPath: string
  isRead: boolean
  createdAt: string
}

export async function fetchCustomerNotifications(): Promise<CustomerNotification[]> {
  const data = await portalRequest('/api/customer/notifications')
  return Array.isArray(data?.notifications) ? data.notifications : []
}

export async function markCustomerNotificationsRead(ids: string[]) {
  return portalRequest('/api/customer/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) })
}

export type ProviderMessage = {
  id: string
  sender: 'customer' | 'provider' | string
  message: string
  createdAt?: string
  editedAt?: string | null
  attachmentUrl?: string | null
  attachmentName?: string
  attachmentType?: string
  attachmentSize?: number
  isRead?: boolean
  seenAt?: string | null
}

export async function fetchProviderMessages(): Promise<ProviderMessage[]> {
  const data = await portalRequest('/api/customer/messages')
  return Array.isArray(data?.messages) ? data.messages : []
}

export async function sendProviderMessage(payload: { message: string; attachmentDataUrl?: string; attachmentName?: string }) {
  const data = await portalRequest('/api/customer/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 15000)
  return Array.isArray(data?.messages) ? data.messages as ProviderMessage[] : []
}

export type RegisteredCompany = {
  id: string
  companyName: string
  logo?: string
  website?: string
  description?: string
  approvedAt?: string | null
}

export async function fetchRegisteredCompanies() {
  const data = await portalRequest('/api/company/registered-companies')
  const companies: RegisteredCompany[] = (Array.isArray(data?.companies) ? data.companies : []).map((company: RegisteredCompany) => {
    const raw = String(company.description || '')
    if (!raw.startsWith('__SAFARPRO_FIRST_RUN__:')) return company
    try {
      const parsed = JSON.parse(raw.slice('__SAFARPRO_FIRST_RUN__:'.length))
      return { ...company, description: String(parsed?.description || '') }
    } catch {
      return { ...company, description: '' }
    }
  })
  return {
    companies,
    count: Number(data?.count || 0),
    totalInstallations: Number(data?.stats?.totalInstallations || 0),
    totalVerified: Number(data?.stats?.totalVerified || 0),
  }
}

export type InnovationFeedback = {
  usefulCount: number
  notUsefulCount: number
  totalCount: number
  usefulPercent: number
  myVote: 'useful' | 'not_useful' | null
}

export type Innovation = {
  id: string
  version?: string
  title: string
  description?: string
  progress?: number
  createdAt?: string
  updatedAt?: string
  feedback?: InnovationFeedback
}

export async function fetchInnovations() {
  const data = await portalRequest('/api/innovations')
  return {
    innovations: Array.isArray(data?.innovations) ? data.innovations as Innovation[] : [],
    latestVersion: String(data?.latestVersion || ''),
  }
}

export async function voteInnovation(innovationId: string, vote: 'useful' | 'not_useful') {
  return portalRequest('/api/innovations/feedback', {
    method: 'POST',
    body: JSON.stringify({ innovationId, vote }),
  })
}

export async function getCustomerRealtimeTicket() {
  return portalRequest('/api/customer/realtime-ticket', { method:'POST', body:'{}' }) as Promise<{ ticket:string; expiresInSeconds:number }>
}

export async function sendCustomerRealtimeEvent(type:string, payload:Record<string,any> = {}) {
  return portalRequest('/api/customer/realtime-event', { method:'POST', body:JSON.stringify({ type, ...payload }) })
}
