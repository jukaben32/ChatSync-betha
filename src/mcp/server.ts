import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export function createChatsycsMcpServer(): McpServer {
  const s = new McpServer(
    { name: 'chatsyncs', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  const textResult = (tool: string, data: Record<string, unknown>) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, tool, ...data }) }],
  });

  s.registerTool(
    'send_text_message',
    {
      description: 'Send a WhatsApp text message to a subscriber. Only within the WhatsApp 24h window unless an approved template is used.',
      inputSchema: { to: z.string(), body: z.string(), contextMessageId: z.string().optional() },
    },
    async (args) =>
      textResult('send_text_message', { to: args.to, body: args.body, contextMessageId: args.contextMessageId }),
  );

  s.registerTool(
    'send_template_message',
    {
      description: 'Send an approved WhatsApp template to a subscriber. Works any time, including outside the 24h window.',
      inputSchema: { to: z.string(), templateName: z.string(), languageCode: z.string().optional() },
    },
    async (args) =>
      textResult('send_template_message', { to: args.to, templateName: args.templateName, languageCode: args.languageCode }),
  );

  s.registerTool(
    'send_interactive_buttons',
    {
      description: 'Send a WhatsApp interactive message with buttons.',
      inputSchema: { to: z.string(), body: z.string(), buttons: z.array(z.string()) },
    },
    async (args) => textResult('send_interactive_buttons', { to: args.to, body: args.body, buttons: args.buttons }),
  );

  s.registerTool(
    'send_file',
    {
      description: 'Send a WhatsApp file/media to a subscriber.',
      inputSchema: { to: z.string(), mediaUrl: z.string(), caption: z.string().optional() },
    },
    async (args) => textResult('send_file', { to: args.to, mediaUrl: args.mediaUrl, caption: args.caption }),
  );

  s.registerTool(
    'upload_media',
    {
      description: 'Upload WhatsApp media.',
      inputSchema: { mediaUrl: z.string(), caption: z.string().optional() },
    },
    async (args) => textResult('upload_media', { mediaUrl: args.mediaUrl, caption: args.caption }),
  );

  s.registerTool(
    'get_message_status',
    {
      description: 'Check WhatsApp delivery/read status of a message.',
      inputSchema: { providerMessageId: z.string() },
    },
    async (args) => textResult('get_message_status', { providerMessageId: args.providerMessageId }),
  );

  s.registerTool(
    'list_templates',
    { description: 'List WhatsApp templates.' },
    async () => textResult('list_templates', {}),
  );

  s.registerTool(
    'create_template',
    {
      description: 'Create a WhatsApp template (Meta reviews before it can be sent).',
      inputSchema: { name: z.string(), languageCode: z.string().optional(), body: z.string() },
    },
    async (args) => textResult('create_template', { name: args.name, languageCode: args.languageCode, body: args.body }),
  );

  s.registerTool(
    'get_template_status',
    {
      description: 'Get WhatsApp template approval status.',
      inputSchema: { templateName: z.string() },
    },
    async (args) => textResult('get_template_status', { templateName: args.templateName }),
  );

  s.registerTool(
    'list_postbacks',
    { description: 'List WhatsApp postbacks.' },
    async () => textResult('list_postbacks', {}),
  );

  s.registerTool(
    'get_subscriber',
    {
      description: 'Get a WhatsApp subscriber/contact by phone.',
      inputSchema: { phone: z.string() },
    },
    async (args) => textResult('get_subscriber', { phone: args.phone }),
  );

  s.registerTool(
    'list_subscribers',
    {
      description: 'List WhatsApp subscribers.',
      inputSchema: { limit: z.number().optional(), offset: z.number().optional() },
    },
    async (args) => textResult('list_subscribers', { limit: args.limit, offset: args.offset }),
  );

  s.registerTool(
    'create_subscriber',
    {
      description: 'Create a WhatsApp subscriber/contact.',
      inputSchema: { phone: z.string(), name: z.string().optional(), customFields: z.object({}).passthrough().optional() },
    },
    async (args) => textResult('create_subscriber', { phone: args.phone, name: args.name, customFields: args.customFields }),
  );

  s.registerTool(
    'update_subscriber',
    {
      description: 'Update a WhatsApp subscriber/contact.',
      inputSchema: { phone: z.string(), name: z.string().optional(), customFields: z.object({}).passthrough().optional() },
    },
    async (args) => textResult('update_subscriber', { phone: args.phone, name: args.name, customFields: args.customFields }),
  );

  s.registerTool(
    'delete_subscriber',
    {
      description: 'Delete a WhatsApp subscriber/contact.',
      inputSchema: { phone: z.string() },
    },
    async (args) => textResult('delete_subscriber', { phone: args.phone }),
  );

  s.registerTool(
    'list_labels',
    { description: 'List WhatsApp labels.' },
    async () => textResult('list_labels', {}),
  );

  s.registerTool(
    'create_label',
    {
      description: 'Create a WhatsApp label.',
      inputSchema: { name: z.string() },
    },
    async (args) => textResult('create_label', { name: args.name }),
  );

  s.registerTool(
    'assign_labels',
    {
      description: 'Assign labels to a WhatsApp subscriber.',
      inputSchema: { phone: z.string(), labels: z.array(z.string()) },
    },
    async (args) => textResult('assign_labels', { phone: args.phone, labels: args.labels }),
  );

  s.registerTool(
    'remove_labels',
    {
      description: 'Remove labels from a WhatsApp subscriber.',
      inputSchema: { phone: z.string(), labels: z.array(z.string()) },
    },
    async (args) => textResult('remove_labels', { phone: args.phone, labels: args.labels }),
  );

  s.registerTool(
    'list_custom_fields',
    { description: 'List WhatsApp custom fields.' },
    async () => textResult('list_custom_fields', {}),
  );

  s.registerTool(
    'assign_custom_fields',
    {
      description: 'Assign custom fields to a WhatsApp subscriber.',
      inputSchema: { phone: z.string(), fields: z.object({}).passthrough() },
    },
    async (args) => textResult('assign_custom_fields', { phone: args.phone, fields: args.fields }),
  );

  s.registerTool(
    'get_conversation',
    {
      description: 'Get a WhatsApp conversation with a subscriber.',
      inputSchema: { phone: z.string() },
    },
    async (args) => textResult('get_conversation', { phone: args.phone }),
  );

  s.registerTool(
    'mark_conversation_status',
    {
      description: 'Mark a WhatsApp conversation status.',
      inputSchema: { phone: z.string(), status: z.string() },
    },
    async (args) => textResult('mark_conversation_status', { phone: args.phone, status: args.status }),
  );

  s.registerTool(
    'assign_chat_to_team_member',
    {
      description: 'Assign a WhatsApp chat to a team member.',
      inputSchema: { phone: z.string(), teamMember: z.string() },
    },
    async (args) => textResult('assign_chat_to_team_member', { phone: args.phone, teamMember: args.teamMember }),
  );

  s.registerTool(
    'add_subscriber_note',
    {
      description: 'Add a note to a subscriber conversation.',
      inputSchema: { phone: z.string(), body: z.string(), author: z.string().optional() },
    },
    async (args) => textResult('add_subscriber_note', { phone: args.phone, body: args.body, author: args.author }),
  );

  s.registerTool(
    'list_team_members',
    { description: 'List team members.' },
    async () => textResult('list_team_members', {}),
  );

  s.registerTool(
    'list_team_roles',
    { description: 'List team roles.' },
    async () => textResult('list_team_roles', {}),
  );

  s.registerTool(
    'assign_sequences',
    {
      description: 'Assign a subscriber to a sequence.',
      inputSchema: { phone: z.string(), sequenceId: z.string() },
    },
    async (args) => textResult('assign_sequences', { phone: args.phone, sequenceId: args.sequenceId }),
  );

  s.registerTool(
    'list_sequences',
    { description: 'List sequences.' },
    async () => textResult('list_sequences', {}),
  );

  s.registerTool(
    'remove_sequences',
    {
      description: 'Remove a subscriber from a sequence.',
      inputSchema: { phone: z.string(), sequenceId: z.string() },
    },
    async (args) => textResult('remove_sequences', { phone: args.phone, sequenceId: args.sequenceId }),
  );

  s.registerTool(
    'list_bot_flows',
    { description: 'List bot flows.' },
    async () => textResult('list_bot_flows', {}),
  );

  s.registerTool(
    'trigger_bot_flow',
    {
      description: 'Trigger a bot flow for a subscriber.',
      inputSchema: { phone: z.string(), flowId: z.string() },
    },
    async (args) => textResult('trigger_bot_flow', { phone: args.phone, flowId: args.flowId }),
  );

  s.registerTool(
    'reset_user_input_flow',
    {
      description: 'Reset the user input flow for a subscriber.',
      inputSchema: { phone: z.string() },
    },
    async (args) => textResult('reset_user_input_flow', { phone: args.phone }),
  );

  s.registerTool(
    'list_catalogs',
    { description: 'List catalogs.' },
    async () => textResult('list_catalogs', {}),
  );

  s.registerTool(
    'sync_catalog',
    {
      description: 'Sync catalog.',
      inputSchema: { catalogId: z.string().optional() },
    },
    async (args) => textResult('sync_catalog', { catalogId: args.catalogId }),
  );

  s.registerTool(
    'list_orders',
    {
      description: 'List orders.',
      inputSchema: { limit: z.number().optional(), offset: z.number().optional() },
    },
    async (args) => textResult('list_orders', { limit: args.limit, offset: args.offset }),
  );

  s.registerTool(
    'update_order_status',
    {
      description: 'Update order status.',
      inputSchema: { orderId: z.string(), status: z.string() },
    },
    async (args) => textResult('update_order_status', { orderId: args.orderId, status: args.status }),
  );

  s.registerTool(
    'get_crm_overview',
    { description: 'Get CRM deals overview.' },
    async () => textResult('get_crm_overview', {}),
  );

  s.registerTool(
    'update_crm_overview',
    {
      description: 'Update CRM deal stage/value for a subscriber.',
      inputSchema: { subscriberPhone: z.string(), stage: z.string().optional(), value: z.number().optional() },
    },
    async (args) => textResult('update_crm_overview', { subscriberPhone: args.subscriberPhone, stage: args.stage, value: args.value }),
  );

  s.registerTool(
    'get_account_info',
    { description: 'Get ChatSyncs account info (plan, connected numbers).' },
    async () => textResult('get_account_info', {}),
  );

  s.registerTool(
    'list_documentation',
    {
      description: 'List ChatSyncs documentation/guides.',
      inputSchema: { query: z.string().optional() },
    },
    async (args) => textResult('list_documentation', { query: args.query }),
  );

  s.registerTool(
    'read_documentation',
    {
      description: 'Read a ChatSyncs documentation page by id.',
      inputSchema: { id: z.string() },
    },
    async (args) => textResult('read_documentation', { id: args.id }),
  );

  s.registerTool(
    'search_documentation',
    {
      description: 'Search ChatSyncs documentation.',
      inputSchema: { query: z.string() },
    },
    async (args) => textResult('search_documentation', { query: args.query }),
  );

  return s;
}

let transport: StreamableHTTPServerTransport | null = null;

export async function startMcpServer(app: any) {
  if (!process.env.MCP_ENABLED || process.env.MCP_ENABLED === 'false') {
    return null;
  }
  const s = createChatsycsMcpServer();
  transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  s.connect(transport);
  app.post('/mcp', { async: async (req: any, reply: any) => transport!.handleRequest(req, reply) });
  app.get('/mcp', { async: async (req: any, reply: any) => transport!.handleRequest(req, reply) });
  return s;
}
