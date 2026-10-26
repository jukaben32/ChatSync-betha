import { prisma } from '../prisma.js';
import { runFlow } from '../flows/engine.js';
import { agentReady, runAgentTurn } from '../ai/agent.js';
import { emitEvent } from './events.js';
import { getOrCreateConversation, sendAndRecord } from './messaging.js';

export interface InboundContext {
  phone: string;
  name?: string;
  body?: string;
  providerMessageId?: string;
  messageType?: string;
}

const STOP_WORDS = ['stop', 'baja', 'cancelar suscripcion', 'cancelar suscripción'];

/**
 * Procesa un mensaje entrante de WhatsApp:
 * 1) upsert del suscriptor y de la conversación abierta, 2) guarda el mensaje (idempotente por id de Meta),
 * 3) si la conversación está en manos de un humano no responde el bot, 4) si coincide una palabra clave
 * dispara el flujo, 5) si no, responde el agente de IA (si está configurado).
 */
export async function handleInbound(params: InboundContext) {
  const { phone, name, body = '', providerMessageId, messageType } = params;

  const existingSubscriber = await prisma.subscriber.findUnique({ where: { phone } });
  const subscriber = await prisma.subscriber.upsert({
    where: { phone },
    update: name && !existingSubscriber?.name ? { name } : {},
    create: { phone, name, source: 'whatsapp' },
  });
  if (!existingSubscriber) await emitEvent('subscriber.created', { phone, name });

  if (providerMessageId) {
    const duplicate = await prisma.message.findFirst({ where: { providerMessageId } });
    if (duplicate) return { subscriber, conversationId: duplicate.conversationId, duplicate: true };
  }

  const conversation = await getOrCreateConversation(subscriber.id);
  const reopened = conversation.status === 'pending' || conversation.status === 'solved';
  await prisma.message.create({
    data: { conversationId: conversation.id, direction: 'inbound', providerMessageId, body, status: 'received', metadata: { type: messageType ?? 'text' } },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date(), ...(reopened && !conversation.assignedTo ? { status: 'open' } : {}) },
  });
  await emitEvent('message.received', { phone, conversationId: conversation.id, body, type: messageType ?? 'text' });

  const text = body.trim().toLowerCase();
  if (STOP_WORDS.includes(text)) {
    await prisma.subscriber.update({ where: { id: subscriber.id }, data: { optedOut: true } });
    return { subscriber, conversationId: conversation.id, optedOut: true };
  }
  if (subscriber.blocked || subscriber.optedOut) return { subscriber, conversationId: conversation.id };

  // Conversación asignada a un humano: el bot no interviene.
  if (conversation.assignedTo) return { subscriber, conversationId: conversation.id, handledBy: 'human' };

  // 1) Flujo por palabra clave
  const flows = await prisma.sequence.findMany({
    where: { kind: 'flow', active: true, triggerKeyword: { not: null } },
    include: { steps: true },
  });
  const flow = flows.find((f) => f.triggerKeyword && text.includes(f.triggerKeyword.toLowerCase()));
  if (flow) {
    await runFlow({ phone, flow: { id: flow.id, name: flow.name, steps: flow.steps as any } });
    return { subscriber, conversationId: conversation.id, handledBy: 'flow', flow: flow.name };
  }

  // 2) Agente de IA
  if (agentReady()) {
    const recent = await prisma.message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: 12 });
    const history = recent
      .reverse()
      .filter((m) => m.body)
      .map((m) => ({ role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.body }));
    const result = await runAgentTurn({ phone, conversationId: conversation.id, history });
    if (result.ok && result.content) {
      await sendAndRecord({ phone, body: result.content, conversationId: conversation.id });
      return { subscriber, conversationId: conversation.id, handledBy: 'ai', handover: result.handover };
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
  await emitEvent('message.status', { providerMessageId, status });
}

/** Envía una respuesta manual desde el inbox. */
export async function handleOutbound(params: { conversationId: string; body: string }) {
  const conversation = await prisma.conversation.findUnique({ where: { id: params.conversationId }, include: { subscriber: true } });
  if (!conversation) throw new Error('conversation_not_found');
  return sendAndRecord({ phone: conversation.subscriber.phone, body: params.body, conversationId: conversation.id });
}
