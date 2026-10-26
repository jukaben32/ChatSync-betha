import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api, getKey, setKey } from './api'
import { ErrorNote } from './ui'
import Dashboard from './pages/Dashboard'
import Inbox from './pages/Inbox'
import Contacts from './pages/Contacts'
import Broadcasts from './pages/Broadcasts'
import Automations from './pages/Automations'
import Templates from './pages/Templates'
import AIAgent from './pages/AIAgent'
import CRM from './pages/CRM'
import Integrations from './pages/Integrations'
import Team from './pages/Team'
import Settings from './pages/Settings'
import Workflows from './pages/Workflows'

const NAV: { group: string; items: { to: string; icon: string; label: string }[] }[] = [
  {
    group: 'Conversaciones',
    items: [
      { to: '/', icon: '▦', label: 'Panel' },
      { to: '/inbox', icon: '💬', label: 'Bandeja' },
      { to: '/contacts', icon: '👥', label: 'Contactos' },
      { to: '/crm', icon: '◈', label: 'CRM' },
    ],
  },
  {
    group: 'Automatización',
    items: [
      { to: '/broadcasts', icon: '📣', label: 'Broadcasts' },
      { to: '/automations', icon: '⚡', label: 'Secuencias y flujos' },
      { to: '/workflows', icon: '↯', label: 'Webhook Workflows' },
      { to: '/templates', icon: '📄', label: 'Plantillas' },
      { to: '/ai', icon: '✦', label: 'Agente IA' },
    ],
  },
  {
    group: 'Configuración',
    items: [
      { to: '/integrations', icon: '🔌', label: 'Webhooks y API' },
      { to: '/team', icon: '🧑‍💼', label: 'Equipo' },
      { to: '/settings', icon: '⚙', label: 'Ajustes' },
    ],
  },
]

function Login({ onLogin }: { onLogin: () => void }) {
  const [key, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/account', { key: key.trim() })
      setKey(key.trim())
      onLogin()
    } catch {
      setError('Clave incorrecta o servidor no disponible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ padding: '0 0 16px' }}>
          <span className="brand-dot">C</span> ChatSyncs
        </div>
        <h3 style={{ marginBottom: 4 }}>Acceso privado</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Introduce tu clave de administrador (ADMIN_API_KEY).
        </p>
        <ErrorNote message={error} />
        <div className="field">
          <span>Clave de acceso</span>
          <input type="password" autoFocus autoComplete="current-password" value={key} onChange={(e) => setValue(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!key.trim() || busy}>
          {busy ? 'Comprobando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand">
          <span className="brand-dot">C</span> ChatSyncs
        </div>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span>{i.icon}</span>
                <span>{i.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          <button className="btn btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main">
        <button className="btn menu-btn" onClick={() => setOpen(true)} aria-label="Abrir menú">
          ☰ Menú
        </button>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/crm" element={<CRM />} />
          <Route path="/broadcasts" element={<Broadcasts />} />
          <Route path="/automations" element={<Automations />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/ai" element={<AIAgent />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/team" element={<Team />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getKey()))

  useEffect(() => {
    const onUnauthorized = () => {
      setKey('')
      setAuthed(false)
    }
    window.addEventListener('chatsyncs:unauthorized', onUnauthorized)
    return () => window.removeEventListener('chatsyncs:unauthorized', onUnauthorized)
  }, [])

  if (!authed) return <Login onLogin={() => setAuthed(true)} />
  return (
    <BrowserRouter>
      <Shell
        onLogout={() => {
          setKey('')
          setAuthed(false)
        }}
      />
    </BrowserRouter>
  )
}
