import { prisma } from '../prisma.js';
import { runFlow, findActiveSession, resumeFlowSession } from '../flows/engine.js';
import { agentReady, runAgentTurn } from '../ai/agent.js';
import { markWhatsAppRead } from '../whatsapp/rich.js';
import { whatsappConfigured } from '../config.js';
import { emitEvent } from './events.js';
import { getOrCreateConversation, sendAndRecord, sendMessage } from './messaging.js';
import { getSetting, isOpenNow } from './settings.js';

export interface InboundContext {
  phone: string;
  name?: string;
  body?: string;
  providerMessageId?: string;
  messageType?: string;
  interactiveId?: string;
  /** Origen del lead, p. ej. "ctwa:<ad_id>" cuando llega desde un anuncio de Click-to-WhatsApp. */
  source?: string;
  mediaUrl?: string;
}

/** contains = el mensaje incluye la palabra · exact = el mensaje es exactamente la palabra · starts = empieza por ella */
export function matchesKeyword(text: string, keyword: string | null, matchType: string) {
  if (!keyword) return false;
  const k = keyword.trim().toLowerCase();
  const t = text.trim();
  if (matchType === 'exact') return t === k;
  if (matchType === 'starts') return t.startsWith(k);
  return t.includes(k);
}

/** Un botón de un broadcast fue pulsado: se cuenta como clic una sola vez por destinatario. */
async function registerBroadcastClick(subscriberId: string, buttonId: string, title: string) {
  const recipient = await prisma.broadcastRecipient.findFirst({
    where: { subscriberId, clickedAt: null, status: { in: ['sent', 'delivered', 'read'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!recipient) return;
  await prisma.broadcastRecipient.update({ where: { id: recipient.id }, data: { clickedAt: new Date(), clickedButton: (title || buttonId).slice(0, 64) } });
  await prisma.broadcast.update({ where: { id: recipient.broadcastId }, data: { clickedCount: { increment: 1 } } });
}

const STOP_WORDS = ['stop', 'baja', 'cancelar suscripcion', 'cancelar suscripción'];
const OFF_HOURS_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/** Al responder el cliente, las secuencias con "detener al responder" se paran y se cancelan sus pasos pendientes. */
async function stopSequencesOnReply(subscriberId: string) {
  const enrollments = await prisma.subscriberSequence.findMany({
    where: { subscriberId, status: 'active', sequence: { stopOnReply: true } },
    select: { sequenceId: true },
  });
  if (!enrollments.length) return;
  const ids = enrollments.map((e) => e.sequenceId);
  await prisma.subscriberSequence.updateMany({ where: { subscriberId, sequenceId: { in: ids } }, data: { status: 'stopped' } });
  await prisma.scheduledJob.updateMany({ where: { subscriberId, sequenceId: { in: ids }, status: 'pending' }, data: { status: 'cancelled' } });
}

/** Reparto equitativo: el miembro del equipo con menos conversaciones asignadas abiertas. */
async function pickRoundRobin(): Promise<string | null> {
  const members = await prisma.teamMember.findMany({ orderBy: { createdAt: 'asc' } });
  if (!members.length) return null;
  const counts = await Promise.all(members.map((m) => prisma.conversation.count({ where: { assignedTo: m.name, status: { in: ['open', 'pending'] } } })));
  let best = 0;
  counts.forEach((c, i) => {
    if (c < counts[best]) best = i;
  });
  return members[best].name;
}

/**
 * Procesa un mensaje entrante de WhatsApp. Orden de decisión:
 * guarda el mensaje (idempotente) → baja (STOP) → respuesta a un flujo en curso → conversación asignada a una persona
 * → horario comercial → palabra clave de flujo → agente de IA.
 */
export async function handleInbound(params: InboundContext) {
  const { phone, name, body = '', providerMessageId, messageType, interactiveId, source, mediaUrl } = params;

  const existingSubscriber = await prisma.subscriber.findUnique({ where: { phone } });
  const subscriber = await prisma.subscriber.upsert({
    where: { phone },
    update: { ...(name && !existingSubscriber?.name ? { name } : {}), ...(source && !existingSubscriber?.source ? { source } : {}) },
    create: { phone, name, source: source ?? 'whatsapp' },
  });
  if (!existingSubscriber) await emitEvent('subscriber.created', { phone, name, source: subscriber.source });

  if (providerMessageId) {
    const duplicate = await prisma.message.findFirst({ where: { providerMessageId } });
    if (duplicate) return { subscriber, conversationId: duplicate.conversationId, duplicate: true };
  }

  const conversation = await getOrCreateConversation(subscriber.id);
  const reopened = conversation.status === 'pending' || conversation.status === 'solved';
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'inbound',
      providerMessageId,
      body,
      mediaUrl,
      status: 'received',
      metadata: { type: messageType ?? 'text', ...(interactiveId ? { interactiveId } : {}) },
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date(), unread: true, nudges: 0, ...(reopened && !conversation.assignedTo ? { status: 'open' } : {}), followUpAt: null },
  });
  await emitEvent('message.received', { name: subscriber.name, phone, message: body, type: messageType ?? 'text', conversationId: conversation.id });
  if (providerMessageId && whatsappConfigured()) await markWhatsAppRead(providerMessageId);

  await stopSequencesOnReply(subscriber.id);
  if (interactiveId?.startsWith('bc_')) await registerBroadcastClick(subscriber.id, interactiveId, body);

  const text = body.trim().toLowerCase();
  if (STOP_WORDS.includes(text)) {
    await prisma.subscriber.update({ where: { id: subscriber.id }, data: { optedOut: true } });
    return { subscriber, conversationId: conversation.id, optedOut: true };
  }
  if (subscriber.blocked || subscriber.optedOut) return { subscriber, conversationId: conversation.id };

  // Reparto automático a un miembro del equipo (solo conversaciones nuevas sin asignar)
  if (!conversation.assignedTo && !existingSubscriber) {
    const assignment = await getSetting('assignment');
    if (assignment.mode === 'round_robin') {
      const member = await pickRoundRobin();
      if (member) {
        await prisma.conversation.update({ where: { id: conversation.id }, data: { assignedTo: member } });
        return { subscriber, conversationId: conversation.id, handledBy: 'human', assignedTo: member };
      }
    }
  }

  // 1) Respuesta a un flujo que esperaba al cliente (botones, lista o pregunta)
  const session = await findActiveSession(subscriber.id);
  if (session) {
    const resumed = await resumeFlowSession({ phone, sessionId: session.id, text: body, interactiveId });
    if (resumed.handled) return { subscriber, conversationId: conversation.id, handledBy: 'flow' };
  }

  // 2) Conversación en manos de una persona: el bot no interviene
  if (conversation.assignedTo) return { subscriber, conversationId: conversation.id, handledBy: 'human' };

  // 3) Horario comercial
  const hours = await getSetting('businessHours');
  if (hours.enabled && hours.offHoursBehavior !== 'ignore') {
    const open = isOpenNow(hours);
    if (hours.offHoursBehavior === 'bot_only_off_hours' && open) return { subscriber, conversationId: conversation.id, handledBy: 'human' };
    if (hours.offHoursBehavior === 'message' && !open) {
      const recent = await prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: 'outbound', createdAt: { gte: new Date(Date.now() - OFF_HOURS_COOLDOWN_MS) }, metadata: { path: ['sender'], equals: 'off_hours' } },
      });
      if (!recent) await sendMessage({ phone, content: { type: 'text', body: hours.offHoursMessage }, conversationId: conversation.id, sender: 'off_hours' });
      return { subscriber, conversationId: conversation.id, handledBy: 'off_hours' };
    }
    if (hours.offHoursBehavior === 'message' && open) return { subscriber, conversationId: conversation.id, handledBy: 'human' };
  }

  // 4) Flujo por palabra clave (en modo "fallback"; con IA en modo "all" la IA decide)
  const ai = await getSetting('ai');
  if (!(ai.mode === 'all' && agentReady())) {
    const flows = await prisma.sequence.findMany({ where: { kind: { in: ['flow', 'keyword'] }, active: true, triggerKeyword: { not: null } }, include: { steps: true } });
    const flow = flows.find((f) => matchesKeyword(text, f.triggerKeyword, f.matchType));
    if (flow) {
      await runFlow({ phone, flow: { id: flow.id, name: flow.name, steps: flow.steps as any }, message: body });
      return { subscriber, conversationId: conversation.id, handledBy: 'flow', flow: flow.name };
    }
  }

  // 5) Agente de IA
  if (agentReady()) {
    if (ai.delaySeconds > 0) await new Promise((r) => setTimeout(r, Math.min(ai.delaySeconds, 8) * 1000));
    const recent = await prisma.message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: 12 });
    const history = recent
      .reverse()
      .filter((m) => m.body)
      .map((m) => ({ role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.body }));
    const result = await runAgentTurn({ phone, conversationId: conversation.id, history });
    if (result.ok && result.content) {
      await sendAndRecord({ phone, body: result.content, conversationId: conversation.id, sender: 'ai' });
      return { subscriber, conversationId: conversation.id, handledBy: 'ai', handover: result.handover, actions: result.actions };
    }
  }
  return { subscriber, conversationId: conversation.id };
}

