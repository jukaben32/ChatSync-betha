import { useState } from 'react'
import { api } from '../api'
import { useMe } from '../auth'
import { Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

interface Appointment {
  id: string
  startsAt: string
  endsAt: string
  status: 'booked' | 'cancelled' | 'completed' | 'no_show'
  title: string | null
  notes: string | null
  subscriber: { phone: string; name: string | null }
}

interface DayHours {
  enabled: boolean
  start: string
  end: string
}

interface Booking {
  enabled: boolean
  timezone: string
  slotMinutes: number
  minNoticeHours: number
  maxDaysAhead: number
  title: string
  days: Record<string, DayHours>
  reminderHours: number[]
  reminderTemplate: string
  reminderLanguage: string
}

const STATUS: Record<Appointment['status'], { label: string; tone: 'green' | 'gray' | 'blue' | 'red' }> = {
  booked: { label: 'Reservada', tone: 'blue' },
  completed: { label: 'Atendida', tone: 'green' },
  cancelled: { label: 'Cancelada', tone: 'gray' },
  no_show: { label: 'No asistió', tone: 'red' },
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

export default function Appointments() {
  const me = useMe()
  const isAdmin = me.role !== 'agent'
  const [tab, setTab] = useState<'agenda' | 'config'>('agenda')
  const [showPast, setShowPast] = useState(false)
  const [creating, setCreating] = useState(false)
  const list = useAsync(() => api<Appointment[]>(`/api/appointments?from=${new Date(Date.now() - (showPast ? 30 : 0) * 86_400_000 - 3_600_000).toISOString()}`), [showPast])
  const settings = useAsync(() => (isAdmin ? api<{ booking: Booking }>('/api/settings') : Promise.resolve(null)))

  async function setStatus(a: Appointment, status: Appointment['status']) {
    await api(`/api/appointments/${a.id}`, { method: 'PATCH', body: { status } })
    list.reload()
  }

  const tz = settings.data?.booking.timezone
  const fmt = (iso: string) => {
    const d = new Date(iso)
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', ...(tz ? { timeZone: tz } : {}) }
    return { day: new Intl.DateTimeFormat('es', opts).format(d), time: new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(tz ? { timeZone: tz } : {}) }).format(d) }
  }

  const byDay = new Map<string, Appointment[]>()
  for (const a of list.data ?? []) {
    const k = fmt(a.startsAt).day
    byDay.set(k, [...(byDay.get(k) ?? []), a])
  }

  return (
    <Page
      title="Citas"
      subtitle="Reservas hechas por WhatsApp o por el equipo"
      actions={
        <>
          {tab === 'agenda' && (
            <label className="check">
              <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Incluir últimos 30 días
            </label>
          )}
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + Nueva cita
          </button>
        </>
      }
    >
      {isAdmin && (
        <div className="tabs">
          <button className={`tab ${tab === 'agenda' ? 'active' : ''}`} onClick={() => setTab('agenda')}>
            Agenda
          </button>
          <button className={`tab ${tab === 'config' ? 'active' : ''}`} onClick={() => setTab('config')}>
            Horarios y recordatorios
          </button>
        </div>
      )}
      <ErrorNote message={list.error} />
      {tab === 'agenda' &&
        (byDay.size === 0 ? (
          <Card>
            <Empty>
              No hay citas próximas. Para que los clientes reserven solos, activa las citas en «Horarios y recordatorios» y añade el paso «Reservar cita» a un flujo.
            </Empty>
          </Card>
        ) : (
          [...byDay.entries()].map(([day, items]) => (
            <Card key={day} title={day}>
              <table>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td style={{ width: 70 }}>
                        <strong>{fmt(a.startsAt).time}</strong>
                      </td>
                      <td>
                        {a.subscriber.name || `+${a.subscriber.phone}`}
                        <div className="muted">
                          +{a.subscriber.phone} {a.title && `· ${a.title}`}
                        </div>
                      </td>
                      <td>
                        <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                      </td>
                      <td>
                        {a.status === 'booked' && (
                          <div className="row" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn btn-sm" onClick={() => setStatus(a, 'completed')}>
                              Atendida
                            </button>
                            <button className="btn btn-sm" onClick={() => setStatus(a, 'no_show')}>
                              No asistió
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => setStatus(a, 'cancelled')}>
                              Cancelar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))
        ))}
      {tab === 'config' && isAdmin && settings.data && <Config value={settings.data.booking} onSaved={settings.reload} />}
      {creating && (
        <NewAppointment
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            list.reload()
          }}
        />
      )}
    </Page>
  )
}

