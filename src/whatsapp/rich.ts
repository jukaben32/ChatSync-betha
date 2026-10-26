import { config } from '../config.js';

export type MediaKind = 'image' | 'document' | 'audio' | 'video';

export interface ReplyButton {
  id: string;
  title: string; // WhatsApp: máx. 20 caracteres
}

export interface ListRow {
  id: string;
  title: string; // máx. 24 caracteres
  description?: string;
}

async function post(payload: Record<string, unknown>): Promise<{ providerMessageId: string }> {
  const res = await fetch(`${config.whatsapp.baseUrl}/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.whatsapp.accessToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { messages?: Array<{ id: string }> };
  const providerMessageId = data.messages?.[0]?.id ?? '';
  if (!providerMessageId) throw new Error('WhatsApp send did not return a message id');
  return { providerMessageId };
}

export interface ButtonsHeader {
  type: 'text' | 'image' | 'video' | 'document';
  text?: string;
  url?: string;
  filename?: string;
}

/** Mensaje con hasta 3 botones de respuesta rápida (y cabecera de texto o medio opcional). */
export function sendWhatsAppButtons(params: { to: string; body: string; buttons: ReplyButton[]; footer?: string; header?: ButtonsHeader }) {
  const buttons = params.buttons.slice(0, 3);
  if (!buttons.length) throw new Error('buttons_required');
  return post({
    to: params.to,
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(params.header
        ? {
            header:
              params.header.type === 'text'
                ? { type: 'text', text: (params.header.text ?? '').slice(0, 60) }
                : { type: params.header.type, [params.header.type]: { link: params.header.url, ...(params.header.type === 'document' && params.header.filename ? { filename: params.header.filename } : {}) } },
          }
        : {}),
      body: { text: params.body.slice(0, 1024) },
      ...(params.footer ? { footer: { text: params.footer.slice(0, 60) } } : {}),
      action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) },
    },
  });
}

/** Mensaje de lista (hasta 10 filas). */
export function sendWhatsAppList(params: { to: string; body: string; buttonText: string; rows: ListRow[] }) {
  const rows = params.rows.slice(0, 10);
  if (!rows.length) throw new Error('rows_required');
  return post({
    to: params.to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: params.body.slice(0, 1024) },
      action: {
        button: params.buttonText.slice(0, 20),
        sections: [
          { title: 'Opciones', rows: rows.map((r) => ({ id: r.id.slice(0, 200), title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) },
        ],
      },
    },
  });
}

/** Imagen, documento, audio o vídeo por URL pública. */
export function sendWhatsAppMedia(params: { to: string; kind: MediaKind; url: string; caption?: string; filename?: string }) {
  const media: Record<string, unknown> = { link: params.url };
  if (params.caption && params.kind !== 'audio') media.caption = params.caption.slice(0, 1024);
  if (params.kind === 'document' && params.filename) media.filename = params.filename;
  return post({ to: params.to, type: params.kind, [params.kind]: media });
}

/** Marca un mensaje entrante como leído (doble check azul). */
export async function markWhatsAppRead(providerMessageId: string) {
  await fetch(`${config.whatsapp.baseUrl}/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.whatsapp.accessToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: providerMessageId }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
