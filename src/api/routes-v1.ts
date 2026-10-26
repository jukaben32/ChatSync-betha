import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../prisma.js';
import { authenticate } from '../auth.js';
import { whatsappConfigured } from '../config.js';
import { sendMessage } from '../domain/messaging.js';
import type { OutgoingContent } from '../domain/messaging.js';
import { addLabelWithTriggers, removeLabel } from '../domain/labels.js';
import { triggerBotFlowForSubscriber, triggerSequenceForSubscriber } from '../domain/sequences.js';
import { createMetaTemplate, listMetaTemplates } from '../whatsapp/client.js';

/**
 * API v1 compatible con la de ChatSyncs (https://platform.chatsyncs.com/api/v1): mismos nombres de endpoint y de
 * parámetros (`apiToken`, `phone_number_id`, `phone_number`…), GET o POST, y respuestas `{ status: "1" | "0", … }`.
 * Una automatización escrita para ChatSyncs funciona cambiando solo la URL base. Contrato en docs/CHATSYNCS_API_V1.md.
 */

class V1Error extends Error {}
type Params = Record<string, any>;

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "a,b" | '["a","b"]' | ["a","b"] | 12 → ["a","b"] */
function toList(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map(String);
  const text = String(value).trim();
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* se trata como texto */
    }
  }
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

/** custom_fields llega como objeto, JSON, o lista [{name,value}] / [{field_name,field_value}]. */
function toFields(value: unknown): Record<string, unknown> {
  let v: unknown = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw new V1Error('custom_fields must be a JSON object or array');
    }
  }
  if (Array.isArray(v)) {
    const out: Record<string, unknown> = {};
    for (const item of v as Params[]) {
      const key = item.name ?? item.field_name ?? item.key;
      if (key) out[String(key)] = item.value ?? item.field_value;
    }
    return out;
  }
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  throw new V1Error('custom_fields is required');
}

function mediaKindOf(type: unknown, url: string): 'image' | 'document' | 'audio' | 'video' {
  const t = String(type ?? '').toLowerCase();
  if (['image', 'document', 'audio', 'video'].includes(t)) return t as 'image' | 'document' | 'audio' | 'video';
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', '3gp', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'aac', 'amr', 'm4a', 'opus'].includes(ext)) return 'audio';
  if (!ext) throw new V1Error('media_type is required when media_url has no file extension');
  return 'document';
}

async function subscriberOf(p: Params) {
  const phone = digits(p.phone_number ?? p.phoneNumber);
  if (phone.length < 7) throw new V1Error('phone_number is required (country code, digits only)');
  const sub = await prisma.subscriber.findUnique({ where: { phone } });
  if (!sub) throw new V1Error('Subscriber not found');
  return sub;
}

const present = (s: { id: string; phone: string; name: string | null; email: string | null; blocked: boolean; optedOut: boolean; customFields: unknown; createdAt: Date; labels?: Array<{ labelId: string }> }) => {
  const [first, ...rest] = (s.name ?? '').split(' ');
  return {
    id: s.id,
    chat_id: s.phone,
    phone_number: s.phone,
    name: s.name,
    first_name: first || null,
    last_name: rest.join(' ') || null,
    email: s.email,
    status: s.blocked ? 'blocked' : s.optedOut ? 'unsubscribed' : 'subscribed',
    custom_fields: s.customFields,
    label_ids: (s.labels ?? []).map((l) => l.labelId),
    created_at: s.createdAt,
  };
};

async function conversationOf(subscriberId: string) {
  const c = await prisma.conversation.findFirst({ where: { subscriberId }, orderBy: { updatedAt: 'desc' } });
  if (!c) throw new V1Error('No conversation found for this subscriber');
  return c;
}

