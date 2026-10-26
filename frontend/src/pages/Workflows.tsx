import { useState } from 'react'
import { api } from '../api'
import type { Sequence, Template } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

interface Condition {
  path: string
  op: string
  value?: string
}

interface Workflow {
  id: string
  name: string
  token: string
  phonePath: string
  templateName: string | null
  language: string
  text: string | null
  variables: Record<string, string>
  conditions: Condition[]
  delayMinutes: number
  actions: { labels?: string[]; sequenceId?: string; assignTo?: string }
  active: boolean
  detectedFields: string[]
}

export default function Workflows() {
  const list = useAsync(() => api<Workflow[]>('/api/workflows'))
  const [editing, setEditing] = useState<Workflow | 'new' | null>(null)
  const [copied, setCopied] = useState('')
  const origin = window.location.origin

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      /* portapapeles no disponible */
    }
  }

  async function toggle(w: Workflow) {
    await api(`/api/workflows/${w.id}`, { method: 'PATCH', body: { active: !w.active } })
    list.reload()
  }
  async function remove(w: Workflow) {
    if (!confirm(`Eliminar "${w.name}"? La URL dejará de funcionar.`)) return
    await api(`/api/workflows/${w.id}`, { method: 'DELETE' })
    list.reload()
  }

  return (
    <Page
      title="Webhook Workflows"
      subtitle="Cualquier app (Shopify, n8n, Zapier, tu código) envía un evento a una URL y ChatSyncs manda el WhatsApp"
      actions={
        <>
          <button className="btn" onClick={list.reload}>
            Actualizar
          </button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + Nuevo workflow
          </button>
        </>
      }
    >
      <ErrorNote message={list.error} />
      {list.data?.length === 0 ? (
        <Card>
          <Empty>
            Aún no hay workflows. Crea uno, copia su URL en la herramienta que genera el evento, envía un ejemplo y pulsa «Actualizar»: ChatSyncs detecta los campos para que los mapees.
          </Empty>
        </Card>
      ) : (
        list.data?.map((w) => {
          const url = `${origin}/api/hooks/${w.token}`
          return (
            <Card
              key={w.id}
              title={w.name}
              actions={
                <label className="check">
                  <input type="checkbox" checked={w.active} onChange={() => toggle(w)} /> Activo
                </label>
              }
            >
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="mono grow" style={{ wordBreak: 'break-all' }}>
                  POST {url}
                </span>
                <button className="btn btn-sm" onClick={() => copy(url, w.id)}>
                  {copied === w.id ? '✓ Copiada' : 'Copiar URL'}
                </button>
              </div>
              <div className="row" style={{ marginBottom: 8 }}>
                <Badge tone="blue">Teléfono: {w.phonePath}</Badge>
                {w.templateName ? <Badge tone="green">Plantilla {w.templateName}</Badge> : w.text ? <Badge tone="green">Texto</Badge> : <Badge>Solo acciones</Badge>}
                {w.conditions.length > 0 && <Badge tone="amber">{w.conditions.length} condición(es)</Badge>}
                {w.delayMinutes > 0 && <Badge>Retraso {w.delayMinutes} min</Badge>}
                {w.actions.labels?.map((l) => (
                  <Badge key={l} tone="green">
                    +{l}
                  </Badge>
                ))}
              </div>
              {w.detectedFields.length > 0 ? (
                <p className="muted" style={{ margin: '0 0 8px' }}>
                  Campos detectados: <span className="mono">{w.detectedFields.slice(0, 12).join(', ')}</span>
                  {w.detectedFields.length > 12 ? '…' : ''}
                </p>
              ) : (
                <p className="muted" style={{ margin: '0 0 8px' }}>
                  Aún no ha recibido ningún evento de ejemplo.
                </p>
              )}
              <div className="row">
                <button className="btn btn-sm" onClick={() => setEditing(w)}>
                  Editar
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(w)}>
                  Eliminar
                </button>
              </div>
            </Card>
          )
        })
      )}
      {editing && (
        <WorkflowEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            list.reload()
          }}
        />
      )}
    </Page>
  )
}

