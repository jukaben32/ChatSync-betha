import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Base de datos en memoria mínima para el motor de flujos ---
const db = vi.hoisted(() => ({
  subscriber: { id: 's1', phone: '1809', name: 'Ana', email: null as string | null, customFields: {} as Record<string, unknown>, blocked: false, optedOut: false },
  labels: new Set<string>(),
  jobs: [] as Array<{ sequenceId: string; resumeOrder: number; runAt: Date }>,
  sessions: [] as Array<{ id: string; subscriberId: string; sequenceId: string; awaitingOrder: number; status: string }>,
  sent: [] as Array<Record<string, any>>,
  sendOk: true,
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
    subscriberLabel: { count: async ({ where }: any) => (db.labels.has(where.label.name) ? 1 : 0) },
    scheduledJob: { create: async ({ data }: any) => db.jobs.push(data) },
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
    return { ok: db.sendOk, messageId: 'm', error: db.sendOk ? undefined : 'x' };
  },
  renderVars: (t: string) => t,
  getOrCreateConversation: async () => ({ id: 'c1' }),
  withinServiceWindow: async () => true,
}));
vi.mock('../src/domain/labels.js', () => ({
  addLabelWithTriggers: async (_id: string, name: string) => db.labels.add(name),
  removeLabel: async (_id: string, name: string) => db.labels.delete(name),
}));
vi.mock('../src/domain/settings.js', () => ({ getSetting: async () => ({ enabled: false }), isOpenNow: () => true }));

import { resumeFlowSession, runFlow } from '../src/flows/engine.js';

const flow = (steps: any[]) => {
  db.flow = { id: 'f1', name: 'test', steps };
  return db.flow;
};
const texts = () => db.sent.filter((c) => c.type === 'text').map((c) => c.body);

beforeEach(() => {
  db.subscriber.customFields = {};
  db.labels.clear();
  db.jobs.length = 0;
  db.sessions.length = 0;
  db.sent.length = 0;
  db.sendOk = true;
});

