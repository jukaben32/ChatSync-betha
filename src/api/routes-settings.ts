import { randomBytes } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { SCOPES, sha256 } from '../auth.js';
import { processDueJobs } from '../domain/sequences.js';
import { processScheduledBroadcasts } from '../domain/broadcasts.js';
import { emitEvent } from '../domain/events.js';
import { DEFAULTS, getSetting, setSetting } from '../domain/settings.js';
import type { SettingKey } from '../domain/settings.js';
import { assertPublicUrl } from '../util/net.js';
import { handleInbound } from '../domain/inbound.js';

// Tres interruptores independientes en ChatSyncs (entrante, saliente, estado); aquí se eligen por evento.
const EVENTS = ['message.received', 'message.sent', 'message.status', 'subscriber.created', 'conversation.updated', 'broadcast.sent'];

function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function settingsRoutes(app: FastifyInstance) {
  // ---------- Consola de pruebas: simula un mensaje de cliente (solo clave de administrador) ----------
  app.post('/api/simulate/inbound', async (request, reply) => {
    const b = request.body as { phone?: string; name?: string; body?: string; interactiveId?: string };
    const phone = String(b.phone ?? '').replace(/\D/g, '');
    if (phone.length < 7 || !b.body) return reply.code(400).send({ error: 'phone and body are required' });
    const result = await handleInbound({ phone, name: b.name, body: b.body, interactiveId: b.interactiveId, messageType: b.interactiveId ? 'interactive' : 'text', providerMessageId: `sim.${Date.now()}.${Math.random().toString(36).slice(2, 8)}` });
    return { ok: true, handledBy: (result as any).handledBy ?? null, conversationId: result.conversationId };
  });

  // ---------- Ajustes (horario comercial, IA, asignación) ----------
  app.get('/api/settings', async () => ({
    businessHours: await getSetting('businessHours'),
    ai: await getSetting('ai'),
    assignment: await getSetting('assignment'),
    sandbox: await getSetting('sandbox'),
    agent: await getSetting('agent'),
  }));

  app.put('/api/settings/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    if (!(key in DEFAULTS)) return reply.code(404).send({ error: 'unknown_setting' });
    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'object body required' });
    if (key === 'businessHours') {
      const tz = String(body.timezone ?? '');
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
      } catch {
        return reply.code(400).send({ error: 'invalid_timezone' });
      }
    }
    await setSetting(key as SettingKey, body);
    return getSetting(key as SettingKey);
  });

  // ---------- Equipo ----------
  app.get('/api/team', async () => prisma.teamMember.findMany({ orderBy: { createdAt: 'asc' } }));
  app.post('/api/team', async (request, reply) => {
    const body = request.body as { name?: string; email?: string; role?: string };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });
    const member = await prisma.teamMember.create({ data: { name: body.name, email: body.email, role: body.role === 'admin' ? 'admin' : 'agent' } });
    return reply.code(201).send(member);
  });
  app.delete('/api/team/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.teamMember.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Respuestas rápidas (canned responses) ----------
  app.get('/api/canned-responses', async () => prisma.cannedResponse.findMany({ orderBy: { shortcut: 'asc' } }));
  app.post('/api/canned-responses', async (request, reply) => {
    const body = request.body as { shortcut?: string; title?: string; body?: string };
    if (!body.shortcut || !body.body) return reply.code(400).send({ error: 'shortcut and body are required' });
    const shortcut = body.shortcut.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
    if (!shortcut) return reply.code(400).send({ error: 'invalid_shortcut' });
    const row = await prisma.cannedResponse.upsert({
      where: { shortcut },
      update: { title: body.title || shortcut, body: body.body },
      create: { shortcut, title: body.title || shortcut, body: body.body },
    });
    return reply.code(201).send(row);
  });
  app.delete('/api/canned-responses/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.cannedResponse.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Campos personalizados ----------
  app.get('/api/custom-fields', async () => prisma.customFieldDef.findMany({ orderBy: { key: 'asc' } }));
  app.post('/api/custom-fields', async (request, reply) => {
    const body = request.body as { key?: string; label?: string; type?: string };
    const key = (body.key ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
    if (!key) return reply.code(400).send({ error: 'key is required' });
    const type = ['text', 'number', 'date', 'boolean'].includes(body.type ?? '') ? body.type! : 'text';
    const row = await prisma.customFieldDef.upsert({ where: { key }, update: { label: body.label || key, type }, create: { key, label: body.label || key, type } });
    return reply.code(201).send(row);
  });
  app.delete('/api/custom-fields/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.customFieldDef.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Base de conocimiento (AI Agent) ----------
  app.get('/api/knowledge', async () =>
    prisma.knowledgeSource.findMany({ select: { id: true, type: true, title: true, sourceUrl: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
  );
  app.post('/api/knowledge', async (request, reply) => {
    const body = request.body as { type?: 'text' | 'url' | 'sheet'; title?: string; content?: string; url?: string };
    if (body.type === 'url' || body.type === 'sheet') {
      if (!body.url) return reply.code(400).send({ error: 'url is required' });
      let target: URL;
      try {
        target = assertPublicUrl(body.url);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
      // Google Sheets: se lee como CSV público (la hoja debe estar compartida con enlace)
      const sheet = body.type === 'sheet' && target.hostname === 'docs.google.com' ? target.pathname.match(/\/spreadsheets\/d\/([^/]+)/) : null;
      const fetchUrl = sheet ? `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv` : target.toString();
      const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(10_000), redirect: 'follow' }).catch(() => null);
      if (!res?.ok) return reply.code(502).send({ error: 'fetch_failed' });
      const raw = await res.text();
      const text = (sheet ? raw : htmlToText(raw)).slice(0, 20_000);
      if (!text) return reply.code(422).send({ error: 'empty_page' });
      const source = await prisma.knowledgeSource.create({
        data: { type: sheet ? 'sheet' : 'url', title: body.title || target.hostname, sourceUrl: target.toString(), content: text },
      });
      return reply.code(201).send({ id: source.id, title: source.title, chars: text.length });
    }
    if (!body.title || !body.content) return reply.code(400).send({ error: 'title and content are required' });
    const source = await prisma.knowledgeSource.create({ data: { type: 'text', title: body.title, content: body.content.slice(0, 20_000) } });
    return reply.code(201).send({ id: source.id, title: source.title });
  });
  app.delete('/api/knowledge/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.knowledgeSource.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Webhooks salientes ----------
  app.get('/api/webhooks', async () => ({ events: EVENTS, endpoints: await prisma.webhookEndpoint.findMany({ orderBy: { createdAt: 'desc' } }) }));
  app.post('/api/webhooks', async (request, reply) => {
    const body = request.body as { url?: string; events?: string[]; secret?: string };
    if (!body.url || !/^https?:\/\//.test(body.url)) return reply.code(400).send({ error: 'valid url is required' });
    const endpoint = await prisma.webhookEndpoint.create({
      data: { url: body.url, events: (body.events ?? []).filter((e) => EVENTS.includes(e)), secret: body.secret || randomBytes(16).toString('hex') },
    });
    return reply.code(201).send(endpoint);
  });
  app.patch('/api/webhooks/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { active?: boolean };
    return prisma.webhookEndpoint.update({ where: { id }, data: { active: body.active } });
  });
  app.delete('/api/webhooks/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.webhookEndpoint.delete({ where: { id } });
    return { ok: true };
  });
  app.post('/api/webhooks/test', async () => {
    await emitEvent('message.received', { test: true, name: 'Prueba', phone: '0000000000', message: 'ping desde ChatSyncs' });
    return { ok: true };
  });

  // ---------- API keys (con alcance) y registro de uso ----------
  app.get('/api/api-keys', async () =>
    prisma.apiKey.findMany({ select: { id: true, name: true, prefix: true, scopes: true, active: true, lastUsedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
  );
  app.post('/api/api-keys', async (request, reply) => {
    const body = request.body as { name?: string; scopes?: string[] };
    const scopes = (body.scopes ?? []).filter((s) => (SCOPES as string[]).includes(s));
    const key = 'cs_live_' + randomBytes(24).toString('hex');
    const record = await prisma.apiKey.create({ data: { name: body.name || 'API key', prefix: key.slice(0, 12), hash: sha256(key), scopes } });
    // La clave completa solo se muestra aquí, una vez.
    return reply.code(201).send({ id: record.id, name: record.name, scopes, key });
  });
  app.patch('/api/api-keys/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { active?: boolean; scopes?: string[]; name?: string };
    return prisma.apiKey.update({
      where: { id },
      data: { active: body.active, name: body.name, ...(body.scopes ? { scopes: body.scopes.filter((s) => (SCOPES as string[]).includes(s)) } : {}) },
      select: { id: true, name: true, prefix: true, scopes: true, active: true },
    });
  });
  app.delete('/api/api-keys/:id', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.apiKey.delete({ where: { id } });
    return { ok: true };
  });
  app.get('/api/api-logs', async () => prisma.apiLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));

  // ---------- Analítica ----------
  app.get('/api/analytics/overview', async () => {
    const since = new Date(Date.now() - 7 * 86_400_000);
    since.setHours(0, 0, 0, 0);
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    since30.setHours(0, 0, 0, 0);
    const [subscribers, newSubscribers, open, pending, solved, messages, broadcasts, deals, labels, sources, followUps, joined30, left30, b30] = await Promise.all([
      prisma.subscriber.count(),
      prisma.subscriber.count({ where: { createdAt: { gte: since } } }),
      prisma.conversation.count({ where: { status: 'open' } }),
      prisma.conversation.count({ where: { status: 'pending' } }),
      prisma.conversation.count({ where: { status: 'solved' } }),
      prisma.message.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, direction: true }, take: 20_000 }),
      prisma.broadcast.aggregate({ _sum: { sentCount: true, deliveredCount: true, readCount: true, failedCount: true }, _count: true }),
      prisma.crmDeal.groupBy({ by: ['stage'], _count: true, _sum: { value: true } }),
      prisma.label.findMany({ include: { _count: { select: { subscribers: true } } }, orderBy: { name: 'asc' }, take: 10 }),
      prisma.subscriber.groupBy({ by: ['source'], _count: true }),
      prisma.conversation.count({ where: { followUpAt: { lte: new Date() }, status: { in: ['open', 'pending'] } } }),
      prisma.subscriber.findMany({ where: { createdAt: { gte: since30 } }, select: { createdAt: true }, take: 20_000 }),
      prisma.subscriber.count({ where: { OR: [{ optedOut: true }, { blocked: true }], updatedAt: { gte: since30 } } }),
      prisma.broadcast.findMany({ where: { createdAt: { gte: since30 } }, select: { status: true, sentCount: true, readCount: true, failedCount: true } }),
    ]);
    const growth = new Map<string, number>();
    for (let i = 0; i < 31; i++) growth.set(new Date(since30.getTime() + i * 86_400_000).toISOString().slice(0, 10), 0);
    for (const j of joined30) {
      const k = j.createdAt.toISOString().slice(0, 10);
      if (growth.has(k)) growth.set(k, (growth.get(k) ?? 0) + 1);
    }
    const b30sent = b30.reduce((n, b) => n + b.sentCount, 0);
    const b30read = b30.reduce((n, b) => n + b.readCount, 0);

    const perDay = new Map<string, { date: string; inbound: number; outbound: number }>();
    for (let i = 0; i < 8; i++) {
      const d = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      perDay.set(d, { date: d, inbound: 0, outbound: 0 });
    }
    for (const m of messages) {
      const row = perDay.get(m.createdAt.toISOString().slice(0, 10));
      if (row) row[m.direction === 'inbound' ? 'inbound' : 'outbound'] += 1;
    }
    const sent = broadcasts._sum.sentCount ?? 0;
    const delivered = broadcasts._sum.deliveredCount ?? 0;
    const read = broadcasts._sum.readCount ?? 0;
    return {
      subscribers,
      newSubscribers,
      conversations: { open, pending, solved, followUpsDue: followUps },
      messagesPerDay: [...perDay.values()],
      broadcasts: {
        total: broadcasts._count,
        sent,
        delivered,
        read,
        failed: broadcasts._sum.failedCount ?? 0,
        deliveryRate: sent ? Math.round((delivered / sent) * 100) : 0,
        readRate: sent ? Math.round((read / sent) * 100) : 0,
      },
      growth30: { joined: joined30.length, left: left30, perDay: [...growth.entries()].map(([date, count]) => ({ date, count })) },
      broadcasts30: {
        campaigns: b30.length,
        completed: b30.filter((b) => b.status === 'sent').length,
        messagesSent: b30sent,
        failed: b30.reduce((n, b) => n + b.failedCount, 0),
        avgOpenRate: b30sent ? Math.round((b30read / b30sent) * 100) : 0,
      },
      deals: deals.map((d) => ({ stage: d.stage, count: d._count, value: d._sum.value ?? 0 })),
      labels: labels.map((l) => ({ name: l.name, subscribers: l._count.subscribers })),
      sources: sources.map((s) => ({ source: s.source ?? 'desconocido', subscribers: s._count })),
    };
  });

  // ---------- Cron (Vercel Cron o un disparador externo envían Authorization: Bearer $CRON_SECRET) ----------
  app.get('/api/cron/tick', async (request, reply) => {
    const auth = request.headers.authorization ?? '';
    if (!config.cronSecret || auth !== `Bearer ${config.cronSecret}`) return reply.code(401).send({ error: 'unauthorized' });
    const jobs = await processDueJobs();
    const broadcasts = await processScheduledBroadcasts();
    // Las sesiones de flujo caducan a las 24 h (fin de la ventana de servicio de WhatsApp)
    const expired = await prisma.flowSession.updateMany({ where: { status: 'active', updatedAt: { lt: new Date(Date.now() - 86_400_000) } }, data: { status: 'expired' } });
    return { ok: true, jobs, broadcasts, expiredSessions: expired.count };
  });
}
