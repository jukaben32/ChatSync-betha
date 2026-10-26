import { useEffect, useRef, useState } from 'react'
import { api, initials, timeAgo } from '../api'
import type { Conversation } from '../api'
import { useMe } from '../auth'
import { Avatar, Badge, ErrorNote, Modal, useAsync } from '../ui'

interface Member {
  id: string
  name: string
}

interface Canned {
  id: string
  shortcut: string
  title: string
  body: string
}

interface Insights {
  summary: string
  leadScore: number
  churnRisk: number
  sentiment: 'positive' | 'neutral' | 'negative'
  nextBestAction: string
}

type ConvDetail = Conversation & { windowOpen?: boolean; followUpAt?: string | null; important?: boolean; unread?: boolean }

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'gray' }> = {
  open: { label: 'Abierta', tone: 'green' },
  pending: { label: 'Pendiente', tone: 'amber' },
  solved: { label: 'Resuelta', tone: 'gray' },
  archived: { label: 'Archivada', tone: 'gray' },
}

const TABS = [
  { id: 'open', label: 'Abiertas' },
  { id: 'mine', label: 'Mías' },
  { id: 'unassigned', label: 'Sin asignar' },
  { id: 'unread', label: 'No leídas' },
  { id: 'important', label: 'Importantes' },
  { id: 'followup', label: 'Seguimiento' },
  { id: 'solved', label: 'Resueltas' },
  { id: 'archived', label: 'Archivadas' },
  { id: 'blocked', label: 'Bloqueados' },
]

const ME_KEY = 'chatsyncs_me'
const readMe = () => {
  try {
    return localStorage.getItem(ME_KEY) ?? ''
  } catch {
    return ''
  }
}

function queryFor(tab: string, search: string, me: string) {
  const p = new URLSearchParams()
  if (tab === 'open') p.set('status', 'open')
  if (tab === 'mine') p.set('assignedTo', me || '__nadie__')
  if (tab === 'unassigned') p.set('assignedTo', 'unassigned')
  if (tab === 'unread') p.set('unread', 'true')
  if (tab === 'important') p.set('important', 'true')
  if (tab === 'blocked') p.set('blocked', 'true')
  if (tab === 'followup') p.set('followUp', 'due')
  if (tab === 'solved') p.set('status', 'solved')
  if (tab === 'archived') p.set('status', 'archived')
  if (search) p.set('q', search)
  return p.toString()
}

