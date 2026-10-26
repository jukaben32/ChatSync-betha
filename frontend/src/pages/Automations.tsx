import { useState } from 'react'
import { api } from '../api'
import type { Sequence, Step } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

const ACTIONS: Record<string, string> = {
  send_text: 'Enviar texto',
  send_media: 'Enviar archivo',
  send_template: 'Enviar plantilla',
  send_buttons: 'Pregunta con botones',
  send_list: 'Pregunta con lista',
  ask: 'Pedir un dato',
  condition: 'Condición (si / si no)',
  wait: 'Esperar',
  http_request: 'Llamada HTTP',
  set_field: 'Guardar campo',
  add_label: 'Añadir etiqueta',
  remove_label: 'Quitar etiqueta',
  assign_human: 'Pasar a una persona',
  enroll_sequence: 'Inscribir en secuencia',
  goto: 'Ir al paso…',
  end: 'Terminar',
}

const END = '__end'
const END_ORDER = 100000

interface UiStep {
  uid: string
  action: string
  delayDays: number
  params: Record<string, any>
}

let counter = 0
const uid = () => `u${Date.now().toString(36)}${counter++}`

/** Claves de `params` que apuntan a otro paso (por número de orden en el servidor, por uid en el editor). */
function eachTarget(step: { action: string; params: Record<string, any> }, fn: (holder: Record<string, any>, key: string) => void) {
  const p = step.params
  if (step.action === 'send_buttons') (p.buttons ?? []).forEach((b: Record<string, any>) => fn(b, 'next'))
  if (step.action === 'send_list') (p.rows ?? []).forEach((r: Record<string, any>) => fn(r, 'next'))
  if (step.action === 'ask') fn(p, 'next')
  if (step.action === 'condition') {
    fn(p, 'then')
    fn(p, 'else')
  }
  if (step.action === 'goto') fn(p, 'to')
}

function fromServer(steps: Step[]): UiStep[] {
  const sorted = [...steps].sort((a, b) => a.order - b.order)
  const ids = new Map(sorted.map((s) => [s.order, uid()]))
  return sorted.map((s) => {
    const ui: UiStep = { uid: ids.get(s.order)!, action: s.action, delayDays: s.delayDays ?? 0, params: structuredClone(s.params ?? {}) }
    eachTarget(ui, (h, k) => {
      const v = h[k]
      h[k] = v === undefined || v === null || v === '' ? '' : Number(v) >= END_ORDER ? END : (ids.get(Number(v)) ?? '')
    })
    return ui
  })
}

function toServer(steps: UiStep[]) {
  const orders = new Map(steps.map((s, i) => [s.uid, i]))
  return steps.map((s, i) => {
    const copy = { action: s.action, delayDays: s.delayDays, params: structuredClone(s.params), order: i }
    eachTarget(copy, (h, k) => {
      const v = h[k]
      if (v === '' || v === undefined) delete h[k]
      else h[k] = v === END ? END_ORDER : orders.get(v)
    })
    return copy
  })
}

function summary(s: { action: string; params: Record<string, any>; delayDays?: number }) {
  const p = s.params ?? {}
  switch (s.action) {
    case 'send_text':
    case 'send_buttons':
    case 'send_list':
    case 'ask':
      return String(p.body ?? '').slice(0, 40) || '(vacío)'
    case 'send_media':
      return `${p.kind ?? 'image'}`
    case 'send_template':
      return String(p.templateName ?? '?')
    case 'wait':
      return `${s.delayDays || 0} d ${p.minutes ? `+ ${p.minutes} min` : ''}`
    case 'add_label':
    case 'remove_label':
      return String(p.label ?? '?')
    case 'http_request':
      return `${p.method ?? 'GET'} ${String(p.url ?? '').slice(0, 30)}`
    case 'set_field':
      return String(p.field ?? '?')
    default:
      return ''
  }
}