const STATUS_RANK: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3 };

/** Actualiza el estado de un mensaje y de su destinatario de broadcast (sent → delivered → read). */
export async function handleStatusUpdate(params: { providerMessageId: string; status: string; error?: string }) {
  const { providerMessageId, status, error } = params;

  const message = await prisma.message.findFirst({ where: { providerMessageId } });
  if (message && (STATUS_RANK[status] ?? -1) >= (STATUS_RANK[message.status] ?? 0)) {
    await prisma.message.update({
      where: { id: message.id },
      data: { status, ...(error ? { metadata: { ...(message.metadata as object), error } } : {}) },
    });
  }

  const recipient = await prisma.broadcastRecipient.findFirst({ where: { providerMessageId } });
  if (recipient && (STATUS_RANK[status] ?? -1) >= (STATUS_RANK[recipient.status] ?? 0)) {
    await prisma.broadcastRecipient.update({ where: { id: recipient.id }, data: { status, ...(error ? { error } : {}) } });
    const grouped = await prisma.broadcastRecipient.groupBy({ by: ['status'], where: { broadcastId: recipient.broadcastId }, _count: true });
    const count = (s: string) => grouped.find((g) => g.status === s)?._count ?? 0;
    await prisma.broadcast.update({
      where: { id: recipient.broadcastId },
      data: {
        sentCount: count('sent') + count('delivered') + count('read'),
        deliveredCount: count('delivered') + count('read'),
        readCount: count('read'),
        failedCount: count('failed'),
      },
    });
  }
  await emitEvent('message.status', { providerMessageId, status, wa_message_id: providerMessageId });
}

/** Envía una respuesta manual desde el inbox. */
export async function handleOutbound(params: { conversationId: string; body: string; sender?: string }) {
  const conversation = await prisma.conversation.findUnique({ where: { id: params.conversationId }, include: { subscriber: true } });
  if (!conversation) throw new Error('conversation_not_found');
  const { signature } = await getSetting('agent');
  const body = signature.trim() ? `${params.body}

${signature.trim()}` : params.body;
  return sendMessage({ phone: conversation.subscriber.phone, content: { type: 'text', body }, conversationId: conversation.id, sender: params.sender ?? 'agent' });
}
