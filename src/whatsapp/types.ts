export const WHATSAPP_CHANNEL = 'whatsapp' as const;

export type WhatsAppDirection = 'inbound' | 'outbound';

export interface WhatsAppInboundMessage {
  providerMessageId?: string;
  phone: string;
  name?: string;
  body?: string;
  mediaUrl?: string;
  timestamp?: string;
}

export interface WhatsAppOutboundRequest {
  to: string;
  body: string;
  providerMessageId?: string;
  contextMessageId?: string;
  messageType?: 'text' | 'template' | 'interactive' | 'image' | 'document';
  templateName?: string;
}

export interface MessageStatus {
  providerMessageId: string;
  status: 'delivered' | 'sent' | 'read' | 'failed';
}