export default function Automations() {
  const [tab, setTab] = useState<'sequence' | 'flow'>('flow')
  const list = useAsync(() => api<Sequence[]>(`/api/sequences?kind=${tab}`), [tab])
  const [editing, setEditing] = useState<Sequence | 'new' | null>(null)
  const [running, setRunning] = useState<Sequence | null>(null)

  async function toggle(s: Sequence) {
    await api(`/api/sequences/${s.id}`, { method: 'PATCH', body: { active: !s.active } })
    list.reload()
  }
  async function remove(s: Sequence) {
    if (!confirm(`Eliminar "${s.name}"?`)) return
    await api(`/api/sequences/${s.id}`, { method: 'DELETE' })
    list.reload()
  }

  return (
    <Page
      title="Secuencias y flujos"
      subtitle="Chatbots con preguntas y ramas, y campañas de goteo (drip)"
      actions={
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + {tab === 'flow' ? 'Nuevo flujo' : 'Nueva secuencia'}
        </button>
      }
    >
      <div className="tabs">
        <button className={`tab ${tab === 'flow' ? 'active' : ''}`} onClick={() => setTab('flow')}>
          Flujos de chatbot
        </button>
        <button className={`tab ${tab === 'sequence' ? 'active' : ''}`} onClick={() => setTab('sequence')}>
          Secuencias drip
        </button>
      </div>
      <ErrorNote message={list.error} />
      {list.data?.length === 0 ? (
        <Card>
          <Empty>
            {tab === 'flow'
              ? 'Aún no hay flujos. Un flujo se dispara cuando un cliente escribe su palabra clave y puede preguntar, ramificar y guardar datos.'
              : 'Aún no hay secuencias. Una secuencia envía mensajes escalonados en el tiempo y se detiene sola cuando el cliente responde.'}
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-2">
          {list.data?.map((s) => (
            <Card
              key={s.id}
              title={s.name}
              actions={
                <label className="check" title="Activo">
                  <input type="checkbox" checked={s.active} onChange={() => toggle(s)} /> Activo
                </label>
              }
            >
              <div className="row" style={{ marginBottom: 8 }}>
                {s.kind === 'flow' && <Badge tone="blue">Palabra clave: {s.triggerKeyword || '—'}</Badge>}
                {s.kind === 'sequence' && s.triggerLabel && <Badge tone="blue">Etiqueta: {s.triggerLabel}</Badge>}
                <Badge>{s.steps.length} pasos</Badge>
                {s.kind === 'sequence' && <Badge tone="green">{s._count?.enrollments ?? 0} inscritos</Badge>}
                {s.kind === 'sequence' && s.stopOnReply !== false && <Badge tone="amber">Se detiene al responder</Badge>}
              </div>
              <ol style={{ paddingLeft: 22, margin: '0 0 12px', maxHeight: 190, overflowY: 'auto' }} start={1}>
                {[...s.steps]
                  .sort((a, b) => a.order - b.order)
                  .map((st, i) => (
                    <li key={st.id ?? i}>
                      <strong>{ACTIONS[st.action] ?? st.action}</strong> <span className="muted">{summary(st)}</span>
                    </li>
                  ))}
              </ol>
              <div className="row">
                <button className="btn btn-sm" onClick={() => setEditing(s)}>
                  Editar
                </button>
                <button className="btn btn-sm" onClick={() => setRunning(s)}>
                  Ejecutar para un contacto
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>
                  Eliminar
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <Editor
          kind={tab}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            list.reload()
          }}
        />
      )}
      {running && <RunModal sequence={running} onClose={() => setRunning(null)} />}
    </Page>
  )
}

function TargetSelect({ value, steps, self, onChange, label }: { value: string; steps: UiStep[]; self: string; onChange: (v: string) => void; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} style={{ minWidth: 150 }}>
      <option value="">→ siguiente paso</option>
      <option value={END}>→ terminar</option>
      {steps.map((s, i) =>
        s.uid === self ? null : (
          <option key={s.uid} value={s.uid}>
            → paso {i + 1}: {ACTIONS[s.action] ?? s.action}
          </option>
        ),
      )}
    </select>
  )
}

