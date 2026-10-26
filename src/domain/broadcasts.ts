import { prisma } from '../prisma.js';
import { whatsappConfigured } from '../config.js';
import { emitEvent } from './events.js';
import { sendMessage } from './messaging.js';
import { getSetting } from './settings.js';
import type { OutgoingContent } from './messaging.js';

const BATCH = 10;

export interface FieldFilter {
  field: string;
  op: 'eq' | 'neq' | 'contains' | 'exists';
  value?: string;
}

export interface Audience {
  all?: boolean;
  labels?: string[];
  excludeLabels?: string[];
  fields?: FieldFilter[];
}

function matchesField(customFields: unknown, filter: FieldFilter) {
  const actual = ((customFields ?? {}) as Record<string, unknown>)[filter.field];
  const a = String(actual ?? '').toLowerCase();
  const v = String(filter.value ?? '').toLowerCase();
  switch (filter.op) {
    case 'eq':
      return a === v;
    case 'neq':
      return a !== v;
    case 'contains':
      return a.includes(v);
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
  }
}

/** Resuelve la audiencia: etiquetas incluidas/excluidas y filtros por campos personalizados. Excluye bloqueados y bajas. */
export async function resolveAudience(audience: Audience) {
  const subscribers = await prisma.subscriber.findMany({
    where: {
      blocked: false,
      optedOut: false,
      ...(audience.labels?.length ? { labels: { some: { label: { name: { in: audience.labels } } } } } : {}),
      ...(audience.excludeLabels?.length ? { NOT: { labels: { some: { label: { name: { in: audience.excludeLabels } } } } } } : {}),
    },
  });
  const filters = audience.fields ?? [];
  return filters.length ? subscribers.filter((s) => filters.every((f) => matchesField(s.customFields, f))) : subscribers;
}

function contentFor(broadcast: { contentType: string; content: string; language: string; mediaUrl: string | null; buttons: unknown }): OutgoingContent {
  const buttons = Array.isArray(broadcast.buttons) ? (broadcast.buttons as Array<{ title?: string }>).filter((b) => b.title) : [];
  if (broadcast.contentType === 'template') return { type: 'template', name: broadcast.content, language: broadcast.language };
  if (broadcast.mediaUrl) return { type: 'media', kind: 'image', url: broadcast.mediaUrl, caption: broadcast.content };
  if (buttons.length) return { type: 'buttons', body: broadcast.content, buttons: buttons.map((b, i) => ({ id: `bc_${i}`, title: String(b.title) })) };
  return { type: 'text', body: broadcast.content };
}

/**
 * Envía un broadcast a la audiencia y guarda un BroadcastRecipient por contacto. Los textos admiten {{name}} y
 * {{campo}}. Los estados delivered/read llegan después por el webhook de Meta.
 */
export async function sendBroadcast(params: { broadcastId: string }) {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: params.broadcastId } });
  if (!broadcast) throw new Error('broadcast_not_found');
  if (broadcast.status === 'sent' || broadcast.status === 'sending') throw new Error('broadcast_already_sent');
  if (!whatsappConfigured() && !(await getSetting('sandbox')).enabled) throw new Error('whatsapp_not_configured');

  const subscribers = await resolveAudience((broadcast.audience ?? {}) as Audience);
  await prisma.broadcast.update({ where: { id: broadcast.id }, data: { status: 'sending' } });

  const content = contentFor(broadcast);
  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < subscribers.length; i += BATCH) {
    await Promise.all(
      subscribers.slice(i, i + BATCH).map(async (subscriber) => {
        // sendMessage registra el mensaje en la conversación del contacto (con variables ya resueltas)
        // y respeta bloqueos y la regla de las 24 h: texto libre solo dentro de la ventana, plantillas siempre.
        const result = await sendMessage({ phone: subscriber.phone, content, sender: 'broadcast' });
        await prisma.broadcastRecipient.create({
          data: {
            broadcastId: broadcast.id,
            subscriberId: subscriber.id,
            providerMessageId: result.providerMessageId,
            status: result.ok ? 'sent' : 'failed',
            error: result.error?.slice(0, 500),
          },
        });
        if (result.ok) sentCount += 1;
        else failedCount += 1;
      }),
    );
  }

  await prisma.broadcast.update({ where: { id: broadcast.id }, data: { status: 'sent', sentCount, failedCount } });
  await emitEvent('broadcast.sent', { broadcastId: broadcast.id, sentCount, failedCount });
  return { ok: true, broadcastId: broadcast.id, audience: subscribers.length, sentCount, failedCount };
}

/** Envía los broadcasts programados cuya hora ya llegó. Lo invoca /api/cron/tick. */
export async function processScheduledBroadcasts() {
  const due = await prisma.broadcast.findMany({ where: { status: 'scheduled', scheduledAt: { lte: new Date() } }, take: 3 });
  const results = [];
  for (const b of due) {
    // reclamar para evitar doble envío con ticks concurrentes
    const claimed = await prisma.broadcast.updateMany({ where: { id: b.id, status: 'scheduled' }, data: { status: 'draft' } });
    if (!claimed.count) continue;
    try {
      results.push(await sendBroadcast({ broadcastId: b.id }));
    } catch (error) {
      await prisma.broadcast.update({ where: { id: b.id }, data: { status: 'failed' } });
      results.push({ ok: false, broadcastId: b.id, error: (error as Error).message });
    }
  }
  return results;
}
