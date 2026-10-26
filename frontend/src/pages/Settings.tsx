import { useState } from 'react'
import { api } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Page, useAsync } from '../ui'

interface Account {
  whatsapp: { configured: boolean; phoneNumberId: string | null; businessAccountId: string | null; signatureValidation: boolean }
  ai: { ready: boolean; model: string }
  counts: { subscribers: number; conversations: number }
}

interface DayHours {
  enabled: boolean
  start: string
  end: string
}

interface Settings {
  businessHours: {
    enabled: boolean
    timezone: string
    days: Record<string, DayHours>
    offHoursMessage: string
    offHoursBehavior: 'message' | 'bot_only_off_hours' | 'ignore'
  }
  ai: { mode: 'all' | 'fallback'; delaySeconds: number; escalateOnNegative: boolean; restrictedTopics: string; autoActions: boolean }
  assignment: { mode: 'manual' | 'round_robin' }
  sandbox: { enabled: boolean }
  agent: { signature: string; translateLanguage: string }
  security: { ipAllowlist: string[] }
  followups: { enabled: boolean; afterHours: number; maxNudges: number; message: string; useAi: boolean }
}

const DAYS: [string, string][] = [
  ['mon', 'Lunes'],
  ['tue', 'Martes'],
  ['wed', 'Miércoles'],
  ['thu', 'Jueves'],
  ['fri', 'Viernes'],
  ['sat', 'Sábado'],
  ['sun', 'Domingo'],
]

const TABS = [
  { id: 'connection', label: 'Conexión' },
  { id: 'hours', label: 'Horario comercial' },
  { id: 'ai', label: 'IA y asignación' },
  { id: 'agent', label: 'Mi cuenta' },
  { id: 'security', label: 'Seguridad' },
  { id: 'data', label: 'Campos y respuestas rápidas' },
  { id: 'test', label: 'Consola de pruebas' },
]

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

