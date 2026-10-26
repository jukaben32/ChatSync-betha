import { prisma } from '../prisma.js';
import { whatsappConfigured } from '../config.js';
import { sendWhatsAppText, sendWhatsAppTemplate } from '../whatsapp/client.js';
import { emitEvent } from './events.js';

/** Devuelve la conversación abierta del suscriptor, o crea una nueva. */
export async function getOrCreateConversation(subscriberId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { subscriberId, status: { not: 'solved' } },
    orderBy: { updatedAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.conversation.create({ data: { subscriberId, status: 'open' } });
}

export interface SendResult {
  ok: boolean;
  messageId: string;
  providerMessageId?: string;
  error?: string;
}

/**
 * Envía un mensaje (texto o plantilla) por WhatsApp y lo registra en la conversación.
 * Si WhatsApp no está configurado o Meta rechaza el envío, el mensaje queda guardado con status "failed".
 */
export async function sendAndRecord(params: {
  phone: string;
  body?: string;
  template?: { name: string; language?: string; variables?: string[] };
  conversationId?: string;
}): Promise<SendResult> {
  const subscriber = await prisma.subscriber.upsert({
    where: { phone: params.phone },
    update: {},
    create: { phone: params.phone },
  });
  const conversationId = params.conversationId ?? (await getOrCreateConversation(subscriber.id)).id;
  const text = params.template ? `[plantilla: ${params.template.name}]` : params.body ?? '';

  let providerMessageId: string | undefined;
  let error: string | undefined;
  if (subscriber.blocked || subscriber.optedOut) {
    error = subscriber.blocked ? 'subscriber_blocked' : 'subscriber_opted_out';
  } else if (!whatsappConfigured()) {
    error = 'whatsapp_not_configured';
  } else {
    try {
      const sent = params.template
        ? await sendWhatsAppTemplate({
            to: params.phone,
            templateName: params.template.name,
            languageCode: params.template.language,
            bodyUrlVariables: params.template.variables,
          })
        : await sendWhatsAppText({ to: params.phone, body: params.body ?? '' });
      providerMessageId = sent.providerMessageId;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      direction: 'outbound',
      providerMessageId,
      body: text,
      status: error ? 'failed' : 'sent',
      metadata: error ? { error } : {},
    },
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  await emitEvent('message.sent', { phone: params.phone, conversationId, messageId: message.id, status: message.status });

  return { ok: !error, messageId: message.id, providerMessageId, error };
}