function WorkflowEditor({ initial, onClose, onSaved }: { initial: Workflow | null; onClose: () => void; onSaved: () => void }) {
  const templates = useAsync(() => api<Template[]>('/api/templates'))
  const sequences = useAsync(() => api<Sequence[]>('/api/sequences?kind=sequence'))
  const team = useAsync(() => api<{ id: string; name: string }[]>('/api/team'))
  const fields = initial?.detectedFields ?? []

  const [name, setName] = useState(initial?.name ?? '')
  const [phonePath, setPhonePath] = useState(initial?.phonePath ?? 'phone')
  const [mode, setMode] = useState<'template' | 'text' | 'none'>(initial?.templateName ? 'template' : initial?.text ? 'text' : initial ? 'none' : 'template')
  const [templateName, setTemplateName] = useState(initial?.templateName ?? '')
  const [language, setLanguage] = useState(initial?.language ?? 'es')
  const [variables, setVariables] = useState<[string, string][]>(Object.entries(initial?.variables ?? {}).length ? Object.entries(initial!.variables) : [['1', '']])
  const [text, setText] = useState(initial?.text ?? '')
  const [conditions, setConditions] = useState<Condition[]>(initial?.conditions ?? [])
  const [delay, setDelay] = useState(initial?.delayMinutes ?? 0)
  const [labels, setLabels] = useState((initial?.actions.labels ?? []).join(', '))
  const [sequenceId, setSequenceId] = useState(initial?.actions.sequenceId ?? '')
  const [assignTo, setAssignTo] = useState(initial?.actions.assignTo ?? '')
  const [error, setError] = useState('')

  const pathInput = (value: string, onChange: (v: string) => void, placeholder = 'ruta.del.campo') => (
    <>
      <input list="detected-fields" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <datalist id="detected-fields">{fields.map((f) => <option key={f} value={f} />)}</datalist>
    </>
  )

  async function save() {
    const body = {
      name,
      phonePath,
      templateName: mode === 'template' ? templateName : '',
      language,
      text: mode === 'text' ? text : '',
      variables: Object.fromEntries(variables.filter(([, p]) => p).map(([k, p]) => [k, p])),
      conditions: conditions.filter((c) => c.path),
      delayMinutes: delay,
      actions: {
        labels: labels.split(',').map((l) => l.trim()).filter(Boolean),
        sequenceId: sequenceId || undefined,
        assignTo: assignTo || undefined,
      },
    }
    try {
      if (initial) await api(`/api/workflows/${initial.id}`, { method: 'PATCH', body })
      else await api('/api/workflows', { body })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const approved = templates.data?.filter((t) => t.status === 'approved') ?? []

  return (
    <Modal
      title={initial ? 'Editar workflow' : 'Nuevo workflow'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim() || !phonePath.trim() || (mode === 'template' && !templateName.trim()) || (mode === 'text' && !text.trim())}>
            Guardar
          </button>
        </>
      }
    >
      <ErrorNote message={error} />
      <Field label="Nombre">
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Campo con el teléfono del cliente" hint={fields.length ? 'Elige uno de los campos detectados.' : 'Cuando recibas un evento de ejemplo aparecerán aquí los campos.'}>
        {pathInput(phonePath, setPhonePath, 'customer.phone')}
      </Field>

      <h3 style={{ margin: '8px 0' }}>Solo cuando…</h3>
      {conditions.map((c, i) => (
        <div className="row" key={i} style={{ flexWrap: 'nowrap', marginBottom: 6 }}>
          <div className="grow">{pathInput(c.path, (v) => setConditions(conditions.map((x, idx) => (idx === i ? { ...x, path: v } : x))))}</div>
          <select style={{ width: 130 }} value={c.op} onChange={(e) => setConditions(conditions.map((x, idx) => (idx === i ? { ...x, op: e.target.value } : x)))} aria-label="Operador">
            <option value="eq">es igual a</option>
            <option value="neq">distinto de</option>
            <option value="contains">contiene</option>
            <option value="gt">mayor que</option>
            <option value="lt">menor que</option>
            <option value="exists">existe</option>
          </select>
          {c.op !== 'exists' && <input style={{ width: 130 }} placeholder="valor" value={c.value ?? ''} onChange={(e) => setConditions(conditions.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))} />}
          <button className="icon-btn" aria-label="Quitar condición" onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => setConditions([...conditions, { path: '', op: 'eq', value: '' }])}>
        + Condición
      </button>

      <h3 style={{ margin: '8px 0' }}>Mensaje de WhatsApp</h3>
      <Field label="Qué enviar">
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="template">Plantilla aprobada (recomendado)</option>
          <option value="text">Texto libre (solo si el cliente escribió en las últimas 24 h)</option>
          <option value="none">Nada: solo ejecutar acciones</option>
        </select>
      </Field>
      {mode === 'template' && (
        <>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <div className="grow">
              <Field label="Plantilla">
                <input list="tpl-names" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="order_confirmation" />
                <datalist id="tpl-names">{approved.map((t) => <option key={t.id} value={t.name} />)}</datalist>
              </Field>
            </div>
            <div style={{ width: 80 }}>
              <Field label="Idioma">
                <input value={language} onChange={(e) => setLanguage(e.target.value)} />
              </Field>
            </div>
          </div>
          <Field label="Variables de la plantilla" hint="Cada {{n}} de la plantilla toma el valor de un campo del evento.">
            <div className="grid" style={{ gap: 6 }}>
              {variables.map(([k, p], i) => (
                <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
                  <span className="mono" style={{ width: 54 }}>{`{{${k}}}`}</span>
                  <div className="grow">{pathInput(p, (v) => setVariables(variables.map((x, idx) => (idx === i ? [x[0], v] : x))))}</div>
                  <button className="icon-btn" aria-label="Quitar variable" onClick={() => setVariables(variables.filter((_, idx) => idx !== i))}>
                    ✕
                  </button>
                </div>
              ))}
              <button className="btn btn-sm" style={{ width: 'fit-content' }} onClick={() => setVariables([...variables, [String(variables.length + 1), '']])}>
                + Variable
              </button>
            </div>
          </Field>
        </>
      )}
      {mode === 'text' && (
        <Field label="Texto" hint="Usa {{ruta.del.campo}} para insertar datos del evento.">
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}
      {mode !== 'none' && (
        <Field label="Retrasar el mensaje (minutos)">
          <input type="number" min={0} value={delay} onChange={(e) => setDelay(Number(e.target.value))} style={{ width: 120 }} />
        </Field>
      )}

      <h3 style={{ margin: '8px 0' }}>Acciones sobre el contacto</h3>
      <Field label="Añadir etiquetas (separadas por coma)">
        <input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="cliente, pagado" />
      </Field>
      <div className="grid grid-2">
        <Field label="Inscribir en secuencia">
          <select value={sequenceId} onChange={(e) => setSequenceId(e.target.value)}>
            <option value="">Ninguna</option>
            {sequences.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Asignar la conversación a">
          <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="">Nadie</option>
            {team.data?.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  )
}
