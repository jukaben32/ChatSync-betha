import { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { analyzeSubscriber, agentReady, rewriteReply, suggestReply, translateText } from '../ai/agent.js';
import { getSetting } from '../domain/settings.js';

async function history(conversationId: string) {
  const rows = await prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: 30 });
  return rows
    .reverse()
    .filter((m) => m.body)
    .map((m) => ({ role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.body }));
}

/** Herramientas de IA para el equipo humano (no responden al cliente por sí solas). */
export async function aiRoutes(app: FastifyInstance) {
  const guard = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    agentReady() ? null : reply.code(409).send({ error: 'agent_disabled', message: 'Falta AI_API_KEY' });

  app.post('/api/ai/rewrite', async (request, reply) => {
    const body = request.body as { text?: string; tone?: string };
    if (!body.text?.trim()) return reply.code(400).send({ error: 'text is required' });
    const blocked = guard(reply);
    if (blocked) return blocked;
    try {
      return { text: await rewriteReply(body.text.slice(0, 2000), body.tone) };
    } catch (e) {
      return reply.code(502).send({ error: 'ai_failed', message: (e as Error).message });
    }
  });

  app.post('/api/ai/translate', async (request, reply) => {
    const body = request.body as { text?: string; target?: string };
    if (!body.text?.trim()) return reply.code(400).send({ error: 'text is required' });
    const blocked = guard(reply);
    if (blocked) return blocked;
    try {
      const target = body.target || (await getSetting('agent')).translateLanguage;
      return { text: await translateText(body.text.slice(0, 2000), target), target };
    } catch (e) {
      return reply.code(502).send({ error: 'ai_failed', message: (e as Error).message });
    }
  });

  app.post('/api/conversations/:id/ai-suggest', async (request, reply) => {
    const { id } = request.params as { id: string };
    const conversation = await prisma.conversation.findUnique({ where: { id }, include: { subscriber: true } });
    if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
    const blocked = guard(reply);
    if (blocked) return blocked;
    try {
      return { text: await suggestReply(conversation.subscriber.phone, await history(id)) };
    } catch (e) {
      return reply.code(502).send({ error: 'ai_failed', message: (e as Error).message });
    }
  });

  // Subscriber IQ: resumen, lead score, riesgo de abandono, sentimiento y siguiente acción
  app.get('/api/subscribers/:phone/insights', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
    if (!subscriber) return reply.code(404).send({ error: 'subscriber_not_found' });
    const blocked = guard(reply);
    if (blocked) return blocked;
    const conversation = await prisma.conversation.findFirst({ where: { subscriberId: subscriber.id }, orderBy: { updatedAt: 'desc' } });
    if (!conversation) return reply.code(404).send({ error: 'no_conversation' });
    try {
      return await analyzeSubscriber(await history(conversation.id));
    } catch (e) {
      return reply.code(502).send({ error: 'ai_failed', message: (e as Error).message });
    }
  });
}
