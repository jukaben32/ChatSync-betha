import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ApiError, api, getKey, setKey } from './api'
import { MeContext } from './auth'
import type { Me } from './auth'
import { Brand, ErrorNote, ThemeSwitch } from './ui'
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
import Forms from './pages/Forms'
import Appointments from './pages/Appointments'

interface NavItem {
  to: string
  icon: string
  label: string
  /** Si es true también lo ven las personas del equipo con rol «agente». */
  agent?: boolean
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Conversaciones',
    items: [
      { to: '/', icon: '▦', label: 'Panel' },
      { to: '/inbox', icon: '💬', label: 'Bandeja', agent: true },
      { to: '/contacts', icon: '👥', label: 'Contactos', agent: true },
      { to: '/crm', icon: '◈', label: 'CRM', agent: true },
      { to: '/appointments', icon: '📅', label: 'Citas', agent: true },
    ],
  },
  {
    group: 'Automatización',
    items: [
      { to: '/broadcasts', icon: '📣', label: 'Broadcasts' },
      { to: '/automations', icon: '⚡', label: 'Secuencias y flujos' },
      { to: '/forms', icon: '📋', label: 'Formularios' },
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
  const [mode, setMode] = useState<'admin' | 'team'>('team')
  const [key, setValue] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ token: string }>('/api/auth/login', { key: ' ', body: mode === 'admin' ? { key: key.trim() } : { email: email.trim(), password } })
      setKey(res.token)
      onLogin()
    } catch (err) {
      const msg = (err as Error).message
      setError((err as ApiError).status === 429 ? 'Demasiados intentos fallidos. Espera unos minutos.' : msg === 'ip_not_allowed' ? 'Tu IP no está en la lista de accesos permitidos.' : 'Datos incorrectos o servidor no disponible.')
    } finally {
      setBusy(false)
    }
  }

  const ready = mode === 'admin' ? Boolean(key.trim()) : Boolean(email.trim() && password)

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <Brand style={{ padding: '0 0 18px' }} />
        <div className="tabs">
          <button type="button" className={`tab ${mode === 'team' ? 'active' : ''}`} onClick={() => setMode('team')}>
            Equipo
          </button>
          <button type="button" className={`tab ${mode === 'admin' ? 'active' : ''}`} onClick={() => setMode('admin')}>
            Administrador
          </button>
        </div>
        <ErrorNote message={error} />
        {mode === 'admin' ? (
          <div className="field">
            <span>Clave de administrador</span>
            <input type="password" autoFocus autoComplete="current-password" value={key} onChange={(e) => setValue(e.target.value)} />
          </div>
        ) : (
          <>
            <div className="field">
              <span>Email</span>
              <input type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <span>Contraseña</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </>
        )}
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!ready || busy}>
          {busy ? 'Comprobando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const isAgent = me.role === 'agent'
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !isAgent || i.agent) })).filter((g) => g.items.length)

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <Brand />
        {groups.map((g) => (
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
          <ThemeSwitch />
          {me.name && me.name !== 'Admin' && (
            <div className="muted" style={{ padding: '0 10px 8px' }}>
              {me.name} · {isAgent ? 'Agente' : 'Admin'}
            </div>
          )}
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
          {!isAgent && <Route path="/" element={<Dashboard />} />}
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/crm" element={<CRM />} />
          <Route path="/appointments" element={<Appointments />} />
          {!isAgent && (
            <>
              <Route path="/broadcasts" element={<Broadcasts />} />
              <Route path="/automations" element={<Automations />} />
              <Route path="/forms" element={<Forms />} />
              <Route path="/workflows" element={<Workflows />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/ai" element={<AIAgent />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/team" element={<Team />} />
              <Route path="/settings" element={<Settings />} />
            </>
          )}
          <Route path="*" element={<Navigate to={isAgent ? '/inbox' : '/'} replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getKey()))
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    const onUnauthorized = () => {
      setKey('')
      setMe(null)
      setAuthed(false)
    }
    window.addEventListener('chatsyncs:unauthorized', onUnauthorized)
    return () => window.removeEventListener('chatsyncs:unauthorized', onUnauthorized)
  }, [])

  // Una vez dentro se consulta el rol para mostrar solo lo que corresponde
  useEffect(() => {
    if (!authed) return
    api<Me>('/api/auth/me')
      .then(setMe)
      .catch(() => undefined)
  }, [authed])

  if (!authed) return <Login onLogin={() => setAuthed(true)} />
  if (!me) return <div className="login muted">Cargando…</div>
  return (
    <MeContext.Provider value={me}>
      <BrowserRouter>
        <Shell
          me={me}
          onLogout={() => {
            setKey('')
            setMe(null)
            setAuthed(false)
          }}
        />
      </BrowserRouter>
    </MeContext.Provider>
  )
}
