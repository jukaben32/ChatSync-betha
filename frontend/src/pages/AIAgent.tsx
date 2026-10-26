import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { api } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Page, useAsync } from '../ui'

interface Source {
  id: string
  type: string
  title: string
  sourceUrl: string | null
  createdAt: string
  _count?: { chunks: number }
}

interface Account {
  ai: { ready: boolean; model: string }
}

const MAX_BYTES = 3_000_000
const TYPE_LABEL: Record<string, string> = { text: 'texto', url: 'web', sheet: 'hoja', file: 'archivo' }

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

export default function AIAgent() {
  const sources = useAsync(() => api<Source[]>('/api/knowledge'))
  const account = useAsync(() => api<Account>('/api/account'))
  const [mode, setMode] = useState<'text' | 'url' | 'file'>('text')
  const [form, setForm] = useState({ title: '', content: '', url: '' })
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [question, setQuestion] = useState('')
  const [found, setFound] = useState<{ title: string; text: string }[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function add() {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const body = mode === 'url' ? { type: /docs\.google\.com\/spreadsheets/.test(form.url) ? 'sheet' : 'url', url: form.url, title: form.title || undefined } : { type: 'text', title: form.title, content: form.content }
      const r = await api<{ chunks?: number }>('/api/knowledge', { body })
      setForm({ title: '', content: '', url: '' })
      setInfo(`Añadido (${r.chunks ?? 0} fragmentos indexados).`)
      sources.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setInfo('')
    if (file.size > MAX_BYTES) return setError(`El archivo pesa ${(file.size / 1e6).toFixed(1)} MB; el máximo es 3 MB.`)
    setBusy(true)
    try {
      const r = await api<{ chunks: number; chars: number }>('/api/knowledge/file', { body: { filename: file.name, contentBase64: await toBase64(file), title: form.title || undefined } })
      setInfo(`«${file.name}» añadido: ${r.chars.toLocaleString()} caracteres en ${r.chunks} fragmentos.`)
      setForm({ ...form, title: '' })
      sources.reload()
    } catch (err) {
      const m = (err as Error).message
      setError(m.includes('Admitimos') ? m : m === 'no_text_found' || m.includes('texto extraíble') ? 'El archivo no tiene texto extraíble (¿es un PDF escaneado?).' : m)
    } finally {
      setBusy(false)
    }
  }

  async function remove(s: Source) {
    await api(`/api/knowledge/${s.id}`, { method: 'DELETE' })
    sources.reload()
  }

  async function test() {
    setError('')
    try {
      setFound((await api<{ results: { title: string; text: string }[] }>(`/api/knowledge/search?q=${encodeURIComponent(question)}`)).results)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const ready = account.data?.ai.ready
  const totalChunks = sources.data?.reduce((n, s) => n + (s._count?.chunks ?? 0), 0) ?? 0

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
          {info && <div className="ok-note">{info}</div>}
          <div className="tabs">
            {(['text', 'file', 'url'] as const).map((m) => (
              <button key={m} className={`tab ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
                {m === 'text' ? 'Texto' : m === 'file' ? 'Archivo (PDF…)' : 'Web / Google Sheet'}
              </button>
            ))}
          </div>
          <Field label="Título" hint={mode === 'file' ? 'Opcional: por defecto se usa el nombre del archivo.' : undefined}>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={mode === 'text' ? 'Ej. Horarios y precios' : 'Opcional'} />
          </Field>
          {mode === 'text' && (
            <Field label="Contenido">
              <textarea style={{ minHeight: 160 }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </Field>
          )}
          {mode === 'url' && (
            <Field label="URL" hint="Páginas web (se descarga el texto) o una hoja de Google Sheets compartida con enlace (se lee como CSV).">
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
            </Field>
          )}
          {mode === 'file' && (
            <>
              <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.csv,.json,.html,.htm" hidden onChange={onFile} />
              <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? 'Procesando…' : 'Elegir archivo'}
              </button>
              <p className="muted">PDF, TXT, MD, CSV, JSON o HTML de hasta 3 MB. Los PDF escaneados (imágenes) no tienen texto que leer.</p>
            </>
          )}
          {mode !== 'file' && (
            <button className="btn btn-primary" onClick={add} disabled={busy || (mode === 'url' ? !form.url.trim() : !form.title.trim() || !form.content.trim())}>
              {busy ? 'Añadiendo…' : 'Añadir'}
            </button>
          )}
        </Card>

        <Card title={`Fuentes cargadas${sources.data ? ` · ${sources.data.length} (${totalChunks} fragmentos)` : ''}`}>
          {sources.data?.length === 0 ? (
            <Empty>Sin fuentes. El agente solo responde con lo que cargues aquí.</Empty>
          ) : (
            sources.data?.map((s) => (
              <div key={s.id} className="deal row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{s.title}</strong> <Badge tone={s.type === 'url' || s.type === 'sheet' ? 'blue' : 'gray'}>{TYPE_LABEL[s.type] ?? s.type}</Badge>{' '}
                  <span className="muted">{s._count?.chunks ?? 0} fragmentos</span>
                  {s.sourceUrl && <div className="muted mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sourceUrl}</div>}
                </div>
                <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>
                  Quitar
                </button>
              </div>
            ))
          )}
        </Card>
      </div>

      <Card title="Probar la búsqueda">
        <p className="muted" style={{ marginTop: 0 }}>
          La IA no recibe todo el texto: solo los fragmentos más parecidos a la pregunta del cliente (así gasta muchos menos tokens). Escribe una pregunta para ver qué le llegaría.
        </p>
        <div className="row">
          <input className="grow" placeholder="¿A qué hora abren los sábados?" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && question.trim() && test()} />
          <button className="btn" onClick={test} disabled={!question.trim()}>
            Buscar
          </button>
        </div>
        {found && (found.length === 0 ? <p className="muted">Ningún fragmento coincide: la IA respondería que no tiene esa información y ofrecería pasar con una persona.</p> : found.map((f, i) => (
          <div key={i} className="deal">
            <strong>{f.title}</strong>
            <div className="muted">{f.text.slice(0, 400)}</div>
          </div>
        )))}
      </Card>
    </Page>
  )
}
