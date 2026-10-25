import { prisma } from '../prisma.js';
import { sendWhatsAppText, sendWhatsAppTemplate } from '../whatsapp/client.js';

export async function sendBroadcast(params: { broadcastId: string }) {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: params.broadcastId } });
  if (!broadcast) throw new Error('broadcast_not_found');
  if (broadcast.status === 'sent') throw new Error('broadcast_already_sent');

  const audience = (broadcast.audience ?? {}) as { labels?: string[]; all?: boolean };
  const subscribers = await prisma.subscriber.findMany({
    where: audience.all ? undefined : audience.labels?.length ? { labels: { some: { label: { name: { in: audience.labels } } } } } : {},
  });

  let sentCount = 0;
  let deliveredCount = 0;

  for (const subscriber of subscribers) {
    try {
      if (broadcast.contentType === 'template') {
        const templateName = String(broadcast.content ?? '');
        const { providerMessageId } = await sendWhatsAppTemplate({ to: subscriber.phone, templateName });
        deliveredCount += 1;
      } else {
        const { providerMessageId } = await sendWhatsAppText({ to: subscriber.phone, body: broadcast.content });
        deliveredCount += 1;
      }
      sentCount += 1;
    } catch (error) {
      // log and continue with the rest of the audience
    }
  }

  await prisma.broadcast.update({
    where: { id: params.broadcastId },
    data: { status: 'sent', sentCount, deliveredCount },
  });

  return { ok: true, broadcastId: params.broadcastId, sentCount, deliveredCount };
}
