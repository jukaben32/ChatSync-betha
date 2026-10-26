import { prisma } from '../prisma.js';
import { getOrCreateConversation, renderVars, sendMessage, withinServiceWindow } from '../domain/messaging.js';
import type { OutgoingContent } from '../domain/messaging.js';
import { addLabelWithTriggers, removeLabel } from '../domain/labels.js';
import { getSetting, isOpenNow } from '../domain/settings.js';
import { assertPublicUrl, getPath } from '../util/net.js';

export interface FlowStep {
  id?: string;
  action: string;
  params?: Record<string, any>;
  delayDays?: number;
  order: number;
}

export interface Flow {
  id: string;
  name: string;
  steps: FlowStep[];
}

export interface FlowResult {
  ok: boolean;
  executed: string[];
  scheduled?: boolean;
  awaiting?: boolean;
}

type SubscriberRow = NonNullable<Awaited<ReturnType<typeof prisma.subscriber.findUnique>>>;

const MAX_STEPS = 100;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Acciones que dejan el flujo esperando la respuesta del cliente. */
export const AWAITING_ACTIONS = ['send_buttons', 'send_list', 'ask'];

function followingOrder(sorted: FlowStep[], order: number): number | undefined {
  return sorted.find((s) => s.order > order)?.order;
}

async function patchFields(subscriberId: string, patch: Record<string, unknown>) {
  const current = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
  const merged = { ...((current?.customFields as object) ?? {}), ...patch };
  return prisma.subscriber.update({ where: { id: subscriberId }, data: { customFields: merged as any } });
}

interface Condition {
  type?: 'label' | 'field' | 'message' | 'hours' | 'window';
  key?: string;
  op?: string;
  value?: unknown;
}

async function evaluate(cond: Condition, sub: SubscriberRow, message: string): Promise<boolean> {
  const text = (v: unknown) => String(v ?? '').toLowerCase();
  const compare = (actual: unknown, op: string, expected: unknown) => {
    switch (op) {
      case 'eq':
        return text(actual) === text(expected);
      case 'neq':
        return text(actual) !== text(expected);
      case 'contains':
        return text(actual).includes(text(expected));
      case 'starts':
        return text(actual).startsWith(text(expected));
      case 'gt':
        return Number(actual) > Number(expected);
      case 'lt':
        return Number(actual) < Number(expected);
      case 'exists':
        return actual !== undefined && actual !== null && actual !== '';
      case 'empty':
        return actual === undefined || actual === null || actual === '';
      default:
        return false;
    }
  };
  switch (cond.type) {
    case 'label': {
      const has = await prisma.subscriberLabel.count({ where: { subscriberId: sub.id, label: { name: String(cond.value ?? '') } } });
      return cond.op === 'not_has' ? has === 0 : has > 0;
    }
    case 'field': {
      const fields = (sub.customFields ?? {}) as Record<string, unknown>;
      const actual = cond.key === 'name' ? sub.name : cond.key === 'email' ? sub.email : cond.key === 'phone' ? sub.phone : fields[cond.key ?? ''];
      return compare(actual, cond.op ?? 'eq', cond.value);
    }
    case 'message':
      return compare(message, cond.op ?? 'contains', cond.value);
    case 'hours': {
      const open = isOpenNow(await getSetting('businessHours'));
      return cond.op === 'closed' ? !open : open;
    }
    case 'window': {
      const inside = await withinServiceWindow(sub.id);
      return cond.op === 'outside' ? !inside : inside;
    }
    default:
      return false;
  }
}

async function startSession(subscriberId: string, sequenceId: string, awaitingOrder: number) {
  await prisma.flowSession.updateMany({ where: { subscriberId, status: 'active' }, data: { status: 'done' } });
  await prisma.flowSession.create({ data: { subscriberId, sequenceId, awaitingOrder } });
}

/**
 * Ejecuta un flujo/secuencia para un suscriptor desde `startOrder`.
 *
 * Acciones: send_text, send_media, send_template, send_buttons, send_list, ask, condition, wait, http_request,
 * set_field, add_label, remove_label, assign_human, enroll_sequence, goto, end.
 *
 * - `send_buttons`, `send_list` y `ask` dejan una FlowSession a la espera de la respuesta del cliente.
 * - `wait` (o delayDays > 0) NO bloquea: programa un ScheduledJob que reanuda el flujo (lo procesa /api/cron/tick).
 * - Las ramas se expresan con números de paso (`next`, `then`, `else`, `to`); sin destino se sigue en orden.
 */
