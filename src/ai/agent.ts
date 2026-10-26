import { CHATSYNC_TOOLS, executeChatsycsTool } from './tools.js';
import { prisma } from '../prisma.js';
import { env } from '../config.js';

export interface AgentConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxIterations: number;
}

export function agentConfig(): AgentConfig {
  return {
    enabled: process.env.AI_AGENT_ENABLED !== 'false',
    baseUrl: process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey: env('AI_API_KEY'),
    model: process.env.AI_MODEL ?? 'openai/gpt-4o-mini',
    maxIterations: Number(process.env.AI_MAX_ITERATIONS ?? 6),
  };
}

export function agentReady() {
  const c = agentConfig();
  return c.enabled && Boolean(c.apiKey);
}

function toJsonSchema(typeToken: string): Record<string, unknown> {
  switch (typeToken) {
    case 'string[]':
      return { type: 'array', items: { type: 'string' } };
    case 'object':
      return { type: 'object' };
    case 'number':
      return { type: 'number' };
    default:
      return { type: 'string' };
  }
}

export function buildTools() {
  const tools = CHATSYNC_TOOLS.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, token] of Object.entries(tool.inputSchema ?? {})) {
      const optional = typeof token === 'string' && token.endsWith('?');
      properties[key] = toJsonSchema(String(token).replace(/\?$/, ''));
      if (!optional) required.push(key);
    }
    return {
      type: 'function' as const,
      function: { name: tool.name, description: tool.description, parameters: { type: 'object', properties, required } },
    };
  });
  tools.push({
    type: 'function' as const,
    function: {
      name: 'handover_to_human',
      description: 'Transfiere la conversación a un agente humano cuando el cliente lo pide o no puedes resolverlo.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: [] },
    },
  });
  return tools;
}

async function systemPrompt() {
  const sources = await prisma.knowledgeSource.findMany({ orderBy: { createdAt: 'asc' }, take: 50 });
  const knowledge = sources.map((s) => `## ${s.title}\n${s.content}`).join('\n\n').slice(0, 24_000);
  return [
    process.env.AI_SYSTEM_PROMPT ??
      'Eres un asistente de atención al cliente por WhatsApp. Responde en el idioma del cliente, de forma breve y amable.',
    'Responde únicamente con información de la base de conocimiento. Si no la tienes, ofrece transferir a un humano.',
    knowledge ? `\n# Base de conocimiento\n${knowledge}` : '',
  ].join('\n');
}

type ChatMessage = Record<string, unknown>;

async function complete(c: AgentConfig, messages: ChatMessage[], tools: unknown[]) {
  const response = await fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
    body: JSON.stringify({ model: c.model, messages, tools, max_tokens: 1024 }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw new Error(`llm_error ${response.status}: ${await response.text()}`);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments?: string } }> } }>;
  };
  return data.choices?.[0]?.message;
}

/**
 * Un turno del agente: historial reciente + herramientas. Devuelve el texto final a enviar al cliente.
 */
export async function runAgentTurn(params: {
  phone: string;
  conversationId: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{ ok: boolean; content?: string; handover?: boolean; error?: string }> {
  const c = agentConfig();
  if (!agentReady()) return { ok: false, error: 'agent_disabled' };

  const messages: ChatMessage[] = [
    { role: 'system', content: (await systemPrompt()) + `\n\nTeléfono del cliente: ${params.phone}` },
    ...params.history,
  ];
  const tools = buildTools();
  let handover = false;

  try {
    let reply = await complete(c, messages, tools);
    for (let i = 0; i < c.maxIterations && reply?.tool_calls?.length; i++) {
      messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: reply.tool_calls });
      for (const call of reply.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          /* argumentos inválidos: se ejecuta con {} */
        }
        let result: unknown;
        if (call.function.name === 'handover_to_human') {
          handover = true;
          await prisma.conversation.update({ where: { id: params.conversationId }, data: { assignedTo: 'human', status: 'pending' } });
          result = { ok: true };
        } else {
          try {
            result = await executeChatsycsTool(call.function.name, { phone: params.phone, ...args });
          } catch (e) {
            result = { ok: false, error: (e as Error).message };
          }
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      reply = await complete(c, messages, tools);
    }
    return { ok: true, content: reply?.content?.trim() || undefined, handover };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
