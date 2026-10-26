import { api } from '../api'
import { Badge, Card, ErrorNote, Page, useAsync } from '../ui'

interface Account {
  whatsapp: { configured: boolean; phoneNumberId: string | null; businessAccountId: string | null; signatureValidation: boolean }
  ai: { ready: boolean; model: string }
  counts: { subscribers: number; conversations: number }
}

function Row({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td>
        <Badge tone={ok ? 'green' : 'amber'}>{ok ? 'Listo' : 'Pendiente'}</Badge>
      </td>
      <td className="muted mono">{detail}</td>
    </tr>
  )
}

export default function Settings() {
  const account = useAsync(() => api<Account>('/api/account'))
  const a = account.data
  const origin = window.location.origin

  return (
    <Page title="Conexión" subtitle="Estado de WhatsApp Cloud API y configuración del webhook">
      <ErrorNote message={account.error} />
      {a && (
        <Card title="Estado">
          <table>
            <tbody>
              <Row label="WhatsApp Cloud API" ok={a.whatsapp.configured} detail={a.whatsapp.phoneNumberId ? `Phone ID ${a.whatsapp.phoneNumberId}` : 'Falta WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN'} />
              <Row label="Validación de firma de Meta" ok={a.whatsapp.signatureValidation} detail={a.whatsapp.signatureValidation ? 'WHATSAPP_APP_SECRET definido' : 'Falta WHATSAPP_APP_SECRET'} />
              <Row label="Agente IA" ok={a.ai.ready} detail={a.ai.ready ? a.ai.model : 'Falta AI_API_KEY'} />
            </tbody>
          </table>
        </Card>
      )}
      <Card title="Configurar el webhook en Meta">
        <ol style={{ paddingLeft: 18, margin: 0, lineHeight: 1.9 }}>
          <li>
            En <strong>Meta for Developers → tu app → WhatsApp → Configuración</strong>, pulsa <em>Editar</em> en Webhook.
          </li>
          <li>
            URL de devolución de llamada: <span className="mono">{origin}/api/whatsapp/webhook</span>
          </li>
          <li>
            Token de verificación: el valor de <span className="mono">WHATSAPP_WEBHOOK_VERIFY_TOKEN</span> en Vercel.
          </li>
          <li>
            Suscríbete al campo <span className="mono">messages</span>.
          </li>
          <li>
            Variables a definir en Vercel: <span className="mono">WHATSAPP_PHONE_NUMBER_ID</span>, <span className="mono">WHATSAPP_BUSINESS_ACCOUNT_ID</span>, <span className="mono">WHATSAPP_ACCESS_TOKEN</span>, <span className="mono">WHATSAPP_APP_SECRET</span>.
          </li>
        </ol>
      </Card>
      {a && (
        <Card title="Datos">
          <p style={{ margin: 0 }}>
            {a.counts.subscribers} contactos · {a.counts.conversations} conversaciones
          </p>
        </Card>
      )}
    </Page>
  )
}
