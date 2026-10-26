import { config, whatsappConfigured } from '../config.js';
import { agentConfig, agentReady, complete } from './agent.js';

/** WhatsApp admite hasta 16 MB; se limita antes para no agotar memoria ni tiempo en serverless. */
const MAX_BYTES = 8 * 1024 * 1024;

export type MediaKind = 'image' | 'audio';

export interface InboundMedia {
  kind: MediaKind;
  /** id de medio de WhatsApp (se descarga con la Graph API). */
  id?: string;
  /** Contenido ya disponible (pruebas/simulación). */
  data?: Buffer;
  mime?: string;
  caption?: string;
}

export interface MediaResult {
  /** Texto que representa el medio: transcripción de la nota de voz o descripción de la imagen. */
  text: string;
  mime?: string;
}

/** Descarga un medio recibido: primero se pide su URL temporal y luego el binario, ambos con el token de acceso. */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ data: Buffer; mime: string }> {
  if (!whatsappConfigured()) throw new Error('whatsapp_not_configured');
  const headers = { Authorization: `Bearer ${config.whatsapp.accessToken}` };
  const meta = await fetch(`${config.whatsapp.baseUrl}/${encodeURIComponent(mediaId)}`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!meta.ok) throw new Error(`media_lookup_failed ${meta.status}`);
  const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!info.url) throw new Error('media_url_missing');
  if ((info.file_size ?? 0) > MAX_BYTES) throw new Error('media_too_large');
  const file = await fetch(info.url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!file.ok) throw new Error(`media_download_failed ${file.status}`);
  const data = Buffer.from(await file.arrayBuffer());
  if (data.length > MAX_BYTES) throw new Error('media_too_large');
  return { data, mime: (info.mime_type ?? file.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim() };
}

/** Formato de contenedor que espera la API de transcripción a partir del tipo MIME. */
export function audioFormat(mime: string | undefined): string {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('flac')) return 'flac';
  if (m.includes('aac')) return 'aac';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  return 'ogg';
}

export async function transcribeAudio(data: Buffer, mime?: string): Promise<string> {
  const c = agentConfig();
  const res = await fetch(`${c.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
    body: JSON.stringify({
      model: process.env.AI_TRANSCRIBE_MODEL ?? 'openai/whisper-1',
      input_audio: { data: data.toString('base64'), format: audioFormat(mime) },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`transcribe_error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (((await res.json()) as { text?: string }).text ?? '').trim();
}

export async function describeImage(data: Buffer, mime: string | undefined, caption?: string): Promise<string> {
  const type = mime && mime.startsWith('image/') ? mime : 'image/jpeg';
  const prompt = [
    'Describe esta imagen enviada por un cliente por WhatsApp en 1-3 frases, en español, de forma objetiva.',
    'Si hay texto visible (recibo, captura, etiqueta, documento), transcríbelo con lo esencial. No inventes datos.',
    caption ? `El cliente la acompañó con este texto: «${caption}».` : '',
  ].join(' ');
  const reply = await complete(
    [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${type};base64,${data.toString('base64')}` } }] }],
    undefined,
    300,
    process.env.AI_MEDIA_MODEL,
  );
  return (reply?.content ?? '').trim();
}

/**
 * Convierte una nota de voz o una imagen en texto para que flujos, palabras clave y el agente de IA
 * puedan tratarlas como un mensaje normal. Lanza error si no hay IA o falla la descarga/transcripción;
 * quien llama decide el texto alternativo.
 */
export async function understandMedia(media: InboundMedia): Promise<MediaResult> {
  if (!agentReady()) throw new Error('ai_not_ready');
  let { data, mime } = media;
  if (!data) {
    if (!media.id) throw new Error('media_missing');
    ({ data, mime } = await downloadWhatsAppMedia(media.id));
  }
  const text = media.kind === 'audio' ? await transcribeAudio(data, mime) : await describeImage(data, mime, media.caption);
  if (!text) throw new Error('media_empty_result');
  return { text, mime };
}
