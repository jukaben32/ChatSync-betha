import { prisma } from '../prisma.js';
import { sendWhatsAppText } from '../whatsapp/client.js';
import { runFlow } from '../flows/engine.js';
import { runAgentTurn } from '../ai/agent.js';

export interface InboundContext {
  phone: string;
  name?: string;
  body?: string;
  mediaUrl?: string;
  providerMessageId?: string;
  direction?: 'inbound' | 'outbound';
}

/**
 * Procesa un inbound de WhatsApp: upsert de suscriptor, conversación,
 * mensaje, y disparo del flujo (bot / AI agent).
 */
export async function handleInbound(params: InboundContext) {
  const { phone, name, body, mediaUrl, providerMessageId, direction = 'inbound' } = params;

  const subscriber = await prisma.subscriber.upsert({
    where: { phone },
    update: { name: name ?? undefined },
    create: { phone, name: name ?? undefined },
  });

  const conversation = await prisma.conversation.create({
    data: { subscriberId: subscriber.id, status: 'open' },
  });

  if (providerMessageId) {
    await prisma.message.create({
      data: { conversationId: conversation.id, direction, providerMessageId, body: body ?? '' },
    });
  }

  // Bot flow: si hay pasos configurados, se dispara el flujo (o el agente)
  const flow = await prisma.sequence.findFirst({
    where: { steps: { some: { action: 'send_text' } } },
    include: { steps: true },
  });

  if (flow) {
    await runFlow({ phone, flow: { id: flow.id, name: flow.name, steps: flow.steps as any } });
  }

  // AI agent turn (OpenAI-compatible). Disabled unless configured.
  if (process.env.AI_AGENT_ENABLED !== 'false') {
    const agentResult = await runAgentTurn({
      messages: [{ role: 'user', content: `WhatsApp inbound from ${phone}: ${body ?? ''}`.trim() }],
    });
    // Agentic responses would be executed via executeChatsycsTool inside runAgentTurn.
    // Persist final agent content as an outbound message when it carries text.
    if (agentResult.content) {
      await sendWhatsAppText({ to: phone, body: agentResult.content });
    }
  }

  return { subscriber, conversation };
}

/**
 * Envía una respuesta dentro de la conversación (outbound).
 */
export async function handleOutbound(params: { conversationId: string; body: string; providerMessageId?: string }) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: { subscriber: true },
  });
  if (!conversation) throw new Error('conversation_not_found');
  const to = conversation.subscriber.phone;
  const { providerMessageId } = await sendWhatsAppText({ to, body: params.body });
  const message = await prisma.message.create({
    data: { conversationId: params.conversationId, direction: 'outbound', providerMessageId, body: params.body },
  });
  return message;
}
