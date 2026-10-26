import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  cfg: { enabled: true, afterHours: 4, maxNudges: 2, message: 'Hola {{name}}, ¿sigues interesado?', useAi: false },
  conversations: [] as any[],
  lastMessage: {} as Record<string, any>,
  windowOpen: true,
  sendOk: true,
  sent: [] as Array<{ phone: string; body: string; sender?: string }>,
  updates: [] as Array<{ id: string; nudges: any }>,
  queries: [] as any[],
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    conversation: {
      findMany: async (args: any) => {
        db.queries.push(args);
        return db.conversations;
      },
      update: async ({ where, data }: any) => db.updates.push({ id: where.id, nudges: data.nudges }),
    },
    message: { findFirst: async ({ where }: any) => db.lastMessage[where.conversationId] ?? null, findMany: async () => [] },
  },
}));
vi.mock('../src/domain/settings.js', () => ({ getSetting: async () => db.cfg }));
vi.mock('../src/domain/messaging.js', () => ({
  withinServiceWindow: async () => db.windowOpen,
  sendMessage: async ({ phone, content, sender }: any) => {
    db.sent.push({ phone, body: content.body, sender });
    return { ok: db.sendOk, messageId: 'm' };
  },
}));
vi.mock('../src/ai/agent.js', () => ({ agentReady: () => false, composeNudge: async () => '' }));

import { processSmartFollowUps } from '../src/domain/followups.js';

const conv = (id: string, name = 'Ana') => ({ id, subscriberId: `s-${id}`, subscriber: { phone: `18090000${id}`, name } });

beforeEach(() => {
  db.cfg = { enabled: true, afterHours: 4, maxNudges: 2, message: 'Hola {{name}}, ¿sigues interesado?', useAi: false };
  db.conversations = [];
  db.lastMessage = {};
  db.windowOpen = true;
  db.sendOk = true;
  db.sent.length = 0;
  db.updates.length = 0;
  db.queries.length = 0;
});

describe('seguimientos inteligentes', () => {
  it('no hace nada si están desactivados', async () => {
    db.cfg.enabled = false;
    db.conversations = [conv('1')];
    expect(await processSmartFollowUps()).toMatchObject({ enabled: false, sent: 0 });
    expect(db.queries).toHaveLength(0);
  });

  it('busca solo conversaciones abiertas, del bot, dentro de la ventana y sin agotar recordatorios', async () => {
    const now = new Date('2026-10-26T12:00:00Z');
    await processSmartFollowUps(now);
    const where = db.queries[0].where;
    expect(where).toMatchObject({ status: 'open', assignedTo: null, nudges: { lt: 2 }, subscriber: { blocked: false, optedOut: false } });
    expect(where.updatedAt.lt.toISOString()).toBe('2026-10-26T08:00:00.000Z'); // hace 4 h
    expect(where.updatedAt.gt.toISOString()).toBe('2026-10-25T13:00:00.000Z'); // hace 23 h (margen sobre las 24 h)
  });

  it('envía el recordatorio con el nombre cuando el último mensaje fue del negocio', async () => {
    db.conversations = [conv('1', 'Luis')];
    db.lastMessage['1'] = { direction: 'outbound', status: 'sent' };
    const r = await processSmartFollowUps();
    expect(r.sent).toBe(1);
    expect(db.sent[0]).toMatchObject({ phone: '180900001', body: 'Hola Luis, ¿sigues interesado?', sender: 'smart_followup' });
    expect(db.updates[0]).toEqual({ id: '1', nudges: { increment: 1 } });
  });

  it('no molesta si el último mensaje es del cliente, falló, o no hay mensajes', async () => {
    db.conversations = [conv('1'), conv('2'), conv('3')];
    db.lastMessage['1'] = { direction: 'inbound', status: 'received' };
    db.lastMessage['2'] = { direction: 'outbound', status: 'failed' };
    const r = await processSmartFollowUps();
    expect(r.sent).toBe(0);
    expect(db.sent).toHaveLength(0);
  });

  it('respeta la ventana de 24 h de WhatsApp', async () => {
    db.conversations = [conv('1')];
    db.lastMessage['1'] = { direction: 'outbound', status: 'sent' };
    db.windowOpen = false;
    expect((await processSmartFollowUps()).sent).toBe(0);
    expect(db.sent).toHaveLength(0);
  });

  it('si el envío falla agota los intentos para no reintentar en cada tick', async () => {
    db.conversations = [conv('1')];
    db.lastMessage['1'] = { direction: 'outbound', status: 'sent' };
    db.sendOk = false;
    const r = await processSmartFollowUps();
    expect(r.sent).toBe(0);
    expect(db.updates[0]).toEqual({ id: '1', nudges: 2 });
  });

  it('limpia el espacio antes de la puntuación cuando el nombre está vacío', async () => {
    db.cfg.message = 'Hola {{name}}, ¿sigues ahí?';
    db.conversations = [conv('1', '')];
    db.lastMessage['1'] = { direction: 'outbound', status: 'sent' };
    await processSmartFollowUps();
    expect(db.sent[0].body).toBe('Hola, ¿sigues ahí?');
  });
});
