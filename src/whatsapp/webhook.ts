import { createHmac, timingSafeEqual } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { handleInbound, handleStatusUpdate } from '../domain/inbound.js';

interface WaMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  image?: { id?: string; caption?: string };
  document?: { id?: string; filename?: string; caption?: string };
  audio?: { id?: string };
  video?: { id?: string; caption?: string };
  location?: { latitude?: number; longitude?: number; name?: string };
}

interface WaStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

interface WaPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: WaMessage[];
        statuses?: WaStatus[];
      };
    }>;
  }>;
}

function messageText(msg: WaMessage): string {
  return (
    msg.text?.body ??
    msg.button?.text ??
    msg.interactive?.button_reply?.title ??
    msg.interactive?.list_reply?.title ??
    msg.image?.caption ??
    msg.video?.caption ??
    msg.document?.caption ??
    msg.document?.filename ??
    (msg.location ? `📍 ${msg.location.name ?? ''} (${msg.location.latitude}, ${msg.location.longitude})`.trim() : '') ??
    ''
  );
}

function validSignature(rawBody: Buffer | undefined, header: string | undefined) {
  if (!config.whatsapp.appSecret) return true; // sin app secret no se puede validar
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex');
  const received = header.slice(7);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export async function whatsappRoutes(app: FastifyInstance) {
  app.get('/webhook', async (request, reply) => {
    const query = request.query as Record<string, string>;
    if (query['hub.mode'] !== 'subscribe' || query['hub.verify_token'] !== config.whatsapp.webhookVerifyToken) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return reply.type('text/plain').send(query['hub.challenge']);
  });

  app.post('/webhook', async (request, reply) => {
    const rawBody = (request as any).rawBody as Buffer | undefined;
    if (!validSignature(rawBody, request.headers['x-hub-signature-256'] as string | undefined)) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    const payload = request.body as WaPayload;
    for (const entry of payload?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        const names = new Map((value.contacts ?? []).map((c) => [c.wa_id ?? '', c.profile?.name]));

        for (const msg of value.messages ?? []) {
          if (!msg.from) continue;
          try {
            await handleInbound({
              phone: msg.from,
              name: names.get(msg.from),
              body: messageText(msg),
              providerMessageId: msg.id,
              messageType: msg.type,
            });
          } catch (error) {
            request.log.error({ err: error, from: msg.from }, 'whatsapp_inbound_failed');
          }
        }

        for (const status of value.statuses ?? []) {
          if (!status.id || !status.status) continue;
          try {
            await handleStatusUpdate({
              providerMessageId: status.id,
              status: status.status,
              error: status.errors?.[0]?.message ?? status.errors?.[0]?.title,
            });
          } catch (error) {
            request.log.error({ err: error }, 'whatsapp_status_failed');
          }
        }
      }
    }
    // Meta reintenta si no recibe 200: siempre confirmamos tras procesar.
    return reply.send({ received: true });
  });
}
