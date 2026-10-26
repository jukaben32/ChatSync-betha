import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { api, initials } from '../api'
import type { Label, Subscriber } from '../api'
import { Avatar, Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

interface ListResponse {
  items: Subscriber[]
  total: number
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const sep = lines[0].includes(';') ? ';' : ','
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase())
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h))
  const iPhone = idx(['phone', 'telefono', 'teléfono', 'whatsapp', 'numero', 'número'])
  const iName = idx(['name', 'nombre'])
  const iEmail = idx(['email', 'correo'])
  const iLabels = idx(['labels', 'etiquetas', 'tags'])
  if (iPhone < 0) throw new Error('El CSV necesita una columna "phone" o "telefono".')
  return lines.slice(1).map((line) => {
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''))
    return {
      phone: cols[iPhone],
      name: iName >= 0 ? cols[iName] : undefined,
      email: iEmail >= 0 ? cols[iEmail] : undefined,
      labels: iLabels >= 0 && cols[iLabels] ? cols[iLabels].split('|').map((s) => s.trim()) : [],
    }
  })
}

export default function Contacts() {
  const [q, setQ] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [detail, setDetail] = useState<Subscriber | null>(null)
  const [note, setNote] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const list = useAsync(() => api<ListResponse>(`/api/subscribers?${new URLSearchParams({ ...(q ? { q } : {}), ...(label ? { label } : {}) })}`), [q, label])
  const labels = useAsync(() => api<Label[]>('/api/labels'))

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const rows = parseCsv(await file.text())
      const res = await api<{ created: number; updated: number; skipped: number }>('/api/subscribers/import', { body: { rows } })
      setNote(`Importación lista: ${res.created} nuevos, ${res.updated} actualizados, ${res.skipped} omitidos.`)
      list.reload()
      labels.reload()
    } catch (err) {
      setNote((err as Error).message)
    }
  }

  return (
    <Page
      title="Contactos"
      subtitle={`${list.data?.total ?? 0} suscriptores`}
      actions={
        <>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importar CSV
          </button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Nuevo contacto
          </button>
        </>
      }
    >
      {note && <div className="ok-note">{note}</div>}
      <ErrorNote message={list.error} />
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="grow" placeholder="Buscar por nombre, teléfono o email…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 200 }} aria-label="Etiqueta">
            <option value="">Todas las etiquetas</option>
            {labels.data?.map((l) => (
              <option key={l.id} value={l.name}>
                {l.name} ({l._count?.subscribers ?? 0})
              </option>
            ))}
          </select>
        </div>
        {list.data?.items.length === 0 ? (
          <Empty>No hay contactos. Añade uno o importa un CSV con columnas phone, name, email, labels (separadas por |).</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contacto</th>
                  <th>Teléfono</th>
                  <th>Etiquetas</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setDetail(s)}>
                    <td>
                      <div className="row">
                        <Avatar text={initials(s.name, s.phone)} />
                        <div>
                          <strong>{s.name || '—'}</strong>
                          <div className="muted">{s.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>+{s.phone}</td>
                    <td>
                      <div className="chips">
                        {s.labels.map((l) => (
                          <Badge key={l.label.id} tone="green">
                            {l.label.name}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>{s.blocked ? <Badge tone="red">Bloqueado</Badge> : s.optedOut ? <Badge tone="amber">Baja</Badge> : <Badge tone="green">Activo</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && <AddContact onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.reload() }} />}
      {detail && <ContactDetail subscriber={detail} onClose={() => setDetail(null)} onChanged={() => { list.reload(); labels.reload() }} />}
    </Page>
  )
}

function AddContact({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ phone: '', name: '', email: '' })
  const [error, setError] = useState('')
  async function save() {
    try {
      await api('/api/subscribers', { body: form })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Modal
      title="Nuevo contacto"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!form.phone.trim()}>
            Guardar
          </button>
        </>
      }
    >
      <ErrorNote message={error} />
      <Field label="Teléfono (con código de país)" hint="Solo números, p. ej. 18095551234">
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" autoFocus />
      </Field>
      <Field label="Nombre">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Email">
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
    </Modal>
  )
}

function ContactDetail({ subscriber, onClose, onChanged }: { subscriber: Subscriber; onClose: () => void; onChanged: () => void }) {
  const detail = useAsync(() => api<Subscriber & { notes: { id: string; body: string; author: string }[] }>(`/api/subscribers/${subscriber.phone}`), [subscriber.phone])
  const [newLabel, setNewLabel] = useState('')
  const s = detail.data ?? subscriber

  async function addLabel() {
    if (!newLabel.trim()) return
    await api(`/api/subscribers/${s.phone}/labels`, { body: { labels: [newLabel.trim()] } })
    setNewLabel('')
    detail.reload()
    onChanged()
  }
  async function removeLabel(id: string) {
    await api(`/api/subscribers/${s.phone}/labels/${id}`, { method: 'DELETE' })
    detail.reload()
    onChanged()
  }
  async function toggle(field: 'blocked' | 'optedOut') {
    await api(`/api/subscribers/${s.phone}`, { method: 'PATCH', body: { [field]: !s[field] } })
    detail.reload()
    onChanged()
  }
  async function remove() {
    if (!confirm(`¿Eliminar a ${s.name || s.phone} y todo su historial?`)) return
    await api(`/api/subscribers/${s.phone}`, { method: 'DELETE' })
    onChanged()
    onClose()
  }

  return (
    <Modal
      title={s.name || `+${s.phone}`}
      onClose={onClose}
      footer={
        <button className="btn btn-danger" onClick={remove}>
          Eliminar contacto
        </button>
      }
    >
      <p className="muted">
        +{s.phone} {s.email && `· ${s.email}`}
      </p>
      <h3 style={{ margin: '12px 0 6px' }}>Etiquetas</h3>
      <div className="chips" style={{ marginBottom: 8 }}>
        {s.labels.map((l) => (
          <span key={l.label.id} className="badge badge-green">
            {l.label.name}{' '}
            <button className="icon-btn" style={{ padding: 0 }} onClick={() => removeLabel(l.label.id)} aria-label={`Quitar ${l.label.name}`}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <input className="grow" placeholder="Nueva etiqueta" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addLabel()} />
        <button className="btn" onClick={addLabel}>
          Añadir
        </button>
      </div>
      <h3 style={{ margin: '16px 0 6px' }}>Preferencias</h3>
      <label className="check">
        <input type="checkbox" checked={s.blocked} onChange={() => toggle('blocked')} /> Bloqueado (no recibe mensajes)
      </label>
      <label className="check" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={s.optedOut} onChange={() => toggle('optedOut')} /> Dado de baja de broadcasts
      </label>
    </Modal>
  )
}
