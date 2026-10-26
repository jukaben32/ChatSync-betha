# ChatSyncs: inventario de funciones

Fuente: capturas con REA de 33 páginas públicas de chatsyncs.com (octubre 2026). Cada afirmación proviene del texto de esas
páginas (marketing, changelog y fichas de producto); no hay capturas de la app con sesión. El estado de cada función en la
réplica está en [GAP_ANALYSIS.md](GAP_ANALYSIS.md).

## Producto

- **Canal:** WhatsApp Business API oficial (Meta). Coexistencia con la app de WhatsApp Business (mismo número, sin migrar).
  Otros canales (Instagram, Messenger, Telegram, WebChat) aparecen en la ficha de IA.
- **Bandeja compartida:** un número, varios agentes con login propio; asignación manual o automática (reglas, reparto
  equitativo); etiquetas, notas privadas, historial; filtros por estado (resuelto/bloqueado/archivado); respuestas rápidas;
  seguimientos; enmascarar teléfonos a agentes; botón «AI Reply»; panel Subscriber IQ.
- **Broadcasts:** segmentación por etiquetas, comportamiento y campos personalizados; variables; imágenes, vídeos, PDF y
  botones; informe en tiempo real (enviados, entregados, leídos, clics); mensajes de marketing.
- **Secuencias drip:** pasos temporizados (día 1/3/7), disparo por etiqueta o acción, parada automática al responder o
  convertir, informe por paso.
- **Chatbot sin código:** canvas de arrastrar; bloques de mensaje, pregunta, condición (If/Else con varias reglas), acción,
  retraso y traspaso; entrada de usuario con validación (incluye imágenes con IA); preview; sugerencias de campos con «#».
- **Webhook Workflow:** URL por workflow; detecta campos de un JSON de ejemplo; mapea variables de plantilla; condiciones;
  retraso en minutos; acciones (etiquetas, secuencia, asignar agente). Asistente IA para configurarlo.
- **Agente de IA:** detecta intención y actúa (etiquetas, secuencias, flujos, traspaso); conocimiento desde FAQs, URLs,
  archivos, APIs y Google Sheets; entiende imágenes y notas de voz; multilingüe; modos «todas las consultas» o «solo si falla
  el flujo»; espera antes de responder, temas restringidos, horario; escalado por sentimiento; entrenamiento vectorial.
  **Subscriber IQ:** resumen, lead score 0-100, riesgo de abandono, sentimiento y siguiente mejor acción.
- **Agentes especializados:** atención al cliente, Shopify, WooCommerce.
- **Captación:** Click-to-WhatsApp (Facebook/Instagram), IndiaMart, JustDial, con primera respuesta automática y atribución.
- **WhatsApp Forms / Flows:** formularios dentro del chat (texto, opciones, número, fecha; multipantalla en beta) con envío a
  Google Sheets o a un flujo.
- **Reserva de citas:** disponibilidad real, confirmación, recordatorios, sincronización con calendario.
- **Horario comercial:** distinto para cada día; el bot puede responder solo fuera de horario.
- **Seguridad:** 2FA obligatorio, registro de accesos, «direct login», IP allowlist, credenciales enmascaradas, registro de
  borrado de datos/medios.
- **Soporte humano:** llamadas de 15/30/60 min por Google Meet incluidas en los planes de pago.

## Desarrolladores

- **API REST:** base `platform.chatsyncs.com/api/v1`, clave `cs_live_…` (Bearer o parámetro), 40+ endpoints, GET o POST,
  JSON; mensajes (texto, plantilla, media, botones), suscriptores, etiquetas, secuencias, catálogo, flujos, estado de
  mensajes, notas, equipo, estado de conversación, CRM, plantillas. Varias claves con permisos, desactivables; registro de uso.
- **Webhooks salientes:** tres interruptores independientes por bot (mensaje entrante, saliente, cambio de estado), JSON
  `{name, phone, message}`; ubicación incluida.
- **MCP:** `mcp.chatsyncs.com/mcp` con clave Bearer (o inicio de sesión), 43 herramientas en 7 grupos: mensajes y plantillas
  (10), contactos y etiquetas (11), conversaciones y equipo (6), secuencias y flujos (6), pedidos y catálogo (4), CRM (2),
  cuenta (1) y ayuda/guías (3).
- **Integraciones citadas:** Zoho CRM, HubSpot, Mailchimp, Shopify, WooCommerce, Zapier, Make, n8n, Google Sheets,
  Google Ads, Cal.com, Calendly, OpenAI, Slack, Twenty CRM, Razorpay y Paytm (pagos).

## Excluido de la réplica (decisión del usuario)

WhatsApp Payments, Razorpay/Paytm, planes y facturación, pedidos y catálogo con precios/cupones/envío, depósitos en citas,
revendedores.
