import { useState } from 'react'
import { api } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Page, useAsync } from '../ui'

interface Source {
  id: string
  type: string
  title: string
  sourceUrl: string | null
  createdAt: string
}

interface Account {
  ai: { ready: boolean; model: string }
}

export default function AIAgent() {
  const sources = useAsync(() => api<Source[]>('/api/knowledge'))
  const account = useAsync(() => api<Account>('/api/account'))
  const [mode, setMode] = useState<'text' | 'url'>('text')
  const [form, setForm] = useState({ title: '', content: '', url: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    setError('')
    try {
      await api('/api/knowledge', { body: mode === 'url' ? { type: 'url', url: form.url, title: form.title || undefined } : { type: 'text', title: form.title, content: form.content } })
      setForm({ title: '', content: '', url: '' })
      sources.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(s: Source) {
    await api(`/api/knowledge/${s.id}`, { method: 'DELETE' })
    sources.reload()
  }

  const ready = account.data?.ai.ready

  return (
    <Page title="Agente IA" subtitle="Responde 24/7 con tu base de conocimiento y traspasa a un humano cuando hace falta">
      <div className={ready ? 'ok-note' : 'warn-note'}>
        {ready
          ? `Agente activo (modelo ${account.data?.ai.model}). Responde cuando ningún flujo coincide y la conversación no está asignada a una persona.`
          : 'El agente está desactivado: falta la variable AI_API_KEY en Vercel (compatible con OpenAI/OpenRouter). Puedes ir cargando la base de conocimiento mientras tanto.'}
      </div>

      <div className="grid grid-2">
        <Card title="Añadir conocimiento">
          <ErrorNote message={error} />
          <div className="tabs">
            <button className={`tab ${mode === 'text' ? 'active' : ''}`} onClick={() => setMode('text')}>
              Texto
            </button>
            <button className={`tab ${mode === 'url' ? 'active' : ''}`} onClick={() => setMode('url')}>
              Página web
            </button>
          </div>
          <Field label="Título">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={mode === 'url' ? 'Opcional' : 'Ej. Horarios y precios'} />
          </Field>
          {mode === 'url' ? (
            <Field label="URL" hint="Se descarga el texto de la página (hasta 20 000 caracteres).">
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
            </Field>
          ) : (
            <Field label="Contenido">
              <textarea style={{ minHeight: 160 }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </Field>
          )}
          <button className="btn btn-primary" onClick={add} disabled={busy || (mode === 'url' ? !form.url.trim() : !form.title.trim() || !form.content.trim())}>
            {busy ? 'Añadiendo…' : 'Añadir'}
          </button>
        </Card>

        <Card title="Fuentes cargadas">
          {sources.data?.length === 0 ? (
            <Empty>Sin fuentes. El agente solo responde con lo que cargues aquí.</Empty>
          ) : (
            sources.data?.map((s) => (
              <div key={s.id} className="deal row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{s.title}</strong> <Badge tone={s.type === 'url' ? 'blue' : 'gray'}>{s.type}</Badge>
                  {s.sourceUrl && <div className="muted mono">{s.sourceUrl}</div>}
                </div>
                <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>
                  Quitar
                </button>
              </div>
            ))
          )}
        </Card>
      </div>
    </Page>
  )
}
