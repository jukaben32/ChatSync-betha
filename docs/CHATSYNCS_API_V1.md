# API v1 de ChatSyncs (contrato observado)

Fuente: la consola de desarrolladores de una cuenta de prueba (`/api/developer/console`), capturada con REA en octubre 2026.
Son los 42 endpoints documentados en la propia consola. La réplica implementa los marcados con ✅ en `/api/v1/...`
(ver `src/api/routes-v1.ts`).

**Convenciones del contrato original**

- Base: `https://platform.chatsyncs.com/api/v1`. Todos los endpoints aceptan **POST** (y casi todos también **GET**).
- Autenticación: parámetro `apiToken` (query o cuerpo `application/x-www-form-urlencoded`/JSON). La réplica además acepta
  `Authorization: Bearer`.
- Cuenta de WhatsApp: parámetro `phone_number_id`. `phone_number` va con código de país, solo dígitos.
- Respuesta: `{"status":"1","message":…}` si va bien; `{"status":"0","message":"…"}` si falla.

| Estado | Endpoint | Parámetros (* obligatorios) |
|---|---|---|
| ✅ | `user/team-member/list` | apiToken* |
| ✅ | `user/package/list` (roles del equipo) | apiToken* |
| ❌ | `whatsapp/account/connect` | user_id*, whatsapp_business_account_id*, access_token* |
| ✅ | `whatsapp/send` | phone_number_id*, phone_number*, message* (texto o plantilla) |
| ✅ | `whatsapp/send/interactive-buttons` | phone_number_id*, phone_number*, message*, buttons*, button_header_text, button_footer_text, media_url, media_id, media_name |
| ✅ | `whatsapp/send/file` | phone_number_id*, phone_number*, media_url*, media_type, media_name, media_caption_text |
| ⚠️ | `whatsapp/upload/media` | phone_number_id* (la réplica solo envía por URL pública) |
| ✅ | `whatsapp/get/conversation` | phone_number_id*, phone_number*, limit*, offset |
| ✅ | `whatsapp/get/post-back-list` | phone_number_id* |
| ✅ | `whatsapp/get/message-status` | wa_message_id* |
| ✅ | `whatsapp/template/list` | phone_number_id* |
| ✅ | `whatsapp/template/create` | phone_number_id*, name*, language, template_type, footer_text |
| ✅ | `whatsapp/template/status` | phone_number_id*, template_id* |
| ✅ | `whatsapp/get/bot-flow-list` | phone_number_id* |
| ✅ | `whatsapp/trigger-bot` | phone_number_id*, bot_flow_unique_id*, phone_number* |
| ✅ | `whatsapp/subscriber/get` | phone_number_id*, phone_number* |
| ✅ | `whatsapp/subscriber/list` | phone_number_id*, limit*, offset, orderBy |
| ✅ | `whatsapp/subscriber/create` | phoneNumberID*, name*, phoneNumber* |
| ✅ | `whatsapp/subscriber/update` | phone_number_id*, phone_number*, first_name, last_name, gender, label_ids |
| ✅ | `whatsapp/subscriber/delete` | phone_number_id*, phone_number* |
| ✅ | `whatsapp/subscriber/reset/user-input-flow` | phone_number_id*, phone_number* |
| ✅ | `whatsapp/subscriber/chat/assign-to-team-member` | phone_number_id*, phone_number*, team_member_id* |
| ✅ | `whatsapp/subscriber/chat/mark-conversation` | phone_number_id*, phone_number*, status |
| ✅ | `whatsapp/subscriber/chat/assign-custom-fields` | phone_number_id*, phone_number*, custom_fields* |
| ✅ | `whatsapp/subscriber/custom-fields/list` | apiToken* |
| ✅ | `whatsapp/subscriber/chat/assign-labels` | phone_number_id*, phone_number*, label_ids* |
| ✅ | `whatsapp/subscriber/chat/remove-labels` | phone_number_id*, phone_number*, label_ids* |
| ✅ | `whatsapp/subscriber/sequence/list` | phone_number_id* |
| ✅ | `whatsapp/subscriber/chat/assign-sequence` | phone_number_id*, phone_number*, sequence_ids* |
| ✅ | `whatsapp/subscriber/chat/remove-sequence` | phone_number_id*, phone_number*, sequence_ids* |
| ✅ | `whatsapp/subscriber/chat/add-notes` | phone_number_id*, phone_number*, note_text* |
| ✅ | `whatsapp/subscriber/chat/get-notes` | phone_number_id*, phone_number* |
| ✅ | `whatsapp/subscriber/crm/get` | phone_number_id*, phone_number* |
| ✅ | `whatsapp/subscriber/crm/update` | phone_number_id*, phone_number*, title, pipeline_id, stage_id, value, currency, owner_user_id, source |
| ✅ | `label/list` | apiToken* |
| ✅ | `label/create` | label_name* |
| ⛔ | `whatsapp/catalog/list`, `catalog/sync`, `catalog/order/list`, `catalog/order/status-change` | catálogo y pedidos: fuera de alcance |
| ⛔ | `user/get/direct-login-url`, `…/only-new-users` | gestión multiusuario con paquetes de pago |

Notas de mapeo: los ids de etiquetas, secuencias, flujos, plantillas y miembros son UUID en la réplica (numéricos en el
original); `label_ids`/`sequence_ids` aceptan lista separada por comas o array JSON.
