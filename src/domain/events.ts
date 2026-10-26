import { createHmac } from 'node:crypto';
import { prisma } from '../prisma.js';

export type EventType =
  | 'message.received'
  | 'message.sent'
  | 'message.status'
  | 'subscriber.created'
  | 'conversation.updated'
  | 'broadcast.sent';

/**
 * Dispara los webhooks salientes suscritos al evento. Se espera su resolución (máx. 4 s)
 * porque en serverless la función se congela al responder.
 */
export async function emitEvent(type: EventType, data: Record<string, unknown>) {
  let endpoints: Array<{ id: string; url: string; secret: string | null; events: string[] }> = [];
  try {
    endpoints = await prisma.webhookEndpoint.findMany({ where: { active: true } });
  } catch {
    return;
  }
  const targets = endpoints.filter((e) => e.events.length === 0 || e.events.includes(type));
  if (!targets.length) return;

  const body = JSON.stringify({ type, data, createdAt: new Date().toISOString() });
  await Promise.allSettled(
    targets.map(async (endpoint) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-ChatSyncs-Event': type };
      if (endpoint.secret) {
        headers['X-ChatSyncs-Signature'] = 'sha256=' + createHmac('sha256', endpoint.secret).update(body).digest('hex');
      }
      await fetch(endpoint.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(4000) });
    }),
  );
}
