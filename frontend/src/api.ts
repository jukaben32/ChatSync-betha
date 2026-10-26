const KEY_STORAGE = 'chatsyncs_api_key'

export function getKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key)
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    /* almacenamiento no disponible */
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.key ?? getKey()}`,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { message: text }
  }
  if (res.status === 401 && !options.key) window.dispatchEvent(new Event('chatsyncs:unauthorized'))
  if (!res.ok) throw new ApiError(res.status, data?.message || data?.error || `Error ${res.status}`)
  return data as T
}

export interface Label {
  id: string
  name: string
  _count?: { subscribers: number }
}

export interface Subscriber {
  id: string
  phone: string
  name: string | null
  email: string | null
  blocked: boolean
  optedOut: boolean
  source: string | null
  customFields?: Record<string, unknown>
  createdAt: string
  labels: { label: Label }[]
  _count?: { conversations: number }
}

export interface Message {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: string
  createdAt: string
  metadata?: { sender?: string; type?: string; error?: string }
}

export interface Conversation {
  id: string
  status: 'open' | 'pending' | 'solved' | 'archived'
  assignedTo: string | null
  followUpAt?: string | null
  windowOpen?: boolean
  updatedAt: string
  subscriber: Subscriber
  messages: Message[]
  notes?: { id: string; author: string; body: string; createdAt: string }[]
}

export interface Step {
  id?: string
  action: string
  params: Record<string, any>
  delayDays: number
  order: number
}

export interface Sequence {
  id: string
  name: string
  kind: 'sequence' | 'flow' | 'keyword'
  triggerKeyword: string | null
  triggerLabel?: string | null
  folder?: string | null
  matchType?: string
  stopOnReply?: boolean
  active: boolean
  steps: Step[]
  _count?: { enrollments: number }
}

export interface Broadcast {
  id: string
  name: string
  contentType: string
  content: string
  status: string
  sentCount: number
  deliveredCount: number
  readCount: number
  clickedCount?: number
  failedCount: number
  audience: { all?: boolean; labels?: string[]; excludeLabels?: string[]; fields?: { field: string; op: string; value?: string }[] }
  scheduledAt?: string | null
  mediaUrl?: string | null
  buttons?: { title: string }[]
  createdAt: string
}

export interface Template {
  id: string
  name: string
  language: string
  category: string
  body: string
  status: string
}

export interface Deal {
  id: string
  stage: string
  value: number
  owner: string | null
  subscriber: Subscriber
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h} h`
  return new Date(iso).toLocaleDateString()
}

export function initials(name: string | null | undefined, phone: string): string {
  const source = (name || phone).trim()
  const parts = source.split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '#'
}