export default function Inbox() {
  const [tab, setTab] = useState('open')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const who = useMe()
  const [picked, setMe] = useState(readMe)
  // Con cuenta propia, «Mías» son las asignadas a tu nombre; con la clave compartida se elige quién eres
  const me = who.id ? who.name : picked

  const list = useAsync(() => api<Conversation[]>(`/api/conversations?${queryFor(tab, search, me)}`), [tab, search, me])
  const team = useAsync(() => api<Member[]>('/api/team'))
  const canned = useAsync(() => api<Canned[]>('/api/canned-responses'))

  // Sin websockets en serverless: refresco periódico (más lento si la pestaña está oculta)
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) list.reload()
    }, 12000)
    return () => clearInterval(t)
  }, [list.reload])

  return (
    <div className={`inbox ${selected ? 'has-chat' : ''}`}>
      <div className="inbox-list">
        <div className="inbox-search">
          <input placeholder="Buscar nombre o teléfono…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="chips">
            {TABS.map((t) => (
              <button key={t.id} className={`badge ${tab === t.id ? 'badge-green' : 'badge-gray'}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {tab === 'mine' && !who.id && (
          <div style={{ padding: '0 12px 8px' }}>
            <select
              value={picked}
              onChange={(e) => {
                setMe(e.target.value)
                try {
                  localStorage.setItem(ME_KEY, e.target.value)
                } catch {
                  /* almacenamiento no disponible */
                }
              }}
              aria-label="Soy"
            >
              <option value="">¿Quién eres?</option>
              {team.data?.map((m) => (
                <option key={m.id} value={m.name}>
                  Soy {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <ErrorNote message={list.error} />
        {list.data?.length === 0 && <div className="empty">Sin conversaciones en esta vista.</div>}
        {list.data?.map((c) => (
          <button key={c.id} className={`conv ${selected === c.id ? 'active' : ''}`} onClick={() => setSelected(c.id)}>
            <Avatar text={initials(c.subscriber.name, c.subscriber.phone)} />
            <div className="grow">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>
                  {(c as Conversation & { unread?: boolean }).unread && <span className="dot" style={{ background: 'var(--brand)' }} title="Sin leer" />}
                  {c.subscriber.name || c.subscriber.phone}
                  {(c as Conversation & { important?: boolean }).important && ' ⭐'}
                </strong>
                <small className="muted">{timeAgo(c.updatedAt)}</small>
              </div>
              <div className="conv-preview">{c.messages[0]?.body || '—'}</div>
              <div className="row" style={{ marginTop: 4 }}>
                <Badge tone={STATUS[c.status]?.tone}>{STATUS[c.status]?.label ?? c.status}</Badge>
                {c.assignedTo && <Badge tone="blue">{c.assignedTo}</Badge>}
              </div>
            </div>
          </button>
        ))}
      </div>
      {selected ? (
        <Chat key={selected} id={selected} members={team.data ?? []} canned={canned.data ?? []} onBack={() => setSelected(null)} onChanged={list.reload} />
      ) : (
        <div className="chat">
          <div className="empty" style={{ margin: 'auto' }}>
            Selecciona una conversación
          </div>
        </div>
      )}
      {selected && <Side id={selected} />}
    </div>
  )
}

function Chat({ id, members, canned, onBack, onChanged }: { id: string; members: Member[]; canned: Canned[]; onBack: () => void; onChanged: () => void }) {
  const conv = useAsync(() => api<ConvDetail>(`/api/conversations/${id}`), [id])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [busyAi, setBusyAi] = useState(false)
  const [error, setError] = useState('')
  const [media, setMedia] = useState(false)
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const bottom = useRef<HTMLDivElement>(null)

  // Abrir la conversación la marca como leída
  useEffect(() => {
    api(`/api/conversations/${id}/read`, { body: {} })
      .then(onChanged)
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) conv.reload()
    }, 8000)
    return () => clearInterval(t)
  }, [conv.reload])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [conv.data?.messages.length])

  const c = conv.data
  const slash = text.startsWith('/') ? text.slice(1).toLowerCase() : null
  const matches = slash !== null ? canned.filter((r) => r.shortcut.includes(slash) || r.title.toLowerCase().includes(slash)).slice(0, 5) : []

  async function post(body: unknown) {
    setSending(true)
    setError('')
    try {
      await api(`/api/conversations/${id}/messages`, { body })
      return true
    } catch (e) {
      const m = (e as Error).message
      setError(
        m === 'whatsapp_not_configured'
          ? 'WhatsApp no está conectado todavía: el mensaje quedó guardado como fallido.'
          : m === 'outside_24h_window'
            ? 'Han pasado más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas.'
            : m,
      )
      return false
    } finally {
      setSending(false)
      conv.reload()
      onChanged()
    }
  }

  async function send() {
    if (!text.trim()) return
    if (mode === 'note') {
      await api(`/api/conversations/${id}/notes`, { body: { body: text.trim(), author: 'agente' } })
      setText('')
      conv.reload()
      return
    }
    if (await post({ body: text.trim() })) setText('')
  }

  async function translate(messageId: string, body: string) {
    setTranslations((t) => ({ ...t, [messageId]: '…' }))
    try {
      const r = await api<{ text: string }>('/api/ai/translate', { body: { text: body } })
      setTranslations((t) => ({ ...t, [messageId]: r.text }))
    } catch (e) {
      setTranslations((t) => ({ ...t, [messageId]: (e as Error).message.includes('AI_API_KEY') ? 'La IA no está activa (falta AI_API_KEY).' : (e as Error).message }))
    }
  }

  async function patch(body: { status?: string; assignedTo?: string | null; followUpAt?: string | null; important?: boolean }) {
    await api(`/api/conversations/${id}`, { method: 'PATCH', body })
    conv.reload()
    onChanged()
  }

  async function ai(kind: 'suggest' | 'rewrite') {
    setBusyAi(true)
    setError('')
    try {
      const r =
        kind === 'suggest'
          ? await api<{ text: string }>(`/api/conversations/${id}/ai-suggest`, { body: {} })
          : await api<{ text: string }>('/api/ai/rewrite', { body: { text } })
      if (r.text) setText(r.text)
    } catch (e) {
      setError((e as Error).message === 'agent_disabled' || (e as Error).message.includes('AI_API_KEY') ? 'La IA no está activa: falta AI_API_KEY en Vercel.' : (e as Error).message)
    } finally {
      setBusyAi(false)
    }
  }

  if (!c) return <div className="chat">{conv.error ? <ErrorNote message={conv.error} /> : <div className="empty">Cargando…</div>}</div>

  const followDue = c.followUpAt && new Date(c.followUpAt).getTime() <= Date.now()

  return (
    <div className="chat">
      <div className="chat-head">
        <button className="icon-btn back-btn" onClick={onBack} aria-label="Volver">
          ←
        </button>
        <Avatar text={initials(c.subscriber.name, c.subscriber.phone)} />
        <div className="grow">
          <strong>{c.subscriber.name || c.subscriber.phone}</strong>
          <div className="muted">
            +{c.subscriber.phone} {c.subscriber.source && c.subscriber.source !== 'whatsapp' && <Badge tone="blue">{c.subscriber.source}</Badge>}
          </div>
        </div>
        <button className="icon-btn" title={c.important ? 'Quitar de importantes' : 'Marcar como importante'} aria-label="Importante" onClick={() => patch({ important: !c.important })}>
          {c.important ? '⭐' : '☆'}
        </button>
        <select value={c.assignedTo ?? ''} onChange={(e) => patch({ assignedTo: e.target.value || null })} style={{ width: 150 }} aria-label="Asignar a">
          <option value="">Bot / sin asignar</option>
          {c.assignedTo && !members.some((m) => m.name === c.assignedTo) && <option value={c.assignedTo}>{c.assignedTo}</option>}
          {members.map((m) => (
            <option key={m.id} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          aria-label="Seguimiento"
          title="Recordatorio de seguimiento"
          style={{ width: 190 }}
          value={c.followUpAt ? new Date(new Date(c.followUpAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
          onChange={(e) => patch({ followUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
        />
        {c.status === 'solved' || c.status === 'archived' ? (
          <button className="btn btn-sm" onClick={() => patch({ status: 'open' })}>
            Reabrir
          </button>
        ) : (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => patch({ status: 'solved', assignedTo: null })}>
              Resolver
            </button>
            <button className="btn btn-sm" onClick={() => patch({ status: 'archived' })}>
              Archivar
            </button>
          </>
        )}
      </div>
      {followDue && <div className="warn-note" style={{ margin: 0, borderRadius: 0 }}>Seguimiento pendiente desde {new Date(c.followUpAt!).toLocaleString()}</div>}
      <div className="chat-body">
        {c.messages.length === 0 && <div className="empty">Sin mensajes.</div>}
        {c.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.direction === 'outbound' ? 'out' : ''} ${m.status === 'failed' ? 'failed' : ''}`}>
            {m.body}
            {m.direction === 'inbound' && m.body && (
              <div>
                {translations[m.id] ? (
                  <div className="muted" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
                    {translations[m.id]}
                  </div>
                ) : (
                  <button className="icon-btn" style={{ padding: '0 4px', fontSize: 12 }} onClick={() => translate(m.id, m.body)}>
                    🌐 Traducir
                  </button>
                )}
              </div>
            )}
            <small>
              {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {m.direction === 'outbound' &&
                ` · ${(m as { metadata?: { sender?: string } }).metadata?.sender === 'ai' ? 'IA · ' : (m as { metadata?: { sender?: string } }).metadata?.sender === 'bot' ? 'bot · ' : ''}${
                  m.status === 'failed' ? 'falló' : m.status === 'read' ? 'leído' : m.status === 'delivered' ? 'entregado' : 'enviado'
                }`}
            </small>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div className="composer" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {c.windowOpen === false && (
          <div className="warn-note" style={{ marginBottom: 8 }}>
            Ventana de 24 h cerrada: solo puedes enviar plantillas hasta que el cliente vuelva a escribir.
          </div>
        )}
        <ErrorNote message={error} />
        <div className="row" style={{ marginBottom: 6, gap: 4 }}>
          <button className={`badge ${mode === 'reply' ? 'badge-green' : 'badge-gray'}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setMode('reply')}>
            Responder
          </button>
          <button className={`badge ${mode === 'note' ? 'badge-amber' : 'badge-gray'}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setMode('note')}>
            Nota interna
          </button>
        </div>
        {matches.length > 0 && mode === 'reply' && (
          <div className="deal" style={{ marginBottom: 8 }}>
            {matches.map((r) => (
              <button key={r.id} className="conv" style={{ padding: 8, border: 0 }} onClick={() => setText(r.body.replace('{{name}}', c.subscriber.name ?? ''))}>
                <strong>/{r.shortcut}</strong>
                <span className="muted conv-preview">{r.body}</span>
              </button>
            ))}
          </div>
        )}
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
          <textarea
            className="grow"
            placeholder={mode === 'note' ? 'Nota interna (el cliente no la ve)…' : 'Escribe un mensaje… (/ para respuestas rápidas · Ctrl+Enter para enviar)'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
            }}
          />
          <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <button className="btn btn-primary" onClick={send} disabled={sending || !text.trim()}>
              {mode === 'note' ? 'Guardar nota' : 'Enviar'}
            </button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 6, display: mode === 'note' ? 'none' : undefined }}>
          <button className="btn btn-sm" onClick={() => ai('suggest')} disabled={busyAi}>
            ✦ Sugerir respuesta
          </button>
          <button className="btn btn-sm" onClick={() => ai('rewrite')} disabled={busyAi || !text.trim()}>
            ✦ Mejorar redacción
          </button>
          <button className="btn btn-sm" onClick={() => setMedia(true)}>
            📎 Enviar archivo
          </button>
        </div>
      </div>
      {media && (
        <MediaModal
          onClose={() => setMedia(false)}
          onSend={async (m) => {
            if (await post({ media: m })) setMedia(false)
          }}
        />
      )}
    </div>
  )
}