function NewAppointment({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const slots = useAsync(() => api<{ enabled: boolean; slots: { startsAt: string; label: string }[] }>('/api/booking/slots?limit=60'))
  const [phone, setPhone] = useState('')
  const [slot, setSlot] = useState('')
  const [title, setTitle] = useState('')
  const [notify, setNotify] = useState(true)
  const [error, setError] = useState('')

  async function save() {
    try {
      await api('/api/appointments', { body: { phone, startsAt: slot, title: title || undefined, notify } })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Modal
      title="Nueva cita"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={save} disabled={phone.replace(/\D/g, '').length < 7 || !slot}>
          Reservar
        </button>
      }
    >
      <ErrorNote message={error} />
      {slots.data && !slots.data.enabled && <div className="warn-note">Las citas están desactivadas: actívalas en «Horarios y recordatorios».</div>}
      <Field label="Teléfono del cliente" hint="Se crea el contacto si no existe.">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoFocus />
      </Field>
      <Field label="Horario">
        <select value={slot} onChange={(e) => setSlot(e.target.value)}>
          <option value="">Elige un hueco libre…</option>
          {slots.data?.slots.map((s) => (
            <option key={s.startsAt} value={s.startsAt}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Motivo (opcional)">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Avisar al cliente por WhatsApp
      </label>
    </Modal>
  )
}

function Config({ value, onSaved }: { value: Booking; onSaved: () => void }) {
  const [v, setV] = useState(value)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const setDay = (k: string, patch: Partial<DayHours>) => setV({ ...v, days: { ...v.days, [k]: { ...v.days[k], ...patch } } })

  async function save() {
    setError('')
    try {
      await api('/api/settings/booking', { method: 'PUT', body: v })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      onSaved()
    } catch (e) {
      setError((e as Error).message === 'invalid_timezone' ? 'Zona horaria no válida (p. ej. America/Santo_Domingo).' : (e as Error).message)
    }
  }

  return (
    <Card title="Reserva de citas" actions={saved ? <Badge tone="green">Guardado</Badge> : undefined}>
      <ErrorNote message={error} />
      <label className="check" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> Permitir reservar citas
      </label>
      <div className="grid grid-2">
        <Field label="Zona horaria (IANA)">
          <input value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} />
        </Field>
        <Field label="Motivo por defecto">
          <input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        <Field label="Duración de cada cita (minutos)">
          <input type="number" min={5} step={5} value={v.slotMinutes} onChange={(e) => setV({ ...v, slotMinutes: Number(e.target.value) })} />
        </Field>
        <Field label="Aviso mínimo (horas)" hint="No se ofrecen horarios que empiecen antes.">
          <input type="number" min={0} value={v.minNoticeHours} onChange={(e) => setV({ ...v, minNoticeHours: Number(e.target.value) })} />
        </Field>
        <Field label="Días hacia adelante">
          <input type="number" min={1} max={90} value={v.maxDaysAhead} onChange={(e) => setV({ ...v, maxDaysAhead: Number(e.target.value) })} />
        </Field>
      </div>
      <h3 style={{ margin: '8px 0' }}>Horario de atención</h3>
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
                  <input type="time" style={{ width: 130 }} value={v.days[k]?.start ?? '09:00'} disabled={!v.days[k]?.enabled} onChange={(e) => setDay(k, { start: e.target.value })} aria-label={`Apertura ${label}`} />
                  <span>a</span>
                  <input type="time" style={{ width: 130 }} value={v.days[k]?.end ?? '17:00'} disabled={!v.days[k]?.enabled} onChange={(e) => setDay(k, { end: e.target.value })} aria-label={`Cierre ${label}`} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ margin: '8px 0' }}>Recordatorios</h3>
      <Field label="Horas antes de la cita (separadas por coma)" hint="Ejemplo: 24, 2. Déjalo vacío para no enviar recordatorios.">
        <input
          value={v.reminderHours.join(', ')}
          onChange={(e) =>
            setV({
              ...v,
              reminderHours: e.target.value
                .split(',')
                .map((x) => Number(x.trim()))
                .filter((n) => Number.isFinite(n) && n > 0),
            })
          }
        />
      </Field>
      <div className="grid grid-2">
        <Field label="Plantilla aprobada para recordatorios" hint="Variables: {{1}} fecha, {{2}} hora. Sin plantilla se envía texto libre, que WhatsApp solo admite dentro de las 24 h.">
          <input value={v.reminderTemplate} onChange={(e) => setV({ ...v, reminderTemplate: e.target.value })} placeholder="recordatorio_cita" />
        </Field>
        <Field label="Idioma de la plantilla">
          <input value={v.reminderLanguage} onChange={(e) => setV({ ...v, reminderLanguage: e.target.value })} />
        </Field>
      </div>
      <button className="btn btn-primary" onClick={save}>
        Guardar
      </button>
    </Card>
  )
}
