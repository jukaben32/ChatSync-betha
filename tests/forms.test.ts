import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  subscriber: { id: 's1', phone: '1809', name: 'Ana', email: null as string | null, customFields: {} as Record<string, unknown>, blocked: false, optedOut: false },
  labels: new Set<string>(),
  sessions: [] as Array<{ id: string; subscriberId: string; sequenceId: string; awaitingOrder: number; status: string }>,
  sent: [] as Array<Record<string, any>>,
  submissions: [] as Array<{ formId: string; answers: Record<string, unknown> }>,
  events: [] as string[],
  form: null as null | { id: string; name: string; doneMessage: string; labelOnDone: string | null; questions: unknown[] },
  flow: null as null | { id: string; name: string; steps: any[] },
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    subscriber: {
      findUnique: async () => db.subscriber,
      update: async ({ data }: any) => {
        if (data.customFields) db.subscriber.customFields = data.customFields;
        return db.subscriber;
      },
    },
    form: { findUnique: async () => db.form },
    formSubmission: { create: async ({ data }: any) => db.submissions.push({ formId: data.formId, answers: data.answers }) },
    subscriberLabel: { count: async () => 0 },
    scheduledJob: { create: async () => undefined },
    conversation: { update: async () => ({}) },
    flowSession: {
      updateMany: async () => {
        db.sessions.forEach((s) => (s.status = 'done'));
      },
      create: async ({ data }: any) => db.sessions.push({ id: `fs${db.sessions.length + 1}`, status: 'active', ...data }),
      findUnique: async ({ where }: any) => {
        const s = db.sessions.find((x) => x.id === where.id);
        return s ? { ...s, sequence: { ...db.flow, steps: db.flow!.steps } } : null;
      },
      update: async ({ where, data }: any) => Object.assign(db.sessions.find((x) => x.id === where.id)!, data),
    },
  },
}));
vi.mock('../src/domain/messaging.js', () => ({
  sendMessage: async ({ content }: any) => {
    db.sent.push(content);
    return { ok: true, messageId: 'm' };
  },
  renderVars: (t: string) => t,
  getOrCreateConversation: async () => ({ id: 'c1' }),
  withinServiceWindow: async () => true,
}));
vi.mock('../src/domain/labels.js', () => ({
  addLabelWithTriggers: async (_id: string, name: string) => db.labels.add(name),
  removeLabel: async () => undefined,
}));
vi.mock('../src/domain/settings.js', () => ({ getSetting: async () => ({ enabled: false }), isOpenNow: () => true }));
vi.mock('../src/domain/events.js', () => ({ emitEvent: async (type: string) => db.events.push(type) }));

import { compileForm, normalizeQuestions, slugKey } from '../src/domain/forms.js';
import { normalizeDate, resumeFlowSession, runFlow } from '../src/flows/engine.js';

const texts = () => db.sent.filter((c) => c.type === 'text').map((c) => c.body);
const answer = (text: string, interactiveId?: string) => resumeFlowSession({ phone: '1809', sessionId: db.sessions[db.sessions.length - 1].id, text, interactiveId });

beforeEach(() => {
  db.subscriber.customFields = {};
  db.labels.clear();
  db.sessions.length = 0;
  db.sent.length = 0;
  db.submissions.length = 0;
  db.events.length = 0;
});

describe('fechas', () => {
  it('acepta DD/MM/AAAA, DD-MM-AAAA y AAAA-MM-DD y normaliza', () => {
    expect(normalizeDate('25/12/2026')).toBe('2026-12-25');
    expect(normalizeDate('5-1-2027')).toBe('2027-01-05');
    expect(normalizeDate('2026-02-03')).toBe('2026-02-03');
  });
  it('rechaza fechas imposibles o con otro formato', () => {
    expect(normalizeDate('31/02/2026')).toBeNull();
    expect(normalizeDate('2026/12/25')).toBeNull();
    expect(normalizeDate('mañana')).toBeNull();
  });
});

