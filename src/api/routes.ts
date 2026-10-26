import { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { config, whatsappConfigured } from '../config.js';
import { agentReady } from '../ai/agent.js';
import { handleOutbound } from '../domain/inbound.js';
import { sendMessage, withinServiceWindow } from '../domain/messaging.js';
import { addLabelWithTriggers } from '../domain/labels.js';
import { emitEvent } from '../domain/events.js';
import { automationRoutes } from './routes-automation.js';
import { settingsRoutes } from './routes-settings.js';
import { hookRoutes } from './routes-hooks.js';
import { aiRoutes } from './routes-ai.js';
import { mcpRoutes } from './routes-mcp.js';

const subscriberInclude = { labels: { include: { label: true } }, _count: { select: { conversations: true } } } as const;

export async function apiRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, service: 'chatsyncs-replica' }));

  // ---------- Subscribers ----------
  app.get('/api/subscribers', async (request) => {
    const q = request.query as { q?: string; label?: string; take?: string; skip?: string };
    const where: any = {};
    if (q.q) {
      where.OR = [
        { phone: { contains: q.q } },
        { name: { contains: q.q, mode: 'insensitive' } },
        { email: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    if (q.label) where.labels = { some: { label: { name: q.label } } };
    const take = Math.min(Number(q.take ?? 100), 500);
    const [items, total] = await Promise.all([
      prisma.subscriber.findMany({ where, include: subscriberInclude, orderBy: { createdAt: 'desc' }, take, skip: Number(q.skip ?? 0) }),
      prisma.subscriber.count({ where }),
    ]);
    return { items, total };
  });

  app.post('/api/subscribers', async (request, reply) => {
    const body = request.body as { phone?: string; name?: string; email?: string; customFields?: Record<string, unknown> };
    if (!body.phone) return reply.code(400).send({ error: 'phone is required' });
    const phone = body.phone.replace(/[^\d]/g, '');
    const existing = await prisma.subscriber.findUnique({ where: { phone } });
    if (existing) return reply.code(200).send(existing);
    const subscriber = await prisma.subscriber.create({
      data: { phone, name: body.name, email: body.email, customFields: (body.customFields ?? {}) as any, source: 'manual' },
      include: subscriberInclude,
    });
    await emitEvent('subscriber.created', { phone, name: body.name });
    return reply.code(201).send(subscriber);
  });

  // Importación masiva (CSV parseado en el cliente): [{ phone, name?, email?, labels? }]
  app.post('/api/subscribers/import', async (request, reply) => {
    const body = request.body as { rows?: Array<{ phone?: string; name?: string; email?: string; labels?: string[] }> };
    if (!body.rows?.length) return reply.code(400).send({ error: 'rows is required' });
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of body.rows.slice(0, 5000)) {
      const phone = String(row.phone ?? '').replace(/[^\d]/g, '');
      if (phone.length < 7) {
        skipped += 1;
        continue;
      }
      const existing = await prisma.subscriber.findUnique({ where: { phone } });
      const subscriber = await prisma.subscriber.upsert({
        where: { phone },
        update: { name: row.name || undefined, email: row.email || undefined },
        create: { phone, name: row.name || undefined, email: row.email || undefined, source: 'import' },
      });
      existing ? (updated += 1) : (created += 1);
      for (const name of row.labels ?? []) {
        if (!name) continue;
        const label = await prisma.label.upsert({ where: { name }, update: {}, create: { name } });
        await prisma.subscriberLabel.upsert({
          where: { subscriberId_labelId: { subscriberId: subscriber.id, labelId: label.id } },
          update: {},
          create: { subscriberId: subscriber.id, labelId: label.id },
        });
      }
    }
    return { ok: true, created, updated, skipped };
  });

  app.get('/api/subscribers/:phone', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const subscriber = await prisma.subscriber.findUnique({
      where: { phone },
      include: {
        labels: { include: { label: true } },
        conversations: { include: { messages: { orderBy: { createdAt: 'asc' }, take: 100 } } },
        notes: { orderBy: { createdAt: 'desc' } },
        deals: true,
      },
    });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    return subscriber;
  });

  app.patch('/api/subscribers/:phone', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const body = request.body as { name?: string; email?: string; customFields?: Record<string, unknown>; blocked?: boolean; optedOut?: boolean };
    const current = await prisma.subscriber.findUnique({ where: { phone } });
    if (!current) return reply.code(404).send({ error: 'subscriber_not_found' });
    return prisma.subscriber.update({
      where: { phone },
      data: {
        name: body.name,
        email: body.email,
        blocked: body.blocked,
        optedOut: body.optedOut,
        // Fusiona con los campos existentes en vez de borrarlos.
        ...(body.customFields ? { customFields: { ...(current.customFields as object), ...body.customFields } as any } : {}),
      },
      include: subscriberInclude,
    });
  });

  app.delete('/api/subscribers/:phone', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    await prisma.subscriber.delete({ where: { phone } });
    return { ok: true };
  });

  app.get('/api/subscribers/:phone/notes', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    return prisma.subscriberNote.findMany({ where: { subscriberId: subscriber.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  });

  // Resumen CRM del contacto: etapa, valor y responsable de su oportunidad más reciente
  app.get('/api/subscribers/:phone/crm', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const deal = await prisma.crmDeal.findFirst({ where: { subscriber: { phone } }, orderBy: { updatedAt: 'desc' } });
    if (!deal) return reply.code(404).send({ error: 'deal_not_found' });
    return deal;
  });

  app.put('/api/subscribers/:phone/crm', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const body = request.body as { stage?: string; value?: number; owner?: string };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    const existing = await prisma.crmDeal.findFirst({ where: { subscriberId: subscriber.id }, orderBy: { updatedAt: 'desc' } });
    const data = { stage: body.stage, owner: body.owner, ...(body.value !== undefined ? { value: Math.round(body.value) } : {}) };
    return existing
      ? prisma.crmDeal.update({ where: { id: existing.id }, data })
      : prisma.crmDeal.create({ data: { subscriberId: subscriber.id, stage: body.stage ?? 'new', value: Math.round(body.value ?? 0), owner: body.owner } });
  });

  // ---------- Labels ----------
  app.get('/api/labels', async () => prisma.label.findMany({ include: { _count: { select: { subscribers: true } } }, orderBy: { name: 'asc' } }));

  app.post('/api/labels', async (request, reply) => {
    const body = request.body as { name?: string };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });
    const label = await prisma.label.upsert({ where: { name: body.name }, update: {}, create: { name: body.name } });
    return reply.code(201).send(label);
  });

  app.delete('/api/labels/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.label.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/api/subscribers/:phone/labels', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const body = request.body as { labels?: string[] };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    const created = [];
    for (const name of body.labels ?? []) {
      await addLabelWithTriggers(subscriber.id, name);
      created.push({ name });
    }
    return { ok: true, labels: created };
  });

  app.delete('/api/subscribers/:phone/labels/:labelId', async (request, reply) => {
    const { phone, labelId } = request.params as { phone: string; labelId: string };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    await prisma.subscriberLabel.deleteMany({ where: { subscriberId: subscriber.id, labelId } });
    return { ok: true };
  });

  // ---------- Conversations (shared inbox) ----------
  app.get('/api/conversations', async (request) => {
    const q = request.query as { phone?: string; status?: string; assignedTo?: string; q?: string; followUp?: string };
    const where: any = {};
    if (q.phone) where.subscriber = { phone: q.phone };
    if (q.status) where.status = q.status;
    if (q.followUp === 'due') where.followUpAt = { lte: new Date() };
    if (q.assignedTo === 'unassigned') where.assignedTo = null;
    else if (q.assignedTo) where.assignedTo = q.assignedTo;
    if (q.q) where.subscriber = { OR: [{ phone: { contains: q.q } }, { name: { contains: q.q, mode: 'insensitive' } }] };
    return prisma.conversation.findMany({
      where,
      include: { subscriber: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  });

  app.get('/api/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        subscriber: { include: { labels: { include: { label: true } } } },
        messages: { orderBy: { createdAt: 'asc' } },
        notes: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
    return { ...conversation, windowOpen: await withinServiceWindow(conversation.subscriberId) };
  });

  app.post('/api/conversations/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      body?: string;
      sender?: string;
      media?: { kind: 'image' | 'document' | 'audio' | 'video'; url: string; caption?: string; filename?: string };
      buttons?: { body: string; buttons: Array<{ title: string }> };
    };
    try {
      if (body.media?.url || body.buttons?.buttons?.length) {
        const conversation = await prisma.conversation.findUnique({ where: { id }, include: { subscriber: true } });
        if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
        const content = body.media?.url
          ? ({ type: 'media', ...body.media } as const)
          : ({ type: 'buttons', body: body.buttons!.body, buttons: body.buttons!.buttons.map((b, i) => ({ id: `m${i}`, title: b.title })) } as const);
        const result = await sendMessage({ phone: conversation.subscriber.phone, content, conversationId: id, sender: body.sender ?? 'agent' });
        return reply.code(result.ok ? 200 : 502).send(result);
      }
      if (!body.body?.trim()) return reply.code(400).send({ error: 'body is required' });
      const result = await handleOutbound({ conversationId: id, body: body.body.trim(), sender: body.sender });
      return reply.code(result.ok ? 200 : 502).send(result);
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  app.post('/api/conversations/:id/notes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { author?: string; body?: string };
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
    return prisma.subscriberNote.create({
      data: { subscriberId: conversation.subscriberId, conversationId: id, author: body.author ?? 'agent', body: body.body ?? '' },
    });
  });

  app.patch('/api/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string; assignedTo?: string | null; followUpAt?: string | null };
    const current = await prisma.conversation.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: 'conversation_not_found' });
    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.assignedTo !== undefined ? { assignedTo: body.assignedTo || null } : {}),
        ...(body.followUpAt !== undefined ? { followUpAt: body.followUpAt ? new Date(body.followUpAt) : null } : {}),
      },
      include: { subscriber: true },
    });
    await emitEvent('conversation.updated', { id, status: conversation.status, assignedTo: conversation.assignedTo });
    return conversation;
  });

  // ---------- CRM deals ----------
  app.get('/api/crm/deals', async () => prisma.crmDeal.findMany({ include: { subscriber: true }, orderBy: { updatedAt: 'desc' } }));

  app.post('/api/crm/deals', async (request, reply) => {
    const body = request.body as { phone?: string; stage?: string; value?: number; owner?: string };
    if (!body.phone) return reply.code(400).send({ error: 'phone is required' });
    const subscriber = await prisma.subscriber.findUnique({ where: { phone: body.phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    const deal = await prisma.crmDeal.create({
      data: { subscriberId: subscriber.id, stage: body.stage ?? 'new', value: Math.round(body.value ?? 0), owner: body.owner },
      include: { subscriber: true },
    });
    return reply.code(201).send(deal);
  });

  app.patch('/api/crm/deals/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { stage?: string; value?: number; owner?: string };
    return prisma.crmDeal.update({
      where: { id },
      data: { stage: body.stage, owner: body.owner, ...(body.value !== undefined ? { value: Math.round(body.value) } : {}) },
      include: { subscriber: true },
    });
  });

  app.delete('/api/crm/deals/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.crmDeal.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Account / estado de conexión ----------
  app.get('/api/account', async () => {
    const [subscribers, conversations] = await Promise.all([prisma.subscriber.count(), prisma.conversation.count()]);
    return {
      ok: true,
      whatsapp: {
        configured: whatsappConfigured(),
        phoneNumberId: config.whatsapp.phoneNumberId || null,
        businessAccountId: config.whatsapp.businessAccountId || null,
        signatureValidation: Boolean(config.whatsapp.appSecret),
      },
      ai: { ready: agentReady(), model: process.env.AI_MODEL ?? 'openai/gpt-4o-mini' },
      counts: { subscribers, conversations },
    };
  });

  await app.register(automationRoutes);
  await app.register(hookRoutes);
  await app.register(aiRoutes);
  await app.register(mcpRoutes);
  await app.register(settingsRoutes);
}