export default function SettingsPage() {
  const [tab, setTab] = useState('connection')
  const account = useAsync(() => api<Account>('/api/account'))
  const settings = useAsync(() => api<Settings>('/api/settings'))

  async function save<K extends keyof Settings>(key: K, value: Settings[K]) {
    await api(`/api/settings/${key}`, { method: 'PUT', body: value })
    settings.reload()
  }

  return (
    <Page title="Ajustes" subtitle="Conexión de WhatsApp, horario, IA, asignación y pruebas">
      <ErrorNote message={account.error || settings.error} />
      <div className="tabs" style={{ overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} style={{ whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'connection' && <Connection account={account.data} settings={settings.data} onSandbox={(enabled) => save('sandbox', { enabled })} />}
      {tab === 'hours' && settings.data && <Hours value={settings.data.businessHours} onSave={(v) => save('businessHours', v)} />}
      {tab === 'ai' && settings.data && (
        <AiAssignment
          ai={settings.data.ai}
          assignment={settings.data.assignment}
          followups={settings.data.followups}
          aiReady={account.data?.ai.ready ?? false}
          onAi={(v) => save('ai', v)}
          onAssignment={(v) => save('assignment', v)}
          onFollowups={(v) => save('followups', v)}
        />
      )}
      {tab === 'security' && settings.data && <SecurityTab value={settings.data.security} onSave={(v) => save('security', v)} />}
      {tab === 'agent' && settings.data && <AgentTab value={settings.data.agent} onSave={(v) => save('agent', v)} />}
      {tab === 'data' && <DataTab />}
      {tab === 'test' && <TestConsole sandbox={settings.data?.sandbox.enabled ?? false} />}
    </Page>
  )
}

function Connection({ account: a, settings, onSandbox }: { account: Account | null; settings: Settings | null; onSandbox: (v: boolean) => void }) {
  const origin = window.location.origin
  return (
    <>
      {a && (
        <Card title="Estado">
          <table>
            <tbody>
              <Row label="WhatsApp Cloud API" ok={a.whatsapp.configured} detail={a.whatsapp.phoneNumberId ? `Phone ID ${a.whatsapp.phoneNumberId}` : 'Falta WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN'} />
              <Row label="Validación de firma de Meta" ok={a.whatsapp.signatureValidation} detail={a.whatsapp.signatureValidation ? 'WHATSAPP_APP_SECRET definido' : 'Falta WHATSAPP_APP_SECRET (sin él se rechazan los webhooks de Meta)'} />
              <Row label="Agente IA" ok={a.ai.ready} detail={a.ai.ready ? a.ai.model : 'Falta AI_API_KEY'} />
            </tbody>
          </table>
        </Card>
      )}
      {settings && !a?.whatsapp.configured && (
        <Card title="Modo simulación">
          <p className="muted" style={{ marginTop: 0 }}>
            Mientras no conectes WhatsApp, activa la simulación para probar flujos, broadcasts y la bandeja: los mensajes se guardan como enviados sin llamar a Meta. Desactívala al conectar el número real.
          </p>
          <label className="check">
            <input type="checkbox" checked={settings.sandbox.enabled} onChange={(e) => onSandbox(e.target.checked)} /> Modo simulación activado
          </label>
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
    </>
  )
}

function Hours({ value, onSave }: { value: Settings['businessHours']; onSave: (v: Settings['businessHours']) => Promise<void> }) {
  const [v, setV] = useState(value)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const setDay = (key: string, patch: Partial<DayHours>) => setV({ ...v, days: { ...v.days, [key]: { ...v.days[key], ...patch } } })

  async function save() {
    setError('')
    try {
      await onSave(v)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError((e as Error).message === 'invalid_timezone' ? 'Zona horaria no válida (p. ej. America/Santo_Domingo).' : (e as Error).message)
    }
  }

  return (
    <Card title="Horario comercial" actions={saved ? <Badge tone="green">Guardado</Badge> : undefined}>
      <ErrorNote message={error} />
      <label className="check" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> Usar horario comercial
      </label>
      <Field label="Zona horaria (IANA)">
        <input value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} style={{ maxWidth: 280 }} />
      </Field>
      <table style={{ marginBottom: 12 }}>
        <tbody>
          {DAYS.map(([k, label]) => (
            <tr key={k}>
              <td style={{ width: 130 }}>
                <label className="check">
                  <input type="checkbox" checked={v.days[k]?.enabled ?? false} onChange={(e) => setDay(k, { enabled: e.target.checked })} /> {label}
                </label>
              </td>
              <td>
                <div className="row">
                  <input type="time" style={{ width: 130 }} value={v.days[k]?.start ?? '09:00'} onChange={(e) => setDay(k, { start: e.target.value })} disabled={!v.days[k]?.enabled} aria-label={`Apertura ${label}`} />
                  <span>a</span>
                  <input type="time" style={{ width: 130 }} value={v.days[k]?.end ?? '18:00'} onChange={(e) => setDay(k, { end: e.target.value })} disabled={!v.days[k]?.enabled} aria-label={`Cierre ${label}`} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Field label="Qué hace el bot según el horario">
        <select value={v.offHoursBehavior} onChange={(e) => setV({ ...v, offHoursBehavior: e.target.value as typeof v.offHoursBehavior })}>
          <option value="ignore">Nada: el horario no afecta al bot</option>
          <option value="message">Fuera de horario: enviar el aviso y no responder más</option>
          <option value="bot_only_off_hours">El bot/IA responde solo fuera de horario (en horario atiende una persona)</option>
        </select>
      </Field>
      <Field label="Aviso fuera de horario" hint="Se envía una sola vez cada 12 h por conversación.">
        <textarea value={v.offHoursMessage} onChange={(e) => setV({ ...v, offHoursMessage: e.target.value })} />
      </Field>
      <button className="btn btn-primary" onClick={save}>
        Guardar horario
      </button>
    </Card>
  )
}

interface AiAssignmentProps {
  ai: Settings['ai']
  assignment: Settings['assignment']
  followups: Settings['followups']
  aiReady: boolean
  onAi: (v: Settings['ai']) => Promise<void>
  onAssignment: (v: Settings['assignment']) => Promise<void>
  onFollowups: (v: Settings['followups']) => Promise<void>
}

function AiAssignment({ ai, assignment, followups, aiReady, onAi, onAssignment, onFollowups }: AiAssignmentProps) {
  const [f, setF] = useState(followups)
  const [a, setA] = useState(ai)
  const [saved, setSaved] = useState('')
  const flash = (k: string) => {
    setSaved(k)
    setTimeout(() => setSaved(''), 1500)
  }
  return (
    <>
      <Card title="Agente IA" actions={saved === 'ai' ? <Badge tone="green">Guardado</Badge> : <Badge tone={aiReady ? 'green' : 'amber'}>{aiReady ? 'Activo' : 'Falta AI_API_KEY'}</Badge>}>
        <Field label="Cuándo responde">
          <select value={a.mode} onChange={(e) => setA({ ...a, mode: e.target.value as typeof a.mode })}>
            <option value="fallback">Solo si ningún flujo por palabra clave aplica</option>
            <option value="all">A todos los mensajes (la IA decide y puede lanzar flujos)</option>
          </select>
        </Field>
        <Field label="Espera antes de responder (segundos, máx. 8)" hint="Simula una respuesta humana.">
          <input type="number" min={0} max={8} value={a.delaySeconds} onChange={(e) => setA({ ...a, delaySeconds: Number(e.target.value) })} style={{ width: 120 }} />
        </Field>
        <Field label="Temas restringidos" hint="Si el cliente los menciona, la IA deriva a una persona.">
          <textarea style={{ minHeight: 60 }} value={a.restrictedTopics} onChange={(e) => setA({ ...a, restrictedTopics: e.target.value })} placeholder="p. ej. reembolsos, asuntos legales" />
        </Field>
        <label className="check" style={{ marginBottom: 6 }}>
          <input type="checkbox" checked={a.escalateOnNegative} onChange={(e) => setA({ ...a, escalateOnNegative: e.target.checked })} /> Pasar a una persona cuando el cliente muestre enfado
        </label>
        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={a.autoActions} onChange={(e) => setA({ ...a, autoActions: e.target.checked })} /> Permitir acciones automáticas (etiquetas, campos, secuencias, flujos)
        </label>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await onAi(a)
            flash('ai')
          }}
        >
          Guardar IA
        </button>
      </Card>
      <Card title="Seguimientos inteligentes" actions={saved === 'fu' ? <Badge tone="green">Guardado</Badge> : undefined}>
        <p className="muted" style={{ marginTop: 0 }}>
          Si el bot atendió una conversación y el cliente deja de contestar, se le envía un recordatorio breve. Solo dentro de la ventana de 24 h de WhatsApp y solo si nadie del equipo la tiene asignada. Se ejecuta con la tarea programada (cron).
        </p>
        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Activar seguimientos
        </label>
        <div className="grid grid-2">
          <Field label="Esperar sin respuesta (horas)" hint="Menos de 23, para seguir dentro de la ventana.">
            <input type="number" min={1} max={22} value={f.afterHours} onChange={(e) => setF({ ...f, afterHours: Number(e.target.value) })} />
          </Field>
          <Field label="Máximo de recordatorios por silencio">
            <input type="number" min={1} max={5} value={f.maxNudges} onChange={(e) => setF({ ...f, maxNudges: Number(e.target.value) })} />
          </Field>
        </div>
        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={f.useAi} onChange={(e) => setF({ ...f, useAi: e.target.checked })} /> Redactarlo con la IA según la conversación (si está activa)
        </label>
        <Field label="Texto fijo (si la IA no está activa)" hint="Usa {{name}} para el nombre del cliente.">
          <textarea style={{ minHeight: 70 }} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
        </Field>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await onFollowups(f)
            flash('fu')
          }}
        >
          Guardar seguimientos
        </button>
      </Card>
      <Card title="Asignación de conversaciones nuevas" actions={saved === 'as' ? <Badge tone="green">Guardado</Badge> : undefined}>
        <Field label="Modo">
          <select
            value={assignment.mode}
            onChange={async (e) => {
              await onAssignment({ mode: e.target.value as 'manual' | 'round_robin' })
              flash('as')
            }}
          >
            <option value="manual">Manual (el bot atiende hasta que alguien la asigne)</option>
            <option value="round_robin">Reparto equitativo: al miembro con menos conversaciones abiertas</option>
          </select>
        </Field>
      </Card>
    </>
  )
}

interface FieldDef {
  id: string
  key: string
  label: string
  type: string
}
interface Canned {
  id: string
  shortcut: string
  title: string
  body: string
}

function DataTab() {
  const fields = useAsync(() => api<FieldDef[]>('/api/custom-fields'))
  const canned = useAsync(() => api<Canned[]>('/api/canned-responses'))
  const [f, setF] = useState({ key: '', label: '', type: 'text' })
  const [c, setC] = useState({ shortcut: '', body: '' })
  const [error, setError] = useState('')

  return (
    <div className="grid grid-2">
      <Card title="Campos personalizados">
        <ErrorNote message={error} />
        <p className="muted" style={{ marginTop: 0 }}>
          Datos extra de cada contacto. Se rellenan con las preguntas de los flujos, la IA, la importación o a mano, y se usan como {'{{variables}}'} y en filtros de broadcasts.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          <input style={{ width: 130 }} placeholder="clave (ciudad)" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
          <input className="grow" placeholder="Nombre visible" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          <select style={{ width: 110 }} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Tipo">
            <option value="text">Texto</option>
            <option value="number">Número</option>
            <option value="date">Fecha</option>
            <option value="boolean">Sí/No</option>
          </select>
          <button
            className="btn btn-primary"
            disabled={!f.key.trim()}
            onClick={async () => {
              try {
                await api('/api/custom-fields', { body: f })
                setF({ key: '', label: '', type: 'text' })
                fields.reload()
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            Añadir
          </button>
        </div>
        {fields.data?.length === 0 ? (
          <Empty>Sin campos definidos.</Empty>
        ) : (
          <table>
            <tbody>
              {fields.data?.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.key}</td>
                  <td>{d.label}</td>
                  <td>
                    <Badge>{d.type}</Badge>
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={async () => {
                        await api(`/api/custom-fields/${d.id}`, { method: 'DELETE' })
                        fields.reload()
                      }}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Respuestas rápidas">
        <p className="muted" style={{ marginTop: 0 }}>
          En la bandeja escribe <span className="mono">/atajo</span> para insertar el texto. Admiten {'{{name}}'}.
        </p>
        <div className="grid" style={{ gap: 6, marginBottom: 12 }}>
          <div className="row">
            <input style={{ width: 140 }} placeholder="atajo (saludo)" value={c.shortcut} onChange={(e) => setC({ ...c, shortcut: e.target.value })} />
            <button
              className="btn btn-primary"
              disabled={!c.shortcut.trim() || !c.body.trim()}
              onClick={async () => {
                await api('/api/canned-responses', { body: c })
                setC({ shortcut: '', body: '' })
                canned.reload()
              }}
            >
              Guardar
            </button>
          </div>
          <textarea style={{ minHeight: 60 }} placeholder="Texto de la respuesta" value={c.body} onChange={(e) => setC({ ...c, body: e.target.value })} />
        </div>
        {canned.data?.length === 0 ? (
          <Empty>Sin respuestas rápidas.</Empty>
        ) : (
          canned.data?.map((r) => (
            <div key={r.id} className="deal row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <div style={{ minWidth: 0 }}>
                <strong className="mono">/{r.shortcut}</strong>
                <div className="muted">{r.body.slice(0, 90)}</div>
              </div>
              <button
                className="btn btn-sm btn-danger"
                onClick={async () => {
                  await api(`/api/canned-responses/${r.id}`, { method: 'DELETE' })
                  canned.reload()
                }}
              >
                Quitar
              </button>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}

function TestConsole({ sandbox }: { sandbox: boolean }) {
  const [form, setForm] = useState({ phone: '', name: '', body: '', interactiveId: '' })
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')

  async function send() {
    setError('')
    try {
      const r = await api<{ handledBy: string | null; conversationId: string }>('/api/simulate/inbound', {
        body: { phone: form.phone, name: form.name || undefined, body: form.body, interactiveId: form.interactiveId || undefined },
      })
      setLog([`Cliente +${form.phone.replace(/\D/g, '')}: «${form.body}» → atendido por: ${r.handledBy ?? 'nadie (sin flujo, IA ni persona)'}`, ...log])
      setForm({ ...form, body: '', interactiveId: '' })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Card title="Consola de pruebas">
      {!sandbox && <div className="warn-note">Sin WhatsApp conectado, activa el modo simulación (pestaña Conexión) para ver las respuestas del bot en la bandeja.</div>}
      <p className="muted" style={{ marginTop: 0 }}>
        Simula que un cliente escribe a tu número: se procesa igual que un mensaje real (flujos, horario, IA, asignación). Mira el resultado en la <strong>Bandeja</strong>.
      </p>
      <ErrorNote message={error} />
      <div className="grid grid-2">
        <Field label="Teléfono del cliente simulado">
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="18095550000" inputMode="tel" />
        </Field>
        <Field label="Nombre (opcional)">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
      </div>
      <Field label="Mensaje del cliente">
        <input value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && form.phone && form.body && send()} />
      </Field>
      <Field label="ID de botón/lista pulsado (opcional)" hint="Para responder a un botón de un flujo: o<paso>_<opción>, p. ej. o0_1. Si lo dejas vacío, se compara por el texto del botón.">
        <input value={form.interactiveId} onChange={(e) => setForm({ ...form, interactiveId: e.target.value })} style={{ maxWidth: 200 }} />
      </Field>
      <button className="btn btn-primary" onClick={send} disabled={form.phone.replace(/\D/g, '').length < 7 || !form.body.trim()}>
        Enviar como cliente
      </button>
      {log.length > 0 && (
        <ul className="muted" style={{ paddingLeft: 18 }}>
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function SecurityTab({ value, onSave }: { value: Settings['security']; onSave: (v: Settings['security']) => Promise<void> }) {
  const me = useAsync(() => api<{ ip?: string }>('/api/auth/me'))
  const [text, setText] = useState(value.ipAllowlist.join('\n'))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const parse = (t: string) => t.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)

  async function save() {
    setError('')
    try {
      await onSave({ ipAllowlist: parse(text) })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const myIp = me.data?.ip
  return (
    <Card title="Accesos permitidos por IP" actions={saved ? <Badge tone="green">Guardado</Badge> : value.ipAllowlist.length ? <Badge tone="amber">Restringido</Badge> : <Badge>Abierto</Badge>}>
      <ErrorNote message={error} />
      <p className="muted" style={{ marginTop: 0 }}>
        Si añades direcciones, solo se podrá entrar al panel, a la API y al MCP desde ellas. Déjalo vacío para permitir cualquier IP. El webhook de Meta y las tareas programadas no se ven afectados. No se puede guardar una lista que no incluya tu IP actual.
      </p>
      <p>
        Tu IP actual: <span className="mono">{myIp ?? '…'}</span>{' '}
        {myIp && (
          <button className="btn btn-sm" onClick={() => setText((t) => (parse(t).includes(myIp) ? t : (t.trim() ? t.trim() + '\n' : '') + myIp))}>
            Añadir mi IP
          </button>
        )}
      </p>
      <Field label="IPs o rangos (uno por línea)" hint="Ejemplos: 203.0.113.5 · 203.0.113.0/24">
        <textarea style={{ minHeight: 110 }} className="mono" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <button className="btn btn-primary" onClick={save}>
        Guardar
      </button>
      <p className="muted" style={{ marginBottom: 0 }}>
        El registro de accesos está en Equipo. Si alguna vez te bloqueas, quita la regla desde la base de datos (tabla Setting, clave «security»).
      </p>
    </Card>
  )
}

const LANGS: [string, string][] = [
  ['es', 'Español'],
  ['en', 'Inglés'],
  ['pt', 'Portugués'],
  ['fr', 'Francés'],
  ['it', 'Italiano'],
  ['de', 'Alemán'],
  ['ar', 'Árabe'],
  ['hi', 'Hindi'],
]

function AgentTab({ value, onSave }: { value: Settings['agent']; onSave: (v: Settings['agent']) => Promise<void> }) {
  const [v, setV] = useState(value)
  const [saved, setSaved] = useState(false)
  return (
    <Card title="Mensajes del equipo" actions={saved ? <Badge tone="green">Guardado</Badge> : undefined}>
      <Field label="Firma" hint="Se añade al final de cada mensaje que envía una persona desde la bandeja (no a los del bot ni la IA). Déjala vacía para no usar firma.">
        <textarea style={{ minHeight: 70 }} value={v.signature} onChange={(e) => setV({ ...v, signature: e.target.value })} placeholder="— Equipo de Atención" />
      </Field>
      <Field label="Idioma de traducción en la bandeja" hint="El botón «Traducir» de cada mensaje del cliente lo traduce a este idioma (requiere la IA activa).">
        <select style={{ maxWidth: 260 }} value={v.translateLanguage} onChange={(e) => setV({ ...v, translateLanguage: e.target.value })}>
          {LANGS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <button
        className="btn btn-primary"
        onClick={async () => {
          await onSave(v)
          setSaved(true)
          setTimeout(() => setSaved(false), 1500)
        }}
      >
        Guardar
      </button>
    </Card>
  )
}
