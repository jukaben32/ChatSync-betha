import { useState } from 'react'
import { api } from '../api'
import { Badge, Card, Empty, ErrorNote, Page, useAsync } from '../ui'

interface Member {
  id: string
  name: string
  email: string | null
  role: string
}

export default function Team() {
  const team = useAsync(() => api<Member[]>('/api/team'))
  const [form, setForm] = useState({ name: '', email: '', role: 'agent' })
  const [error, setError] = useState('')

  async function add() {
    setError('')
    try {
      await api('/api/team', { body: form })
      setForm({ name: '', email: '', role: 'agent' })
      team.reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Page title="Equipo" subtitle="Agentes a los que puedes asignar conversaciones en la bandeja">
      <ErrorNote message={error || team.error} />
      <Card title="Añadir miembro">
        <div className="row">
          <input className="grow" placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="grow" placeholder="Email (opcional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select style={{ width: 130 }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Rol">
            <option value="agent">Agente</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary" onClick={add} disabled={!form.name.trim()}>
            Añadir
          </button>
        </div>
      </Card>
      <Card title="Miembros">
        {team.data?.length === 0 ? (
          <Empty>Todavía no hay miembros.</Empty>
        ) : (
          <table>
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
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={async () => {
                        await api(`/api/team/${m.id}`, { method: 'DELETE' })
                        team.reload()
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
    </Page>
  )
}
