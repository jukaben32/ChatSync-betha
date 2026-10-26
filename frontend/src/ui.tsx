import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const run = useCallback(async () => {
    setLoading(true)
    try {
      setData(await fn())
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    run()
  }, [run])

  return { data, error, loading, reload: run, setData }
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <div className="row">{actions}</div>
      </header>
      {children}
    </div>
  )
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          <h3>{title}</h3>
          <div className="row">{actions}</div>
        </div>
      )}
      {children}
    </section>
  )
}

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function ErrorNote({ message }: { message: string }) {
  return message ? <div className="error-note">{message}</div> : null
}

export function Avatar({ text }: { text: string }) {
  return <span className="avatar">{text}</span>
}

const ICONS: Record<string, ReactNode> = {
  panel: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  inbox: <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12Z" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-3.5 3.200-5.500 6.500-5.500s6 2 6.500 5.500" /><path d="M16 4.600a3.500 3.500 0 0 1 0 6.800M18 14.800c1.800.7 3 2.500 3.500 5.200" /></>,
  crm: <><path d="M3 4h18l-7 9v6l-4 2v-8L3 4Z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  megaphone: <><path d="M3 11v3a1 1 0 0 0 1 1h3l8 4V6L7 10H4a1 1 0 0 0-1 1Z" /><path d="M19 9a4 4 0 0 1 0 6" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  form: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  webhook: <><circle cx="6" cy="17" r="2.500" /><circle cx="18" cy="17" r="2.500" /><circle cx="12" cy="6" r="2.500" /><path d="M12 8.500 7 15M12 8.500l5 6.500M8.500 17h7" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></>,
  sparkle: <path d="M12 3l1.900 5.100L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900L12 3ZM19 17l.7 1.800L21.500 19.500l-1.800.7L19 22l-.7-1.800-1.800-.7 1.800-.7L19 17Z" />,
  plug: <><path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5" /></>,
  team: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.6-4 3.700-6 8-6s7.400 2 8 6" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.400 15a1.700 1.700 0 0 0 .3 1.800l.1.1a2 2 0 1 1-2.800 2.800l-.1-.1a1.700 1.700 0 0 0-1.800-.3 1.700 1.700 0 0 0-1 1.500V21a2 2 0 1 1-4 0v-.1a1.700 1.700 0 0 0-1.100-1.500 1.700 1.700 0 0 0-1.800.3l-.1.1a2 2 0 1 1-2.800-2.800l.1-.1a1.700 1.700 0 0 0 .3-1.800 1.700 1.700 0 0 0-1.500-1H3a2 2 0 1 1 0-4h.1a1.700 1.700 0 0 0 1.500-1.100 1.700 1.700 0 0 0-.3-1.800l-.1-.1a2 2 0 1 1 2.800-2.800l.1.100a1.700 1.700 0 0 0 1.800.3h0a1.700 1.700 0 0 0 1-1.500V3a2 2 0 1 1 4 0v.1a1.700 1.700 0 0 0 1 1.500h0a1.700 1.700 0 0 0 1.800-.3l.1-.1a2 2 0 1 1 2.800 2.800l-.1.100a1.700 1.700 0 0 0-.3 1.800v0a1.700 1.700 0 0 0 1.500 1H21a2 2 0 1 1 0 4h-.1a1.700 1.700 0 0 0-1.500 1Z" /></>,
}

export function Icon({ name, className = 'ico' }: { name: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name] ?? ICONS.sparkle}
    </svg>
  )
}

/** Símbolo de marca de Betha IA (el mismo de betha-ai.vercel.app). */
export function BrandMark({ className = 'brandmark' }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 160 176" fill="currentColor">
      <path d="M20 76V24C20 10 29 4 39 4s17 8 17 19v28L20 83Z" />
      <path d="M62 7c20 18 24 40 15 56L39 96c-12 11-19 21-19 34 0 20 15 30 40 30h30c28 0 45-16 45-39 0-26-17-44-42-44H80l-18 19h27c15 0 24 10 24 24s-10 21-24 21H58c-15 0-22-5-22-14 0-7 5-14 14-22l30-27C99 58 91 29 62 7Z" />
    </svg>
  )
}

export function Brand({ style }: { style?: React.CSSProperties }) {
  return (
    <div className="brand" style={style}>
      <BrandMark />
      <span>betha</span>
      <small>IA</small>
    </div>
  )
}

type Theme = 'dark' | 'light' | 'auto'

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('chatsyncs_theme')
    return t === 'light' || t === 'auto' ? t : 'dark'
  } catch {
    return 'dark'
  }
}

/** Selector de tema: oscuro (marca Betha IA, por defecto), claro, o el del sistema. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const choose = (t: Theme) => {
    setTheme(t)
    document.documentElement.dataset.theme = t
    try {
      localStorage.setItem('chatsyncs_theme', t)
    } catch {
      /* almacenamiento no disponible */
    }
  }
  return (
    <div className="theme-switch" role="group" aria-label="Tema">
      {([['auto', 'Auto'], ['light', 'Claro'], ['dark', 'Oscuro']] as [Theme, string][]).map(([t, label]) => (
        <button key={t} className={theme === t ? 'on' : ''} onClick={() => choose(t)} aria-pressed={theme === t}>
          {label}
        </button>
      ))}
    </div>
  )
}
