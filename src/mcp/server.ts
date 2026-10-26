import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { config, whatsappConfigured } from '../config.js';
import { agentReady } from '../ai/agent.js';
import { getSetting } from '../domain/settings.js';
import { sendMessage } from '../domain/messaging.js';
import { addLabelWithTriggers, removeLabel } from '../domain/labels.js';
import { enrollSubscriberInSequence, triggerBotFlowForSubscriber, triggerSequenceForSubscriber } from '../domain/sequences.js';
import { createMetaTemplate, listMetaTemplates } from '../whatsapp/client.js';
import { availableSlots, BookingError, bookSlot, cancelAppointment, formatSlot } from '../domain/booking.js';

const digits = (v: string) => v.replace(/\D/g, '');

/**
 * Servidor MCP de ChatSyncs. Cada herramienta ejecuta la lógica real (mismas funciones que la API REST),
 * así que un asistente (Claude, Cursor, Codex…) puede operar la cuenta. Sin herramientas de pagos, pedidos ni catálogo.
 */
export function createChatsycsMcpServer(): McpServer {
  const s = new McpServer({ name: 'chatsyncs', version: '2.0.0' }, { capabilities: { tools: {} } });

  const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
  const fail = (error: string) => ({ isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error }) }] });

  /** Registra una herramienta; cualquier excepción se devuelve como error de herramienta, no como fallo del protocolo. */
  const tool = <T extends z.ZodRawShape>(name: string, description: string, shape: T, run: (args: z.objectOutputType<T, z.ZodTypeAny>) => Promise<unknown>) =>
    s.registerTool(name, { description, inputSchema: shape }, (async (args: z.objectOutputType<T, z.ZodTypeAny>) => {
      try {
        return ok(await run(args));
      } catch (e) {
        return fail((e as Error).message);
      }
    }) as never);

  const subscriberBy = async (phone: string) => {
    const sub = await prisma.subscriber.findUnique({ where: { phone: digits(phone) } });
    if (!sub) throw new Error('subscriber_not_found');
    return sub;
  };

  // ---------- Mensajes y plantillas ----------
  tool('send_text_message', 'Envía un texto por WhatsApp. Solo dentro de las 24 h desde el último mensaje del cliente; si no, usa una plantilla.', { phone: z.string(), body: z.string() }, async (a) => ({
    ...(await sendMessage({ phone: digits(a.phone), content: { type: 'text', body: a.body }, sender: 'mcp' })),
  }));

  tool(
    'send_template_message',
    'Envía una plantilla aprobada por Meta (funciona fuera de la ventana de 24 h).',
    { phone: z.string(), templateName: z.string(), language: z.string().optional(), variables: z.array(z.string()).optional() },
    async (a) => ({ ...(await sendMessage({ phone: digits(a.phone), content: { type: 'template', name: a.templateName, language: a.language, variables: a.variables }, sender: 'mcp' })) }),
  );

  tool(
    'send_interactive_buttons',
    'Envía un mensaje con hasta 3 botones de respuesta rápida.',
    { phone: z.string(), body: z.string(), buttons: z.array(z.string()).min(1).max(3) },
    async (a) => ({ ...(await sendMessage({ phone: digits(a.phone), content: { type: 'buttons', body: a.body, buttons: a.buttons.map((title, i) => ({ id: `mcp_${i}`, title })) }, sender: 'mcp' })) }),
  );

  tool(
    'send_file',
    'Envía una imagen, documento, audio o vídeo por URL pública https.',
    { phone: z.string(), url: z.string().url(), kind: z.enum(['image', 'document', 'audio', 'video']).default('image'), caption: z.string().optional() },
    async (a) => ({ ...(await sendMessage({ phone: digits(a.phone), content: { type: 'media', kind: a.kind, url: a.url, caption: a.caption }, sender: 'mcp' })) }),
  );

  tool('get_message_status', 'Estado de un mensaje enviado (sent, delivered, read, failed) por su id de mensaje o de WhatsApp.', { messageId: z.string() }, async (a) => {
    const m = await prisma.message.findFirst({ where: { OR: [{ id: a.messageId.match(/^[0-9a-f-]{36}$/i) ? a.messageId : undefined }, { providerMessageId: a.messageId }] } });
    if (!m) throw new Error('message_not_found');
    return { id: m.id, providerMessageId: m.providerMessageId, status: m.status, createdAt: m.createdAt, metadata: m.metadata };
  });

  tool('list_templates', 'Lista las plantillas de WhatsApp guardadas y su estado.', {}, async () => prisma.template.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));

  tool('get_template_status', 'Estado de una plantilla. Si WhatsApp está conectado, la sincroniza antes con Meta.', { name: z.string() }, async (a) => {
    if (whatsappConfigured()) {
      for (const t of await listMetaTemplates()) {
        if (t.name !== a.name) continue;
        const body = t.components?.find((c) => c.type === 'BODY')?.text ?? '';
        await prisma.template.upsert({
          where: { name_language: { name: t.name, language: t.language } },
          update: { status: t.status.toLowerCase(), category: t.category, body, metaId: t.id },
          create: { name: t.name, language: t.language, category: t.category, body, status: t.status.toLowerCase(), metaId: t.id },
        });
      }
    }
    const rows = await prisma.template.findMany({ where: { name: a.name } });
    if (!rows.length) throw new Error('template_not_found');
    return rows;
  });

  tool(
    'create_template',
    'Crea una plantilla de texto y la envía a revisión de Meta (requiere WhatsApp conectado).',
    { name: z.string(), body: z.string(), language: z.string().default('es'), category: z.enum(['MARKETING', 'UTILITY']).default('MARKETING') },
    async (a) => {
      if (!whatsappConfigured()) throw new Error('whatsapp_not_configured');
      const name = a.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const created = await createMetaTemplate({ name, language: a.language, category: a.category, body: a.body });
      return prisma.template.upsert({
        where: { name_language: { name, language: a.language } },
        update: { body: a.body, category: a.category, status: created.status, metaId: created.id },
        create: { name, language: a.language, category: a.category, body: a.body, status: created.status, metaId: created.id },
      });
    },
  );

  // ---------- Contactos, etiquetas y campos ----------
  tool('list_subscribers', 'Busca contactos por nombre, teléfono o email, o por etiqueta.', { query: z.string().optional(), label: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) }, async (a) =>
    prisma.subscriber.findMany({
      where: {
        ...(a.query ? { OR: [{ phone: { contains: a.query } }, { name: { contains: a.query, mode: 'insensitive' } }, { email: { contains: a.query, mode: 'insensitive' } }] } : {}),
        ...(a.label ? { labels: { some: { label: { name: a.label } } } } : {}),
      },
      include: { labels: { include: { label: true } } },
      orderBy: { createdAt: 'desc' },
      take: a.limit,
    }),
  );

  tool('get_subscriber', 'Datos completos de un contacto: etiquetas, campos, notas y conversaciones.', { phone: z.string() }, async (a) =>
    prisma.subscriber.findUnique({
      where: { phone: digits(a.phone) },
      include: { labels: { include: { label: true } }, notes: { orderBy: { createdAt: 'desc' }, take: 20 }, deals: true },
    }),
  );

  tool('create_subscriber', 'Crea un contacto (o devuelve el existente).', { phone: z.string(), name: z.string().optional(), email: z.string().optional() }, async (a) =>
    prisma.subscriber.upsert({ where: { phone: digits(a.phone) }, update: {}, create: { phone: digits(a.phone), name: a.name, email: a.email, source: 'mcp' } }),
  );

  tool('update_subscriber', 'Actualiza nombre, email o bloqueo de un contacto.', { phone: z.string(), name: z.string().optional(), email: z.string().optional(), blocked: z.boolean().optional() }, async (a) => {
    await subscriberBy(a.phone);
    return prisma.subscriber.update({ where: { phone: digits(a.phone) }, data: { name: a.name, email: a.email, blocked: a.blocked } });
  });

  tool('list_labels', 'Lista las etiquetas con su número de contactos.', {}, async () => prisma.label.findMany({ include: { _count: { select: { subscribers: true } } }, orderBy: { name: 'asc' } }));

  tool('assign_labels', 'Añade etiquetas a un contacto (puede inscribirlo en secuencias disparadas por esa etiqueta).', { phone: z.string(), labels: z.array(z.string()).min(1) }, async (a) => {
    const sub = await subscriberBy(a.phone);
    for (const l of a.labels) await addLabelWithTriggers(sub.id, l);
    return { ok: true, labels: a.labels };
  });

  tool('remove_labels', 'Quita etiquetas de un contacto.', { phone: z.string(), labels: z.array(z.string()).min(1) }, async (a) => {
    const sub = await subscriberBy(a.phone);
    for (const l of a.labels) await removeLabel(sub.id, l);
    return { ok: true };
  });

  tool('list_custom_fields', 'Lista los campos personalizados definidos.', {}, async () => prisma.customFieldDef.findMany({ orderBy: { key: 'asc' } }));

  tool('assign_custom_fields', 'Guarda valores en los campos personalizados de un contacto.', { phone: z.string(), fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) }, async (a) => {
    const sub = await subscriberBy(a.phone);
    const merged = { ...((sub.customFields as object) ?? {}), ...a.fields };
    await prisma.subscriber.update({ where: { id: sub.id }, data: { customFields: merged as never } });
    return { ok: true, customFields: merged };
  });

  // ---------- Conversaciones y equipo ----------
  tool(
    'list_conversations',
    'Lista conversaciones, opcionalmente por estado (open, pending, solved, archived) o por teléfono.',
    { status: z.enum(['open', 'pending', 'solved', 'archived']).optional(), phone: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) },
    async (a) =>
      prisma.conversation.findMany({
        where: { ...(a.status ? { status: a.status } : {}), ...(a.phone ? { subscriber: { phone: digits(a.phone) } } : {}) },
        include: { subscriber: { select: { phone: true, name: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
        take: a.limit,
      }),
  );

  tool('get_conversation', 'Historial de mensajes de una conversación.', { conversationId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }, async (a) => {
    const conv = await prisma.conversation.findUnique({
      where: { id: a.conversationId },
      include: { subscriber: { select: { phone: true, name: true } }, messages: { orderBy: { createdAt: 'desc' }, take: a.limit }, notes: true },
    });
    if (!conv) throw new Error('conversation_not_found');
    return { ...conv, messages: conv.messages.reverse() };
  });

  tool('mark_conversation_status', 'Cambia el estado de la conversación activa de un contacto.', { phone: z.string(), status: z.enum(['open', 'pending', 'solved', 'archived']) }, async (a) => {
    const sub = await subscriberBy(a.phone);
    const conv = await prisma.conversation.findFirst({ where: { subscriberId: sub.id }, orderBy: { updatedAt: 'desc' } });
    if (!conv) throw new Error('conversation_not_found');
    return prisma.conversation.update({ where: { id: conv.id }, data: { status: a.status } });
  });

  tool('assign_chat_to_team_member', 'Asigna la conversación de un contacto a un miembro del equipo (vacío = devolver al bot).', { phone: z.string(), member: z.string().optional() }, async (a) => {
    const sub = await subscriberBy(a.phone);
    const conv = await prisma.conversation.findFirst({ where: { subscriberId: sub.id }, orderBy: { updatedAt: 'desc' } });
    if (!conv) throw new Error('conversation_not_found');
    return prisma.conversation.update({ where: { id: conv.id }, data: { assignedTo: a.member || null } });
  });

  tool('add_subscriber_note', 'Añade una nota interna a un contacto.', { phone: z.string(), note: z.string(), author: z.string().default('mcp') }, async (a) => {
    const sub = await subscriberBy(a.phone);
    return prisma.subscriberNote.create({ data: { subscriberId: sub.id, author: a.author, body: a.note } });
  });

  tool('get_subscriber_notes', 'Notas internas de un contacto.', { phone: z.string() }, async (a) => {
    const sub = await subscriberBy(a.phone);
    return prisma.subscriberNote.findMany({ where: { subscriberId: sub.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  });

  tool('list_team_members', 'Miembros del equipo disponibles para asignar chats.', {}, async () => prisma.teamMember.findMany({ orderBy: { createdAt: 'asc' } }));

  // ---------- Secuencias y flujos ----------
  tool('list_sequences', 'Lista las secuencias drip con sus pasos.', {}, async () => prisma.sequence.findMany({ where: { kind: 'sequence' }, include: { steps: { orderBy: { order: 'asc' } } } }));

  tool('list_bot_flows', 'Lista los flujos de chatbot con su palabra clave.', {}, async () =>
    prisma.sequence.findMany({ where: { kind: 'flow' }, select: { id: true, name: true, triggerKeyword: true, active: true } }),
  );

  tool('assign_sequence', 'Inscribe a un contacto en una secuencia y ejecuta su primer paso.', { phone: z.string(), sequenceId: z.string().uuid() }, async (a) => triggerSequenceForSubscriber({ phone: digits(a.phone), sequenceId: a.sequenceId }));

  tool('unassign_sequence', 'Detiene la secuencia de un contacto y cancela sus pasos pendientes.', { phone: z.string(), sequenceId: z.string().uuid() }, async (a) => {
    const sub = await subscriberBy(a.phone);
    await prisma.subscriberSequence.updateMany({ where: { subscriberId: sub.id, sequenceId: a.sequenceId }, data: { status: 'stopped' } });
    const cancelled = await prisma.scheduledJob.updateMany({ where: { subscriberId: sub.id, sequenceId: a.sequenceId, status: 'pending' }, data: { status: 'cancelled' } });
    return { ok: true, cancelledSteps: cancelled.count };
  });

  tool('enroll_subscriber', 'Inscribe a un contacto en una secuencia SIN ejecutar todavía el primer paso.', { phone: z.string(), sequenceId: z.string().uuid() }, async (a) => enrollSubscriberInSequence({ phone: digits(a.phone), sequenceId: a.sequenceId }));

  tool('trigger_bot_flow', 'Lanza un flujo de chatbot para un contacto.', { phone: z.string(), flowId: z.string().uuid() }, async (a) => triggerBotFlowForSubscriber({ phone: digits(a.phone), flowId: a.flowId }));

  tool('reset_user_input_flow', 'Cancela el flujo que esté esperando una respuesta del contacto (pregunta o botones).', { phone: z.string() }, async (a) => {
    const sub = await subscriberBy(a.phone);
    const r = await prisma.flowSession.updateMany({ where: { subscriberId: sub.id, status: 'active' }, data: { status: 'done' } });
    return { ok: true, closedSessions: r.count };
  });

  // ---------- Citas y formularios ----------
  tool('get_available_slots', 'Próximos huecos libres para citas (según el horario configurado).', { limit: z.number().int().min(1).max(100).default(20) }, async (a) => {
    const settings = await getSetting('booking');
    const slots = await availableSlots(a.limit);
    return { enabled: settings.enabled, timezone: settings.timezone, slots: slots.map((d) => ({ startsAt: d.toISOString(), label: formatSlot(d, settings.timezone) })) };
  });

  tool('list_appointments', 'Lista citas desde hoy, opcionalmente por estado (booked, cancelled, completed, no_show).', { status: z.enum(['booked', 'cancelled', 'completed', 'no_show']).optional(), limit: z.number().int().min(1).max(100).default(30) }, async (a) =>
    prisma.appointment.findMany({
      where: { startsAt: { gte: new Date(Date.now() - 86_400_000) }, ...(a.status ? { status: a.status } : {}) },
      include: { subscriber: { select: { phone: true, name: true } } },
      orderBy: { startsAt: 'asc' },
      take: a.limit,
    }),
  );

  tool('book_appointment', 'Reserva una cita para un contacto en uno de los huecos libres (startsAt en ISO 8601).', { phone: z.string(), startsAt: z.string(), title: z.string().optional() }, async (a) => {
    const startsAt = new Date(a.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw new Error('startsAt must be an ISO 8601 date');
    const sub = await prisma.subscriber.upsert({ where: { phone: digits(a.phone) }, update: {}, create: { phone: digits(a.phone), source: 'mcp' } });
    try {
      return await bookSlot({ subscriberId: sub.id, startsAt, title: a.title });
    } catch (e) {
      throw new Error(e instanceof BookingError ? e.code : (e as Error).message);
    }
  });

  tool('cancel_appointment', 'Cancela una cita y sus recordatorios.', { appointmentId: z.string().uuid() }, async (a) => cancelAppointment(a.appointmentId, 'cancelled'));

  tool('list_forms', 'Formularios del chat con su número de envíos.', {}, async () => prisma.form.findMany({ select: { id: true, name: true, keyword: true, active: true, _count: { select: { submissions: true } } } }));

  tool('send_form', 'Lanza un formulario a un contacto para que lo responda por WhatsApp.', { phone: z.string(), formId: z.string().uuid() }, async (a) => {
    const form = await prisma.form.findUnique({ where: { id: a.formId } });
    if (!form?.sequenceId) throw new Error('form_not_found');
    await prisma.subscriber.upsert({ where: { phone: digits(a.phone) }, update: {}, create: { phone: digits(a.phone), source: 'mcp' } });
    return triggerBotFlowForSubscriber({ phone: digits(a.phone), flowId: form.sequenceId });
  });

  // ---------- Broadcasts ----------
  tool('list_broadcasts', 'Lista los broadcasts con sus métricas de envío, entrega y lectura.', {}, async () => prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }));

  // ---------- CRM ----------
  tool('get_crm_overview', 'Etapa, valor y responsable de la oportunidad de un contacto.', { phone: z.string() }, async (a) => {
    const deal = await prisma.crmDeal.findFirst({ where: { subscriber: { phone: digits(a.phone) } }, orderBy: { updatedAt: 'desc' } });
    if (!deal) throw new Error('deal_not_found');
    return deal;
  });

  tool('update_crm_overview', 'Crea o actualiza la oportunidad de un contacto (etapa, valor, responsable).', { phone: z.string(), stage: z.string().optional(), value: z.number().optional(), owner: z.string().optional() }, async (a) => {
    const sub = await subscriberBy(a.phone);
    const existing = await prisma.crmDeal.findFirst({ where: { subscriberId: sub.id }, orderBy: { updatedAt: 'desc' } });
    const data = { stage: a.stage, owner: a.owner, ...(a.value !== undefined ? { value: Math.round(a.value) } : {}) };
    return existing
      ? prisma.crmDeal.update({ where: { id: existing.id }, data })
      : prisma.crmDeal.create({ data: { subscriberId: sub.id, stage: a.stage ?? 'new', value: Math.round(a.value ?? 0), owner: a.owner } });
  });

  // ---------- Cuenta ----------
  tool('get_account_info', 'Estado de la cuenta: WhatsApp, IA, horario comercial y totales.', {}, async () => {
    const [subscribers, conversations, hours, sandbox] = await Promise.all([prisma.subscriber.count(), prisma.conversation.count(), getSetting('businessHours'), getSetting('sandbox')]);
    return {
      whatsapp: { configured: whatsappConfigured(), phoneNumberId: config.whatsapp.phoneNumberId || null },
      sandbox: sandbox.enabled,
      ai: { ready: agentReady() },
      businessHours: { enabled: hours.enabled, timezone: hours.timezone },
      counts: { subscribers, conversations },
    };
  });

  return s;
}
