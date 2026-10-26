import { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { normalizeQuestions, syncFormFlow } from '../domain/forms.js';
import { triggerBotFlowForSubscriber } from '../domain/sequences.js';
import { csvCell } from '../util/csv.js';

interface FormBody {
  name?: string;
  keyword?: string;
  intro?: string;
  doneMessage?: string;
  labelOnDone?: string;
  active?: boolean;
  questions?: unknown;
}

/** Formularios dentro del chat de WhatsApp: se compilan a un flujo, y cada envío se guarda aparte. */
export async function formRoutes(app: FastifyInstance) {
  app.get('/api/forms', async () => prisma.form.findMany({ include: { _count: { select: { submissions: true } } }, orderBy: { createdAt: 'desc' } }));

  app.post('/api/forms', async (request, reply) => {
    const b = request.body as FormBody;
    if (!b.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    let questions;
    try {
      questions = normalizeQuestions(b.questions);
    } catch (e) {
      return reply.code(400).send({ error: 'invalid_questions', message: (e as Error).message });
    }
    const form = await prisma.form.create({
      data: {
        name: b.name.trim(),
        keyword: b.keyword?.trim() || null,
        intro: b.intro?.trim() || null,
        doneMessage: b.doneMessage?.trim() || undefined,
        labelOnDone: b.labelOnDone?.trim() || null,
        questions: questions as never,
        active: b.active ?? true,
      },
    });
    await syncFormFlow(form);
    return reply.code(201).send(await prisma.form.findUnique({ where: { id: form.id } }));
  });

  app.patch('/api/forms/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as FormBody;
    const current = await prisma.form.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: 'form_not_found' });
    let questions;
    if (b.questions !== undefined) {
      try {
        questions = normalizeQuestions(b.questions);
      } catch (e) {
        return reply.code(400).send({ error: 'invalid_questions', message: (e as Error).message });
      }
    }
    const form = await prisma.form.update({
      where: { id },
      data: {
        name: b.name?.trim() || undefined,
        ...(b.keyword !== undefined ? { keyword: b.keyword.trim() || null } : {}),
        ...(b.intro !== undefined ? { intro: b.intro.trim() || null } : {}),
        ...(b.doneMessage?.trim() ? { doneMessage: b.doneMessage.trim() } : {}),
        ...(b.labelOnDone !== undefined ? { labelOnDone: b.labelOnDone.trim() || null } : {}),
        ...(questions ? { questions: questions as never } : {}),
        active: b.active,
      },
    });
    await syncFormFlow(form);
    return form;
  });

  app.delete('/api/forms/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const form = await prisma.form.findUnique({ where: { id } });
    if (!form) return reply.code(404).send({ error: 'form_not_found' });
    await prisma.form.delete({ where: { id } });
    if (form.sequenceId) await prisma.sequence.delete({ where: { id: form.sequenceId } }).catch(() => undefined);
    return { ok: true };
  });

  app.get('/api/forms/:id/submissions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { limit?: string };
    const form = await prisma.form.findUnique({ where: { id } });
    if (!form) return reply.code(404).send({ error: 'form_not_found' });
    const rows = await prisma.formSubmission.findMany({
      where: { formId: id },
      include: { subscriber: { select: { phone: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.limit ?? 100), 500),
    });
    return { form, submissions: rows };
  });

  app.get('/api/forms/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const form = await prisma.form.findUnique({ where: { id } });
    if (!form) return reply.code(404).send({ error: 'form_not_found' });
    const questions = (form.questions ?? []) as unknown as Array<{ key: string; label: string }>;
    const rows = await prisma.formSubmission.findMany({ where: { formId: id }, include: { subscriber: { select: { phone: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 20_000 });
    const lines = [['fecha', 'telefono', 'nombre', ...questions.map((q) => q.label)].map(csvCell).join(',')];
    for (const r of rows) {
      const a = (r.answers ?? {}) as Record<string, unknown>;
      lines.push([r.createdAt.toISOString(), r.subscriber.phone, r.subscriber.name, ...questions.map((q) => a[q.key])].map(csvCell).join(','));
    }
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="formulario-${id.slice(0, 8)}.csv"`)
      .send('﻿' + lines.join('\r\n'));
  });

  // Lanza el formulario a un contacto (aunque no haya escrito la palabra clave)
  app.post('/api/forms/:id/send', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { phone?: string };
    const phone = String(body.phone ?? '').replace(/\D/g, '');
    if (phone.length < 7) return reply.code(400).send({ error: 'phone is required' });
    const form = await prisma.form.findUnique({ where: { id } });
    if (!form?.sequenceId) return reply.code(404).send({ error: 'form_not_found' });
    await prisma.subscriber.upsert({ where: { phone }, update: {}, create: { phone, source: 'form' } });
    return triggerBotFlowForSubscriber({ phone, flowId: form.sequenceId });
  });
}
