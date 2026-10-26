import { useState } from 'react'
import { api } from '../api'
import type { Deal } from '../api'
import { Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

const STAGES = [
  { id: 'new', label: 'Nuevo' },
  { id: 'contacted', label: 'Contactado' },
  { id: 'qualified', label: 'Calificado' },
  { id: 'proposal', label: 'Propuesta' },
  { id: 'won', label: 'Ganado' },
  { id: 'lost', label: 'Perdido' },
]

export default function CRM() {
  const deals = useAsync(() => api<Deal[]>('/api/crm/deals'))
  const [creating, setCreating] = useState(false)

  async function move(d: Deal, stage: string) {
    await api(`/api/crm/deals/${d.id}`, { method: 'PATCH', body: { stage } })
    deals.reload()
  }
  async function remove(d: Deal) {
    if (!confirm('Eliminar esta oportunidad?')) return
    await api(`/api/crm/deals/${d.id}`, { method: 'DELETE' })
    deals.reload()
  }

  return (
    <Page
      title="CRM"
      subtitle="Pipeline de oportunidades por contacto"
      actions={
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + Nueva oportunidad
        </button>
      }
    >
      <ErrorNote message={deals.error} />
      {deals.data?.length === 0 && <Empty>Aún no hay oportunidades. Crea una a partir de un contacto existente.</Empty>}
      <div className="kanban">
        {STAGES.map((st) => {
          const items = deals.data?.filter((d) => d.stage === st.id) ?? []
          const total = items.reduce((sum, d) => sum + d.value, 0)
          return (
            <div className="column" key={st.id}>
              <h3>
                <span>{st.label}</span>
                <span className="muted">
                  {items.length}
                  {total > 0 && ` · ${total.toLocaleString()}`}
                </span>
              </h3>
              {items.map((d) => (
                <div className="deal" key={d.id}>
                  <strong>{d.subscriber.name || `+${d.subscriber.phone}`}</strong>
                  <div className="muted">{d.value > 0 ? d.value.toLocaleString() : 'Sin valor'}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <select value={d.stage} onChange={(e) => move(d, e.target.value)} aria-label="Mover a" style={{ padding: '4px 6px' }}>
                      {STAGES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button className="icon-btn" onClick={() => remove(d)} aria-label="Eliminar">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {creating && (
        <NewDeal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            deals.reload()
          }}
        />
      )}
    </Page>
  )
}

function NewDeal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ phone: '', stage: 'new', value: '' })
  const [error, setError] = useState('')
  async function save() {
    try {
      await api('/api/crm/deals', { body: { phone: form.phone.replace(/[^\d]/g, ''), stage: form.stage, value: Number(form.value) || 0 } })
      onSaved()
    } catch (e) {
      setError((e as Error).message === 'subscriber_not_found' ? 'Ese teléfono no existe en Contactos.' : (e as Error).message)
    }
  }
  return (
    <Modal
      title="Nueva oportunidad"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!form.phone.trim()}>
            Crear
          </button>
        </>
      }
    >
      <ErrorNote message={error} />
      <Field label="Teléfono del contacto">
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" autoFocus />
      </Field>
      <Field label="Etapa">
        <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Valor estimado">
        <input type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
      </Field>
    </Modal>
  )
}
