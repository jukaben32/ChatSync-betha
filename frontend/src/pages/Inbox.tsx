import { useEffect, useRef, useState } from 'react'
import { api, initials, timeAgo } from '../api'
import type { Conversation } from '../api'
import { Avatar, Badge, ErrorNote, useAsync } from '../ui'

interface Member {
  id: string
  name: string
}

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'gray' }> = {
  open: { label: 'Abierta', tone: 'green' },
  pending: { label: 'Pendiente', tone: 'amber' },
  solved: { label: 'Resuelta', tone: 'gray' },
}

export default function Inbox() {
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const list = useAsync(
    () => api<Conversation[]>(`/api/conversations?${new URLSearchParams({ ...(filter ? { status: filter } : {}), ...(search ? { q: search } : {}) })}`),
    [filter, search],
  )
  const team = useAsync(() => api<Member[]>('/api/team'))

  // Refresco periódico de la lista (sustituye al tiempo real sin websockets en serverless)
  useEffect(() => {
    const t = setInterval(() => list.reload(), 15000)
    return () => clearInterval(t)
  }, [list.reload])

  return (
    <div className={`inbox ${selected ? 'has-chat' : ''}`}>
      <div className="inbox-list">
        <div className="inbox-search">
          <input placeholder="Buscar nombre o teléfono…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Estado">
            <option value="">Todas</option>
            <option value="open">Abiertas</option>
            <option value="pending">Pendientes</option>
            <option value="solved">Resueltas</option>
          </select>
        </div>
        <ErrorNote message={list.error} />
        {list.data?.length === 0 && <div className="empty">Sin conversaciones. Aparecerán cuando lleguen mensajes por WhatsApp.</div>}
        {list.data?.map((c) => (
          <button key={c.id} className={`conv ${selected === c.id ? 'active' : ''}`} onClick={() => setSelected(c.id)}>
            <Avatar text={initials(c.subscriber.name, c.subscriber.phone)} />
            <div className="grow">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{c.subscriber.name || c.subscriber.phone}</strong>
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
        <Chat key={selected} id={selected} members={team.data ?? []} onBack={() => setSelected(null)} onChanged={list.reload} />
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

function Chat({ id, members, onBack, onChanged }: { id: string; members: Member[]; onBack: () => void; onChanged: () => void }) {
  const conv = useAsync(() => api<Conversation>(`/api/conversations/${id}`), [id])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setInterval(() => conv.reload(), 8000)
    return () => clearInterval(t)
  }, [conv.reload])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [conv.data?.messages.length])

  const c = conv.data

  async function send() {
    if (!text.trim()) return
    setSending(true)
    setError('')
    try {
      await api(`/api/conversations/${id}/messages`, { body: { body: text.trim() } })
      setText('')
    } catch (e) {
      setError((e as Error).message === 'whatsapp_not_configured' ? 'WhatsApp no está conectado todavía: el mensaje se guardó como fallido.' : (e as Error).message)
    } finally {
      setSending(false)
      conv.reload()
      onChanged()
    }
  }

  async function patch(body: { status?: string; assignedTo?: string | null }) {
    await api(`/api/conversations/${id}`, { method: 'PATCH', body })
    conv.reload()
    onChanged()
  }

  if (!c) return <div className="chat">{conv.error ? <ErrorNote message={conv.error} /> : <div className="empty">Cargando…</div>}</div>

  return (
    <div className="chat">
      <div className="chat-head">
        <button className="icon-btn back-btn" onClick={onBack} aria-label="Volver">
          ←
        </button>
        <Avatar text={initials(c.subscriber.name, c.subscriber.phone)} />
        <div className="grow">
          <strong>{c.subscriber.name || c.subscriber.phone}</strong>
          <div className="muted">+{c.subscriber.phone}</div>
        </div>
        <select value={c.assignedTo ?? ''} onChange={(e) => patch({ assignedTo: e.target.value || null })} style={{ width: 150 }} aria-label="Asignar a">
          <option value="">Bot / sin asignar</option>
          {members.map((m) => (
            <option key={m.id} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
        {c.status === 'solved' ? (
          <button className="btn btn-sm" onClick={() => patch({ status: 'open' })}>
            Reabrir
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={() => patch({ status: 'solved', assignedTo: null })}>
            Resolver
          </button>
        )}
      </div>
      <div className="chat-body">
        {c.messages.length === 0 && <div className="empty">Sin mensajes.</div>}
        {c.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.direction === 'outbound' ? 'out' : ''} ${m.status === 'failed' ? 'failed' : ''}`}>
            {m.body}
            <small>
              {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {m.direction === 'outbound' && ` · ${m.status === 'failed' ? 'falló' : m.status === 'read' ? 'leído' : m.status === 'delivered' ? 'entregado' : 'enviado'}`}
            </small>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div className="composer" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <ErrorNote message={error} />
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
          <textarea
            className="grow"
            placeholder="Escribe un mensaje…  (Ctrl+Enter para enviar)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
            }}
          />
          <button className="btn btn-primary" onClick={send} disabled={sending || !text.trim()}>
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}

function Side({ id }: { id: string }) {
  const conv = useAsync(() => api<Conversation>(`/api/conversations/${id}`), [id])
  const [note, setNote] = useState('')
  const c = conv.data

  async function addNote() {
    if (!note.trim()) return
    await api(`/api/conversations/${id}/notes`, { body: { body: note.trim(), author: 'agente' } })
    setNote('')
    conv.reload()
  }

  if (!c) return <div className="inbox-side" />
  const sub = c.subscriber as typeof c.subscriber & { labels: { label: { id: string; name: string } }[] }
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
      <div className="chips" style={{ marginBottom: 16 }}>
        {sub.labels.map((l) => (
          <Badge key={l.label.id} tone="green">
            {l.label.name}
          </Badge>
        ))}
      </div>
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
