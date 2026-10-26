import { useState } from 'react'
import { api } from '../api'
import type { Sequence, Step } from '../api'
import { Badge, Card, Empty, ErrorNote, Field, Modal, Page, useAsync } from '../ui'

const ACTIONS: Record<string, string> = {
  send_text: 'Enviar texto',
  send_template: 'Enviar plantilla',
  wait: 'Esperar',
  add_label: 'Añadir etiqueta',
}

function describe(step: Step) {
  switch (step.action) {
    case 'send_text':
      return String(step.params.body ?? '').slice(0, 70) || '(vacío)'
    case 'send_template':
      return `Plantilla ${step.params.templateName ?? '?'}`
    case 'wait':
      return `${step.delayDays || 0} d ${step.params.minutes ? `+ ${step.params.minutes} min` : ''}`
    case 'add_label':
      return `Etiqueta ${step.params.label ?? '?'}`
    default:
      return step.action
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
      subtitle="Chatbots por palabra clave y campañas de goteo (drip)"
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
              ? 'Aún no hay flujos. Un flujo se dispara cuando un cliente escribe su palabra clave.'
              : 'Aún no hay secuencias. Una secuencia envía mensajes escalonados en el tiempo a un contacto.'}
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
                <Badge>{s.steps.length} pasos</Badge>
                {s.kind === 'sequence' && <Badge tone="green">{s._count?.enrollments ?? 0} inscritos</Badge>}
              </div>
              <ol style={{ paddingLeft: 18, margin: '0 0 12px' }}>
                {s.steps.map((st, i) => (
                  <li key={st.id ?? i}>
                    <strong>{ACTIONS[st.action] ?? st.action}</strong> <span className="muted">· {describe(st)}</span>
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

function Editor({ kind, initial, onClose, onSaved }: { kind: 'sequence' | 'flow'; initial: Sequence | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [keyword, setKeyword] = useState(initial?.triggerKeyword ?? '')
  const [steps, setSteps] = useState<Step[]>(initial?.steps ?? [{ action: 'send_text', params: { body: '' }, delayDays: 0, order: 0 }])
  const [error, setError] = useState('')

  const update = (i: number, patch: Partial<Step>) => setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const setParam = (i: number, key: string, value: unknown) => update(i, { params: { ...steps[i].params, [key]: value } })

  async function save() {
    const payload = {
      name,
      kind,
      triggerKeyword: kind === 'flow' ? keyword.trim() : null,
      steps: steps.map((s, order) => ({ action: s.action, params: s.params, delayDays: s.delayDays, order })),
    }
    try {
      if (initial) await api(`/api/sequences/${initial.id}`, { method: 'PATCH', body: payload })
      else await api('/api/sequences', { body: payload })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
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
          <button className="btn btn-primary" onClick={save} disabled={!name.trim() || steps.length === 0 || (kind === 'flow' && !keyword.trim())}>
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
      <h3 style={{ margin: '8px 0' }}>Pasos</h3>
      {steps.map((s, i) => (
        <div className="step" key={i}>
          <select value={s.action} onChange={(e) => update(i, { action: e.target.value, params: {}, delayDays: 0 })} aria-label="Acción">
            {Object.entries(ACTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <div>
            {s.action === 'send_text' && <textarea style={{ minHeight: 60 }} placeholder="Mensaje" value={s.params.body ?? ''} onChange={(e) => setParam(i, 'body', e.target.value)} />}
            {s.action === 'send_template' && (
              <div className="row">
                <input className="grow" placeholder="Nombre de la plantilla" value={s.params.templateName ?? ''} onChange={(e) => setParam(i, 'templateName', e.target.value)} />
                <input style={{ width: 70 }} placeholder="es" value={s.params.language ?? 'es'} onChange={(e) => setParam(i, 'language', e.target.value)} />
              </div>
            )}
            {s.action === 'wait' && (
              <div className="row">
                <input type="number" min={0} style={{ width: 90 }} value={s.delayDays} onChange={(e) => update(i, { delayDays: Number(e.target.value) })} aria-label="Días" /> días
                <input type="number" min={0} style={{ width: 90 }} value={s.params.minutes ?? 0} onChange={(e) => setParam(i, 'minutes', Number(e.target.value))} aria-label="Minutos" /> min
              </div>
            )}
            {s.action === 'add_label' && <input placeholder="Etiqueta" value={s.params.label ?? ''} onChange={(e) => setParam(i, 'label', e.target.value)} />}
          </div>
          <button className="icon-btn" onClick={() => setSteps(steps.filter((_, idx) => idx !== i))} aria-label="Quitar paso">
            ✕
          </button>
        </div>
      ))}
      <button className="btn btn-sm" onClick={() => setSteps([...steps, { action: 'send_text', params: { body: '' }, delayDays: 0, order: steps.length }])}>
        + Añadir paso
      </button>
      <p className="muted" style={{ marginBottom: 0 }}>
        Los pasos &quot;Esperar&quot; se reanudan con la tarea programada diaria (cron).
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
      setResult('Ejecutado. Revisa la bandeja: si WhatsApp no está conectado, los mensajes quedan como fallidos.')
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
