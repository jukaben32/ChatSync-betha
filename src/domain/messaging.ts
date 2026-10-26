import { prisma } from '../prisma.js';
import { whatsappConfigured } from '../config.js';
import { sendWhatsAppText, sendWhatsAppTemplate } from '../whatsapp/client.js';
import { sendWhatsAppButtons, sendWhatsAppList, sendWhatsAppMedia } from '../whatsapp/rich.js';
import type { ButtonsHeader, ListRow, MediaKind, ReplyButton } from '../whatsapp/rich.js';
import { randomUUID } from 'node:crypto';
import { emitEvent } from './events.js';
import { getSetting } from './settings.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Devuelve la conversación abierta del suscriptor, o crea una nueva. */
export async function getOrCreateConversation(subscriberId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { subscriberId, status: { notIn: ['solved', 'archived'] } },
    orderBy: { updatedAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.conversation.create({ data: { subscriberId, status: 'open' } });
}

/** WhatsApp solo permite mensajes libres durante 24 h tras el último mensaje del cliente. */
export async function withinServiceWindow(subscriberId: string) {
  const last = await prisma.message.findFirst({
    where: { direction: 'inbound', conversation: { subscriberId } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return Boolean(last && Date.now() - last.createdAt.getTime() < WINDOW_MS);
}

/** Sustituye {{name}}, {{phone}}, {{email}} y {{campo_personalizado}} por los datos del contacto. */
export function renderVars(text: string, subscriber: { name: string | null; phone: string; email: string | null; customFields: unknown }) {
  const fields = (subscriber.customFields ?? {}) as Record<string, unknown>;
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key: string) => {
    if (key === 'name') return subscriber.name ?? '';
    if (key === 'phone') return subscriber.phone;
    if (key === 'email') return subscriber.email ?? '';
    const value = fields[key.replace(/^field\./, '')];
    return value === undefined || value === null ? '' : String(value);
  });
}

export type OutgoingContent =
  | { type: 'text'; body: string }
  | { type: 'template'; name: string; language?: string; variables?: string[] }
  | { type: 'buttons'; body: string; buttons: ReplyButton[]; footer?: string; header?: ButtonsHeader }
  | { type: 'list'; body: string; buttonText: string; rows: ListRow[] }
  | { type: 'media'; kind: MediaKind; url: string; caption?: string; filename?: string };

export interface SendResult {
  ok: boolean;
  messageId: string;
  providerMessageId?: string;
  error?: string;
}

function preview(content: OutgoingContent): string {
  switch (content.type) {
    case 'text':
      return content.body;
    case 'template':
      return `[plantilla: ${content.name}]`;
    case 'buttons':
      return `${content.body}\n${content.buttons.map((b) => `[${b.title}]`).join(' ')}`;
    case 'list':
      return `${content.body}\n${content.rows.map((r) => `• ${r.title}`).join('\n')}`;
    case 'media':
      return `[${content.kind}] ${content.caption ?? content.url}`;
  }
}

/**
 * Envía un mensaje por WhatsApp y lo registra en la conversación. Todo el sistema envía por aquí.
 * Si el contacto está bloqueado/de baja, WhatsApp no está configurado, o se está fuera de la ventana
 * de 24 h (solo plantillas), el mensaje queda guardado con status "failed" y el motivo en metadata.
 */
export async function sendMessage(params: { phone: string; content: OutgoingContent; conversationId?: string; sender?: string }): Promise<SendResult> {
  const subscriber = await prisma.subscriber.upsert({ where: { phone: params.phone }, update: {}, create: { phone: params.phone } });
  const conversationId = params.conversationId ?? (await getOrCreateConversation(subscriber.id)).id;

  // Variables {{...}} en los textos
  const content: OutgoingContent = (() => {
    const c = params.content;
    if (c.type === 'text') return { ...c, body: renderVars(c.body, subscriber) };
    if (c.type === 'buttons') return { ...c, body: renderVars(c.body, subscriber) };
    if (c.type === 'list') return { ...c, body: renderVars(c.body, subscriber) };
    if (c.type === 'media' && c.caption) return { ...c, caption: renderVars(c.caption, subscriber) };
    return c;
  })();

  let providerMessageId: string | undefined;
  let error: string | undefined;
  const sandbox = !whatsappConfigured() && (await getSetting('sandbox')).enabled;
  if (subscriber.blocked || subscriber.optedOut) {
    error = subscriber.blocked ? 'subscriber_blocked' : 'subscriber_opted_out';
  } else if (!whatsappConfigured() && !sandbox) {
    error = 'whatsapp_not_configured';
  } else if (content.type !== 'template' && !(await withinServiceWindow(subscriber.id))) {
    error = 'outside_24h_window';
  } else if (sandbox) {
    providerMessageId = `sandbox.${randomUUID()}`;
  } else {
    try {
      const to = params.phone;
      const sent =
        content.type === 'template'
          ? await sendWhatsAppTemplate({ to, templateName: content.name, languageCode: content.language, bodyUrlVariables: content.variables })
          : content.type === 'buttons'
            ? await sendWhatsAppButtons({ to, body: content.body, buttons: content.buttons, footer: content.footer, header: content.header })
            : content.type === 'list'
              ? await sendWhatsAppList({ to, body: content.body, buttonText: content.buttonText, rows: content.rows })
              : content.type === 'media'
                ? await sendWhatsAppMedia({ to, kind: content.kind, url: content.url, caption: content.caption, filename: content.filename })
                : await sendWhatsAppText({ to, body: content.body });
      providerMessageId = sent.providerMessageId;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      direction: 'outbound',
      providerMessageId,
      body: preview(content),
      mediaUrl: content.type === 'media' ? content.url : undefined,
      status: error ? 'failed' : 'sent',
      metadata: { type: content.type, ...(sandbox ? { sandbox: true } : {}), ...(params.sender ? { sender: params.sender } : {}), ...(error ? { error } : {}) },
    },
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  await emitEvent('message.sent', { phone: params.phone, conversationId, messageId: message.id, status: message.status, body: message.body });

  return { ok: !error, messageId: message.id, providerMessageId, error };
}

/** Atajo de compatibilidad: texto o plantilla. */
export function sendAndRecord(params: {
  phone: string;
  body?: string;
  template?: { name: string; language?: string; variables?: string[] };
  conversationId?: string;
  sender?: string;
}) {
  const content: OutgoingContent = params.template
    ? { type: 'template', name: params.template.name, language: params.template.language, variables: params.template.variables }
    : { type: 'text', body: params.body ?? '' };
  return sendMessage({ phone: params.phone, content, conversationId: params.conversationId, sender: params.sender });
}
