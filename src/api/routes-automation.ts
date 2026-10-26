import { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { whatsappConfigured } from '../config.js';
import { sendBroadcast } from '../domain/broadcasts.js';
import { enrollSubscriberInSequence, triggerBotFlowForSubscriber, triggerSequenceForSubscriber } from '../domain/sequences.js';
import { createMetaTemplate, listMetaTemplates } from '../whatsapp/client.js';

type StepInput = { action?: string; params?: Record<string, unknown>; delayDays?: number; order?: number };

const stepData = (steps: StepInput[]) =>
  steps.map((s, i) => ({ action: s.action ?? 'send_text', params: (s.params ?? {}) as any, delayDays: s.delayDays ?? 0, order: s.order ?? i }));

export async function automationRoutes(app: FastifyInstance) {
  // ---------- Broadcasts ----------
  app.get('/api/broadcasts', async () => prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' } }));

  app.post('/api/broadcasts', async (request, reply) => {
    const body = request.body as { name?: string; audience?: any; contentType?: string; content?: string; language?: string };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });
    if (!body.content) return reply.code(400).send({ error: 'content is required' });
    const broadcast = await prisma.broadcast.create({
      data: {
        name: body.name,
        audience: body.audience ?? { all: true },
        contentType: body.contentType === 'template' ? 'template' : 'text',
        content: body.content,
        language: body.language ?? 'es',
        status: 'draft',
      },
    });
    return reply.code(201).send(broadcast);
  });

  app.get('/api/broadcasts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const broadcast = await prisma.broadcast.findUnique({ where: { id }, include: { recipients: { include: { subscriber: true }, take: 500 } } });
    if (!broadcast) return reply.code(404).send({ error: 'broadcast_not_found' });
    return broadcast;
  });

  app.post('/api/broadcasts/:id/send', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await sendBroadcast({ broadcastId: id });
    } catch (error) {
      const message = (error as Error).message;
      const code = message === 'broadcast_not_found' ? 404 : message === 'whatsapp_not_configured' || message === 'broadcast_already_sent' ? 409 : 502;
      return reply.code(code).send({ error: 'broadcast_send_failed', message });
    }
  });

  app.delete('/api/broadcasts/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.broadcast.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Sequences (drip) y Flows (chatbot) ----------
  app.get('/api/sequences', async (request) => {
    const q = request.query as { kind?: string };
    return prisma.sequence.findMany({
      where: q.kind ? { kind: q.kind } : {},
      include: { steps: { orderBy: { order: 'asc' } }, _count: { select: { enrollments: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.get('/api/sequences/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const sequence = await prisma.sequence.findUnique({ where: { id }, include: { steps: { orderBy: { order: 'asc' } }, _count: { select: { enrollments: true } } } });
    if (!sequence) return reply.code(404).send({ error: 'sequence_not_found' });
    return sequence;
  });

  app.post('/api/sequences', async (request, reply) => {
    const body = request.body as { name?: string; kind?: string; triggerKeyword?: string; steps?: StepInput[] };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });
    const sequence = await prisma.sequence.create({
      data: {
        name: body.name,
        kind: body.kind === 'flow' ? 'flow' : 'sequence',
        triggerKeyword: body.triggerKeyword || null,
        steps: { create: stepData(body.steps ?? []) },
      },
      include: { steps: true },
    });
    return reply.code(201).send(sequence);
  });

  app.patch('/api/sequences/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; active?: boolean; triggerKeyword?: string | null; steps?: StepInput[] };
    const exists = await prisma.sequence.findUnique({ where: { id } });
    if (!exists) return reply.code(404).send({ error: 'sequence_not_found' });
    if (body.steps) await prisma.sequenceStep.deleteMany({ where: { sequenceId: id } });
    return prisma.sequence.update({
      where: { id },
      data: {
        name: body.name,
        active: body.active,
        ...(body.triggerKeyword !== undefined ? { triggerKeyword: body.triggerKeyword || null } : {}),
        ...(body.steps ? { steps: { create: stepData(body.steps) } } : {}),
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  });

  app.delete('/api/sequences/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.sequence.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/api/sequences/:id/trigger', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { phone?: string };
    if (!body.phone) return reply.code(400).send({ error: 'phone is required' });
    try {
      const sequence = await prisma.sequence.findUnique({ where: { id } });
      if (!sequence) return reply.code(404).send({ error: 'sequence_not_found' });
      return sequence.kind === 'flow'
        ? await triggerBotFlowForSubscriber({ phone: body.phone, flowId: id })
        : await triggerSequenceForSubscriber({ phone: body.phone, sequenceId: id });
    } catch (error) {
      return reply.code(404).send({ error: 'trigger_failed', message: (error as Error).message });
    }
  });

  app.post('/api/sequences/:id/enroll', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { phone?: string };
    if (!body.phone) return reply.code(400).send({ error: 'phone is required' });
    try {
      return await enrollSubscriberInSequence({ phone: body.phone, sequenceId: id });
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  // ---------- Plantillas de WhatsApp ----------
  app.get('/api/templates', async () => prisma.template.findMany({ orderBy: { createdAt: 'desc' } }));

  app.post('/api/templates', async (request, reply) => {
    const body = request.body as { name?: string; language?: string; category?: string; body?: string; submit?: boolean };
    if (!body.name || !body.body) return reply.code(400).send({ error: 'name and body are required' });
    const name = body.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const language = body.language ?? 'es';
    const category = (body.category ?? 'MARKETING').toUpperCase();

    let status = 'draft';
    let metaId: string | undefined;
    let warning: string | undefined;
    if (body.submit) {
      if (!whatsappConfigured()) {
        warning = 'whatsapp_not_configured: se guardó como borrador';
      } else {
        try {
          const created = await createMetaTemplate({ name, language, category, body: body.body });
          status = created.status === 'approved' ? 'approved' : 'pending';
          metaId = created.id;
        } catch (error) {
          return reply.code(502).send({ error: 'meta_template_failed', message: (error as Error).message });
        }
      }
    }
    const template = await prisma.template.upsert({
      where: { name_language: { name, language } },
      update: { body: body.body, category, status, metaId },
      create: { name, language, category, body: body.body, status, metaId },
    });
    return reply.code(201).send({ ...template, warning });
  });

  // Sincroniza el estado de las plantillas desde Meta.
  app.post('/api/templates/sync', async (_request, reply) => {
    if (!whatsappConfigured()) return reply.code(409).send({ error: 'whatsapp_not_configured' });
    try {
      const remote = await listMetaTemplates();
      for (const t of remote) {
        const body = t.components?.find((c) => c.type === 'BODY')?.text ?? '';
        await prisma.template.upsert({
          where: { name_language: { name: t.name, language: t.language } },
          update: { status: t.status.toLowerCase(), category: t.category, body, metaId: t.id },
          create: { name: t.name, language: t.language, category: t.category, body, status: t.status.toLowerCase(), metaId: t.id },
        });
      }
      return { ok: true, synced: remote.length };
    } catch (error) {
      return reply.code(502).send({ error: 'meta_sync_failed', message: (error as Error).message });
    }
  });

  app.delete('/api/templates/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.template.delete({ where: { id } });
    return { ok: true };
  });
}
