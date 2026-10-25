import { prisma } from '../prisma.js';
import { sendWhatsAppText, sendWhatsAppTemplate, getWhatsAppMessageStatus } from '../whatsapp/client.js';
import { triggerBotFlowForSubscriber, enrollSubscriberInSequence } from '../domain/sequences.js';
import { sendBroadcast } from '../domain/broadcasts.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const CHATSYNC_TOOLS: ToolDefinition[] = [
  { name: 'send_text_message', description: 'Send a WhatsApp text message to a subscriber.', inputSchema: { to: 'string', body: 'string', contextMessageId: 'string?' } },
  { name: 'send_template_message', description: 'Send an approved WhatsApp template to a subscriber.', inputSchema: { to: 'string', templateName: 'string', languageCode: 'string?' } },
  { name: 'send_interactive_buttons', description: 'Send a WhatsApp interactive message with buttons.', inputSchema: { to: 'string', body: 'string', buttons: 'string[]' } },
  { name: 'send_file', description: 'Send a WhatsApp file/media to a subscriber.', inputSchema: { to: 'string', mediaUrl: 'string', caption: 'string?' } },
  { name: 'upload_media', description: 'Upload WhatsApp media.', inputSchema: { mediaUrl: 'string', caption: 'string?' } },
  { name: 'get_message_status', description: 'Check WhatsApp delivery/read status of a message.', inputSchema: { providerMessageId: 'string' } },
  { name: 'list_templates', description: 'List WhatsApp templates.', inputSchema: {} },
  { name: 'create_template', description: 'Create a WhatsApp template (Meta reviews before it can be sent).', inputSchema: { name: 'string', languageCode: 'string?', body: 'string' } },
  { name: 'get_template_status', description: 'Get WhatsApp template approval status.', inputSchema: { templateName: 'string' } },
  { name: 'list_postbacks', description: 'List WhatsApp postbacks.', inputSchema: {} },
  { name: 'get_subscriber', description: 'Get a WhatsApp subscriber/contact by phone.', inputSchema: { phone: 'string' } },
  { name: 'list_subscribers', description: 'List WhatsApp subscribers.', inputSchema: { limit: 'number', offset: 'number' } },
  { name: 'create_subscriber', description: 'Create a WhatsApp subscriber/contact.', inputSchema: { phone: 'string', name: 'string?', customFields: 'object' } },
  { name: 'update_subscriber', description: 'Update a WhatsApp subscriber/contact.', inputSchema: { phone: 'string', name: 'string?', customFields: 'object' } },
  { name: 'delete_subscriber', description: 'Delete a WhatsApp subscriber/contact.', inputSchema: { phone: 'string' } },
  { name: 'list_labels', description: 'List WhatsApp labels.', inputSchema: {} },
  { name: 'create_label', description: 'Create a WhatsApp label.', inputSchema: { name: 'string' } },
  { name: 'assign_labels', description: 'Assign labels to a WhatsApp subscriber.', inputSchema: { phone: 'string', labels: 'string[]' } },
  { name: 'remove_labels', description: 'Remove labels from a WhatsApp subscriber.', inputSchema: { phone: 'string', labels: 'string[]' } },
  { name: 'list_custom_fields', description: 'List WhatsApp custom fields.', inputSchema: {} },
  { name: 'assign_custom_fields', description: 'Assign custom fields to a WhatsApp subscriber.', inputSchema: { phone: 'string', fields: 'object' } },
  { name: 'get_conversation', description: 'Get a WhatsApp conversation with a subscriber.', inputSchema: { phone: 'string' } },
  { name: 'mark_conversation_status', description: 'Mark a WhatsApp conversation status.', inputSchema: { phone: 'string', status: 'string' } },
  { name: 'assign_chat_to_team_member', description: 'Assign a WhatsApp chat to a team member.', inputSchema: { phone: 'string', teamMember: 'string' } },
  { name: 'add_subscriber_note', description: 'Add a note to a subscriber conversation.', inputSchema: { phone: 'string', body: 'string', author: 'string?' } },
  { name: 'list_team_members', description: 'List team members.', inputSchema: {} },
  { name: 'list_team_roles', description: 'List team roles.', inputSchema: {} },
  { name: 'assign_sequences', description: 'Assign a subscriber to a sequence.', inputSchema: { phone: 'string', sequenceId: 'string' } },
  { name: 'list_sequences', description: 'List sequences.', inputSchema: {} },
  { name: 'remove_sequences', description: 'Remove a subscriber from a sequence.', inputSchema: { phone: 'string', sequenceId: 'string' } },
  { name: 'list_bot_flows', description: 'List bot flows.', inputSchema: {} },
  { name: 'trigger_bot_flow', description: 'Trigger a bot flow for a subscriber.', inputSchema: { phone: 'string', flowId: 'string' } },
  { name: 'reset_user_input_flow', description: 'Reset the user input flow for a subscriber.', inputSchema: { phone: 'string' } },
  { name: 'list_catalogs', description: 'List catalogs.', inputSchema: {} },
  { name: 'sync_catalog', description: 'Sync catalog.', inputSchema: { catalogId: 'string?' } },
  { name: 'list_orders', description: 'List orders.', inputSchema: { limit: 'number', offset: 'number' } },
  { name: 'update_order_status', description: 'Update order status.', inputSchema: { orderId: 'string', status: 'string' } },
  { name: 'get_crm_overview', description: 'Get CRM deals overview.', inputSchema: {} },
  { name: 'update_crm_overview', description: 'Update CRM deal stage/value for a subscriber.', inputSchema: { subscriberPhone: 'string', stage: 'string?', value: 'number' } },
  { name: 'get_account_info', description: 'Get ChatSyncs account info (plan, connected numbers).', inputSchema: {} },
  { name: 'list_documentation', description: 'List ChatSyncs documentation/guides.', inputSchema: { query: 'string?' } },
  { name: 'read_documentation', description: 'Read a ChatSyncs documentation page by id.', inputSchema: { id: 'string' } },
  { name: 'search_documentation', description: 'Search ChatSyncs documentation.', inputSchema: { query: 'string' } },
];