export async function runFlow(params: { phone: string; flow: Flow; startOrder?: number; message?: string; resuming?: boolean }): Promise<FlowResult> {
  let sub = await prisma.subscriber.findUnique({ where: { phone: params.phone } });
  if (!sub) throw new Error('subscriber_not_found');

  const sorted = [...params.flow.steps].sort((a, b) => a.order - b.order);
  const executed: string[] = [];
  const message = params.message ?? '';

  let i = params.startOrder === undefined ? 0 : sorted.findIndex((s) => s.order >= params.startOrder!);
  const startIndex = i;
  const jump = (target: unknown): number => {
    if (target === undefined || target === null || target === '') return i + 1;
    return sorted.findIndex((s) => s.order === Number(target));
  };
  const send = (content: OutgoingContent) => sendMessage({ phone: params.phone, content, sender: 'bot' });

  for (let guard = 0; i >= 0 && i < sorted.length && guard < MAX_STEPS; guard++) {
    const step = sorted[i];
    const p = step.params ?? {};
    const isFirstResumed = params.resuming && i === startIndex;

    // Retraso propio del paso (secuencias drip: "día 1, día 3…")
    const delayMs = Math.max(0, step.delayDays ?? 0) * 86_400_000 + Math.max(0, Number(p.minutes ?? 0)) * 60_000;
    if (delayMs > 0 && !isFirstResumed) {
      const isWait = step.action === 'wait';
      const resumeOrder = isWait ? followingOrder(sorted, step.order) : step.order;
      if (resumeOrder === undefined) return { ok: true, executed };
      await prisma.scheduledJob.create({ data: { subscriberId: sub.id, sequenceId: params.flow.id, resumeOrder, runAt: new Date(Date.now() + delayMs) } });
      executed.push(`scheduled:${step.order}`);
      return { ok: true, executed, scheduled: true };
    }

    let next = i + 1;
    switch (step.action) {
      case 'send_text':
        await send({ type: 'text', body: String(p.body ?? '') });
        break;
      case 'send_media':
        await send({ type: 'media', kind: p.kind ?? 'image', url: String(p.url ?? ''), caption: p.caption, filename: p.filename });
        break;
      case 'send_template':
        await send({ type: 'template', name: String(p.templateName ?? ''), language: p.language, variables: p.variables });
        break;
      case 'send_buttons': {
        const buttons = (p.buttons ?? []).map((b: any, idx: number) => ({ id: `o${step.order}_${idx}`, title: String(b.title ?? '') }));
        const result = await send({ type: 'buttons', body: String(p.body ?? ''), buttons, footer: p.footer });
        if (!result.ok) return { ok: false, executed };
        await startSession(sub.id, params.flow.id, step.order);
        executed.push(`${step.action}:${step.order}`);
        return { ok: true, executed, awaiting: true };
      }
      case 'send_list': {
        const rows = (p.rows ?? []).map((r: any, idx: number) => ({ id: `o${step.order}_${idx}`, title: String(r.title ?? ''), description: r.description }));
        const result = await send({ type: 'list', body: String(p.body ?? ''), buttonText: String(p.buttonText ?? 'Ver opciones'), rows });
        if (!result.ok) return { ok: false, executed };
        await startSession(sub.id, params.flow.id, step.order);
        executed.push(`${step.action}:${step.order}`);
        return { ok: true, executed, awaiting: true };
      }
      case 'ask': {
        const result = await send({ type: 'text', body: String(p.body ?? '') });
        if (!result.ok) return { ok: false, executed };
        await startSession(sub.id, params.flow.id, step.order);
        executed.push(`${step.action}:${step.order}`);
        return { ok: true, executed, awaiting: true };
      }
      case 'condition': {
        const conditions: Condition[] = p.conditions ?? [];
        const results = await Promise.all(conditions.map((c) => evaluate(c, sub!, message)));
        const pass = conditions.length === 0 ? true : p.match === 'any' ? results.some(Boolean) : results.every(Boolean);
        next = pass ? jump(p.then) : jump(p.else);
        break;
      }
      case 'http_request': {
        try {
          const url = assertPublicUrl(renderVars(String(p.url ?? ''), sub));
          const method = String(p.method ?? 'GET').toUpperCase();
          const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...(p.headers ?? {}) },
            body: method === 'GET' || method === 'HEAD' ? undefined : renderVars(typeof p.body === 'string' ? p.body : JSON.stringify(p.body ?? {}), sub),
            signal: AbortSignal.timeout(8000),
          });
          if (p.saveField) {
            const data = await res.json().catch(() => null);
            const value = p.savePath ? getPath(data, String(p.savePath)) : data;
            sub = await patchFields(sub.id, { [String(p.saveField)]: value });
          }
          executed.push(`http:${res.status}`);
        } catch (e) {
          executed.push(`http_error:${(e as Error).message}`);
        }
        break;
      }
      case 'set_field':
        sub = await patchFields(sub.id, { [String(p.field ?? '')]: renderVars(String(p.value ?? ''), sub) });
        break;
      case 'add_label':
        if (p.label) await addLabelWithTriggers(sub.id, String(p.label));
        break;
      case 'remove_label':
        if (p.label) await removeLabel(sub.id, String(p.label));
        break;
      case 'assign_human': {
        const conversation = await getOrCreateConversation(sub.id);
        await prisma.conversation.update({ where: { id: conversation.id }, data: { assignedTo: String(p.member || 'human'), status: 'pending' } });
        if (p.body) await send({ type: 'text', body: String(p.body) });
        executed.push(`${step.action}:${step.order}`);
        return { ok: true, executed };
      }
      case 'enroll_sequence':
        if (p.sequenceId) {
          const { triggerSequenceForSubscriber } = await import('../domain/sequences.js');
          await triggerSequenceForSubscriber({ phone: params.phone, sequenceId: String(p.sequenceId) }).catch(() => undefined);
        }
        break;
      case 'goto':
        next = jump(p.to);
        break;
      case 'end':
        executed.push(`${step.action}:${step.order}`);
        return { ok: true, executed };
      case 'wait':
        break; // sin retraso configurado: no hace nada
      default:
        break;
    }
    executed.push(`${step.action}:${step.order}`);
    i = next;
  }
  return { ok: true, executed };
}