function MediaModal({ onClose, onSend }: { onClose: () => void; onSend: (m: { kind: string; url: string; caption: string }) => void }) {
  const [form, setForm] = useState({ kind: 'image', url: '', caption: '' })
  return (
    <Modal
      title="Enviar archivo"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!/^https:\/\//.test(form.url)} onClick={() => onSend(form)}>
          Enviar
        </button>
      }
    >
      <div className="field">
        <span>Tipo</span>
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          <option value="image">Imagen</option>
          <option value="document">Documento (PDF…)</option>
          <option value="video">Vídeo</option>
          <option value="audio">Audio</option>
        </select>
      </div>
      <div className="field">
        <span>URL pública (https)</span>
        <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
        <small className="muted">WhatsApp descarga el archivo desde esta dirección.</small>
      </div>
      <div className="field">
        <span>Texto (opcional)</span>
        <input value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
      </div>
    </Modal>
  )
}

function Side({ id }: { id: string }) {
  const conv = useAsync(() => api<ConvDetail>(`/api/conversations/${id}`), [id])
  const [note, setNote] = useState('')
  const [iq, setIq] = useState<Insights | null>(null)
  const [iqError, setIqError] = useState('')
  const [iqBusy, setIqBusy] = useState(false)
  const c = conv.data

  async function addNote() {
    if (!note.trim()) return
    await api(`/api/conversations/${id}/notes`, { body: { body: note.trim(), author: 'agente' } })
    setNote('')
    conv.reload()
  }

  async function analyze() {
    if (!c) return
    setIqBusy(true)
    setIqError('')
    try {
      setIq(await api<Insights>(`/api/subscribers/${c.subscriber.id}/insights`))
    } catch (e) {
      setIqError((e as Error).message.includes('AI_API_KEY') ? 'Activa la IA (AI_API_KEY) para usar Subscriber IQ.' : (e as Error).message)
    } finally {
      setIqBusy(false)
    }
  }

  if (!c) return <div className="inbox-side" />
  const sub = c.subscriber as typeof c.subscriber & { customFields?: Record<string, unknown> }
  const fields = Object.entries(sub.customFields ?? {})
  return (
    <div className="inbox-side">
      <h3>Contacto</h3>
      <p>
        <strong>{sub.name || '—'}</strong>
        <br />
        <span className="muted">+{sub.phone}</span>
        {sub.email && (
          <>
            <br />
            <span className="muted">{sub.email}</span>
          </>
        )}
      </p>
      <div className="chips" style={{ marginBottom: 12 }}>
        {sub.labels.map((l) => (
          <Badge key={l.label.id} tone="green">
            {l.label.name}
          </Badge>
        ))}
      </div>
      {fields.length > 0 && (
        <>
          <h3 style={{ marginBottom: 6 }}>Campos</h3>
          <table style={{ marginBottom: 12 }}>
            <tbody>
              {fields.map(([k, v]) => (
                <tr key={k}>
                  <td className="muted">{k}</td>
                  <td>{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3 style={{ marginBottom: 6 }}>Subscriber IQ</h3>
      <ErrorNote message={iqError} />
      {iq ? (
        <div className="deal">
          <p style={{ margin: '0 0 8px' }}>{iq.summary}</p>
          <div className="row" style={{ marginBottom: 6 }}>
            <Badge tone={iq.leadScore >= 70 ? 'green' : iq.leadScore >= 40 ? 'amber' : 'gray'}>Lead {iq.leadScore}/100</Badge>
            <Badge tone={iq.churnRisk >= 60 ? 'red' : 'gray'}>Abandono {iq.churnRisk}%</Badge>
            <Badge tone={iq.sentiment === 'positive' ? 'green' : iq.sentiment === 'negative' ? 'red' : 'gray'}>{iq.sentiment === 'positive' ? 'Positivo' : iq.sentiment === 'negative' ? 'Negativo' : 'Neutral'}</Badge>
          </div>
          <strong>Siguiente acción</strong>
          <div>{iq.nextBestAction}</div>
        </div>
      ) : null}
      <button className="btn btn-sm" style={{ margin: '4px 0 16px' }} onClick={analyze} disabled={iqBusy}>
        {iqBusy ? 'Analizando…' : iq ? 'Actualizar análisis' : '✦ Analizar con IA'}
      </button>

      <h3 style={{ marginBottom: 8 }}>Notas internas</h3>
      <textarea placeholder="Añadir nota…" value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 60 }} />
      <button className="btn btn-sm" style={{ margin: '8px 0 12px' }} onClick={addNote} disabled={!note.trim()}>
        Guardar nota
      </button>
      {c.notes?.map((n) => (
        <div key={n.id} className="deal">
          {n.body}
          <small className="muted" style={{ display: 'block', marginTop: 4 }}>
            {n.author} · {timeAgo(n.createdAt)}
          </small>
        </div>
      ))}
    </div>
  )
}
