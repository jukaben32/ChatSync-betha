# ChatSyncs — Inventario de funcionalidades (REA-verificado)

> Generado con REA (`morluto/rea`) contra `https://chatsyncs.com` mediante escenarios CDP (`capture-browser-scenario`) y capturas DOM + accesibilidad.

## Cobertura REA

| Ruta | Estado |
|---|---|
| `/` | ✅ Capturada (DOM + accesibilidad) |
| `/pricing` | ✅ Capturada (DOM + accesibilidad) |
| `/ai-agents` | ✅ Capturada (DOM + accesibilidad) |
| `/mcp` | ✅ Capturada (DOM + accesibilidad) |
| `/services` | ✅ Capturada (DOM + accesibilidad) |
| `/compare` | ✅ Capturada (DOM + accesibilidad) |
| `/features/whatsapp-coexistence` | ✅ Capturada (DOM + accesibilidad) |
| `/features/whatsapp-broadcast` | ✅ Capturada (DOM + accesibilidad) |
| `/features/whatsapp-chatbot` | ✅ Capturada (DOM + accesibilidad) |
| `/features/ai-agent` | ✅ Capturada (DOM + accesibilidad) |
| `/features/human-support` | ✅ Capturada (DOM + accesibilidad) |
| `/features/shared-inbox` | ✅ Capturada (DOM + accesibilidad) |
| `/features/click-to-whatsapp-ads` | ✅ Capturada (DOM + accesibilidad) |
| `/features/drip-campaigns` | ✅ Capturada (DOM + accesibilidad) |
| `/features/whatsapp-catalog` | ✅ Capturada (DOM + accesibilidad) |
| `/features/appointment-booking` | ✅ Capturada (DOM + accesibilidad) |
| `/features/whatsapp-forms` | ✅ Capturada (DOM + accesibilidad) |
| `/features/webhook-workflow` | ✅ Capturada (DOM + accesibilidad) |
| `/features/rest-api` | ✅ Capturada (DOM + accesibilidad) |
| `/features/incoming-outgoing-webhooks` | ✅ Capturada (DOM + accesibilidad) |
| `/ai-agents/customer-support` | ✅ Capturada (DOM + accesibilidad) |
| `/ai-agents/shopify-whatsapp` | ✅ Capturada (DOM + accesibilidad) |
| `/ai-agents/woocommerce-whatsapp` | ✅ Capturada (DOM + accesibilidad) |

**Excluidas a propósito** (no forman parte de la réplica privada solicitada): `/features/whatsapp-payments` (pagos) y toda la vertical de facturación/pagos.

## Funcionalidades (agrupadas por subsistema)

### 1. WhatsApp Core
- Conexión oficial por WhatsApp Business API (Meta) — "Official Meta Business Partner".
- Coexistencia WhatsApp + WhatsApp Business / apps existentes (WhatsApp Coexistence).

### 2. Mensajería y plantillas
- Send text / template / interactive buttons / file / media.
- Template approval flow (Meta reviews each new template before sending).

### 3. Campañas masivas (Broadcast)
- Broadcast a listas/segmentos con template o texto libre.

### 4. Chatbots no-code
- Flow builder: steps, conditions, waits, actions.

### 5. AI Agents
- Specialists: Customer Support, Shopify WhatsApp, WooCommerce WhatsApp.
- Prompt actions con marcadores: `##add_label##`, `##save_custom_field##`, `##assign_sequence##`, `##trigger_bot_flow##`, `##call_http_api##`, `##assign_human_member##`, `##transfer_agent##`, `##mark_as_solved##`, `##skip_reply##`, `##block_subscriber##`.
- Knowledge sources: content, URL, file, media, Google Sheet, API.

### 6. Human Support / Inbox compartido
- Shared team inbox, notes, assignment, status, labels.

### 7. CRM / Deals / Orders / Catalog
- Deals stages/values/owners; orders status; catalog sync.

### 8. MCP Server (43 tools)
- Grupos: Messages/templates (10), Contacts/labels (11), Conversations/team (6), Sequences/flows (6), Orders/catalog (4), CRM (2), Account (1), Docs (3). Total 43.

### 9. REST / Webhooks / Developer API
- Incoming/outgoing webhooks, REST API, bot flows via webhook.

## Próximas fases del build (réplica privada)

1. Scaffold backend (Fastify + Prisma/Postgres) + capa WhatsApp Cloud API.
2. Inbox compartido + contacts/labels/notes.
3. Broadcast + bot flows + sequences.
4. AI agents (tool loop) + MCP server + REST API.
5. Catalog/orders/CRM.
6. Dashboard UI.
