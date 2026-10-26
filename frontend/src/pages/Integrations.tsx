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
  scopes: string[]
  active: boolean
  lastUsedAt: string | null
  createdAt: string
}

interface LogRow {
  id: string
  keyName: string | null
  method: string
  path: string
  status: number
  createdAt: string
}

const SCOPE_LABEL: Record<string, string> = { read: 'Leer', write: 'Escribir', send: 'Enviar mensajes' }

export default function Integrations() {
  const hooks = useAsync(() => api<{ events: string[]; endpoints: Endpoint[] }>('/api/webhooks'))
  const keys = useAsync(() => api<ApiKeyRow[]>('/api/api-keys'))
  const logs = useAsync(() => api<LogRow[]>('/api/api-logs'))
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const [keyName, setKeyName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['read', 'write', 'send'])
  const [newKey, setNewKey] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [showLogs, setShowLogs] = useState(false)

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
    // Sin ningún alcance marcado, el servidor lo trataría como acceso total: se exige elegir al menos uno
    const r = await api<{ key: string }>('/api/api-keys', { body: { name: keyName || 'API key', scopes } })
    setNewKey(r.key)
    setKeyName('')
    keys.reload()
  }

  async function testHooks() {
    await api('/api/webhooks/test', { body: {} })
    setInfo('Evento de prueba enviado a los webhooks activos.')
  }

  const origin = window.location.origin
  const allScopes = scopes.length === 3

  return (
    <Page title="Webhooks y API" subtitle="Conecta ChatSyncs con n8n, Zapier, Make u otros proyectos tuyos">
      <ErrorNote message={error || hooks.error} />
      {info && <div className="ok-note">{info}</div>}

      <Card
        title="Webhooks salientes"
        actions={
          <button className="btn btn-sm" onClick={testHooks}>
            Enviar evento de prueba
          </button>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Elige los eventos que recibirá cada URL: mensaje entrante, mensaje saliente o cambio de estado (enviado, entregado, leído, fallido). Para recibir eventos de apps externas usa{' '}
          <strong>Webhook Workflows</strong>.
        </p>
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
          Sin eventos seleccionados, el endpoint recibe todos. Cada envío incluye <span className="mono">X-ChatSyncs-Signature</span> (HMAC SHA-256 del cuerpo con el secreto).
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
          Usa <span className="mono">Authorization: Bearer &lt;key&gt;</span> contra <span className="mono">{origin}/api/…</span>. Cada clave tiene los permisos que marques y se puede desactivar sin borrarla.
        </p>
        {newKey && (
          <div className="ok-note">
            Copia tu clave ahora, no se volverá a mostrar:
            <div className="mono" style={{ wordBreak: 'break-all', marginTop: 4 }}>
              {newKey}
            </div>
          </div>
        )}
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="grow" placeholder="Nombre (p. ej. n8n)" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          {Object.entries(SCOPE_LABEL).map(([k, v]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={scopes.includes(k)} onChange={(e) => setScopes(e.target.checked ? [...scopes, k] : scopes.filter((s) => s !== k))} /> {v}
            </label>
          ))}
          <button className="btn btn-primary" onClick={addKey} disabled={scopes.length === 0}>
            Crear clave
          </button>
        </div>
        {!allScopes && scopes.length > 0 && <p className="muted" style={{ marginTop: 0 }}>Esta clave solo podrá: {scopes.map((s) => SCOPE_LABEL[s].toLowerCase()).join(', ')}.</p>}
        {keys.data?.length === 0 ? (
          <Empty>No hay claves creadas.</Empty>
        ) : (
          <table>
            <tbody>
              {keys.data?.map((k) => (
                <tr key={k.id}>
                  <td>
                    {k.name}
                    <div className="muted mono">{k.prefix}…</div>
                  </td>
                  <td>
                    <div className="chips">
                      {(k.scopes.length ? k.scopes : ['read', 'write', 'send']).map((s) => (
                        <Badge key={s} tone="blue">
                          {SCOPE_LABEL[s]}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="muted">{k.lastUsedAt ? `usada ${timeAgo(k.lastUsedAt)}` : 'sin usar'}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <Badge tone={k.active ? 'green' : 'gray'}>{k.active ? 'Activa' : 'Desactivada'}</Badge>
                      <button
                        className="btn btn-sm"
                        onClick={async () => {
                          await api(`/api/api-keys/${k.id}`, { method: 'PATCH', body: { active: !k.active } })
                          keys.reload()
                        }}
                      >
                        {k.active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          await api(`/api/api-keys/${k.id}`, { method: 'DELETE' })
                          keys.reload()
                        }}
                      >
                        Borrar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Registro de uso de la API"
        actions={
          <button
            className="btn btn-sm"
            onClick={() => {
              setShowLogs(!showLogs)
              logs.reload()
            }}
          >
            {showLogs ? 'Ocultar' : 'Ver últimas 100 llamadas'}
          </button>
        }
      >
        {showLogs &&
          (logs.data?.length === 0 ? (
            <Empty>Aún no hay llamadas con API keys.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {logs.data?.map((l) => (
                    <tr key={l.id}>
                      <td className="muted">{timeAgo(l.createdAt)}</td>
                      <td>{l.keyName}</td>
                      <td className="mono">
                        {l.method} {l.path}
                      </td>
                      <td>
                        <Badge tone={l.status < 300 ? 'green' : l.status < 500 ? 'amber' : 'red'}>{l.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {!showLogs && <p className="muted" style={{ margin: 0 }}>Solo se registran las llamadas hechas con API keys (no las del panel).</p>}
      </Card>

      <Card title="Ejemplos rápidos">
        <pre className="mono" style={{ overflowX: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>{`# Crear un contacto
curl -X POST ${origin}/api/subscribers \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"phone":"18095550000","name":"Ana"}'

# Enviar un mensaje a una conversación
curl -X POST ${origin}/api/conversations/$CONVERSATION_ID/messages \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"body":"Hola, tu pedido salió hoy"}'

# Lanzar un flujo o secuencia para un contacto
curl -X POST ${origin}/api/sequences/$ID/trigger \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"phone":"18095550000"}'`}</pre>
      </Card>
    </Page>
  )
}