function validInput(kind: string | undefined, text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  switch (kind) {
    case 'number':
      return value !== '' && !Number.isNaN(Number(value.replace(',', '.')));
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'phone':
      return value.replace(/[^\d]/g, '').length >= 7;
    default:
      return true;
  }
}

/** ¿Tiene el contacto una FlowSession activa (esperando respuesta)? */
export function findActiveSession(subscriberId: string) {
  return prisma.flowSession.findFirst({
    where: { subscriberId, status: 'active', updatedAt: { gte: new Date(Date.now() - SESSION_TTL_MS) } },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Reanuda una sesión con la respuesta del cliente. Devuelve handled=true si el flujo consumió el mensaje.
 */
export async function resumeFlowSession(params: { phone: string; sessionId: string; text: string; interactiveId?: string }): Promise<{ handled: boolean }> {
  const session = await prisma.flowSession.findUnique({ where: { id: params.sessionId }, include: { sequence: { include: { steps: true } } } });
  if (!session || session.status !== 'active') return { handled: false };
  const flow: Flow = { id: session.sequence.id, name: session.sequence.name, steps: session.sequence.steps as FlowStep[] };
  const sorted = [...flow.steps].sort((a, b) => a.order - b.order);
  const step = sorted.find((s) => s.order === session.awaitingOrder);
  if (!step) {
    await prisma.flowSession.update({ where: { id: session.id }, data: { status: 'done' } });
    return { handled: false };
  }
  const p = step.params ?? {};
  const resume = (order: number | undefined) =>
    order === undefined ? Promise.resolve() : runFlow({ phone: params.phone, flow, startOrder: order, message: params.text, resuming: true });

  if (step.action === 'ask') {
    if (!validInput(p.validate, params.text)) {
      await sendMessage({ phone: params.phone, content: { type: 'text', body: String(p.errorText ?? 'Ese dato no parece válido, inténtalo de nuevo.') }, sender: 'bot' });
      await prisma.flowSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
      return { handled: true };
    }
    if (p.field) await patchFields(session.subscriberId, { [String(p.field)]: p.validate === 'number' ? Number(params.text.replace(',', '.')) : params.text.trim() });
    await prisma.flowSession.update({ where: { id: session.id }, data: { status: 'done' } });
    await resume(p.next !== undefined && p.next !== '' ? Number(p.next) : followingOrder(sorted, step.order));
    return { handled: true };
  }

  if (step.action === 'send_buttons' || step.action === 'send_list') {
    const options: Array<{ title?: string; next?: number }> = step.action === 'send_buttons' ? p.buttons ?? [] : p.rows ?? [];
    const wanted = params.text.trim().toLowerCase();
    const index = options.findIndex((o, idx) => params.interactiveId === `o${step.order}_${idx}` || String(o.title ?? '').toLowerCase() === wanted);
    if (index < 0) {
      await prisma.flowSession.update({ where: { id: session.id }, data: { status: 'done' } });
      return { handled: false };
    }
    await prisma.flowSession.update({ where: { id: session.id }, data: { status: 'done' } });
    const target = options[index].next;
    await resume(target !== undefined && target !== null && String(target) !== '' ? Number(target) : followingOrder(sorted, step.order));
    return { handled: true };
  }

  await prisma.flowSession.update({ where: { id: session.id }, data: { status: 'done' } });
  return { handled: false };
}
