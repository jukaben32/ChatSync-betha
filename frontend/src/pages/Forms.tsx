import { useState } from 'react'
import { api, getKey, timeAgo } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

type QType = 'text' | 'number' | 'email' | 'phone' | 'date' | 'choice'

interface Question {
  key?: string
  label: string
  type: QType
  options?: string[]
  required?: boolean
}

interface FormRow {
  id: string
  name: string
  keyword: string | null
  intro: string | null
  doneMessage: string
  labelOnDone: string | null
  active: boolean
  questions: Question[]
  _count?: { submissions: number }
}

interface Submission {
  id: string
  createdAt: string
  answers: Record<string, unknown>
  subscriber: { phone: string; name: string | null }
}

const TYPE_LABEL: Record<QType, string> = { text: 'Texto', number: 'Número', email: 'Email', phone: 'Teléfono', date: 'Fecha', choice: 'Opciones' }

export default function Forms() {
  const list = useAsync(() => api<FormRow[]>('/api/forms'))
  const [editing, setEditing] = useState<FormRow | 'new' | null>(null)
  const [viewing, setViewing] = useState<FormRow | null>(null)
  const [sending, setSending] = useState<FormRow | null>(null)

  async function remove(f: FormRow) {
    if (!confirm(`Eliminar el formulario "${f.name}" y sus ${f._count?.submissions ?? 0} envíos?`)) return
    await api(`/api/forms/${f.id}`, { method: 'DELETE' })
    list.reload()
  }
  async function toggle(f: FormRow) {
    await api(`/api/forms/${f.id}`, { method: 'PATCH', body: { active: !f.active } })
    list.reload()
  }

  return (
    <Page
      title="Formularios"
      subtitle="Recoge datos dentro del chat de WhatsApp: una pregunta por mensaje, con validación"
      actions={
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + Nuevo formulario
        </button>
      }
    >
      <ErrorNote message={list.error} />
      {list.data?.length === 0 ? (
        <Card>
          <Empty>
            Aún no hay formularios. Un formulario se lanza cuando el cliente escribe su palabra clave (o a mano desde aquí), le hace las preguntas una a una, valida las respuestas y las guarda como envío y en sus campos.
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-2">
          {list.data?.map((f) => (
            <Card
              key={f.id}
              title={f.name}
              actions={
                <label className="check">
                  <input type="checkbox" checked={f.active} onChange={() => toggle(f)} /> Activo
                </label>
              }
            >
              <div className="row" style={{ marginBottom: 8 }}>
                {f.keyword ? <Badge tone="blue">Palabra clave: {f.keyword}</Badge> : <Badge>Solo manual</Badge>}
                <Badge>{f.questions.length} preguntas</Badge>
                <Badge tone="green">{f._count?.submissions ?? 0} envíos</Badge>
              </div>
              <ol style={{ paddingLeft: 22, margin: '0 0 12px' }}>
                {f.questions.map((q, i) => (
                  <li key={i}>
                    {q.label} <span className="muted">· {TYPE_LABEL[q.type]}{q.required === false ? ' · opcional' : ''}</span>
                  </li>
                ))}
              </ol>
              <div className="row">
                <button className="btn btn-sm" onClick={() => setViewing(f)}>
                  Ver envíos
                </button>
                <button className="btn btn-sm" onClick={() => setSending(f)}>
                  Enviar a un contacto
                </button>
                <button className="btn btn-sm" onClick={() => setEditing(f)}>
                  Editar
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(f)}>
                  Eliminar
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <FormEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            list.reload()
          }}
        />
      )}
      {viewing && <Submissions form={viewing} onClose={() => setViewing(null)} />}
      {sending && <SendModal form={sending} onClose={() => setSending(null)} />}
    </Page>
  )
}

