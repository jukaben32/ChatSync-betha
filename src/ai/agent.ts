import { CHATSYNC_TOOLS, executeChatsycsTool } from './tools.js';

export interface AgentConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxIterations: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  enabled: process.env.AI_AGENT_ENABLED !== 'false',
  baseUrl: process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1',
  apiKey: process.env.AI_API_KEY ?? '',
  model: process.env.AI_MODEL ?? 'openai/gpt-4o-mini',
  maxIterations: Number(process.env.AI_MAX_ITERATIONS ?? 6),
};

function toJsonSchema(typeToken: string): Record<string, unknown> {
  switch (typeToken) {
    case 'string[]':
      return { type: 'array', items: { type: 'string' } };
    case 'object':
      return { type: 'object' };
    case 'number':
    case 'number?':
      return { type: 'number' };
    case 'string?':
    case 'string':
      return { type: 'string' };
    default:
      return { type: 'string' };
  }
}

export function buildTools() {
  return CHATSYNC_TOOLS.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const schema = tool.inputSchema ?? {};
    for (const [key, token] of Object.entries(schema)) {
      const isOptional = typeof token === 'string' && token.endsWith('?');
      properties[key] = toJsonSchema(String(token).replace(/\?$/, ''));
      if (!isOptional) required.push(key);
    }
    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        inputSchema: { type: 'object', properties, required },
      },
    };
  });
}

export async function runAgentTurn(params: { messages: Array<{ role: string; content: string; phone?: string }> }) {
  const config = DEFAULT_CONFIG;
  if (!config.enabled || !config.apiKey) {
    return { ok: false, error: 'agent_disabled', reason: 'AI agent not configured' };
  }

  const messages: Array<Record<string, unknown>> = [];
  for (const message of params.messages) {
    messages.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
      ...(message.phone ? { tool_choice: undefined } : {}),
    });
  }

  const tools = buildTools();
  let iterations = 0;
  let finalContent: string = '';

  let response: Response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, tools, max_tokens: 1024 }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    return { ok: false, error: 'llm_error', message: errorText };
  }
  const completion = (await response.json()) as {
    choices?: Array<{ message?: { role: string; content?: string; tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }> } }>;
  };
  let assistantMessage = completion.choices?.[0]?.message;
  finalContent = assistantMessage?.content ?? '';

  while (assistantMessage?.tool_calls?.length && iterations < config.maxIterations) {
    iterations += 1;
    const toolMessages: Array<Record<string, unknown>> = [
      ...messages,
      { role: 'assistant', content: finalContent || null, tool_calls: assistantMessage.tool_calls },
    ];
    const toolResults: Array<Record<string, unknown>> = [];
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function?.name ?? '';
      const toolArgs = (toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {}) as Record<string, unknown>;
      let toolResult: unknown = { ok: false, error: 'unknown_tool' };
      try {
        toolResult = await executeChatsycsTool(toolName, toolArgs);
      } catch (error) {
        toolResult = { ok: false, error: (error as Error).message };
      }
      toolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id ?? '',
        name: toolName,
        content: JSON.stringify(toolResult),
      });
    }
    finalContent = '';
    let response2: Response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: toolMessages, tools, max_tokens: 1024 }),
    });
    if (!response2.ok) {
      const errorText = await response2.text();
      return { ok: false, error: 'llm_error', message: errorText };
    }
    const completion2 = (await response2.json()) as {
      choices?: Array<{ message?: { role: string; content?: string; tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }> } }>;
    };
    assistantMessage = completion2.choices?.[0]?.message;
    finalContent = assistantMessage?.content ?? '';
  }

  return { ok: true, content: finalContent, iterations };
}
