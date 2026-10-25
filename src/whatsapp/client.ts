import { config } from '../config.js';

interface SendTextResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

interface SendTemplateResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

/**
 * Envía un mensaje de texto por WhatsApp Cloud API (Meta).
 * Reglas: mensajes libres dentro de la ventana de 24h del usuario;
 * plantillas aprobadas fuera de ella.
 */
export async function sendWhatsAppText(params: {
  to: string;
  body: string;
  contextMessageId?: string;
}): Promise<{ providerMessageId: string }> {
  const url = `${config.whatsapp.baseUrl}/${config.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'text',
      text: { body: params.body, preview_url: false },
      ...(params.contextMessageId ? { context_message_id: params.contextMessageId } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as SendTextResponse;
  const providerMessageId = data.messages?.[0]?.id ?? '';
  if (!providerMessageId) throw new Error('WhatsApp send did not return a message id');
  return { providerMessageId };
}

/**
 * Envía una plantilla aprobada por Meta.
 */
export async function sendWhatsAppTemplate(params: {
  to: string;
  templateName: string;
  languageCode?: string;
  bodyUrlVariables?: string[];
}): Promise<{ providerMessageId: string }> {
  const url = `${config.whatsapp.baseUrl}/${config.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.languageCode ?? 'es' },
        ...(params.bodyUrlVariables ? { components: [{ type: 'BODY', parameters: params.bodyUrlVariables.map((v) => ({ type: 'text', text: v })) }] } : {}),
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp template send failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as SendTemplateResponse;
  const providerMessageId = data.messages?.[0]?.id ?? '';
  if (!providerMessageId) throw new Error('WhatsApp template send did not return a message id');
  return { providerMessageId };
}

/**
 * Consulta estado de entrega/lectura vía Graph API.
 */
export async function getWhatsAppMessageStatus(providerMessageId: string): Promise<{ status: string }> {
  const url = `${config.whatsapp.baseUrl}/${config.whatsapp.phoneNumberId}/messages/${providerMessageId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
  });
  if (!res.ok) throw new Error(`WhatsApp status fetch failed: ${res.status}`);
  const data = (await res.json()) as { status?: string };
  return { status: data.status ?? 'delivered' };
}