function FormEditor({ initial, onClose, onSaved }: { initial: FormRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [keyword, setKeyword] = useState(initial?.keyword ?? '')
  const [intro, setIntro] = useState(initial?.intro ?? '')
  const [done, setDone] = useState(initial?.doneMessage ?? '¡Gracias! Hemos recibido tus respuestas.')
  const [label, setLabel] = useState(initial?.labelOnDone ?? '')
  const [questions, setQuestions] = useState<Question[]>(initial?.questions ?? [{ label: '', type: 'text', required: true }])
  const [error, setError] = useState('')

  const update = (i: number, patch: Partial<Question>) => setQuestions(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= questions.length) return
    const copy = [...questions]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    setQuestions(copy)
  }

  async function save() {
    const payload = { name, keyword, intro, doneMessage: done, labelOnDone: label, questions: questions.map((q) => ({ ...q, options: q.type === 'choice' ? q.options : undefined })) }
    try {
      if (initial) await api(`/api/forms/${initial.id}`, { method: 'PATCH', body: payload })
      else await api('/api/forms', { body: payload })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Modal
      title={initial ? 'Editar formulario' : 'Nuevo formulario'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim() || questions.some((q) => !q.label.trim())}>
            Guardar
          </button>
        </>
      }
    >
      <ErrorNote message={error} />
      <div className="grid grid-2">
        <Field label="Nombre">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Palabra clave (opcional)" hint="Si el cliente la escribe, empieza el formulario.">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </Field>
      </div>
      <Field label="Mensaje de introducción (opcional)">
        <input value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="Vamos a reservar tu cita…" />
      </Field>
      <h3 style={{ margin: '8px 0' }}>Preguntas</h3>
      {questions.map((q, i) => (
        <div className="step" key={i} style={{ gridTemplateColumns: '1fr', gap: 8 }}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Badge tone="blue">{i + 1}</Badge>
            <input className="grow" placeholder="Texto de la pregunta" value={q.label} onChange={(e) => update(i, { label: e.target.value })} />
            <select style={{ width: 130 }} value={q.type} onChange={(e) => update(i, { type: e.target.value as QType, options: e.target.value === 'choice' ? q.options ?? ['', ''] : undefined })} aria-label="Tipo">
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">
              ↑
            </button>
            <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === questions.length - 1} aria-label="Bajar">
              ↓
            </button>
            <button className="icon-btn" onClick={() => setQuestions(questions.filter((_, idx) => idx !== i))} aria-label="Quitar pregunta" disabled={questions.length === 1}>
              ✕
            </button>
          </div>
          {q.type === 'choice' && (
            <div className="grid" style={{ gap: 6 }}>
              {(q.options ?? []).map((o, oi) => (
                <div className="row" key={oi} style={{ flexWrap: 'nowrap' }}>
                  <input className="grow" maxLength={24} placeholder={`Opción ${oi + 1}`} value={o} onChange={(e) => update(i, { options: (q.options ?? []).map((x, xi) => (xi === oi ? e.target.value : x)) })} />
                  <button className="icon-btn" aria-label="Quitar opción" onClick={() => update(i, { options: (q.options ?? []).filter((_, xi) => xi !== oi) })}>
                    ✕
                  </button>
                </div>
              ))}
              {(q.options?.length ?? 0) < 10 && (
                <button className="btn btn-sm" style={{ width: 'fit-content' }} onClick={() => update(i, { options: [...(q.options ?? []), ''] })}>
                  + Opción
                </button>
              )}
              <span className="muted">Hasta 3 opciones se muestran como botones; de 4 a 10, como lista.</span>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={q.required !== false} onChange={(e) => update(i, { required: e.target.checked })} /> Obligatoria (si no, el cliente puede escribir «omitir»)
          </label>
        </div>
      ))}
      {questions.length < 20 && (
        <button className="btn btn-sm" onClick={() => setQuestions([...questions, { label: '', type: 'text', required: true }])}>
          + Añadir pregunta
        </button>
      )}
      <h3 style={{ margin: '16px 0 8px' }}>Al terminar</h3>
      <Field label="Mensaje final">
        <input value={done} onChange={(e) => setDone(e.target.value)} />
      </Field>
      <Field label="Etiqueta que se añade al contacto (opcional)">
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
    </Modal>
  )
}

function Submissions({ form, onClose }: { form: FormRow; onClose: () => void }) {
  const data = useAsync(() => api<{ submissions: Submission[] }>(`/api/forms/${form.id}/submissions`), [form.id])

  async function download() {
    const res = await fetch(`/api/forms/${form.id}/export`, { headers: { Authorization: `Bearer ${getKey()}` } })
    if (!res.ok) return
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = `${form.name}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const rows = data.data?.submissions ?? []
  return (
    <Modal
      title={`Envíos de «${form.name}»`}
      onClose={onClose}
      footer={
        <button className="btn" onClick={download} disabled={!rows.length}>
          Exportar CSV
        </button>
      }
    >
      <ErrorNote message={data.error} />
      {rows.length === 0 ? (
        <Empty>Nadie ha completado este formulario todavía.</Empty>
      ) : (
        rows.map((s) => (
          <div key={s.id} className="deal">
            <strong>{s.subscriber.name || `+${s.subscriber.phone}`}</strong> <span className="muted">· {timeAgo(s.createdAt)}</span>
            <table style={{ marginTop: 6 }}>
              <tbody>
                {form.questions.map((q) => (
                  <tr key={q.key ?? q.label}>
                    <td className="muted" style={{ width: '40%' }}>
                      {q.label}
                    </td>
                    <td>{String(s.answers[q.key ?? ''] ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </Modal>
  )
}

function SendModal({ form, onClose }: { form: FormRow; onClose: () => void }) {
  const [phone, setPhone] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  async function send() {
    setError('')
    setResult('')
    try {
      await api(`/api/forms/${form.id}/send`, { body: { phone } })
      setResult('Formulario enviado. Las respuestas del cliente llegarán a «Ver envíos».')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Modal
      title={`Enviar «${form.name}»`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={send} disabled={phone.replace(/\D/g, '').length < 7}>
          Enviar
        </button>
      }
    >
      <ErrorNote message={error} />
      {result && <div className="ok-note">{result}</div>}
      <Field label="Teléfono del contacto" hint="Se crea si no existe. Fuera de la ventana de 24 h WhatsApp solo permite plantillas.">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoFocus />
      </Field>
    </Modal>
  )
}