export async function v1Routes(app: FastifyInstance) {
  // Autenticación propia: `apiToken` en query o cuerpo, o cabecera Authorization/x-api-key.
  app.addHook('preHandler', async (request, reply) => {
    const p = paramsOf(request);
    const header = request.headers.authorization;
    const key = String(p.apiToken ?? p.api_token ?? (header?.toLowerCase().startsWith('bearer ') ? header.slice(7) : (request.headers['x-api-key'] ?? ''))).trim();
    const result = await authenticate(key, request.method, request.url.split('?')[0]);
    if (!result.ok) return reply.code(result.status).send({ status: '0', message: result.error === 'unauthorized' ? 'Invalid or missing apiToken' : result.error });
    request.apiKeyName = result.keyName;
  });

  const paramsOf = (request: FastifyRequest): Params => ({ ...((request.query as Params) ?? {}), ...(typeof request.body === 'object' && request.body ? (request.body as Params) : {}) });

  /** Registra GET y POST. El handler devuelve campos extra de la respuesta; `message` por defecto es "success". */
  const route = (path: string, handler: (p: Params) => Promise<Params | undefined>) => {
    const run = async (request: FastifyRequest, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      try {
        const extra = (await handler(paramsOf(request))) ?? {};
        return { status: '1', ...(extra.message === undefined ? { message: 'Success' } : {}), ...extra };
      } catch (e) {
        const message = (e as Error).message;
        // Errores del propio contrato → 200 con status 0 (como el original); fallos inesperados → 500
        return e instanceof V1Error ? { status: '0', message } : reply.code(500).send({ status: '0', message });
      }
    };
    app.get(`/api/v1/${path}`, run as never);
    app.post(`/api/v1/${path}`, run as never);
  };

  const send = async (phone: string, content: OutgoingContent) => {
    const r = await sendMessage({ phone, content, sender: 'api' });
    if (!r.ok) throw new V1Error(r.error ?? 'send_failed');
    return { wa_message_id: r.providerMessageId ?? r.messageId, message: 'Message sent successfully' };
  };

  // ---------- Usuario / equipo ----------
  route('user/team-member/list', async () => {
    const members = await prisma.teamMember.findMany({ orderBy: { createdAt: 'asc' } });
    if (!members.length) throw new V1Error('No team member found');
    return { message: members.map((m) => ({ id: m.id, name: m.name, email: m.email, role_id: m.role, role: m.role === 'admin' ? 'Admin' : 'Agent' })) };
  });

  route('user/package/list', async () => ({
    message: [
      { id: 'admin', package_name: 'Admin', package_type: 'team' },
      { id: 'agent', package_name: 'Agent', package_type: 'team' },
    ],
  }));

  // ---------- Mensajes ----------
  route('whatsapp/send', async (p) => {
    const phone = digits(p.phone_number);
    if (phone.length < 7) throw new V1Error('phone_number is required (country code, digits only)');
    const templateName = p.template_name ?? p.template;
    if (templateName) {
      return send(phone, { type: 'template', name: String(templateName), language: p.language ?? p.language_code, variables: toList(p.variables ?? p.template_variables) });
    }
    if (!p.message) throw new V1Error('message is required');
    return send(phone, { type: 'text', body: String(p.message) });
  });

  route('whatsapp/send/interactive-buttons', async (p) => {
    const phone = digits(p.phone_number);
    if (phone.length < 7) throw new V1Error('phone_number is required (country code, digits only)');
    if (!p.message) throw new V1Error('message is required');
    let raw: unknown = p.buttons;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        throw new V1Error('buttons must be a JSON array of 1 to 3 items');
      }
    }
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) throw new V1Error('buttons must be a JSON array of 1 to 3 items');
    const buttons = raw.map((b, i) => (typeof b === 'string' ? { id: `btn_${i}`, title: b } : { id: String(b.id ?? `btn_${i}`), title: String(b.title ?? '') }));
    if (buttons.some((b) => !b.title || b.title.length > 20)) throw new V1Error('each button title is required and up to 20 characters');
    const header = p.media_url
      ? { type: mediaKindOf(p.media_type, String(p.media_url)) as 'image' | 'video' | 'document', url: String(p.media_url), filename: p.media_name }
      : p.button_header_text
        ? { type: 'text' as const, text: String(p.button_header_text) }
        : undefined;
    if (header && header.type !== 'text' && !['image', 'video', 'document'].includes(header.type)) throw new V1Error('header media must be image, video or document');
    return send(phone, { type: 'buttons', body: String(p.message), buttons, footer: p.button_footer_text, header });
  });

  route('whatsapp/send/file', async (p) => {
    const phone = digits(p.phone_number);
    if (phone.length < 7) throw new V1Error('phone_number is required (country code, digits only)');
    if (p.media_id && !p.media_url) throw new V1Error('media_id is not supported; send a public https media_url');
    if (!p.media_url) throw new V1Error('media_url is required');
    if (!/^https:\/\//i.test(String(p.media_url))) throw new V1Error('media_url must be a public https URL');
    const kind = mediaKindOf(p.media_type, String(p.media_url));
    if (kind === 'document' && !p.media_name) throw new V1Error('media_name is required when media_type is document');
    return send(phone, { type: 'media', kind, url: String(p.media_url), caption: p.media_caption_text ?? p.message, filename: p.media_name });
  });

  route('whatsapp/upload/media', async () => {
    throw new V1Error('Media upload is not supported in this deployment: send a public https media_url to send/file instead');
  });

  route('whatsapp/get/conversation', async (p) => {
    const sub = await subscriberOf(p);
    const limit = Math.min(Math.max(Number(p.limit ?? 20), 1), 200);
    const offset = Math.max(Number(p.offset ?? 0), 0);
    const rows = await prisma.message.findMany({ where: { conversation: { subscriberId: sub.id } }, orderBy: { createdAt: 'desc' }, take: limit, skip: offset });
    return {
      message: rows.map((m) => ({
        id: m.id,
        wa_message_id: m.providerMessageId,
        direction: m.direction === 'inbound' ? 'in' : 'out',
        message: m.body,
        status: m.status,
        created_at: m.createdAt,
      })),
    };
  });

  route('whatsapp/get/post-back-list', async () => {
    // Ids de los botones/listas definidos en los flujos (el cliente los devuelve en sus respuestas)
    const flows = await prisma.sequence.findMany({ where: { kind: 'flow' }, include: { steps: true } });
    const out: Array<{ post_back_id: string; title: string; flow: string }> = [];
    for (const f of flows) {
      for (const s of f.steps) {
        const p = (s.params ?? {}) as Params;
        const opts: Params[] = s.action === 'send_buttons' ? p.buttons ?? [] : s.action === 'send_list' ? p.rows ?? [] : [];
        opts.forEach((o, i) => out.push({ post_back_id: `o${s.order}_${i}`, title: String(o.title ?? ''), flow: f.name }));
      }
    }
    return { message: out };
  });

  route('whatsapp/get/message-status', async (p) => {
    const id = String(p.wa_message_id ?? '');
    if (!id) throw new V1Error('wa_message_id is required');
    const m = await prisma.message.findFirst({ where: { OR: [{ providerMessageId: id }, ...(UUID.test(id) ? [{ id }] : [])] } });
    if (!m) throw new V1Error('Message not found');
    return { message: { wa_message_id: m.providerMessageId, status: m.status, updated_at: m.createdAt } };
  });

  // ---------- Plantillas ----------
  route('whatsapp/template/list', async () => ({
    message: (await prisma.template.findMany({ orderBy: { createdAt: 'desc' } })).map((t) => ({ id: t.id, name: t.name, language: t.language, category: t.category, status: t.status, body: t.body })),
  }));

  route('whatsapp/template/create', async (p) => {
    const name = String(p.name ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const body = String(p.body_text ?? p.body ?? p.message ?? '').trim();
    if (!name) throw new V1Error('name is required');
    if (!body) throw new V1Error('body_text is required');
    const language = String(p.language ?? 'es');
    const category = String(p.template_type ?? p.category ?? 'MARKETING').toUpperCase();
    let status = 'draft';
    let metaId: string | undefined;
    if (whatsappConfigured()) {
      const created = await createMetaTemplate({ name, language, category, body });
      status = created.status;
      metaId = created.id;
    }
    const t = await prisma.template.upsert({
      where: { name_language: { name, language } },
      update: { body, category, status, metaId },
      create: { name, language, category, body, status, metaId },
    });
    return { template_id: t.id, template_status: status, message: whatsappConfigured() ? 'Template submitted for review' : 'Template saved as draft (WhatsApp is not connected)' };
  });

  route('whatsapp/template/status', async (p) => {
    const ref = String(p.template_id ?? '');
    if (!ref) throw new V1Error('template_id is required');
    let t = await prisma.template.findFirst({ where: { OR: [...(UUID.test(ref) ? [{ id: ref }] : []), { metaId: ref }, { name: ref }] } });
    if (!t) throw new V1Error('Template not found');
    if (whatsappConfigured()) {
      const live = (await listMetaTemplates()).find((x) => x.name === t!.name && x.language === t!.language);
      if (live) t = await prisma.template.update({ where: { id: t.id }, data: { status: live.status.toLowerCase(), metaId: live.id } });
    }
    return { message: { template_id: t.id, name: t.name, language: t.language, status: t.status, category: t.category } };
  });

  // ---------- Flujos ----------
  route('whatsapp/get/bot-flow-list', async () => ({
    message: (await prisma.sequence.findMany({ where: { kind: 'flow' }, select: { id: true, name: true, triggerKeyword: true, active: true } })).map((f) => ({
      unique_id: f.id,
      name: f.name,
      keyword: f.triggerKeyword,
      status: f.active ? 'active' : 'inactive',
    })),
  }));

  route('whatsapp/trigger-bot', async (p) => {
    const phone = digits(p.phone_number);
    if (phone.length < 7) throw new V1Error('phone_number is required (country code, digits only)');
    if (!p.bot_flow_unique_id) throw new V1Error('bot_flow_unique_id is required');
    await prisma.subscriber.upsert({ where: { phone }, update: {}, create: { phone, source: 'api' } });
    try {
      await triggerBotFlowForSubscriber({ phone, flowId: String(p.bot_flow_unique_id) });
    } catch (e) {
      throw new V1Error((e as Error).message === 'bot_flow_not_found' ? 'Bot flow not found' : (e as Error).message);
    }
    return { message: 'Bot flow triggered successfully' };
  });

  // ---------- Suscriptores ----------
  route('whatsapp/subscriber/get', async (p) => {
    const sub = await prisma.subscriber.findUnique({ where: { phone: digits(p.phone_number) }, include: { labels: true } });
    if (!sub) throw new V1Error('Subscriber not found');
    return { message: present(sub) };
  });

  route('whatsapp/subscriber/list', async (p) => {
    const limit = Math.min(Math.max(Number(p.limit ?? 25), 1), 500);
    const order = String(p.orderBy ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const rows = await prisma.subscriber.findMany({ include: { labels: true }, orderBy: { createdAt: order }, take: limit, skip: Math.max(Number(p.offset ?? 0), 0) });
    return { message: rows.map(present) };
  });

  route('whatsapp/subscriber/create', async (p) => {
    const phone = digits(p.phoneNumber ?? p.phone_number);
    if (phone.length < 7) throw new V1Error('phoneNumber is required (country code, digits only)');
    if (!p.name) throw new V1Error('name is required');
    const existing = await prisma.subscriber.findUnique({ where: { phone } });
    if (existing) throw new V1Error('Subscriber already exists');
    const sub = await prisma.subscriber.create({ data: { phone, name: String(p.name), source: 'api' }, include: { labels: true } });
    return { message: present(sub) };
  });

  route('whatsapp/subscriber/update', async (p) => {
    const sub = await subscriberOf(p);
    const name = [p.first_name, p.last_name].filter((x) => x !== undefined && x !== '').join(' ').trim();
    const fields = p.gender ? { ...((sub.customFields as object) ?? {}), gender: String(p.gender) } : undefined;
    await prisma.subscriber.update({ where: { id: sub.id }, data: { ...(name ? { name } : {}), ...(fields ? { customFields: fields as never } : {}) } });
    for (const id of toList(p.label_ids)) {
      const label = UUID.test(id) ? await prisma.label.findUnique({ where: { id } }) : await prisma.label.findUnique({ where: { name: id } });
      if (label) await addLabelWithTriggers(sub.id, label.name);
    }
    return { message: 'Subscriber updated successfully' };
  });

  route('whatsapp/subscriber/delete', async (p) => {
    const sub = await subscriberOf(p);
    await prisma.subscriber.delete({ where: { id: sub.id } });
    return { message: 'Subscriber deleted successfully' };
  });

  route('whatsapp/subscriber/reset/user-input-flow', async (p) => {
    const sub = await subscriberOf(p);
    await prisma.flowSession.updateMany({ where: { subscriberId: sub.id, status: 'active' }, data: { status: 'done' } });
    return { message: 'User input flow reset successfully' };
  });

  route('whatsapp/subscriber/chat/assign-to-team-member', async (p) => {
    const sub = await subscriberOf(p);
    if (!p.team_member_id) throw new V1Error('team_member_id is required');
    const ref = String(p.team_member_id);
    const member = await prisma.teamMember.findFirst({ where: { OR: [...(UUID.test(ref) ? [{ id: ref }] : []), { name: ref }] } });
    if (!member) throw new V1Error('Team member not found');
    const conv = await conversationOf(sub.id);
    await prisma.conversation.update({ where: { id: conv.id }, data: { assignedTo: member.name } });
    return { message: 'Chat assigned to team member successfully' };
  });

  route('whatsapp/subscriber/chat/mark-conversation', async (p) => {
    const sub = await subscriberOf(p);
    const wanted = String(p.status ?? p.conversation_status ?? 'resolved').toLowerCase();
    if (wanted === 'blocked' || wanted === 'block') {
      await prisma.subscriber.update({ where: { id: sub.id }, data: { blocked: true } });
      return { message: 'Subscriber blocked' };
    }
    const map: Record<string, string> = { resolved: 'solved', solved: 'solved', open: 'open', unresolved: 'open', pending: 'pending', archived: 'archived', archive: 'archived' };
    const status = map[wanted];
    if (!status) throw new V1Error('status must be one of: open, pending, resolved, archived, blocked');
    const conv = await conversationOf(sub.id);
    await prisma.conversation.update({ where: { id: conv.id }, data: { status, ...(status === 'solved' ? { assignedTo: null } : {}) } });
    return { message: 'Conversation status updated successfully' };
  });

  route('whatsapp/subscriber/chat/assign-custom-fields', async (p) => {
    const sub = await subscriberOf(p);
    const fields = toFields(p.custom_fields);
    await prisma.subscriber.update({ where: { id: sub.id }, data: { customFields: { ...((sub.customFields as object) ?? {}), ...fields } as never } });
    return { message: 'Custom fields assigned successfully' };
  });

  route('whatsapp/subscriber/custom-fields/list', async () => ({
    message: (await prisma.customFieldDef.findMany({ orderBy: { key: 'asc' } })).map((f) => ({ id: f.id, name: f.key, label: f.label, type: f.type })),
  }));

  const labelsFrom = async (ids: string[]) => {
    if (!ids.length) throw new V1Error('label_ids is required');
    const labels = await prisma.label.findMany({ where: { OR: [{ id: { in: ids.filter((i) => UUID.test(i)) } }, { name: { in: ids } }] } });
    if (!labels.length) throw new V1Error('Label not found');
    return labels;
  };

  route('whatsapp/subscriber/chat/assign-labels', async (p) => {
    const sub = await subscriberOf(p);
    for (const l of await labelsFrom(toList(p.label_ids))) await addLabelWithTriggers(sub.id, l.name);
    return { message: 'Labels assigned successfully' };
  });

  route('whatsapp/subscriber/chat/remove-labels', async (p) => {
    const sub = await subscriberOf(p);
    for (const l of await labelsFrom(toList(p.label_ids))) await removeLabel(sub.id, l.name);
    return { message: 'Labels removed successfully' };
  });

  route('whatsapp/subscriber/sequence/list', async () => ({
    message: (await prisma.sequence.findMany({ where: { kind: 'sequence' }, select: { id: true, name: true, active: true } })).map((s) => ({ id: s.id, name: s.name, status: s.active ? 'active' : 'inactive' })),
  }));

  const sequencesFrom = async (ids: string[]) => {
    if (!ids.length) throw new V1Error('sequence_ids is required');
    const rows = await prisma.sequence.findMany({ where: { kind: 'sequence', OR: [{ id: { in: ids.filter((i) => UUID.test(i)) } }, { name: { in: ids } }] } });
    if (!rows.length) throw new V1Error('Sequence not found');
    return rows;
  };

  route('whatsapp/subscriber/chat/assign-sequence', async (p) => {
    const sub = await subscriberOf(p);
    for (const s of await sequencesFrom(toList(p.sequence_ids))) await triggerSequenceForSubscriber({ phone: sub.phone, sequenceId: s.id });
    return { message: 'Sequences assigned successfully' };
  });

  route('whatsapp/subscriber/chat/remove-sequence', async (p) => {
    const sub = await subscriberOf(p);
    const rows = await sequencesFrom(toList(p.sequence_ids));
    const ids = rows.map((s) => s.id);
    await prisma.subscriberSequence.updateMany({ where: { subscriberId: sub.id, sequenceId: { in: ids } }, data: { status: 'stopped' } });
    await prisma.scheduledJob.updateMany({ where: { subscriberId: sub.id, sequenceId: { in: ids }, status: 'pending' }, data: { status: 'cancelled' } });
    return { message: 'Sequences removed successfully' };
  });

  route('whatsapp/subscriber/chat/add-notes', async (p) => {
    const sub = await subscriberOf(p);
    if (!p.note_text) throw new V1Error('note_text is required');
    await prisma.subscriberNote.create({ data: { subscriberId: sub.id, author: p.author ? String(p.author) : 'api', body: String(p.note_text) } });
    return { message: 'Note added successfully' };
  });

  route('whatsapp/subscriber/chat/get-notes', async (p) => {
    const sub = await subscriberOf(p);
    const notes = await prisma.subscriberNote.findMany({ where: { subscriberId: sub.id }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { message: notes.map((n) => ({ id: n.id, note_text: n.body, author: n.author, created_at: n.createdAt })) };
  });

  // CRM: etapa, valor y responsable de la oportunidad (título, embudo, moneda y origen se guardan como metadatos)
  const dealOut = (d: { id: string; stage: string; value: number; owner: string | null; metadata: unknown; updatedAt: Date }) => {
    const m = (d.metadata ?? {}) as Params;
    return { deal_id: d.id, title: m.title ?? null, pipeline_id: m.pipeline_id ?? null, stage_id: d.stage, value: d.value, currency: m.currency ?? null, owner_user_id: d.owner, source: m.source ?? null, updated_at: d.updatedAt };
  };

  route('whatsapp/subscriber/crm/get', async (p) => {
    const sub = await subscriberOf(p);
    const deal = await prisma.crmDeal.findFirst({ where: { subscriberId: sub.id }, orderBy: { updatedAt: 'desc' } });
    if (!deal) throw new V1Error('CRM deal not found');
    return { message: dealOut(deal) };
  });

  route('whatsapp/subscriber/crm/update', async (p) => {
    const sub = await subscriberOf(p);
    const existing = await prisma.crmDeal.findFirst({ where: { subscriberId: sub.id }, orderBy: { updatedAt: 'desc' } });
    const meta = { ...((existing?.metadata as object) ?? {}) } as Params;
    for (const k of ['title', 'pipeline_id', 'currency', 'source']) if (p[k] !== undefined) meta[k] = p[k];
    const data = {
      stage: p.stage_id !== undefined ? String(p.stage_id) : undefined,
      owner: p.owner_user_id !== undefined ? String(p.owner_user_id) : undefined,
      value: p.value !== undefined ? Math.round(Number(p.value) || 0) : undefined,
      metadata: meta as never,
    };
    const deal = existing
      ? await prisma.crmDeal.update({ where: { id: existing.id }, data })
      : await prisma.crmDeal.create({ data: { subscriberId: sub.id, stage: data.stage ?? 'new', value: data.value ?? 0, owner: data.owner, metadata: meta as never } });
    return { message: dealOut(deal) };
  });

  // ---------- Etiquetas ----------
  route('label/list', async () => ({ message: (await prisma.label.findMany({ orderBy: { name: 'asc' } })).map((l) => ({ id: l.id, label_name: l.name })) }));

  route('label/create', async (p) => {
    const name = String(p.label_name ?? '').trim();
    if (!name) throw new V1Error('label_name is required');
    const label = await prisma.label.upsert({ where: { name }, update: {}, create: { name } });
    return { message: { id: label.id, label_name: label.name } };
  });
}
