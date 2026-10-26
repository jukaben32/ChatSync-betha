import { prisma } from '../prisma.js';

/**
 * Base de conocimiento por fragmentos. En vez de meter todo el texto en cada prompt, se parte en fragmentos y solo
 * se envían a la IA los más relevantes para la pregunta del cliente (búsqueda BM25 léxica: no necesita embeddings
 * ni una API aparte, y reduce mucho el consumo de tokens).
 */

const STOPWORDS = new Set(
  'de la que el en y a los se del las un por con no una su para es al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros the and for are but not you all can had her was one our out has his how its may who did get now see two way use she him the of to in is it that on be as at by this with from or an'.split(' '),
);

/** Raíz aproximada: sin plural y limitada a 5 letras, para que «devolver» y «devoluciones» coincidan. */
function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  return w.slice(0, 5);
}

/** minúsculas, sin tildes, solo letras/números; descarta palabras vacías y de 1-2 letras; devuelve raíces */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}

/** Parte un texto en fragmentos de ~`size` caracteres respetando párrafos y frases, con solapamiento. */
export function chunkText(text: string, size = 900, overlap = 120): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  // unidades: párrafos; los párrafos largos se parten por frases
  const units: string[] = [];
  for (const para of clean.split(/\n{2,}/)) {
    if (para.length <= size) units.push(para.trim());
    else units.push(...(para.match(/[^.!?\n]+[.!?]*\s*/g) ?? [para]).map((s) => s.trim()).filter(Boolean));
  }

  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    // una "frase" mayor que el tamaño se corta en seco
    const pieces = unit.length > size ? unit.match(new RegExp(`.{1,${size}}`, 'gs')) ?? [unit] : [unit];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 1 > size) {
        chunks.push(current.trim());
        current = current.slice(Math.max(0, current.length - overlap)).replace(/^\S*\s/, '') + ' ';
      }
      current += (current && !current.endsWith(' ') ? ' ' : '') + piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export interface ChunkRow {
  id: string;
  text: string;
  title: string;
}

/** BM25 sobre los fragmentos. Devuelve los `k` mejores con puntuación > 0, ordenados de mayor a menor. */
export function rankChunks(query: string, chunks: ChunkRow[], k = 6): Array<ChunkRow & { score: number }> {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !chunks.length) return [];
  const docs = chunks.map((c) => tokenize(`${c.title} ${c.text}`));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);

  const K1 = 1.5;
  const B = 0.75;
  const N = chunks.length;
  return chunks
    .map((c, i) => {
      const d = docs[i];
      const tf = new Map<string, number>();
      for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const t of q) {
        const f = tf.get(t) ?? 0;
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * d.length) / avg));
      }
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Reemplaza los fragmentos de una fuente por los de su contenido actual. */
export async function indexSource(sourceId: string, content: string): Promise<number> {
  const chunks = chunkText(content);
  await prisma.knowledgeChunk.deleteMany({ where: { sourceId } });
  if (chunks.length) await prisma.knowledgeChunk.createMany({ data: chunks.map((text, position) => ({ sourceId, position, text })) });
  return chunks.length;
}

/** Fuentes anteriores a los fragmentos (o sin ellos) se indexan la primera vez que se necesitan. */
async function ensureIndexed() {
  const missing = await prisma.knowledgeSource.findMany({ where: { chunks: { none: {} } }, select: { id: true, content: true }, take: 20 });
  for (const s of missing) await indexSource(s.id, s.content);
}

/** Los fragmentos más relevantes para `query`, ya recortados al presupuesto de caracteres del prompt. */
export async function searchKnowledge(query: string, opts: { k?: number; maxChars?: number } = {}): Promise<Array<{ title: string; text: string }>> {
  await ensureIndexed();
  const rows = await prisma.knowledgeChunk.findMany({ select: { id: true, text: true, source: { select: { title: true } } }, take: 5000 });
  const ranked = rankChunks(query, rows.map((r) => ({ id: r.id, text: r.text, title: r.source.title })), opts.k ?? 6);
  const out: Array<{ title: string; text: string }> = [];
  let used = 0;
  for (const c of ranked) {
    if (used + c.text.length > (opts.maxChars ?? 5000)) break;
    out.push({ title: c.title, text: c.text });
    used += c.text.length;
  }
  return out;
}

const TEXT_TYPES = ['txt', 'md', 'csv', 'json', 'html', 'htm', 'xml', 'log'];

/** Texto de un archivo subido: PDF (unpdf) o texto plano. */
export async function extractFileText(filename: string, data: Buffer): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf' || data.subarray(0, 5).toString('latin1') === '%PDF-') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (TEXT_TYPES.includes(ext)) {
    const raw = data.toString('utf8');
    return ext === 'html' || ext === 'htm' || ext === 'xml' ? raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : raw;
  }
  throw new Error('unsupported_file_type');
}
