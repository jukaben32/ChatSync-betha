import { useState } from 'react'
import { api, timeAgo } from '../api'
import { Badge, Card, Empty, ErrorNote, Page, useAsync } from '../ui'

interface Endpoint {
  id: string
  url: string
  events: string[]
  secret: string | null
  active: boolean
}

interface ApiKeyRow {
  id: string
  name: string
  prefix: string
  lastUsedAt: string | null
  createdAt: string
}

export default function Integrations() {
  const hooks = useAsync(() => api<{ events: string[]; endpoints: Endpoint[] }>('/api/webhooks'))
  const keys = useAsync(() => api<ApiKeyRow[]>('/api/api-keys'))
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const [keyName, setKeyName] = useState('')
  const [newKey, setNewKey] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function addHook() {
    setError('')
    try {
      await api('/api/webhooks', { body: { url, events } })
      setUrl('')
      setEvents([])
      hooks.reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function addKey() {
    const r = await api<{ key: string }>('/api/api-keys', { body: { name: keyName || 'API key' } })
    setNewKey(r.key)
    setKeyName('')
    keys.reload()
  }

  async function testHooks() {
    await api('/api/webhooks/test', { body: {} })
    setInfo('Evento de prueba enviado a los webhooks activos.')
  }

  const origin = window.location.origin

  return (
    <Page title="Webhooks y API" subtitle="Conecta ChatSyncs con n8n, Zapier, Make u otros proyectos tuyos">
      <ErrorNote message={error || hooks.error} />
      {info && <div className="ok-note">{info}</div>}

      <Card title="Webhooks salientes" actions={<button className="btn btn-sm" onClick={testHooks}>Enviar evento de prueba</button>}>
        <div className="row" style={{ marginBottom: 8 }}>
          <input className="grow" placeholder="https://tu-n8n.com/webhook/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn btn-primary" onClick={addHook} disabled={!/^https?:\/\//.test(url)}>
            Añadir
          </button>
        </div>
        <div className="chips" style={{ marginBottom: 12 }}>
          {hooks.data?.events.map((ev) => {
            const on = events.includes(ev)
            return (
              <button key={ev} type="button" className={`badge ${on ? 'badge-green' : 'badge-gray'}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setEvents(on ? events.filter((x) => x !== ev) : [...events, ev])}>
                {on ? '✓ ' : ''}
                {ev}
              </button>
            )
          })}
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Sin eventos seleccionados, el endpoint recibe todos. Cada envío incluye la cabecera X-ChatSyncs-Signature (HMAC SHA-256 con el secreto).
        </p>
        {hooks.data?.endpoints.length === 0 ? (
          <Empty>No hay webhooks configurados.</Empty>
        ) : (
          hooks.data?.endpoints.map((h) => (
            <div key={h.id} className="deal">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="mono">{h.url}</span>
                <div className="row">
                  <Badge tone={h.active ? 'green' : 'gray'}>{h.active ? 'Activo' : 'Pausado'}</Badge>
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      await api(`/api/webhooks/${h.id}`, { method: 'PATCH', body: { active: !h.active } })
                      hooks.reload()
                    }}
                  >
                    {h.active ? 'Pausar' : 'Activar'}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={async () => {
                      await api(`/api/webhooks/${h.id}`, { method: 'DELETE' })
                      hooks.reload()
                    }}
                  >
                    Quitar
                  </button>
                </div>
              </div>
              <div className="muted">{h.events.length ? h.events.join(', ') : 'Todos los eventos'}</div>
              {h.secret && <div className="muted mono">secreto: {h.secret}</div>}
            </div>
          ))
        )}
      </Card>

      <Card title="API keys (REST)">
        <p className="muted" style={{ marginTop: 0 }}>
          Usa <span className="mono">Authorization: Bearer &lt;key&gt;</span> contra <span className="mono">{origin}/api/…</span>
        </p>
        {newKey && (
          <div className="ok-note">
            Copia tu clave ahora, no se volverá a mostrar:
            <div className="mono" style={{ wordBreak: 'break-all', marginTop: 4 }}>{newKey}</div>
          </div>
        )}
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="grow" placeholder="Nombre (p. ej. n8n)" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          <button className="btn btn-primary" onClick={addKey}>
            Crear clave
          </button>
        </div>
        {keys.data?.length === 0 ? (
          <Empty>No hay claves creadas.</Empty>
        ) : (
          <table>
            <tbody>
              {keys.data?.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="mono">{k.prefix}…</td>
                  <td className="muted">{k.lastUsedAt ? `usada ${timeAgo(k.lastUsedAt)}` : 'sin usar'}</td>
                  <td>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={async () => {
                        await api(`/api/api-keys/${k.id}`, { method: 'DELETE' })
                        keys.reload()
                      }}
                    >
                      Revocar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  )
}
