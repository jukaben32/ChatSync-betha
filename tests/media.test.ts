import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_BASE_URL = 'https://llm.test/v1';
});
afterEach(() => vi.restoreAllMocks());

describe('medios entrantes', () => {
  it('elige el formato de audio según el MIME', async () => {
    const { audioFormat } = await import('../src/ai/media.js');
    expect(audioFormat('audio/ogg; codecs=opus')).toBe('ogg');
    expect(audioFormat('audio/mpeg')).toBe('mp3');
    expect(audioFormat('audio/wav')).toBe('wav');
    expect(audioFormat(undefined)).toBe('ogg');
  });

  it('transcribe una nota de voz con el endpoint de transcripción', async () => {
    const { understandMedia } = await import('../src/ai/media.js');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ text: 'Hola, quiero una cita' }), { status: 200 }));
    const out = await understandMedia({ kind: 'audio', data: Buffer.from('abc'), mime: 'audio/ogg' });
    expect(out.text).toBe('Hola, quiero una cita');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://llm.test/v1/audio/transcriptions');
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.input_audio).toEqual({ data: Buffer.from('abc').toString('base64'), format: 'ogg' });
  });

  it('describe una imagen enviándola como data URI al modelo', async () => {
    const { understandMedia } = await import('../src/ai/media.js');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Un recibo de pago por 50 USD.' } }] }), { status: 200 }));
    const out = await understandMedia({ kind: 'image', data: Buffer.from('png'), mime: 'image/png', caption: 'mi pago' });
    expect(out.text).toContain('recibo');
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    const parts = sent.messages[0].content;
    expect(parts[1].image_url.url.startsWith('data:image/png;base64,')).toBe(true);
    expect(parts[0].text).toContain('mi pago');
  });

  it('falla de forma controlada sin IA configurada', async () => {
    process.env.AI_API_KEY = 'pending';
    const { understandMedia } = await import('../src/ai/media.js');
    await expect(understandMedia({ kind: 'audio', data: Buffer.from('x') })).rejects.toThrow('ai_not_ready');
  });
});
