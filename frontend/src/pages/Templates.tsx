import { useState } from 'react'
import { api } from '../api'
import type { Template } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

const TONE: Record<string, 'gray' | 'amber' | 'green' | 'red'> = { draft: 'gray', pending: 'amber', approved: 'green', rejected: 'red' }
const LABEL: Record<string, string> = { draft: 'Borrador', pending: 'En revisión', approved: 'Aprobada', rejected: 'Rechazada' }

export default function Templates() {
  const list = useAsync(() => api<Template[]>('/api/templates'))
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function sync() {
    setError('')
    setMessage('')
    try {
      const r = await api<{ synced: number }>('/api/templates/sync', { body: {} })
      setMessage(`${r.synced} plantillas sincronizadas desde Meta.`)
      list.reload()
    } catch (e) {
      const m = (e as Error).message
      setError(m === 'whatsapp_not_configured' ? 'Conecta WhatsApp (Conexión) para sincronizar con Meta.' : m)
    }
  }

  async function remove(t: Template) {
    if (!confirm(`Eliminar la plantilla "${t.name}" de este panel? (No se borra en Meta)`)) return
    await api(`/api/templates/${t.id}`, { method: 'DELETE' })
    list.reload()
  }

  return (
    <Page
      title="Plantillas"
      subtitle="Mensajes que Meta debe aprobar antes de usarse fuera de la ventana de 24 h"
      actions={
        <>
          <button className="btn" onClick={sync}>
            Sincronizar con Meta
          </button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + Nueva plantilla
          </button>
        </>
      }
    >
      {message && <div className="ok-note">{message}</div>}
      <ErrorNote message={error || list.error} />
      <Card>
        {list.data?.length === 0 ? (
          <Empty>No hay plantillas. Crea una o sincroniza las existentes de tu cuenta de WhatsApp Business.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Idioma</th>
                  <th>Categoría</th>
                  <th>Estado</th>
                  <th>Contenido</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.name}</td>
                    <td>{t.language}</td>
                    <td>{t.category}</td>
                    <td>
                      <Badge tone={TONE[t.status] ?? 'gray'}>{LABEL[t.status] ?? t.status}</Badge>
                    </td>
                    <td className="muted">{t.body.slice(0, 80)}</td>
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={() => remove(t)}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && (
        <NewTemplate
          onClose={() => setCreating(false)}
          onSaved={(warning) => {
            setCreating(false)
            if (warning) setMessage(warning)
            list.reload()
          }}
        />
      )}
    </Page>
  )
}

function NewTemplate({ onClose, onSaved }: { onClose: () => void; onSaved: (warning?: string) => void }) {
  const [form, setForm] = useState({ name: '', language: 'es', category: 'MARKETING', body: '', submit: false })
  const [error, setError] = useState('')
  async function save() {
    try {
      const r = await api<{ warning?: string }>('/api/templates', { body: form })
      onSaved(r.warning)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Modal
      title="Nueva plantilla"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim() || !form.body.trim()}>
            Guardar
          </button>
        </>
      }
    >
      <ErrorNote message={error} />
      <Field label="Nombre" hint="Minúsculas, números y guion bajo.">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
      </Field>
      <div className="grid grid-2">
        <Field label="Idioma">
          <input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
        </Field>
        <Field label="Categoría">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="MARKETING">Marketing</option>
            <option value="UTILITY">Utilidad</option>
          </select>
        </Field>
      </div>
      <Field label="Cuerpo" hint="Variables con {{1}}, {{2}}…">
        <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={form.submit} onChange={(e) => setForm({ ...form, submit: e.target.checked })} /> Enviar a revisión de Meta ahora
      </label>
    </Modal>
  )
}
