import { useState } from 'react'
import { api, timeAgo } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

interface Member {
  id: string
  name: string
  email: string | null
  role: 'admin' | 'agent'
  active: boolean
  hasPassword: boolean
}

interface LogRow {
  id: string
  actor: string
  role: string
  ip: string | null
  ok: boolean
  createdAt: string
}

export default function Team() {
  const team = useAsync(() => api<Member[]>('/api/team'))
  const [editing, setEditing] = useState<Member | 'new' | null>(null)
  const [showLog, setShowLog] = useState(false)
  const log = useAsync(() => api<LogRow[]>('/api/login-log'))

  async function toggle(m: Member) {
    await api(`/api/team/${m.id}`, { method: 'PATCH', body: { active: !m.active } })
    team.reload()
  }
  async function remove(m: Member) {
    if (!confirm(`Eliminar a ${m.name}? Sus conversaciones asignadas quedarán a su nombre.`)) return
    await api(`/api/team/${m.id}`, { method: 'DELETE' })
    team.reload()
  }

  return (
    <Page
      title="Equipo"
      subtitle="Personas que atienden conversaciones. Con email y contraseña pueden entrar al panel con su propia cuenta"
      actions={
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + Añadir miembro
        </button>
      }
    >
      <ErrorNote message={team.error} />
      <Card>
        <p className="muted" style={{ marginTop: 0 }}>
          <strong>Agente:</strong> atiende la bandeja, contactos, CRM y citas; los teléfonos le salen enmascarados y no puede configurar, exportar ni borrar contactos.
          <br />
          <strong>Admin:</strong> acceso completo. Los mensajes que envía cada persona quedan registrados con su nombre.
        </p>
        {team.data?.length === 0 ? (
          <Empty>Todavía no hay miembros.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Acceso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {team.data?.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                    </td>
                    <td className="muted">{m.email}</td>
                    <td>
                      <Badge tone={m.role === 'admin' ? 'blue' : 'gray'}>{m.role === 'admin' ? 'Admin' : 'Agente'}</Badge>
                    </td>
                    <td>
                      {!m.hasPassword ? <Badge>Sin acceso al panel</Badge> : m.active ? <Badge tone="green">Puede entrar</Badge> : <Badge tone="amber">Desactivado</Badge>}
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm" onClick={() => setEditing(m)}>
                          Editar
                        </button>
                        {m.hasPassword && (
                          <button className="btn btn-sm" onClick={() => toggle(m)}>
                            {m.active ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                        <button className="btn btn-sm btn-danger" onClick={() => remove(m)}>
                          Quitar
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

      <Card
        title="Registro de accesos"
        actions={
          <button
            className="btn btn-sm"
            onClick={() => {
              setShowLog(!showLog)
              log.reload()
            }}
          >
            {showLog ? 'Ocultar' : 'Ver últimos accesos'}
          </button>
        }
      >
        {showLog &&
          (log.data?.length === 0 ? (
            <Empty>Aún no hay accesos registrados.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {log.data?.slice(0, 50).map((l) => (
                    <tr key={l.id}>
                      <td className="muted">{timeAgo(l.createdAt)}</td>
                      <td>{l.actor}</td>
                      <td>
                        <Badge>{l.role === 'admin' ? 'Admin' : 'Agente'}</Badge>
                      </td>
                      <td className="mono">{l.ip ?? '—'}</td>
                      <td>
                        <Badge tone={l.ok ? 'green' : 'red'}>{l.ok ? 'Correcto' : 'Fallido'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {!showLog && <p className="muted" style={{ margin: 0 }}>Se registran los accesos al panel (correctos y fallidos) con su IP. Tras 10 fallos desde una misma IP se bloquea el acceso 15 minutos.</p>}
      </Card>

      {editing && (
        <MemberEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            team.reload()
          }}
        />
      )}
    </Page>
  )
}

function MemberEditor({ initial, onClose, onSaved }: { initial: Member | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: initial?.name ?? '', email: initial?.email ?? '', role: initial?.role ?? 'agent', password: '' })
  const [error, setError] = useState('')

  async function save() {
    try {
      const body = { name: form.name, email: form.email || null, role: form.role, ...(form.password ? { password: form.password } : {}) }
      if (initial) await api(`/api/team/${initial.id}`, { method: 'PATCH', body })
      else await api('/api/team', { body })
      onSaved()
    } catch (e) {
      const m = (e as Error).message
      setError(m === 'email_in_use' ? 'Ese email ya está en uso.' : m)
    }
  }

  return (
    <Modal
      title={initial ? `Editar a ${initial.name}` : 'Añadir miembro'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()}>
            Guardar
          </button>
        </>
      }
    >
      <ErrorNote message={error} />
      <Field label="Nombre">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
      </Field>
      <Field label="Email" hint="Necesario para que pueda entrar al panel.">
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field label="Rol">
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'agent' })}>
          <option value="agent">Agente (atiende, sin configuración)</option>
          <option value="admin">Admin (acceso completo)</option>
        </select>
      </Field>
      <Field label={initial?.hasPassword ? 'Nueva contraseña (déjala vacía para no cambiarla)' : 'Contraseña de acceso (opcional)'} hint="Mínimo 8 caracteres. Sin contraseña la persona solo aparece como asignable, sin entrar al panel.">
        <input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </Field>
    </Modal>
  )
}
