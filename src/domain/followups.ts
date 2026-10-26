import { prisma } from '../prisma.js';
import { agentReady, composeNudge } from '../ai/agent.js';
import { getSetting } from './settings.js';
import { sendMessage, withinServiceWindow } from './messaging.js';

const WINDOW_SAFETY_MS = 23 * 3_600_000; // WhatsApp cierra la ventana a las 24 h: se deja una hora de margen

/**
 * Seguimientos inteligentes: si el último mensaje de una conversación abierta (atendida por el bot) lo envió el negocio y el
 * cliente lleva `afterHours` sin contestar, se le envía un recordatorio breve. Máximo `maxNudges` por silencio y solo dentro de la
 * ventana de 24 h. Lo invoca /api/cron/tick.
 */
export async function processSmartFollowUps(now = new Date()) {
  const cfg = await getSetting('followups');
  if (!cfg.enabled) return { enabled: false, sent: 0, checked: 0 };

  const candidates = await prisma.conversation.findMany({
    where: {
      status: 'open',
      assignedTo: null,
      nudges: { lt: cfg.maxNudges },
      updatedAt: { lt: new Date(now.getTime() - cfg.afterHours * 3_600_000), gt: new Date(now.getTime() - WINDOW_SAFETY_MS) },
      subscriber: { blocked: false, optedOut: false },
    },
    include: { subscriber: true },
    orderBy: { updatedAt: 'asc' },
    take: 25,
  });

  let sent = 0;
  for (const c of candidates) {
    const last = await prisma.message.findFirst({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' } });
    // Solo si el cliente es quien no ha contestado, y la ventana sigue abierta
    if (!last || last.direction !== 'outbound' || last.status === 'failed') continue;
    if (!(await withinServiceWindow(c.subscriberId))) continue;

    let body = cfg.message.replace('{{name}}', c.subscriber.name ?? '').replace(/\s+([,.!?])/g, '$1').trim();
    if (cfg.useAi && agentReady()) {
      const recent = await prisma.message.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' }, take: 10 });
      const history = recent
        .reverse()
        .filter((m) => m.body)
        .map((m) => ({ role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.body }));
      body = (await composeNudge(c.subscriber.phone, history).catch(() => '')) || body;
    }
    if (!body) continue;

    const result = await sendMessage({ phone: c.subscriber.phone, content: { type: 'text', body }, conversationId: c.id, sender: 'smart_followup' });
    // Si falla no se reintenta en cada tick: se agotan los intentos de este silencio
    await prisma.conversation.update({ where: { id: c.id }, data: { nudges: result.ok ? { increment: 1 } : cfg.maxNudges } });
    if (result.ok) sent += 1;
  }
  return { enabled: true, sent, checked: candidates.length };
}
