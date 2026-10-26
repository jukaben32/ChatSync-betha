import { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { sendBroadcast } from '../domain/broadcasts.js';
import { triggerBotFlowForSubscriber } from '../domain/sequences.js';

export async function apiRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, service: 'chatsyncs-replica' }));

  // ---------- Subscribers ----------
  app.get('/api/subscribers', async () => {
    const subscribers = await prisma.subscriber.findMany({
      include: { labels: { include: { label: true } }, _count: { select: { conversations: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return subscribers;
  });

  app.post('/api/subscribers', async (request, reply) => {
    const body = request.body as { phone?: string; name?: string; email?: string; customFields?: Record<string, unknown> };
    if (!body.phone) return reply.code(400).send({ error: 'phone is required' });
    const existing = await prisma.subscriber.findUnique({ where: { phone: body.phone } });
    if (existing) {
      return reply.code(200).send(existing);
    }
    const subscriber = await prisma.subscriber.create({
      data: { phone: body.phone, name: body.name, email: body.email, customFields: (body.customFields ?? {}) as any },
      include: { labels: { include: { label: true } } },
    });
    return reply.code(201).send(subscriber);
  });

  app.get('/api/subscribers/:phone', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const subscriber = await prisma.subscriber.findUnique({
      where: { phone },
      include: { labels: { include: { label: true } }, conversations: { include: { messages: true } }, notes: true },
    });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    return subscriber;
  });

  app.delete('/api/subscribers/:phone', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    await prisma.subscriber.delete({ where: { phone } });
    return { ok: true };
  });

  app.patch('/api/subscribers/:phone', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const body = request.body as { name?: string; email?: string; customFields?: Record<string, unknown> };
    const subscriber = await prisma.subscriber.update({
      where: { phone },
      data: { name: body.name, email: body.email, customFields: (body.customFields ?? {}) as any },
      include: { labels: { include: { label: true } } },
    });
    return subscriber;
  });

  // ---------- Labels ----------
  app.get('/api/labels', async () => prisma.label.findMany({ include: { _count: { select: { subscribers: true } } } }));
  app.post('/api/labels', async (request, reply) => {
    const body = request.body as { name?: string };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });
    const label = await prisma.label.create({ data: { name: body.name } });
    return reply.code(201).send(label);
  });

  app.post('/api/subscribers/:phone/labels', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const body = request.body as { labels?: string[] };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    const created: any[] = [];
    for (const labelName of body.labels ?? []) {
      const label = await prisma.label.upsert({
        where: { name: labelName },
        update: {},
        create: { name: labelName },
      });
      created.push(label);
    }
    return { ok: true, labels: created };
  });

  // ---------- Conversations ----------
  app.get('/api/conversations', async (request, reply) => {
    const q = request.query as { phone?: string; status?: string };
    const where: any = {};
    if (q.phone) where.subscriber = { phone: q.phone };
    if (q.status) where.status = q.status;
    const conversations = await prisma.conversation.findMany({
      where,
      include: { subscriber: true, messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return conversations;
  });

  app.get('/api/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { subscriber: true, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
    return conversation;
  });

  app.post('/api/conversations/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { direction?: 'inbound' | 'outbound'; body?: string; providerMessageId?: string };
    const conversation = await prisma.conversation.findUnique({ where: { id }, include: { subscriber: true } });
    if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
    const message = await prisma.message.create({
      data: {
        conversationId: id,
        direction: body.direction ?? 'outbound',
        providerMessageId: body.providerMessageId,
        body: body.body ?? '',
      },
    });
    await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
    return message;
  });

  app.post('/api/conversations/:id/notes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { author?: string; body?: string };
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
    const note = await prisma.subscriberNote.create({
      data: { subscriberId: conversation.subscriberId, conversationId: id, author: body.author ?? 'agent', body: body.body ?? '' },
    });
    return note;
  });

  app.patch('/api/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string; assignedTo?: string };
    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.assignedTo !== undefined ? { assignedTo: body.assignedTo } : {}),
      },
      include: { subscriber: true, messages: { orderBy: { createdAt: 'asc' } } },
    });
    return conversation;
  });

  // ---------- Broadcasts ----------
  app.get('/api/broadcasts', async () => prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' } }));
  app.post('/api/broadcasts', async (request, reply) => {
    const body = request.body as { name?: string; audience?: any; contentType?: string; content?: string };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });
    const broadcast = await prisma.broadcast.create({
      data: {
        name: body.name,
        audience: body.audience ?? {},
        contentType: body.contentType ?? 'text',
        content: body.content ?? '',
        status: 'draft',
      },
    });
    return reply.code(201).send(broadcast);
  });

  app.post('/api/broadcasts/:id/send', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await sendBroadcast({ broadcastId: id });
      return result;
    } catch (error) {
      return reply.code(502).send({ error: 'broadcast_send_failed', message: (error as Error).message });
    }
  });

  // ---------- Sequences ----------
  app.get('/api/sequences', async () => prisma.sequence.findMany({ include: { _count: { select: { enrollments: true } } } }));
  app.post('/api/sequences', async (request, reply) => {
    const body = request.body as { name?: string; steps?: any[] };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });
    const sequence = await prisma.sequence.create({
      data: { name: body.name, steps: { create: (body.steps ?? []).map((s: any, i: number) => ({ action: s.action, params: s.params ?? {}, delayDays: s.delayDays ?? 0, order: s.order ?? i })) } },
      include: { steps: true },
    });
    return reply.code(201).send(sequence);
  });

  app.post('/api/sequences/:id/trigger', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { phone?: string };
    if (!body.phone) return reply.code(400).send({ error: 'phone is required' });
    try {
      const result = await triggerBotFlowForSubscriber({ phone: body.phone, flowId: id });
      return result;
    } catch (error) {
      return reply.code(404).send({ error: 'bot_flow_not_found', message: (error as Error).message });
    }
  });

  // ---------- Orders ----------
  app.get('/api/orders', async (request, reply) => {
    const q = request.query as { phone?: string };
    const where = q.phone ? { subscriber: { phone: q.phone } } : {};
    const orders = await prisma.order.findMany({
      where,
      include: { subscriber: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return orders;
  });

  app.patch('/api/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string };
    const order = await prisma.order.update({ where: { id }, data: { status: body.status ?? 'pending' } });
    return order;
  });

  // ---------- CRM deals ----------
  app.get('/api/crm/deals', async () => prisma.crmDeal.findMany({ include: { subscriber: true } }));
  app.patch('/api/crm/deals/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { stage?: string; value?: number; owner?: string };
    const deal = await prisma.crmDeal.update({ where: { id }, data: body });
    return deal;
  });

  // ---------- Account ----------
  app.get('/api/account', async () => ({
    ok: true,
    whatsapp: {
      businessAccountId: 'set_from_env',
      phoneNumberId: 'set_from_env',
      webhookConfigured: true,
    },
  }));
}
