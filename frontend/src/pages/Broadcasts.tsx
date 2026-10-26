import { useState } from 'react'
import { api } from '../api'
import type { Broadcast, Label, Template } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

const TONE: Record<string, 'gray' | 'amber' | 'green'> = { draft: 'gray', sending: 'amber', sent: 'green' }
const LABEL: Record<string, string> = { draft: 'Borrador', sending: 'Enviando', sent: 'Enviado' }

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
      setError(m === 'whatsapp_not_configured' ? 'Conecta WhatsApp (Conexión) antes de enviar broadcasts.' : m)
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
                  <th>Tipo</th>
                  <th>Audiencia</th>
                  <th>Estado</th>
                  <th>Enviados</th>
                  <th>Entregados</th>
                  <th>Leídos</th>
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
                    <td>{b.contentType === 'template' ? 'Plantilla' : 'Texto'}</td>
                    <td>{b.audience?.all || !b.audience?.labels?.length ? 'Todos' : b.audience.labels.join(', ')}</td>
                    <td>
                      <Badge tone={TONE[b.status] ?? 'gray'}>{LABEL[b.status] ?? b.status}</Badge>
                    </td>
                    <td>{b.sentCount}</td>
                    <td>{b.deliveredCount}</td>
                    <td>{b.readCount}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {b.status === 'draft' && (
                          <button className="btn btn-sm btn-primary" disabled={busy === b.id} onClick={() => send(b)}>
                            {busy === b.id ? 'Enviando…' : 'Enviar'}
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

function NewBroadcast({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const labels = useAsync(() => api<Label[]>('/api/labels'))
  const templates = useAsync(() => api<Template[]>('/api/templates'))
  const [form, setForm] = useState({ name: '', contentType: 'text', content: '', language: 'es' })
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')

  async function save() {
    try {
      await api('/api/broadcasts', {
        body: { ...form, audience: selected.length ? { labels: selected } : { all: true } },
      })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const approved = templates.data?.filter((t) => t.status === 'approved') ?? []

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
            Guardar borrador
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
        <Field label="Mensaje">
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </Field>
      )}
      <Field label="Audiencia" hint={selected.length ? 'Solo contactos con alguna de estas etiquetas.' : 'Sin etiquetas seleccionadas se envía a todos los contactos activos.'}>
        <div className="chips">
          {labels.data?.map((l) => {
            const on = selected.includes(l.name)
            return (
              <button
                key={l.id}
                type="button"
                className={`badge ${on ? 'badge-green' : 'badge-gray'}`}
                style={{ border: 0, cursor: 'pointer' }}
                onClick={() => setSelected(on ? selected.filter((n) => n !== l.name) : [...selected, l.name])}
              >
                {on ? '✓ ' : ''}
                {l.name} · {l._count?.subscribers ?? 0}
              </button>
            )
          })}
          {labels.data?.length === 0 && <span className="muted">Aún no hay etiquetas.</span>}
        </div>
      </Field>
    </Modal>
  )
}