export async function executeChatsycsTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  switch (name) {
    case 'send_text_message': {
      const { to, body, contextMessageId } = args as { to: string; body: string; contextMessageId?: string };
      const { providerMessageId } = await sendWhatsAppText({ to, body, contextMessageId });
      return { ok: true, result: { providerMessageId } };
    }
    case 'send_template_message': {
      const { to, templateName, languageCode } = args as { to: string; templateName: string; languageCode?: string };
      const { providerMessageId } = await sendWhatsAppTemplate({ to, templateName, languageCode });
      return { ok: true, result: { providerMessageId } };
    }
    case 'get_message_status': {
      const { providerMessageId } = args as { providerMessageId: string };
      const status = await getWhatsAppMessageStatus(providerMessageId);
      return { ok: true, result: status };
    }
    case 'get_subscriber': {
      const { phone } = args as { phone: string };
      const subscriber = await prisma.subscriber.findUnique({ where: { phone }, include: { labels: { include: { label: true } } } });
      return { ok: true, result: subscriber };
    }
    case 'list_subscribers': {
      const limit = (args.limit as number) ?? 100;
      const offset = (args.offset as number) ?? 0;
      const subscribers = await prisma.subscriber.findMany({ take: limit, skip: offset });
      return { ok: true, result: { subscribers } };
    }
    case 'assign_labels': {
      const { phone, labels } = args as { phone: string; labels: string[] };
      const subscriber = await prisma.subscriber.findUnique({ where: { phone } });
      if (!subscriber) return { ok: false, error: 'subscriber_not_found' };
      for (const labelName of labels) {
        const label = await prisma.label.upsert({ where: { name: labelName }, update: {}, create: { name: labelName } });
        await prisma.subscriberLabel.upsert({
          where: { subscriberId_labelId: { subscriberId: subscriber.id, labelId: label.id } },
          update: {},
          create: { subscriberId: subscriber.id, labelId: label.id },
        });
      }
      return { ok: true };
    }
    case 'assign_sequences': {
      const { phone, sequenceId } = args as { phone: string; sequenceId: string };
      const enrollment = await enrollSubscriberInSequence({ phone, sequenceId });
      return { ok: true, result: enrollment };
    }
    case 'trigger_bot_flow': {
      const { phone, flowId } = args as { phone: string; flowId: string };
      const result = await triggerBotFlowForSubscriber({ phone, flowId });
      return { ok: true, result };
    }
    case 'update_order_status': {
      const { orderId, status } = args as { orderId: string; status: string };
      const order = await prisma.order.update({ where: { id: orderId }, data: { status } });
      return { ok: true, result: order };
    }
    case 'update_crm_overview': {
      const { subscriberPhone, stage, value } = args as { subscriberPhone: string; stage?: string; value?: number };
      const subscriber = await prisma.subscriber.findUnique({ where: { phone: subscriberPhone } });
      if (!subscriber) return { ok: false, error: 'subscriber_not_found' };
      const existing = await prisma.crmDeal.findFirst({ where: { subscriberId: subscriber.id } });
      const deal = existing
        ? await prisma.crmDeal.update({ where: { id: existing.id }, data: { stage: stage ?? undefined, value: value ?? undefined } })
        : await prisma.crmDeal.create({ data: { subscriberId: subscriber.id, stage: stage ?? 'new', value: value ?? 0 } });
      return { ok: true, result: deal };
    }
    case 'get_crm_overview':
      return { ok: true, result: await prisma.crmDeal.findMany({ include: { subscriber: true } }) };
    case 'list_orders': {
      const limit = (args.limit as number) ?? 100;
      const offset = (args.offset as number) ?? 0;
      const orders = await prisma.order.findMany({ take: limit, skip: offset, include: { subscriber: true } });
      return { ok: true, result: { orders } };
    }
    case 'list_bot_flows':
      return { ok: true, result: { flows: await prisma.sequence.findMany() } };
    case 'send_broadcast':
      return { ok: true, result: await sendBroadcast({ broadcastId: String(args.broadcastId) }) };
    default:
      return { ok: false, error: `unknown_tool:${name}` };
  }
}
