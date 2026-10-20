export const REALTIME_CHAT_EVENTS = ['message:new','message:seen','typing:start','typing:stop','presence:online','presence:offline','conversation:update','notification:new'] as const

export type RealtimeChatEvent = {
  type: string
  installationId?: string
  scope?: string
  payload?: any
  at?: string
}

type TicketLoader = () => Promise<{ ticket:string }>

type RealtimeOptions = {
  getTicket: TicketLoader
  onEvent: (event:RealtimeChatEvent)=>void
  onConnectionChange?: (connected:boolean)=>void
  sendFallback?: (type:string,payload:Record<string,any>)=>Promise<unknown>
}

function realtimeBaseUrl(path:string) {
  const configured = String(import.meta.env.VITE_CENTRAL_API_URL || '').trim()
  const httpUrl = configured || window.location.origin
  const url = new URL(httpUrl, window.location.origin)
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url
}

function wsUrl() {
  const url = realtimeBaseUrl('/api/realtime')
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

function sseUrl() {
  return realtimeBaseUrl('/api/realtime/events')
}

export function createRealtimeChat(options:RealtimeOptions) {
  let socket:WebSocket|null = null
  let stream:EventSource|null = null
  let closed = false
  let retryTimer:number|undefined
  let wsOpened = false
  let fallbackActive = false
  let retryCount = 0
  const queue:Array<{type:string;payload:Record<string,any>}> = []

  const deliver = (raw:any) => {
    try { options.onEvent(typeof raw === 'string' ? JSON.parse(raw) : raw) } catch {}
  }

  const scheduleSse = () => {
    if (closed || retryTimer) return
    const delay = Math.min(15000, 1200 * Math.pow(1.6, retryCount++))
    retryTimer = window.setTimeout(() => { retryTimer=undefined; void connectSse() }, delay)
  }

  const connectSse = async () => {
    if (closed) return
    fallbackActive = true
    try {
      const { ticket } = await options.getTicket()
      const url = sseUrl(); url.searchParams.set('ticket', ticket)
      stream?.close()
      stream = new EventSource(url.toString(), { withCredentials: true })
      stream.onopen = () => {
        retryCount = 0
        options.onConnectionChange?.(true)
        while (queue.length) {
          const item=queue.shift()!
          void options.sendFallback?.(item.type,item.payload).catch(()=>{})
        }
      }
      stream.onmessage = (event) => deliver(event.data)
      stream.onerror = () => {
        options.onConnectionChange?.(false)
        stream?.close(); stream=null
        scheduleSse()
      }
    } catch {
      options.onConnectionChange?.(false)
      scheduleSse()
    }
  }

  const connectWs = async () => {
    if (closed) return
    try {
      const { ticket } = await options.getTicket()
      const url = wsUrl(); url.searchParams.set('ticket', ticket)
      socket = new WebSocket(url.toString())
      const fallbackTimer = window.setTimeout(() => {
        if (!wsOpened && !closed) {
          try { socket?.close() } catch {}
          void connectSse()
        }
      }, 2500)
      socket.addEventListener('open', () => {
        wsOpened = true
        window.clearTimeout(fallbackTimer)
        retryCount = 0
        options.onConnectionChange?.(true)
        while (queue.length && socket?.readyState === WebSocket.OPEN) {
          const item=queue.shift()!
          socket.send(JSON.stringify({type:item.type,...item.payload}))
        }
      })
      socket.addEventListener('message', (event) => deliver(String(event.data || '{}')))
      socket.addEventListener('close', () => {
        window.clearTimeout(fallbackTimer)
        options.onConnectionChange?.(false)
        if (closed || fallbackActive) return
        if (!wsOpened) { void connectSse(); return }
        const delay = Math.min(8000, 1000 * Math.pow(1.6, retryCount++))
        retryTimer = window.setTimeout(() => { retryTimer=undefined; void connectWs() }, delay)
      })
      socket.addEventListener('error', () => {
        if (!wsOpened && !closed && !fallbackActive) void connectSse()
        try { socket?.close() } catch {}
      })
    } catch {
      options.onConnectionChange?.(false)
      void connectSse()
    }
  }

  const send = (type:string, payload:Record<string,any> = {}) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, ...payload }))
      return
    }
    if (fallbackActive && options.sendFallback) {
      void options.sendFallback(type,payload).catch(()=>{})
      return
    }
    if (queue.length < 20) queue.push({type,payload})
  }

  void connectWs()
  return {
    send,
    close() {
      closed = true
      if (retryTimer) window.clearTimeout(retryTimer)
      try { socket?.close() } catch {}
      try { stream?.close() } catch {}
      options.onConnectionChange?.(false)
    },
  }
}
