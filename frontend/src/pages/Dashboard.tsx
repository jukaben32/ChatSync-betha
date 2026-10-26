import { Link } from 'react-router-dom'
import { api } from '../api'
import { Card, ErrorNote, Page, useAsync } from '../ui'

interface Overview {
  subscribers: number
  newSubscribers: number
  conversations: { open: number; pending: number; solved: number }
  messagesPerDay: { date: string; inbound: number; outbound: number }[]
  broadcasts: { total: number; sent: number; delivered: number; read: number; failed: number; deliveryRate: number; readRate: number }
  deals: { stage: string; count: number; value: number }[]
  labels: { name: string; subscribers: number }[]
}

interface Account {
  whatsapp: { configured: boolean }
  ai: { ready: boolean }
}

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
    const [overview, account] = await Promise.all([api<Overview>('/api/analytics/overview'), api<Account>('/api/account')])
    return { overview, account }
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
