import { FastifyInstance } from 'fastify';
import { config } from '../config.js';

interface WhatsAppWebhookPayload {
  object: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        messages?: Array<{
          message?: {
            messageId?: string;
            from?: string;
            timestamp?: string;
            text?: { body?: string };
            interactive?: { type?: string; content?: { text?: { body?: string }; payload?: string } };
            image?: { id?: string; caption?: string };
            document?: { id?: string; filename?: string };
            audio?: { id?: string };
            video?: { id?: string };
            location?: { latitude?: number; longitude?: number; name?: string };
            contact?: { saves?: Array<{ phone?: string; name?: string }> };
          };
        }>;
        statuses?: Array<Record<string, unknown>>;
      };
    }>;
  }>;
}

export async function whatsappRoutes(app: FastifyInstance) {
  app.get('/webhook', async (request, reply) => {
    const query = request.query as any;
    const hubMode = query['hub.mode'];
    const hubVerifyToken = query['hub.verify_token'];
    const hubChallenge = query['hub.challenge'];
    if (hubMode !== 'subscribe' || hubVerifyToken !== config.whatsapp.webhookVerifyToken) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return reply.send(hubChallenge);
  });

  app.post('/webhook', async (request, reply) => {
    const payload = request.body as WhatsAppWebhookPayload;
    const changes = payload?.entry?.[0]?.changes ?? [];
    for (const change of changes) {
      const value = change?.value;
      const metadata = value?.metadata;
      const messages = value?.messages ?? [];
      const statusUpdates = value?.statuses ?? [];

      for (const message of messages) {
        const msg = message?.message;
        const from = msg?.from;
        if (!from) continue;
        const providerMessageId = msg?.messageId ?? '';
        const body =
          msg?.text?.body ??
          msg?.interactive?.content?.text?.body ??
          msg?.interactive?.content?.payload ??
          msg?.image?.caption ??
          msg?.document?.filename ??
          '';

        request.log.info(
          { from, providerMessageId, body, metadata },
          'whatsapp_inbound_message_received',
        );
        // TODO: persist inbound message into DB via Prisma
        // TODO: enqueue bot flow / AI agent trigger
      }

      for (const status of statusUpdates) {
        request.log.info({ status }, 'whatsapp_status_update');
      }
    }
    return reply.send({ received: true });
  });
}
