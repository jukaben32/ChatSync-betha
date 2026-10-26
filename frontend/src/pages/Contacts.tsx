import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { api, getKey, initials, timeAgo } from '../api'
import type { Label, Sequence, Subscriber } from '../api'
import { useMe } from '../auth'
import { Avatar, Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

interface ListResponse {
  items: (Subscriber & { lists?: { list: { id: string; name: string } }[] })[]
  total: number
}

interface Stats {
  total: number
  subscribed: number
  unsubscribed: number
  blocked: number
  inSequences: number
}

interface AudienceList {
  id: string
  name: string
  _count?: { members: number }
}

type Row = ListResponse['items'][number]

function parseCsv(text: string) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
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

const STATUS_TONE = { subscribed: 'green', unsubscribed: 'amber', blocked: 'red' } as const

export default function Contacts() {
  const isAgent = useMe().role === 'agent'
  const [q, setQ] = useState('')
  const [label, setLabel] = useState('')
  const [list, setList] = useState('')
  const [sequence, setSequence] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('latest')
  const [adding, setAdding] = useState(false)
  const [detail, setDetail] = useState<Row | null>(null)
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [bulk, setBulk] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const params = new URLSearchParams({ ...(q && { q }), ...(label && { label }), ...(list && { list }), ...(sequence && { sequence }), ...(status && { status }), sort })
  const rows = useAsync(() => api<ListResponse>(`/api/subscribers?${params}`), [q, label, list, sequence, status, sort])
  const stats = useAsync(() => (isAgent ? Promise.resolve(null) : api<Stats>('/api/subscribers/stats')))
  const labels = useAsync(() => api<Label[]>('/api/labels'))
  const lists = useAsync(() => api<AudienceList[]>('/api/lists'))
  const sequences = useAsync(() => api<Sequence[]>('/api/sequences?kind=sequence'))

  const reloadAll = () => {
    rows.reload()
    stats.reload()
    labels.reload()
    lists.reload()
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const parsed = parseCsv(await file.text())
      const listName = prompt('¿Añadir los contactos importados a una lista? (opcional, escribe el nombre)') ?? ''
      const res = await api<{ created: number; updated: number; skipped: number }>('/api/subscribers/import', { body: { rows: parsed, list: listName.trim() || undefined } })
      setNote(`Importación lista: ${res.created} nuevos, ${res.updated} actualizados, ${res.skipped} omitidos.`)
      reloadAll()
    } catch (err) {
      setNote((err as Error).message)
    }
  }

  async function exportCsv() {
    const res = await fetch(`/api/subscribers/export?${params}`, { headers: { Authorization: `Bearer ${getKey()}` } })
    if (!res.ok) return setNote('No se pudo exportar.')
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = 'contactos.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function runBulk() {
    if (!bulk || !selected.length) return
    const needsValue = ['add_label', 'remove_label', 'add_list', 'remove_list', 'enroll_sequence'].includes(bulk)
    if (needsValue && !bulkValue.trim()) return setNote('Esta acción necesita un valor (etiqueta, lista o secuencia).')
    if (bulk === 'delete' && !confirm(`¿Eliminar ${selected.length} contactos y todo su historial?`)) return
    try {
      const r = await api<{ affected: number }>('/api/subscribers/bulk', { body: { phones: selected, action: bulk, value: bulkValue.trim() || undefined } })
      setNote(`Acción aplicada a ${r.affected} contacto(s).`)
      setSelected([])
      setBulk('')
      setBulkValue('')
      reloadAll()
    } catch (err) {
      setNote((err as Error).message)
    }
  }

  const items = rows.data?.items ?? []
  const allSelected = items.length > 0 && items.every((s) => selected.includes(s.phone))
  const statusOf = (s: Row) => (s.blocked ? 'blocked' : s.optedOut ? 'unsubscribed' : 'subscribed')
  const STATUS_LABEL = { subscribed: 'Activo', unsubscribed: 'Baja', blocked: 'Bloqueado' } as const

  return (
    <Page
      title="Contactos"
      subtitle="Gestiona y segmenta a tu audiencia"
      actions={
        <>
          {!isAgent && (
            <>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
              <button className="btn" onClick={() => fileRef.current?.click()}>
                Importar CSV
              </button>
              <button className="btn" onClick={exportCsv}>
                Exportar CSV
              </button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Nuevo contacto
          </button>
        </>
      }
    >
      {stats.data && (
        <div className="grid grid-4" style={{ marginBottom: 16 }}>
          <div className="card stat">
            <div className="label">Total</div>
            <div className="value">{stats.data.total}</div>
          </div>
          <div className="card stat">
            <div className="label">Suscritos</div>
            <div className="value">{stats.data.subscribed}</div>
            <div className="muted">{stats.data.total ? Math.round((stats.data.subscribed / stats.data.total) * 100) : 0}% del total</div>
          </div>
          <div className="card stat">
            <div className="label">En secuencias</div>
            <div className="value">{stats.data.inSequences}</div>
          </div>
          <div className="card stat">
            <div className="label">Bajas / bloqueados</div>
            <div className="value">
              {stats.data.unsubscribed} / {stats.data.blocked}
            </div>
          </div>
        </div>
      )}
      {note && <div className="ok-note">{note}</div>}
      <ErrorNote message={rows.error} />
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="grow" style={{ minWidth: 200 }} placeholder="Buscar por nombre, teléfono o email…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select style={{ width: 160 }} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Etiqueta">
            <option value="">Todas las etiquetas</option>
            {labels.data?.map((l) => (
              <option key={l.id} value={l.name}>
                {l.name} ({l._count?.subscribers ?? 0})
              </option>
            ))}
          </select>
          <select style={{ width: 150 }} value={list} onChange={(e) => setList(e.target.value)} aria-label="Lista">
            <option value="">Todas las listas</option>
            {lists.data?.map((l) => (
              <option key={l.id} value={l.name}>
                {l.name} ({l._count?.members ?? 0})
              </option>
            ))}
          </select>
          <select style={{ width: 170 }} value={sequence} onChange={(e) => setSequence(e.target.value)} aria-label="Secuencia">
            <option value="">Todas las secuencias</option>
            {sequences.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>
            <option value="subscribed">Activos</option>
            <option value="unsubscribed">Baja</option>
            <option value="blocked">Bloqueados</option>
          </select>
          <select style={{ width: 130 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Orden">
            <option value="latest">Más recientes</option>
            <option value="oldest">Más antiguos</option>
            <option value="name">Por nombre</option>
          </select>
        </div>

        {!isAgent && selected.length > 0 && (
          <div className="row" style={{ marginBottom: 12, padding: 10, background: 'var(--brand-soft)', borderRadius: 10 }}>
            <strong>{selected.length} seleccionados</strong>
            <select style={{ width: 200 }} value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="Acción masiva">
              <option value="">Acción masiva…</option>
              <option value="add_label">Añadir etiqueta</option>
              <option value="remove_label">Quitar etiqueta</option>
              <option value="add_list">Añadir a lista</option>
              <option value="remove_list">Quitar de lista</option>
              <option value="enroll_sequence">Inscribir en secuencia</option>
              <option value="block">Bloquear</option>
              <option value="unblock">Desbloquear</option>
              <option value="unsubscribe">Dar de baja</option>
              <option value="resubscribe">Reactivar</option>
              <option value="delete">Eliminar</option>
            </select>
            {['add_label', 'remove_label', 'add_list', 'remove_list', 'enroll_sequence'].includes(bulk) &&
              (bulk === 'enroll_sequence' ? (
                <select style={{ width: 200 }} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="Secuencia">
                  <option value="">Elige secuencia…</option>
                  {sequences.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input list="bulk-values" style={{ width: 200 }} placeholder={bulk.includes('label') ? 'Etiqueta' : 'Lista'} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
              ))}
            <datalist id="bulk-values">{(bulk.includes('label') ? labels.data?.map((l) => l.name) : lists.data?.map((l) => l.name))?.map((n) => <option key={n} value={n} />)}</datalist>
            <button className="btn btn-primary" onClick={runBulk} disabled={!bulk}>
              Aplicar
            </button>
            <button className="btn" onClick={() => setSelected([])}>
              Quitar selección
            </button>
          </div>
        )}

        {items.length === 0 ? (
          <Empty>No hay contactos con estos filtros. Añade uno o importa un CSV con columnas phone, name, email, labels (separadas por |).</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {!isAgent && (<th style={{ width: 36 }}>
                    <input type="checkbox" aria-label="Seleccionar todos" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? items.map((s) => s.phone) : [])} />
                  </th>)}
                  <th>Contacto</th>
                  <th>Teléfono</th>
                  <th>Etiquetas</th>
                  <th>Listas</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setDetail(s)}>
                    {!isAgent && (<td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${s.name || s.phone}`}
                        checked={selected.includes(s.phone)}
                        onChange={(e) => setSelected(e.target.checked ? [...selected, s.phone] : selected.filter((p) => p !== s.phone))}
                      />
                    </td>)}
                    <td>
                      <div className="row">
                        <Avatar text={initials(s.name, s.phone)} />
                        <div>
                          <strong>{s.name || '—'}</strong>
                          <div className="muted">
                            {s.email}
                            {s.source && s.source !== 'whatsapp' ? ` · ${s.source}` : ''}
                          </div>
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
                    <td>
                      <div className="chips">
                        {s.lists?.map((l) => (
                          <Badge key={l.list.id} tone="blue">
                            {l.list.name}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[statusOf(s)]}>{STATUS_LABEL[statusOf(s)]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ marginBottom: 0 }}>
          Mostrando {items.length} de {rows.data?.total ?? 0}
        </p>
      </Card>

      {adding && (
        <AddContact
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            reloadAll()
          }}
        />
      )}
      {detail && <ContactDetail subscriber={detail} onClose={() => setDetail(null)} onChanged={reloadAll} />}
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

interface Detail extends Subscriber {
  lists: { list: { id: string; name: string } }[]
  sequences: { sequenceId: string; status: string; sequence: { id: string; name: string } }[]
  flowSessions: { id: string; sequence: { name: string } }[]
  notes: { id: string; body: string; author: string; createdAt: string }[]
  deals: { id: string; stage: string; value: number }[]
}

const TABS = ['Resumen', 'Etiquetas y listas', 'Secuencias y flujos', 'Campos', 'Notas']

function ContactDetail({ subscriber, onClose, onChanged }: { subscriber: Row; onClose: () => void; onChanged: () => void }) {
  const isAgent = useMe().role === 'agent'
  const detail = useAsync(() => api<Detail>(`/api/subscribers/${subscriber.id}`), [subscriber.id])
  const defs = useAsync(() => api<{ key: string; label: string }[]>('/api/custom-fields'))
  const allSequences = useAsync(() => api<Sequence[]>('/api/sequences?kind=sequence'))
  const [tab, setTab] = useState(TABS[0])
  const [newLabel, setNewLabel] = useState('')
  const [newList, setNewList] = useState('')
  const [fieldKey, setFieldKey] = useState('')
  const [fieldValue, setFieldValue] = useState('')
  const [newSeq, setNewSeq] = useState('')
  const s = detail.data
  const base = subscriber

  const refresh = () => {
    detail.reload()
    onChanged()
  }
  const patch = async (body: Record<string, unknown>) => {
    await api(`/api/subscribers/${base.id}`, { method: 'PATCH', body })
    refresh()
  }

  async function addLabel() {
    if (!newLabel.trim()) return
    await api(`/api/subscribers/${base.id}/labels`, { body: { labels: [newLabel.trim()] } })
    setNewLabel('')
    refresh()
  }
  async function addList() {
    if (!newList.trim()) return
    await api(`/api/subscribers/${base.id}/lists`, { body: { lists: [newList.trim()] } })
    setNewList('')
    refresh()
  }
  async function remove() {
    if (!confirm(`¿Eliminar a ${base.name || base.phone} y todo su historial?`)) return
    await api(`/api/subscribers/${base.id}`, { method: 'DELETE' })
    onChanged()
    onClose()
  }

  const blocked = s?.blocked ?? base.blocked
  const optedOut = s?.optedOut ?? base.optedOut

  return (
    <Modal
      title={base.name || `+${base.phone}`}
      onClose={onClose}
      footer={
        isAgent ? undefined : (
          <button className="btn btn-danger" onClick={remove}>
            Eliminar contacto
          </button>
        )
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        +{base.phone} {base.email && `· ${base.email}`} {base.source && `· origen: ${base.source}`} · desde {timeAgo(base.createdAt)}
      </p>
      <div className="tabs" style={{ overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} style={{ whiteSpace: 'nowrap' }} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Resumen' && (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <Badge tone={blocked ? 'red' : optedOut ? 'amber' : 'green'}>{blocked ? 'Bloqueado' : optedOut ? 'De baja' : 'Activo'}</Badge>
            {s?.deals.map((d) => (
              <Badge key={d.id} tone="blue">
                CRM: {d.stage} · {d.value}
              </Badge>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={blocked} onChange={() => patch({ blocked: !blocked })} /> Bloqueado (no recibe mensajes)
          </label>
          <label className="check" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={optedOut} onChange={() => patch({ optedOut: !optedOut })} /> Dado de baja de broadcasts
          </label>
        </>
      )}

      {tab === 'Etiquetas y listas' && s && (
        <>
          <h3 style={{ margin: '0 0 6px' }}>Etiquetas</h3>
          <div className="chips" style={{ marginBottom: 8 }}>
            {s.labels.map((l) => (
              <span key={l.label.id} className="badge badge-green">
                {l.label.name}{' '}
                <button
                  className="icon-btn"
                  style={{ padding: 0 }}
                  aria-label={`Quitar ${l.label.name}`}
                  onClick={async () => {
                    await api(`/api/subscribers/${base.id}/labels/${l.label.id}`, { method: 'DELETE' })
                    refresh()
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="row" style={{ marginBottom: 16 }}>
            <input className="grow" placeholder="Nueva etiqueta" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addLabel()} />
            <button className="btn" onClick={addLabel}>
              Añadir
            </button>
          </div>
          <h3 style={{ margin: '0 0 6px' }}>Listas</h3>
          <div className="chips" style={{ marginBottom: 8 }}>
            {s.lists.map((l) => (
              <span key={l.list.id} className="badge badge-blue">
                {l.list.name}{' '}
                <button
                  className="icon-btn"
                  style={{ padding: 0 }}
                  aria-label={`Quitar de ${l.list.name}`}
                  onClick={async () => {
                    await api(`/api/subscribers/${base.id}/lists/${l.list.id}`, { method: 'DELETE' })
                    refresh()
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="row">
            <input className="grow" placeholder="Añadir a una lista" value={newList} onChange={(e) => setNewList(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addList()} />
            <button className="btn" onClick={addList}>
              Añadir
            </button>
          </div>
        </>
      )}

      {tab === 'Secuencias y flujos' && s && (
        <>
          <h3 style={{ margin: '0 0 6px' }}>Secuencias</h3>
          {s.sequences.length === 0 && <p className="muted">No está en ninguna secuencia.</p>}
          {s.sequences.map((e) => (
            <div key={e.sequenceId} className="deal row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{e.sequence.name}</strong> <Badge tone={e.status === 'active' ? 'green' : 'gray'}>{e.status === 'active' ? 'Activa' : e.status === 'completed' ? 'Completada' : 'Detenida'}</Badge>
              </div>
              {e.status === 'active' && (
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    await api(`/api/subscribers/${base.id}/sequences/${e.sequenceId}`, { method: 'DELETE' })
                    refresh()
                  }}
                >
                  Detener
                </button>
              )}
            </div>
          ))}
          <div className="row" style={{ margin: '8px 0 16px' }}>
            <select className="grow" value={newSeq} onChange={(e) => setNewSeq(e.target.value)} aria-label="Secuencia">
              <option value="">Inscribir en una secuencia…</option>
              {allSequences.data?.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!newSeq}
              onClick={async () => {
                await api(`/api/sequences/${newSeq}/trigger`, { body: { phone: base.phone } })
                setNewSeq('')
                refresh()
              }}
            >
              Inscribir
            </button>
          </div>
          <h3 style={{ margin: '0 0 6px' }}>Flujo esperando respuesta</h3>
          {s.flowSessions.length === 0 ? (
            <p className="muted">Ningún flujo está esperando una respuesta de este contacto.</p>
          ) : (
            s.flowSessions.map((f) => (
              <div key={f.id} className="deal row" style={{ justifyContent: 'space-between' }}>
                <strong>{f.sequence.name}</strong>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    await api(`/api/subscribers/${base.id}/reset-input-flow`, { body: {} })
                    refresh()
                  }}
                >
                  Reiniciar
                </button>
              </div>
            ))
          )}
        </>
      )}

      {tab === 'Campos' && s && (
        <>
          {Object.entries(s.customFields ?? {}).length === 0 && <p className="muted">Sin campos personalizados.</p>}
          {Object.entries(s.customFields ?? {}).length > 0 && (
            <table style={{ marginBottom: 12 }}>
              <tbody>
                {Object.entries(s.customFields ?? {}).map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td>{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input list="contact-fields" style={{ width: 150 }} placeholder="campo" value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} />
            <datalist id="contact-fields">{defs.data?.map((d) => <option key={d.key} value={d.key} />)}</datalist>
            <input className="grow" placeholder="valor" value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} />
            <button
              className="btn"
              disabled={!fieldKey.trim()}
              onClick={async () => {
                await patch({ customFields: { [fieldKey.trim()]: fieldValue } })
                setFieldKey('')
                setFieldValue('')
              }}
            >
              Guardar
            </button>
          </div>
        </>
      )}

      {tab === 'Notas' && s && (
        <>
          {s.notes.length === 0 && <p className="muted">Sin notas.</p>}
          {s.notes.map((n) => (
            <div key={n.id} className="deal">
              {n.body}
              <small className="muted" style={{ display: 'block' }}>
                {n.author} · {timeAgo(n.createdAt)}
              </small>
            </div>
          ))}
        </>
      )}
    </Modal>
  )
}
