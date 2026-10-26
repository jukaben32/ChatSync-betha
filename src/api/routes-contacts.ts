import { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { addLabelWithTriggers, removeLabel } from '../domain/labels.js';
import { triggerSequenceForSubscriber } from '../domain/sequences.js';
import { subscriberWhere } from '../domain/subscriber-filters.js';

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  // Neutraliza fórmulas (=, +, -, @) para que Excel/Sheets no las ejecuten al abrir el CSV
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

type BulkAction = 'add_label' | 'remove_label' | 'add_list' | 'remove_list' | 'block' | 'unblock' | 'unsubscribe' | 'resubscribe' | 'delete' | 'enroll_sequence';
const BULK_ACTIONS: BulkAction[] = ['add_label', 'remove_label', 'add_list', 'remove_list', 'block', 'unblock', 'unsubscribe', 'resubscribe', 'delete', 'enroll_sequence'];

/** Gestión de contactos: estadísticas, exportación, acciones masivas y listas (Subscriber Manager). */
export async function contactRoutes(app: FastifyInstance) {
  // ---------- Estadísticas ----------
  app.get('/api/subscribers/stats', async () => {
    const [total, subscribed, unsubscribed, blocked, inSequences] = await Promise.all([
      prisma.subscriber.count(),
      prisma.subscriber.count({ where: { blocked: false, optedOut: false } }),
      prisma.subscriber.count({ where: { optedOut: true } }),
      prisma.subscriber.count({ where: { blocked: true } }),
      prisma.subscriberSequence.groupBy({ by: ['subscriberId'], where: { status: 'active' } }).then((r) => r.length),
    ]);
    return { total, subscribed, unsubscribed, blocked, inSequences };
  });

  // ---------- Exportar CSV (respeta los filtros del listado) ----------
  app.get('/api/subscribers/export', async (request, reply) => {
    const q = request.query as { q?: string; label?: string; list?: string; sequence?: string; status?: string };
    const rows = await prisma.subscriber.findMany({
      where: subscriberWhere(q),
      include: { labels: { include: { label: true } }, lists: { include: { list: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20_000,
    });
    const fieldKeys = [...new Set(rows.flatMap((r) => Object.keys((r.customFields ?? {}) as object)))].sort();
    const head = ['phone', 'name', 'email', 'status', 'source', 'labels', 'lists', 'created_at', ...fieldKeys];
    const lines = [head.map(csvCell).join(',')];
    for (const r of rows) {
      const fields = (r.customFields ?? {}) as Record<string, unknown>;
      lines.push(
        [
          r.phone,
          r.name,
          r.email,
          r.blocked ? 'blocked' : r.optedOut ? 'unsubscribed' : 'subscribed',
          r.source,
          r.labels.map((l) => l.label.name).join('|'),
          r.lists.map((l) => l.list.name).join('|'),
          r.createdAt.toISOString(),
          ...fieldKeys.map((k) => fields[k]),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="subscribers.csv"')
      .send('﻿' + lines.join('\r\n'));
  });

  // ---------- Acciones masivas ----------
  app.post('/api/subscribers/bulk', async (request, reply) => {
    const body = request.body as { phones?: string[]; action?: BulkAction; value?: string };
    const phones = [...new Set((body.phones ?? []).map((p) => String(p).replace(/\D/g, '')).filter((p) => p.length >= 7))].slice(0, 1000);
    if (!phones.length) return reply.code(400).send({ error: 'phones is required' });
    if (!body.action || !BULK_ACTIONS.includes(body.action)) return reply.code(400).send({ error: 'invalid_action', allowed: BULK_ACTIONS });
    const needsValue = ['add_label', 'remove_label', 'add_list', 'remove_list', 'enroll_sequence'].includes(body.action);
    if (needsValue && !body.value?.trim()) return reply.code(400).send({ error: 'value is required for this action' });

    const subscribers = await prisma.subscriber.findMany({ where: { phone: { in: phones } } });
    const ids = subscribers.map((s) => s.id);
    const value = body.value?.trim() ?? '';
    let affected = ids.length;

    switch (body.action) {
      case 'block':
      case 'unblock':
        await prisma.subscriber.updateMany({ where: { id: { in: ids } }, data: { blocked: body.action === 'block' } });
        break;
      case 'unsubscribe':
      case 'resubscribe':
        await prisma.subscriber.updateMany({ where: { id: { in: ids } }, data: { optedOut: body.action === 'unsubscribe' } });
        break;
      case 'delete':
        await prisma.subscriber.deleteMany({ where: { id: { in: ids } } });
        break;
      case 'add_label':
        for (const s of subscribers) await addLabelWithTriggers(s.id, value);
        break;
      case 'remove_label':
        for (const s of subscribers) await removeLabel(s.id, value);
        break;
      case 'add_list': {
        const list = await prisma.audienceList.upsert({ where: { name: value }, update: {}, create: { name: value } });
        await prisma.audienceListMember.createMany({ data: ids.map((subscriberId) => ({ listId: list.id, subscriberId })), skipDuplicates: true });
        break;
      }
      case 'remove_list': {
        const list = await prisma.audienceList.findUnique({ where: { name: value } });
        if (list) await prisma.audienceListMember.deleteMany({ where: { listId: list.id, subscriberId: { in: ids } } });
        break;
      }
      case 'enroll_sequence': {
        const sequence = await prisma.sequence.findFirst({ where: { kind: 'sequence', OR: [{ id: /^[0-9a-f-]{36}$/i.test(value) ? value : undefined }, { name: value }] } });
        if (!sequence) return reply.code(404).send({ error: 'sequence_not_found' });
        affected = 0;
        for (const s of subscribers) {
          await triggerSequenceForSubscriber({ phone: s.phone, sequenceId: sequence.id }).then(() => (affected += 1)).catch(() => undefined);
        }
        break;
      }
    }
    return { ok: true, requested: phones.length, matched: subscribers.length, affected };
  });

  // ---------- Listas de contactos (distintas de las etiquetas) ----------
  app.get('/api/lists', async () => prisma.audienceList.findMany({ include: { _count: { select: { members: true } } }, orderBy: { name: 'asc' } }));

  app.post('/api/lists', async (request, reply) => {
    const body = request.body as { name?: string };
    const name = body.name?.trim();
    if (!name) return reply.code(400).send({ error: 'name is required' });
    const list = await prisma.audienceList.upsert({ where: { name }, update: {}, create: { name } });
    return reply.code(201).send(list);
  });

  app.delete('/api/lists/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.audienceList.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/api/subscribers/:phone/lists', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const body = request.body as { lists?: string[] };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    for (const raw of body.lists ?? []) {
      const name = raw.trim();
      if (!name) continue;
      const list = await prisma.audienceList.upsert({ where: { name }, update: {}, create: { name } });
      await prisma.audienceListMember.upsert({
        where: { listId_subscriberId: { listId: list.id, subscriberId: subscriber.id } },
        update: {},
        create: { listId: list.id, subscriberId: subscriber.id },
      });
    }
    return { ok: true };
  });

  app.delete('/api/subscribers/:phone/lists/:listId', async (request, reply) => {
    const { phone, listId } = request.params as { phone: string; listId: string };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    await prisma.audienceListMember.deleteMany({ where: { subscriberId: subscriber.id, listId } });
    return { ok: true };
  });

  // ---------- Secuencias y flujos del contacto ----------
  app.post('/api/subscribers/:phone/reset-input-flow', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    const r = await prisma.flowSession.updateMany({ where: { subscriberId: subscriber.id, status: 'active' }, data: { status: 'done' } });
    return { ok: true, closed: r.count };
  });

  app.delete('/api/subscribers/:phone/sequences/:sequenceId', async (request, reply) => {
    const { phone, sequenceId } = request.params as { phone: string; sequenceId: string };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    await prisma.subscriberSequence.updateMany({ where: { subscriberId: subscriber.id, sequenceId }, data: { status: 'stopped' } });
    await prisma.scheduledJob.updateMany({ where: { subscriberId: subscriber.id, sequenceId, status: 'pending' }, data: { status: 'cancelled' } });
    return { ok: true };
  });
}
