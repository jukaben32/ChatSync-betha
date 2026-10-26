import { randomBytes } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { addLabelWithTriggers } from '../domain/labels.js';
import { sendMessage } from '../domain/messaging.js';
import { triggerSequenceForSubscriber } from '../domain/sequences.js';
import { getPath } from '../util/net.js';

interface Condition {
  path: string;
  op: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'exists';
  value?: unknown;
}

interface WorkflowActions {
  labels?: string[];
  sequenceId?: string;
  assignTo?: string;
}

const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function check(payload: unknown, c: Condition): boolean {
  const actual = getPath(payload, c.path);
  const a = str(actual).toLowerCase();
  const v = str(c.value).toLowerCase();
  switch (c.op) {
    case 'eq':
      return a === v;
    case 'neq':
      return a !== v;
    case 'contains':
      return a.includes(v);
    case 'gt':
      return Number(actual) > Number(c.value);
    case 'lt':
      return Number(actual) < Number(c.value);
    case 'exists':
      return a !== '';
    default:
      return false;
  }
}

/** Lista las rutas de campos de un JSON ("customer.name", "items.0.sku") para el mapeo visual. */
function flatten(value: unknown, prefix = '', out: string[] = [], depth = 0): string[] {
  if (depth > 4 || out.length > 80) return out;
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
  } else if (prefix) out.push(prefix);
  return out;
}

export async function hookRoutes(app: FastifyInstance) {
  // ---------- Administración de workflows (requiere clave) ----------
  app.get('/api/workflows', async () => {
    const rows = await prisma.inboundWorkflow.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((w) => ({ ...w, detectedFields: flatten(w.lastPayload) }));
  });

  app.post('/api/workflows', async (request, reply) => {
    const b = request.body as Partial<{
      name: string;
      phonePath: string;
      templateName: string;
      language: string;
      text: string;
      variables: Record<string, string>;
      conditions: Condition[];
      delayMinutes: number;
      actions: WorkflowActions;
    }>;
    if (!b.name) return reply.code(400).send({ error: 'name is required' });
    const wf = await prisma.inboundWorkflow.create({
      data: {
        name: b.name,
        token: randomBytes(16).toString('hex'),
        phonePath: b.phonePath || 'phone',
        templateName: b.templateName || null,
        language: b.language || 'es',
        text: b.text || null,
        variables: (b.variables ?? {}) as any,
        conditions: (b.conditions ?? []) as any,
        delayMinutes: Math.max(0, Math.round(b.delayMinutes ?? 0)),
        actions: (b.actions ?? {}) as any,
      },
    });
    return reply.code(201).send(wf);
  });

  app.patch('/api/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, any>;
    return prisma.inboundWorkflow.update({
      where: { id },
      data: {
        name: b.name,
        phonePath: b.phonePath,
        templateName: b.templateName === '' ? null : b.templateName,
        language: b.language,
        text: b.text === '' ? null : b.text,
        variables: b.variables,
        conditions: b.conditions,
        delayMinutes: b.delayMinutes !== undefined ? Math.max(0, Math.round(b.delayMinutes)) : undefined,
        actions: b.actions,
        active: b.active,
      },
    });
  });

  app.delete('/api/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.inboundWorkflow.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Receptor público: el token de la URL hace de secreto ----------
  app.post('/api/hooks/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const wf = await prisma.inboundWorkflow.findUnique({ where: { token } });
    if (!wf || !wf.active) return reply.code(404).send({ error: 'workflow_not_found' });

    const payload = request.body as unknown;
    await prisma.inboundWorkflow.update({ where: { id: wf.id }, data: { lastPayload: (payload ?? {}) as any } });

    const phone = str(getPath(payload, wf.phonePath)).replace(/[^\d]/g, '');
    if (phone.length < 7) return reply.code(422).send({ error: 'phone_not_found', path: wf.phonePath });

    const conditions = (wf.conditions ?? []) as unknown as Condition[];
    if (!conditions.every((c) => check(payload, c))) return { ok: true, skipped: 'conditions_not_met' };

    const nameGuess = str(getPath(payload, 'name') || getPath(payload, 'customer.name') || getPath(payload, 'customer_name'));
    const subscriber = await prisma.subscriber.upsert({
      where: { phone },
      update: {},
      create: { phone, name: nameGuess || undefined, source: `workflow:${wf.name}`.slice(0, 64) },
    });

    // Acciones sobre el contacto
    const actions = (wf.actions ?? {}) as WorkflowActions;
    for (const label of actions.labels ?? []) await addLabelWithTriggers(subscriber.id, label);
    if (actions.assignTo) {
      const conv = await prisma.conversation.findFirst({ where: { subscriberId: subscriber.id, status: { not: 'solved' } }, orderBy: { updatedAt: 'desc' } });
      if (conv) await prisma.conversation.update({ where: { id: conv.id }, data: { assignedTo: actions.assignTo } });
    }
    if (actions.sequenceId) await triggerSequenceForSubscriber({ phone, sequenceId: actions.sequenceId }).catch(() => undefined);

    // Mensaje: plantilla (variables mapeadas por campo) o texto con {{ruta.del.campo}}
    let sent: { ok: boolean; error?: string } | { scheduled: true } | undefined;
    const render = (t: string) => t.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, p: string) => str(getPath(payload, p)));
    const stepParams = wf.templateName
      ? {
          action: 'send_template',
          params: {
            templateName: wf.templateName,
            language: wf.language,
            variables: Object.entries((wf.variables ?? {}) as Record<string, string>)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([, path]) => str(getPath(payload, path))),
          },
        }
      : wf.text
        ? { action: 'send_text', params: { body: render(wf.text) } }
        : null;

    if (stepParams) {
      if (wf.delayMinutes > 0) {
        // Mensaje diferido: una secuencia interna de un paso que se borra tras ejecutarse
        const seq = await prisma.sequence.create({
          data: { name: `__wf_${wf.id.slice(0, 8)}_${Date.now()}`, kind: 'internal', steps: { create: [{ ...stepParams, params: stepParams.params as any, delayDays: 0, order: 0 }] } },
        });
        await prisma.scheduledJob.create({ data: { subscriberId: subscriber.id, sequenceId: seq.id, resumeOrder: 0, runAt: new Date(Date.now() + wf.delayMinutes * 60_000) } });
        sent = { scheduled: true };
      } else {
        const content =
          stepParams.action === 'send_template'
            ? ({ type: 'template', name: wf.templateName!, language: wf.language, variables: (stepParams.params as any).variables } as const)
            : ({ type: 'text', body: (stepParams.params as any).body } as const);
        const result = await sendMessage({ phone, content, sender: `workflow:${wf.name}` });
        sent = { ok: result.ok, error: result.error };
      }
    }
    return { ok: true, phone, message: sent ?? null };
  });
}