const COND_TYPES: Record<string, string> = { label: 'Etiqueta', field: 'Campo', message: 'Mensaje del cliente', hours: 'Horario', window: 'Ventana 24 h' }
const COND_OPS: Record<string, [string, string][]> = {
  label: [['has', 'tiene'], ['not_has', 'no tiene']],
  field: [['eq', 'es igual a'], ['neq', 'distinto de'], ['contains', 'contiene'], ['gt', 'mayor que'], ['lt', 'menor que'], ['exists', 'tiene valor'], ['empty', 'está vacío']],
  message: [['contains', 'contiene'], ['eq', 'es igual a'], ['starts', 'empieza por']],
  hours: [['open', 'abierto'], ['closed', 'cerrado']],
  window: [['inside', 'dentro'], ['outside', 'fuera']],
}

function StepFields({ step, steps, index, update }: { step: UiStep; steps: UiStep[]; index: number; update: (patch: Partial<UiStep>) => void }) {
  const p = step.params
  const set = (patch: Record<string, unknown>) => update({ params: { ...p, ...patch } })
  const setAt = (key: 'buttons' | 'rows' | 'conditions', i: number, patch: Record<string, unknown>) =>
    set({ [key]: (p[key] ?? []).map((x: Record<string, unknown>, idx: number) => (idx === i ? { ...x, ...patch } : x)) })
  const fieldsDef = useAsync(() => api<{ key: string; label: string }[]>('/api/custom-fields'))
  const labels = useAsync(() => api<{ name: string }[]>('/api/labels'))
  const sequences = useAsync(() => api<Sequence[]>('/api/sequences?kind=sequence'))
  const team = useAsync(() => api<{ id: string; name: string }[]>('/api/team'))

  const fieldInput = (key: string, value: string, onChange: (v: string) => void) => (
    <>
      <input list={`fields-${step.uid}-${key}`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="campo (p. ej. ciudad)" />
      <datalist id={`fields-${step.uid}-${key}`}>
        {fieldsDef.data?.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </datalist>
    </>
  )
  const labelInput = (value: string, onChange: (v: string) => void) => (
    <>
      <input list={`labels-${step.uid}`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="etiqueta" />
      <datalist id={`labels-${step.uid}`}>{labels.data?.map((l) => <option key={l.name} value={l.name} />)}</datalist>
    </>
  )

  switch (step.action) {
    case 'send_text':
      return <textarea style={{ minHeight: 60 }} placeholder="Mensaje. Variables: {{name}}, {{phone}}, {{campo}}" value={p.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
    case 'send_media':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <div className="row">
            <select style={{ width: 130 }} value={p.kind ?? 'image'} onChange={(e) => set({ kind: e.target.value })}>
              <option value="image">Imagen</option>
              <option value="document">Documento</option>
              <option value="video">Vídeo</option>
              <option value="audio">Audio</option>
            </select>
            <input className="grow" placeholder="URL pública https://…" value={p.url ?? ''} onChange={(e) => set({ url: e.target.value })} />
          </div>
          <input placeholder="Texto (opcional)" value={p.caption ?? ''} onChange={(e) => set({ caption: e.target.value })} />
        </div>
      )
    case 'send_template':
      return (
        <div className="row">
          <input className="grow" placeholder="Nombre de la plantilla" value={p.templateName ?? ''} onChange={(e) => set({ templateName: e.target.value })} />
          <input style={{ width: 70 }} placeholder="es" value={p.language ?? 'es'} onChange={(e) => set({ language: e.target.value })} />
        </div>
      )
    case 'send_buttons':
    case 'send_list': {
      const key = step.action === 'send_buttons' ? 'buttons' : 'rows'
      const items: { title?: string; next?: string }[] = p[key] ?? []
      const max = key === 'buttons' ? 3 : 10
      return (
        <div className="grid" style={{ gap: 6 }}>
          <textarea style={{ minHeight: 50 }} placeholder="Pregunta" value={p.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
          {key === 'rows' && <input placeholder="Texto del botón de la lista" value={p.buttonText ?? ''} onChange={(e) => set({ buttonText: e.target.value })} />}
          {items.map((it, i) => (
            <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
              <input className="grow" maxLength={key === 'buttons' ? 20 : 24} placeholder={`Opción ${i + 1}`} value={it.title ?? ''} onChange={(e) => setAt(key, i, { title: e.target.value })} />
              <TargetSelect label={`Destino de la opción ${i + 1}`} value={it.next ?? ''} steps={steps} self={step.uid} onChange={(v) => setAt(key, i, { next: v })} />
              <button className="icon-btn" aria-label="Quitar opción" onClick={() => set({ [key]: items.filter((_, idx) => idx !== i) })}>
                ✕
              </button>
            </div>
          ))}
          {items.length < max && (
            <button className="btn btn-sm" style={{ width: 'fit-content' }} onClick={() => set({ [key]: [...items, { title: '', next: '' }] })}>
              + Opción
            </button>
          )}
        </div>
      )
    }
    case 'ask':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <textarea style={{ minHeight: 50 }} placeholder="Pregunta al cliente" value={p.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
          <div className="row">
            <div className="grow">{fieldInput('ask', p.field ?? '', (v) => set({ field: v }))}</div>
            <select style={{ width: 130 }} value={p.validate ?? 'text'} onChange={(e) => set({ validate: e.target.value })} aria-label="Validación">
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="email">Email</option>
              <option value="phone">Teléfono</option>
            </select>
          </div>
          <input placeholder="Mensaje si la respuesta no es válida" value={p.errorText ?? ''} onChange={(e) => set({ errorText: e.target.value })} />
          <div className="row">
            <span className="muted">Al recibir la respuesta:</span>
            <TargetSelect label="Destino tras la respuesta" value={p.next ?? ''} steps={steps} self={step.uid} onChange={(v) => set({ next: v })} />
          </div>
        </div>
      )
    case 'condition': {
      const conds: { type?: string; key?: string; op?: string; value?: string }[] = p.conditions ?? []
      return (
        <div className="grid" style={{ gap: 6 }}>
          <div className="row">
            <span>Se cumple</span>
            <select style={{ width: 120 }} value={p.match ?? 'all'} onChange={(e) => set({ match: e.target.value })}>
              <option value="all">todas</option>
              <option value="any">alguna</option>
            </select>
            <span>de estas condiciones:</span>
          </div>
          {conds.map((c, i) => (
            <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
              <select style={{ width: 150 }} value={c.type ?? 'label'} onChange={(e) => setAt('conditions', i, { type: e.target.value, op: COND_OPS[e.target.value][0][0], key: '', value: '' })} aria-label="Tipo">
                {Object.entries(COND_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {c.type === 'field' && <input style={{ width: 120 }} placeholder="campo" value={c.key ?? ''} onChange={(e) => setAt('conditions', i, { key: e.target.value })} />}
              <select style={{ width: 130 }} value={c.op ?? COND_OPS[c.type ?? 'label'][0][0]} onChange={(e) => setAt('conditions', i, { op: e.target.value })} aria-label="Operador">
                {COND_OPS[c.type ?? 'label'].map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {['label', 'field', 'message'].includes(c.type ?? 'label') && !['exists', 'empty'].includes(c.op ?? '') && (
                <input className="grow" placeholder="valor" value={c.value ?? ''} onChange={(e) => setAt('conditions', i, { value: e.target.value })} />
              )}
              <button className="icon-btn" aria-label="Quitar condición" onClick={() => set({ conditions: conds.filter((_, idx) => idx !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-sm" style={{ width: 'fit-content' }} onClick={() => set({ conditions: [...conds, { type: 'label', op: 'has', value: '' }] })}>
            + Condición
          </button>
          <div className="row">
            <strong>Si se cumple</strong>
            <TargetSelect label="Si se cumple" value={p.then ?? ''} steps={steps} self={step.uid} onChange={(v) => set({ then: v })} />
            <strong>Si no</strong>
            <TargetSelect label="Si no se cumple" value={p.else ?? ''} steps={steps} self={step.uid} onChange={(v) => set({ else: v })} />
          </div>
        </div>
      )
    }
    case 'wait':
      return (
        <div className="row">
          <input type="number" min={0} style={{ width: 90 }} value={step.delayDays} onChange={(e) => update({ delayDays: Number(e.target.value) })} aria-label="Días" /> días
          <input type="number" min={0} style={{ width: 90 }} value={p.minutes ?? 0} onChange={(e) => set({ minutes: Number(e.target.value) })} aria-label="Minutos" /> min
        </div>
      )
    case 'http_request':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select style={{ width: 100 }} value={p.method ?? 'GET'} onChange={(e) => set({ method: e.target.value })}>
              {['GET', 'POST', 'PUT', 'PATCH'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input className="grow" placeholder="https://api.ejemplo.com/pedido/{{phone}}" value={p.url ?? ''} onChange={(e) => set({ url: e.target.value })} />
          </div>
          {p.method && p.method !== 'GET' && <textarea style={{ minHeight: 50 }} placeholder='Cuerpo JSON, p. ej. {"phone":"{{phone}}"}' value={typeof p.body === 'string' ? p.body : ''} onChange={(e) => set({ body: e.target.value })} />}
          <div className="row">
            <input style={{ width: 160 }} placeholder="ruta de la respuesta (data.estado)" value={p.savePath ?? ''} onChange={(e) => set({ savePath: e.target.value })} />
            <span>→ guardar en</span>
            <div style={{ width: 170 }}>{fieldInput('http', p.saveField ?? '', (v) => set({ saveField: v }))}</div>
          </div>
        </div>
      )
    case 'set_field':
      return (
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <div style={{ width: 200 }}>{fieldInput('set', p.field ?? '', (v) => set({ field: v }))}</div>
          <span>=</span>
          <input className="grow" placeholder="valor (admite {{variables}})" value={p.value ?? ''} onChange={(e) => set({ value: e.target.value })} />
        </div>
      )
    case 'add_label':
    case 'remove_label':
      return labelInput(p.label ?? '', (v) => set({ label: v }))
    case 'assign_human':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <select value={p.member ?? ''} onChange={(e) => set({ member: e.target.value })} aria-label="Miembro">
            <option value="">Cualquier persona del equipo</option>
            {team.data?.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <input placeholder="Mensaje al cliente (opcional): Te paso con una persona…" value={p.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
        </div>
      )
    case 'enroll_sequence':
      return (
        <select value={p.sequenceId ?? ''} onChange={(e) => set({ sequenceId: e.target.value })} aria-label="Secuencia">
          <option value="">Elige una secuencia…</option>
          {sequences.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )
    case 'goto':
      return <TargetSelect label="Ir a" value={p.to ?? ''} steps={steps} self={step.uid} onChange={(v) => set({ to: v })} />
    default:
      return <span className="muted">Termina el flujo aquí.{index === 0 ? '' : ''}</span>
  }
}

function Editor({ kind, initial, onClose, onSaved }: { kind: 'sequence' | 'flow'; initial: Sequence | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [keyword, setKeyword] = useState(initial?.triggerKeyword ?? '')
  const [triggerLabel, setTriggerLabel] = useState(initial?.triggerLabel ?? '')
  const [stopOnReply, setStopOnReply] = useState(initial?.stopOnReply ?? true)
  const [steps, setSteps] = useState<UiStep[]>(
    initial ? fromServer(initial.steps) : [{ uid: uid(), action: kind === 'flow' ? 'send_text' : 'send_text', delayDays: 0, params: { body: '' } }],
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (i: number, patch: Partial<UiStep>) => setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const copy = [...steps]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    setSteps(copy)
  }
  const remove = (i: number) => {
    const gone = steps[i].uid
    // Quita las referencias a un paso eliminado para no dejar ramas rotas
    setSteps(
      steps
        .filter((_, idx) => idx !== i)
        .map((s) => {
          const copy = { ...s, params: structuredClone(s.params) }
          eachTarget(copy, (h, k) => {
            if (h[k] === gone) h[k] = ''
          })
          return copy
        }),
    )
  }

  async function save() {
    setBusy(true)
    setError('')
    const payload = {
      name,
      kind,
      triggerKeyword: kind === 'flow' ? keyword.trim() : null,
      triggerLabel: kind === 'sequence' ? triggerLabel.trim() || null : null,
      stopOnReply,
      steps: toServer(steps),
    }
    try {
      if (initial) await api(`/api/sequences/${initial.id}`, { method: 'PATCH', body: payload })
      else await api('/api/sequences', { body: payload })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={initial ? 'Editar' : kind === 'flow' ? 'Nuevo flujo' : 'Nueva secuencia'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !name.trim() || steps.length === 0 || (kind === 'flow' && !keyword.trim())}>
            Guardar
          </button>
        </>
      }
    >
      <ErrorNote message={error} />
      <Field label="Nombre">
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      {kind === 'flow' && (
        <Field label="Palabra clave" hint="El flujo se dispara cuando el mensaje del cliente contiene esta palabra.">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </Field>
      )}
      {kind === 'sequence' && (
        <>
          <Field label="Inscribir automáticamente al recibir la etiqueta (opcional)">
            <input value={triggerLabel} onChange={(e) => setTriggerLabel(e.target.value)} placeholder="p. ej. nuevo-lead" />
          </Field>
          <label className="check" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={stopOnReply} onChange={(e) => setStopOnReply(e.target.checked)} /> Detener la secuencia cuando el cliente responda
          </label>
        </>
      )}
      <h3 style={{ margin: '8px 0' }}>Pasos</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Los pasos se ejecutan en orden. Las ramas (botones, condiciones, «ir al paso») saltan al paso elegido; usa «terminar» para cortar una rama.
      </p>
      {steps.map((s, i) => (
        <div className="step" key={s.uid} style={{ gridTemplateColumns: '1fr', gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <Badge tone="blue">Paso {i + 1}</Badge>
              <select value={s.action} onChange={(e) => update(i, { action: e.target.value, params: {}, delayDays: 0 })} aria-label="Acción" style={{ width: 220 }}>
                {Object.entries(ACTIONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {s.action !== 'wait' && s.action !== 'end' && (
                <label className="muted" title="Espera antes de ejecutar este paso">
                  esperar{' '}
                  <input type="number" min={0} style={{ width: 64, padding: '4px 6px' }} value={s.delayDays} onChange={(e) => update(i, { delayDays: Number(e.target.value) })} aria-label="Días de espera" /> d
                </label>
              )}
            </div>
            <div className="row" style={{ gap: 2 }}>
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">
                ↑
              </button>
              <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Bajar">
                ↓
              </button>
              <button className="icon-btn" onClick={() => remove(i)} aria-label="Quitar paso">
                ✕
              </button>
            </div>
          </div>
          <StepFields step={s} steps={steps} index={i} update={(patch) => update(i, patch)} />
        </div>
      ))}
      <button className="btn btn-sm" onClick={() => setSteps([...steps, { uid: uid(), action: 'send_text', delayDays: 0, params: { body: '' } }])}>
        + Añadir paso
      </button>
      <p className="muted" style={{ marginBottom: 0 }}>
        Las esperas se reanudan con la tarea programada (cron) del servidor.
      </p>
    </Modal>
  )
}

function RunModal({ sequence, onClose }: { sequence: Sequence; onClose: () => void }) {
  const [phone, setPhone] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  async function run() {
    setError('')
    setResult('')
    try {
      await api(`/api/sequences/${sequence.id}/trigger`, { body: { phone: phone.replace(/[^\d]/g, '') } })
      setResult('Ejecutado. Revisa la bandeja: si WhatsApp no está conectado (ni el modo simulación activo), los mensajes quedan como fallidos.')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Modal
      title={`Ejecutar "${sequence.name}"`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={run} disabled={phone.replace(/[^\d]/g, '').length < 7}>
          Ejecutar
        </button>
      }
    >
      <ErrorNote message={error} />
      {result && <div className="ok-note">{result}</div>}
      <Field label="Teléfono del contacto" hint="El contacto debe existir en Contactos.">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoFocus />
      </Field>
    </Modal>
  )
}