describe('definición de formularios', () => {
  it('genera claves únicas sin tildes', () => {
    expect(slugKey('Fecha de la cita')).toBe('fecha_de_la_cita');
    expect(slugKey('¿Cuántas personas?')).toBe('cuantas_personas');
    const q = normalizeQuestions([{ label: 'Nombre' }, { label: 'Nombre' }]);
    expect(q.map((x) => x.key)).toEqual(['nombre', 'nombre_2']);
  });
  it('valida las preguntas', () => {
    expect(() => normalizeQuestions([])).toThrow();
    expect(() => normalizeQuestions([{ label: '' }])).toThrow();
    expect(() => normalizeQuestions([{ label: 'Plan', type: 'choice', options: ['solo uno'] }])).toThrow(/2 opciones/);
    expect(() => normalizeQuestions([{ label: 'Plan', type: 'choice', options: Array.from({ length: 11 }, (_, i) => `o${i}`) }])).toThrow(/10 opciones/);
  });
  it('compila a botones (≤3), lista (>3) y preguntas con validación', () => {
    const questions = normalizeQuestions([
      { label: 'Nombre' },
      { label: 'Tipo', type: 'choice', options: ['A', 'B'] },
      { label: 'Ciudad', type: 'choice', options: ['a', 'b', 'c', 'd'] },
      { label: 'Edad', type: 'number', required: false },
    ]);
    const steps = compileForm({ id: 'f1', name: 'Registro', intro: null, questions });
    expect(steps.map((s) => s.action)).toEqual(['send_text', 'ask', 'send_buttons', 'send_list', 'ask', 'submit_form']);
    expect(String(steps[0].params.body)).toContain('cancelar');
    expect(steps[2].params.field).toBe('tipo');
    expect(steps[4].params).toMatchObject({ validate: 'number', optional: true, cancellable: true });
    expect(steps.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('ejecución de un formulario', () => {
  const setup = () => {
    const questions = normalizeQuestions([
      { label: 'Nombre completo' },
      { label: 'Fecha de la cita', type: 'date' },
      { label: 'Servicio', type: 'choice', options: ['Limpieza', 'Revisión'] },
      { label: 'Comentarios', required: false },
    ]);
    db.form = { id: 'f1', name: 'Reserva', doneMessage: '¡Listo, te esperamos!', labelOnDone: 'reservo', questions };
    db.flow = { id: 'seq1', name: 'Reserva', steps: compileForm({ id: 'f1', name: 'Reserva', intro: 'Reserva tu cita', questions }) };
  };

  it('recorre todas las preguntas, valida y guarda el envío', async () => {
    setup();
    const start = await runFlow({ phone: '1809', flow: db.flow! });
    expect(start.awaiting).toBe(true);
    expect(texts()[0]).toContain('Reserva tu cita');

    await answer('Ana Pérez');
    expect(db.subscriber.customFields.nombre_completo).toBe('Ana Pérez');

    await answer('mañana');
    expect(texts()).toContain('Escribe la fecha como DD/MM/AAAA, por ejemplo 25/12/2026.');
    expect(db.subscriber.customFields.fecha_de_la_cita).toBeUndefined();

    await answer('25/12/2026');
    expect(db.subscriber.customFields.fecha_de_la_cita).toBe('2026-12-25');
    expect(db.sent[db.sent.length - 1].type).toBe('buttons');

    await answer('Revisión', 'o3_1');
    expect(db.subscriber.customFields.servicio).toBe('Revisión');

    await answer('omitir');
    expect(db.submissions).toHaveLength(1);
    expect(db.submissions[0].answers).toEqual({ nombre_completo: 'Ana Pérez', fecha_de_la_cita: '2026-12-25', servicio: 'Revisión', comentarios: null });
    expect(texts()).toContain('¡Listo, te esperamos!');
    expect(db.labels.has('reservo')).toBe(true);
    expect(db.events).toContain('form.submitted');
  });

  it('«cancelar» abandona sin guardar nada', async () => {
    setup();
    await runFlow({ phone: '1809', flow: db.flow! });
    await answer('Ana');
    await answer('cancelar');
    expect(texts()).toContain('Formulario cancelado. Cuando quieras, puedes empezar de nuevo.');
    expect(db.submissions).toHaveLength(0);
    expect(db.sessions[db.sessions.length - 1].status).toBe('done');
  });
});
