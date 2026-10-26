import { Link } from 'react-router-dom'
import { api } from '../api'
import { Badge, Card, Icon, ErrorNote, Page, useAsync } from '../ui'

interface Overview {
  subscribers: number
  newSubscribers: number
  conversations: { open: number; pending: number; solved: number }
  messagesPerDay: { date: string; inbound: number; outbound: number }[]
  broadcasts: { total: number; sent: number; delivered: number; read: number; failed: number; deliveryRate: number; readRate: number }
  deals: { stage: string; count: number; value: number }[]
  labels: { name: string; subscribers: number }[]
  growth30?: { joined: number; left: number; perDay: { date: string; count: number }[] }
  broadcasts30?: { campaigns: number; completed: number; messagesSent: number; failed: number; avgOpenRate: number }
}

interface SourceRow {
  source: string
  kind: string
  subscribers: number
  won: number
  wonValue: number
  conversion: number
}

interface Account {
  whatsapp: { configured: boolean }
  ai: { ready: boolean; model?: string }
}

const QUICK: { to: string; icon: string; title: string; hint: string }[] = [
  { to: '/broadcasts', icon: 'megaphone', title: 'Nuevo broadcast', hint: 'Enviar a tu audiencia' },
  { to: '/inbox', icon: 'inbox', title: 'Abrir bandeja', hint: 'Ver conversaciones' },
  { to: '/automations', icon: 'bolt', title: 'Crear flujo', hint: 'Construir automatización' },
  { to: '/ai', icon: 'sparkle', title: 'Entrenar IA', hint: 'Mejorar sus respuestas' },
  { to: '/settings', icon: 'plug', title: 'Conectar canal', hint: 'WhatsApp Cloud API' },
]

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="muted">{hint}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { data, error, loading } = useAsync(async () => {
    const [overview, account, knowledge, sources] = await Promise.all([
      api<Overview>('/api/analytics/overview'),
      api<Account>('/api/account'),
      api<unknown[]>('/api/knowledge'),
      api<SourceRow[]>('/api/analytics/sources'),
    ])
    return { overview, account, knowledge: knowledge.length, sources }
  })

  if (loading && !data) return <Page title="Panel">Cargando…</Page>
  const o = data?.overview
  const max = Math.max(1, ...(o?.messagesPerDay.flatMap((d) => [d.inbound, d.outbound]) ?? [1]))

  return (
    <Page title="Panel" subtitle="Resumen de los últimos 7 días">
      <ErrorNote message={error} />
      {data && !data.account.whatsapp.configured && (
        <div className="warn-note">
          WhatsApp aún no está conectado: puedes preparar contactos, flujos y plantillas, pero no se enviarán mensajes. <Link to="/settings">Ver conexión</Link>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: 16 }}>
        {QUICK.map((qa) => (
          <Link key={qa.to} to={qa.to} className="card quick" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Icon name={qa.icon} />
            <strong>{qa.title}</strong>
            <div className="muted">{qa.hint}</div>
          </Link>
        ))}
      </div>
      {o && (
        <>
          <div className="grid grid-4">
            <Stat label="Contactos" value={o.subscribers} hint={`+${o.newSubscribers} esta semana`} />
            <Stat label="Conversaciones abiertas" value={o.conversations.open} hint={`${o.conversations.pending} pendientes`} />
            <Stat label="Entrega de broadcasts" value={`${o.broadcasts.deliveryRate}%`} hint={`${o.broadcasts.sent} enviados`} />
            <Stat label="Lectura de broadcasts" value={`${o.broadcasts.readRate}%`} hint={`${o.broadcasts.failed} fallidos`} />
          </div>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Card title="Mensajes por día">
              <div className="legend">
                <span>
                  <i className="dot" style={{ background: 'var(--blue)' }} />
                  Recibidos
                </span>
                <span>
                  <i className="dot" style={{ background: 'var(--brand)' }} />
                  Enviados
                </span>
              </div>
              <div className="bars">
                {o.messagesPerDay.map((d) => (
                  <div className="bar-col" key={d.date} title={`${d.date}: ${d.inbound} recibidos, ${d.outbound} enviados`}>
                    <div className="bar-stack">
                      <div className="bar in" style={{ height: `${(d.inbound / max) * 100}%` }} />
                      <div className="bar out" style={{ height: `${(d.outbound / max) * 100}%` }} />
                    </div>
                    <small className="muted">{d.date.slice(8)}</small>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Pipeline CRM" actions={<Link to="/crm">Abrir</Link>}>
              {o.deals.length === 0 ? (
                <p className="muted">Sin oportunidades todavía.</p>
              ) : (
                <table>
                  <tbody>
                    {o.deals.map((d) => (
                      <tr key={d.stage}>
                        <td>{d.stage}</td>
                        <td>{d.count} deals</td>
                        <td>{d.value.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          {o.growth30 && (
            <div className="grid grid-2" style={{ marginTop: 16 }}>
              <Card title="Crecimiento de contactos (30 días)">
                <div className="legend">
                  <span>
                    <i className="dot" style={{ background: 'var(--brand)', marginRight: 4 }} />
                    Nuevos: {o.growth30.joined}
                  </span>
                  <span>Bajas y bloqueos: {o.growth30.left}</span>
                </div>
                <div className="bars" style={{ height: 110 }}>
                  {o.growth30.perDay.map((d) => {
                    const peak = Math.max(1, ...o.growth30!.perDay.map((x) => x.count))
                    return (
                      <div className="bar-col" key={d.date} title={`${d.date}: ${d.count}`} style={{ minWidth: 4 }}>
                        <div className="bar-stack">
                          <div className="bar out" style={{ height: `${(d.count / peak) * 100}%`, width: '70%', maxWidth: 'none' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
              <Card title="Broadcasts (últimos 30 días)" actions={<Link to="/broadcasts">Abrir</Link>}>
                <table>
                  <tbody>
                    <tr><td>Campañas</td><td>{o.broadcasts30?.campaigns ?? 0}</td></tr>
                    <tr><td>Completadas</td><td>{o.broadcasts30?.completed ?? 0}</td></tr>
                    <tr><td>Mensajes enviados</td><td>{o.broadcasts30?.messagesSent ?? 0}</td></tr>
                    <tr><td>Tasa media de lectura</td><td>{o.broadcasts30?.avgOpenRate ?? 0}%</td></tr>
                    <tr><td>Fallidos / sin entregar</td><td>{o.broadcasts30?.failed ?? 0}</td></tr>
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          <Card title="Estado del agente IA" actions={<Link to="/ai">Configurar</Link>}>
            <div className="row">
              <Badge tone={data?.account.ai.ready ? 'green' : 'gray'}>{data?.account.ai.ready ? 'Activo' : 'Inactivo'}</Badge>
              <span>{data?.knowledge ?? 0} fuentes de conocimiento</span>
              {data?.account.ai.ready && <span className="muted">· modelo {data.account.ai.model}</span>}
            </div>
          </Card>

          {data && data.sources.length > 0 && (
            <Card title="Origen de los leads">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Origen</th>
                      <th>Contactos</th>
                      <th>Oportunidades ganadas</th>
                      <th>Conversión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((r) => (
                      <tr key={r.source}>
                        <td>
                          {r.kind === 'anuncio' ? '📣 Anuncio ' : ''}
                          <span className="mono">{r.source}</span>
                        </td>
                        <td>{r.subscribers}</td>
                        <td>
                          {r.won}
                          {r.wonValue > 0 ? ' · ' + r.wonValue.toLocaleString() : ''}
                        </td>
                        <td>{r.conversion}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                Los chats que llegan desde un anuncio de Click-to-WhatsApp se guardan como «ctwa:&lt;id del anuncio&gt;».
              </p>
            </Card>
          )}

          <Card title="Etiquetas principales">
            {o.labels.length === 0 ? (
              <p className="muted">Aún no hay etiquetas.</p>
            ) : (
              <div className="chips">
                {o.labels.map((l) => (
                  <span key={l.name} className="badge badge-green">
                    {l.name} · {l.subscribers}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  )
}