describe('motor de flujos', () => {
  it('ejecuta pasos en orden', async () => {
    const r = await runFlow({ phone: '1809', flow: flow([{ action: 'send_text', params: { body: 'uno' }, order: 0 }, { action: 'send_text', params: { body: 'dos' }, order: 1 }]) });
    expect(r.ok).toBe(true);
    expect(texts()).toEqual(['uno', 'dos']);
  });

  it('condition salta a then/else según un campo', async () => {
    const steps = [
      { action: 'condition', params: { conditions: [{ type: 'field', key: 'plan', op: 'eq', value: 'vip' }], then: 2, else: 4 }, order: 1 },
      { action: 'send_text', params: { body: 'hola vip' }, order: 2 },
      { action: 'end', order: 3 },
      { action: 'send_text', params: { body: 'hola normal' }, order: 4 },
    ];
    db.subscriber.customFields = { plan: 'VIP' };
    await runFlow({ phone: '1809', flow: flow(steps) });
    expect(texts()).toContain('hola vip');
    expect(texts()).not.toContain('hola normal');
  });

  it('condition por etiqueta con match any', async () => {
    db.labels.add('lead');
    const steps = [
      { action: 'condition', params: { match: 'any', conditions: [{ type: 'label', op: 'has', value: 'cliente' }, { type: 'label', op: 'has', value: 'lead' }], then: 5 }, order: 0 },
      { action: 'send_text', params: { body: 'no debería' }, order: 1 },
      { action: 'end', order: 4 },
      { action: 'send_text', params: { body: 'ok' }, order: 5 },
    ];
    await runFlow({ phone: '1809', flow: flow(steps) });
    expect(texts()).toEqual(['ok']);
  });

  it('wait programa un job y no bloquea', async () => {
    const r = await runFlow({
      phone: '1809',
      flow: flow([{ action: 'send_text', params: { body: 'a' }, order: 0 }, { action: 'wait', delayDays: 1, order: 1 }, { action: 'send_text', params: { body: 'b' }, order: 2 }]),
    });
    expect(r.scheduled).toBe(true);
    expect(texts()).toEqual(['a']);
    expect(db.jobs).toHaveLength(1);
    expect(db.jobs[0].resumeOrder).toBe(2);
    expect(db.jobs[0].runAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });

  it('al reanudar un job no vuelve a esperar y continúa', async () => {
    const f = flow([{ action: 'wait', delayDays: 1, order: 1 }, { action: 'send_text', params: { body: 'b' }, order: 2 }]);
    const r = await runFlow({ phone: '1809', flow: f, startOrder: 2, resuming: true });
    expect(r.scheduled).toBeUndefined();
    expect(texts()).toEqual(['b']);
  });

  it('un paso con delayDays se programa y al reanudar se ejecuta', async () => {
    const f = flow([{ action: 'send_text', params: { body: 'día 3' }, delayDays: 3, order: 0 }]);
    const first = await runFlow({ phone: '1809', flow: f });
    expect(first.scheduled).toBe(true);
    expect(db.jobs[0].resumeOrder).toBe(0);
    await runFlow({ phone: '1809', flow: f, startOrder: 0, resuming: true });
    expect(texts()).toEqual(['día 3']);
  });

  it('send_buttons espera y la respuesta enruta al paso indicado', async () => {
    const steps = [
      { action: 'send_buttons', params: { body: '¿Qué necesitas?', buttons: [{ title: 'Ventas', next: 10 }, { title: 'Soporte', next: 20 }] }, order: 0 },
      { action: 'send_text', params: { body: 'ventas' }, order: 10 },
      { action: 'end', order: 11 },
      { action: 'send_text', params: { body: 'soporte' }, order: 20 },
    ];
    const r = await runFlow({ phone: '1809', flow: flow(steps) });
    expect(r.awaiting).toBe(true);
    expect(db.sent[0].type).toBe('buttons');
    expect(db.sessions).toHaveLength(1);

    const res = await resumeFlowSession({ phone: '1809', sessionId: db.sessions[0].id, text: 'Soporte', interactiveId: 'o0_1' });
    expect(res.handled).toBe(true);
    expect(texts()).toEqual(['soporte']);
  });

  it('una respuesta que no coincide con ningún botón libera la sesión', async () => {
    flow([{ action: 'send_buttons', params: { body: 'x', buttons: [{ title: 'A' }] }, order: 0 }]);
    await runFlow({ phone: '1809', flow: db.flow! });
    const res = await resumeFlowSession({ phone: '1809', sessionId: db.sessions[0].id, text: 'otra cosa' });
    expect(res.handled).toBe(false);
    expect(db.sessions[0].status).toBe('done');
  });

  it('ask valida, guarda el dato y continúa', async () => {
    const steps = [
      { action: 'ask', params: { body: '¿Cuántas personas?', field: 'personas', validate: 'number', errorText: 'Solo números' }, order: 0 },
      { action: 'send_text', params: { body: 'gracias' }, order: 1 },
    ];
    await runFlow({ phone: '1809', flow: flow(steps) });
    const id = db.sessions[0].id;

    const bad = await resumeFlowSession({ phone: '1809', sessionId: id, text: 'muchas' });
    expect(bad.handled).toBe(true);
    expect(texts()).toContain('Solo números');
    expect(db.subscriber.customFields.personas).toBeUndefined();
    expect(db.sessions[0].status).toBe('active');

    await resumeFlowSession({ phone: '1809', sessionId: id, text: '4' });
    expect(db.subscriber.customFields.personas).toBe(4);
    expect(texts()).toContain('gracias');
    expect(db.sessions[0].status).toBe('done');
  });

  it('si el envío falla no deja la sesión esperando', async () => {
    db.sendOk = false;
    const r = await runFlow({ phone: '1809', flow: flow([{ action: 'ask', params: { body: '?', field: 'x' }, order: 0 }]) });
    expect(r.ok).toBe(false);
    expect(db.sessions).toHaveLength(0);
  });

  it('un goto en bucle termina por el límite de pasos', async () => {
    const r = await runFlow({ phone: '1809', flow: flow([{ action: 'goto', params: { to: 0 }, order: 0 }]) });
    expect(r.ok).toBe(true);
    expect(r.executed.length).toBeLessThanOrEqual(100);
  });

  it('add_label y set_field actualizan el contacto', async () => {
    await runFlow({
      phone: '1809',
      flow: flow([{ action: 'add_label', params: { label: 'interesado' }, order: 0 }, { action: 'set_field', params: { field: 'ciudad', value: 'Santiago' }, order: 1 }]),
    });
    expect(db.labels.has('interesado')).toBe(true);
    expect(db.subscriber.customFields.ciudad).toBe('Santiago');
  });
});
