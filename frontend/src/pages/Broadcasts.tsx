import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Broadcast, Label, Template } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

const TONE: Record<string, 'gray' | 'amber' | 'green' | 'blue' | 'red'> = { draft: 'gray', scheduled: 'blue', sending: 'amber', sent: 'green', failed: 'red' }
const LABEL: Record<string, string> = { draft: 'Borrador', scheduled: 'Programado', sending: 'Enviando', sent: 'Enviado', failed: 'Falló' }

export default function Broadcasts() {
  const list = useAsync(() => api<Broadcast[]>('/api/broadcasts'))
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function send(b: Broadcast) {
    if (!confirm(`Enviar "${b.name}" ahora a toda la audiencia?`)) return
    setBusy(b.id)
    setError('')
    setMessage('')
    try {
      const r = await api<{ audience: number; sentCount: number; failedCount: number }>(`/api/broadcasts/${b.id}/send`, { method: 'POST', body: {} })
      setMessage(`Enviado a ${r.audience} contactos: ${r.sentCount} correctos, ${r.failedCount} fallidos.`)
    } catch (e) {
      const m = (e as Error).message
      setError(m === 'whatsapp_not_configured' ? 'Conecta WhatsApp (Conexión) o activa el modo simulación antes de enviar.' : m)
    } finally {
      setBusy('')
      list.reload()
    }
  }

  async function remove(b: Broadcast) {
    if (!confirm(`Eliminar "${b.name}"?`)) return
    await api(`/api/broadcasts/${b.id}`, { method: 'DELETE' })
    list.reload()
  }

  const audienceText = (b: Broadcast) => {
    const a = b.audience ?? {}
    const parts = [
      a.labels?.length ? `con ${a.labels.join(', ')}` : '',
      a.excludeLabels?.length ? `sin ${a.excludeLabels.join(', ')}` : '',
      a.fields?.length ? `${a.fields.length} filtro(s) de campo` : '',
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : 'Todos'
  }

  return (
    <Page
      title="Broadcasts"
      subtitle="Campañas masivas por la API oficial de WhatsApp"
      actions={
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + Nuevo broadcast
        </button>
      }
    >
      {message && <div className="ok-note">{message}</div>}
      <ErrorNote message={error || list.error} />
      <Card>
        {list.data?.length === 0 ? (
          <Empty>Aún no hay broadcasts. Crea uno con texto libre (ventana de 24 h) o con una plantilla aprobada.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Audiencia</th>
                  <th>Estado</th>
                  <th>Enviados</th>
                  <th>Entregados</th>
                  <th>Leídos</th>
                  <th>Fallidos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.name}</strong>
                      <div className="muted">{b.contentType === 'template' ? `Plantilla: ${b.content}` : b.content.slice(0, 60)}</div>
                    </td>
                    <td>{audienceText(b)}</td>
                    <td>
                      <Badge tone={TONE[b.status] ?? 'gray'}>{LABEL[b.status] ?? b.status}</Badge>
                      {b.status === 'scheduled' && b.scheduledAt && <div className="muted">{new Date(b.scheduledAt).toLocaleString()}</div>}
                    </td>
                    <td>{b.sentCount}</td>
                    <td>{b.deliveredCount}</td>
                    <td>{b.readCount}</td>
                    <td>{b.failedCount}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {(b.status === 'draft' || b.status === 'scheduled') && (
                          <button className="btn btn-sm btn-primary" disabled={busy === b.id} onClick={() => send(b)}>
                            {busy === b.id ? 'Enviando…' : 'Enviar ahora'}
                          </button>
                        )}
                        <button className="btn btn-sm btn-danger" onClick={() => remove(b)}>
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && (
        <NewBroadcast
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

interface FieldFilter {
  field: string
  op: string
  value: string
}

function NewBroadcast({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const labels = useAsync(() => api<Label[]>('/api/labels'))
  const templates = useAsync(() => api<Template[]>('/api/templates'))
  const [form, setForm] = useState({ name: '', contentType: 'text', content: '', language: 'es', mediaUrl: '' })
  const [buttons, setButtons] = useState<string[]>([])
  const [include, setInclude] = useState<string[]>([])
  const [exclude, setExclude] = useState<string[]>([])
  const [filters, setFilters] = useState<FieldFilter[]>([])
  const [when, setWhen] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState('')

  const audience = {
    ...(include.length ? { labels: include } : {}),
    ...(exclude.length ? { excludeLabels: exclude } : {}),
    ...(filters.length ? { fields: filters.filter((f) => f.field) } : {}),
    ...(!include.length && !exclude.length && !filters.length ? { all: true } : {}),
  }

  // Vista previa: cuántos contactos recibirían el envío
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ count: number }>('/api/broadcasts/audience-count', { body: audience })
        .then((r) => setCount(r.count))
        .catch(() => setCount(null))
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(audience)])

  async function save() {
    try {
      await api('/api/broadcasts', {
        body: {
          ...form,
          mediaUrl: form.mediaUrl || undefined,
          buttons: buttons.filter(Boolean).map((title) => ({ title })),
          audience,
          scheduledAt: when ? new Date(when).toISOString() : undefined,
        },
      })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const approved = templates.data?.filter((t) => t.status === 'approved') ?? []
  const toggle = (list: string[], set: (v: string[]) => void, name: string) => set(list.includes(name) ? list.filter((n) => n !== name) : [...list, name])

  const chips = (selected: string[], set: (v: string[]) => void, tone: 'badge-green' | 'badge-red') => (
    <div className="chips">
      {labels.data?.map((l) => {
        const on = selected.includes(l.name)
        return (
          <button key={l.id} type="button" className={`badge ${on ? tone : 'badge-gray'}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => toggle(selected, set, l.name)}>
            {on ? '✓ ' : ''}
            {l.name} · {l._count?.subscribers ?? 0}
          </button>
        )
      })}
      {labels.data?.length === 0 && <span className="muted">Aún no hay etiquetas.</span>}
    </div>
  )

  return (
    <Modal
      title="Nuevo broadcast"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim() || !form.content.trim()}>
            {when ? 'Programar' : 'Guardar borrador'}
          </button>
        </>
      }
    >
      <ErrorNote message={error} />
      <Field label="Nombre interno">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
      </Field>
      <Field label="Tipo de mensaje" hint="Fuera de la ventana de 24 h WhatsApp exige una plantilla aprobada.">
        <select value={form.contentType} onChange={(e) => setForm({ ...form, contentType: e.target.value, content: '' })}>
          <option value="text">Texto libre</option>
          <option value="template">Plantilla aprobada</option>
        </select>
      </Field>
      {form.contentType === 'template' ? (
        <Field label="Plantilla" hint={approved.length ? undefined : 'No hay plantillas aprobadas. Sincroniza desde Plantillas.'}>
          <select
            value={form.content}
            onChange={(e) => {
              const t = approved.find((x) => x.name === e.target.value)
              setForm({ ...form, content: e.target.value, language: t?.language ?? 'es' })
            }}
          >
            <option value="">Elige una plantilla…</option>
            {approved.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name} ({t.language})
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <>
          <Field label="Mensaje" hint="Variables: {{name}}, {{phone}}, {{campo_personalizado}}">
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </Field>
          <Field label="Imagen (URL https, opcional)" hint="Si la añades, el mensaje se envía como imagen con este texto.">
            <input value={form.mediaUrl} onChange={(e) => setForm({ ...form, mediaUrl: e.target.value })} placeholder="https://…" />
          </Field>
          {!form.mediaUrl && (
            <Field label="Botones de respuesta rápida (hasta 3)">
              <div className="grid" style={{ gap: 6 }}>
                {buttons.map((b, i) => (
                  <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
                    <input className="grow" maxLength={20} value={b} placeholder={`Botón ${i + 1}`} onChange={(e) => setButtons(buttons.map((x, idx) => (idx === i ? e.target.value : x)))} />
                    <button className="icon-btn" aria-label="Quitar botón" onClick={() => setButtons(buttons.filter((_, idx) => idx !== i))}>
                      ✕
                    </button>
                  </div>
                ))}
                {buttons.length < 3 && (
                  <button className="btn btn-sm" style={{ width: 'fit-content' }} onClick={() => setButtons([...buttons, ''])}>
                    + Botón
                  </button>
                )}
              </div>
            </Field>
          )}
        </>
      )}

      <h3 style={{ margin: '4px 0 8px' }}>Audiencia</h3>
      <Field label="Incluir contactos con alguna de estas etiquetas">{chips(include, setInclude, 'badge-green')}</Field>
      <Field label="Excluir contactos con estas etiquetas">{chips(exclude, setExclude, 'badge-red')}</Field>
      <Field label="Filtrar por campos personalizados">
        <div className="grid" style={{ gap: 6 }}>
          {filters.map((f, i) => (
            <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
              <input style={{ width: 120 }} placeholder="campo" value={f.field} onChange={(e) => setFilters(filters.map((x, idx) => (idx === i ? { ...x, field: e.target.value } : x)))} />
              <select style={{ width: 130 }} value={f.op} onChange={(e) => setFilters(filters.map((x, idx) => (idx === i ? { ...x, op: e.target.value } : x)))} aria-label="Operador">
                <option value="eq">es igual a</option>
                <option value="neq">distinto de</option>
                <option value="contains">contiene</option>
                <option value="exists">tiene valor</option>
              </select>
              {f.op !== 'exists' && <input className="grow" placeholder="valor" value={f.value} onChange={(e) => setFilters(filters.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))} />}
              <button className="icon-btn" aria-label="Quitar filtro" onClick={() => setFilters(filters.filter((_, idx) => idx !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-sm" style={{ width: 'fit-content' }} onClick={() => setFilters([...filters, { field: '', op: 'eq', value: '' }])}>
            + Filtro
          </button>
        </div>
      </Field>
      <div className="ok-note">{count === null ? 'Calculando audiencia…' : `${count} contacto(s) recibirían este broadcast (se excluyen bloqueados y bajas).`}</div>

      <Field label="Programar envío (opcional)" hint="La tarea programada del servidor lo envía a esa hora. Déjalo vacío para guardarlo como borrador y enviarlo a mano.">
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
    </Modal>
  )
}
