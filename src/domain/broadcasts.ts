import { prisma } from '../prisma.js';
import { whatsappConfigured } from '../config.js';
import { sendWhatsAppTemplate, sendWhatsAppText } from '../whatsapp/client.js';
import { emitEvent } from './events.js';

const BATCH = 10;

/**
 * Envía un broadcast a la audiencia (todos o por etiquetas) y guarda un BroadcastRecipient por contacto.
 * Los estados delivered/read llegan después por el webhook de Meta.
 */
export async function sendBroadcast(params: { broadcastId: string }) {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: params.broadcastId } });
  if (!broadcast) throw new Error('broadcast_not_found');
  if (broadcast.status === 'sent' || broadcast.status === 'sending') throw new Error('broadcast_already_sent');
  if (!whatsappConfigured()) throw new Error('whatsapp_not_configured');

  const audience = (broadcast.audience ?? {}) as { labels?: string[]; all?: boolean };
  const subscribers = await prisma.subscriber.findMany({
    where: {
      blocked: false,
      optedOut: false,
      ...(audience.all || !audience.labels?.length ? {} : { labels: { some: { label: { name: { in: audience.labels } } } } }),
    },
  });

  await prisma.broadcast.update({ where: { id: broadcast.id }, data: { status: 'sending' } });
  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < subscribers.length; i += BATCH) {
    const batch = subscribers.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (subscriber) => {
        try {
          const { providerMessageId } =
            broadcast.contentType === 'template'
              ? await sendWhatsAppTemplate({ to: subscriber.phone, templateName: broadcast.content, languageCode: broadcast.language })
              : await sendWhatsAppText({ to: subscriber.phone, body: broadcast.content });
          await prisma.broadcastRecipient.create({
            data: { broadcastId: broadcast.id, subscriberId: subscriber.id, providerMessageId, status: 'sent' },
          });
          sentCount += 1;
        } catch (error) {
          await prisma.broadcastRecipient.create({
            data: { broadcastId: broadcast.id, subscriberId: subscriber.id, status: 'failed', error: (error as Error).message.slice(0, 500) },
          });
          failedCount += 1;
        }
      }),
    );
  }

  await prisma.broadcast.update({ where: { id: broadcast.id }, data: { status: 'sent', sentCount, failedCount } });
  await emitEvent('broadcast.sent', { broadcastId: broadcast.id, sentCount, failedCount });
  return { ok: true, broadcastId: broadcast.id, audience: subscribers.length, sentCount, failedCount };
}
