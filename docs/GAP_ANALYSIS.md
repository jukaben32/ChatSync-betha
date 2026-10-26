# Análisis de carencias: réplica vs. ChatSyncs

**Método.** Dos capturas con REA (`capture-browser-scenario`, `inspect-web-page`):

1. **Web pública** de chatsyncs.com: 33 páginas (home, pricing, mcp, changelog, services, compare, `/ai-agents/*`, `/features/*`,
   industrias y blog). Escenario reproducible en `docs/rea-captures/public-scenario.json`.
2. **App con sesión** (`platform.chatsyncs.com`, cuenta de prueba en periodo de prueba): panel, Shared Inbox, Connect Account,
   Chatbot Manager, Subscriber Manager, Broadcast Center, Ajustes (seguridad), Cuenta, Equipo y la **consola de desarrolladores**,
   que documenta 42 endpoints de la API v1 (ver [CHATSYNCS_API_V1.md](CHATSYNCS_API_V1.md)).

Limitación: la cuenta de prueba estaba vacía (0 suscriptores, sin bots), así que las pantallas de detalle (editor de flujos
con datos, ficha de un suscriptor con historial, informes con cifras) se vieron sin contenido. Las capturas en bruto contienen
datos personales de la cuenta y **se eliminaron**; solo se conserva lo derivado aquí.

**Fuera de alcance por decisión del usuario (uso privado, sin cobros):** WhatsApp Payments, Razorpay/Paytm, planes, facturación,
transacciones, pedidos y catálogo con precios/cupones/envío, depósitos en citas, revendedores. En la app real: *Billing*,
*Transactions*, *Package List*, *Commerce* y los endpoints `catalog/*`.

Leyenda: ✅ hecho · ⚠️ parcial · ❌ pendiente · ⛔ excluido

## Menú real de ChatSyncs y equivalencia

| Sección de ChatSyncs | En la réplica |
|---|---|
| Dashboard (crecimiento 30 días, estado de la IA, accesos rápidos) | ✅ Panel |
| Shared Inbox (Mine/All/Important/Unread/Archived/Blocked/Resolved, Reply/Note, canned con `/`) | ✅ Bandeja |
| Connect Account (WhatsApp, Shopify, WooCommerce, Salla) | ⚠️ solo WhatsApp (ajustes + webhook); tiendas ⛔ |
| Chatbot Manager → Automation (Keyword Replies con carpetas, Follow-up Sequences) | ✅ Respuestas por palabra clave, Secuencias y flujos |
| Chatbot Manager → Data Collection | ✅ Formularios |
| Chatbot Manager → AI (Configuration, Agents) | ⚠️ un agente global (no varios) |
| Chatbot Manager → Quick Actions / Outbound Actions | ❌ |
| Subscriber Manager (filtros, listas, secuencias, import/export, bulk, perfil con pestañas) | ✅ Contactos |
| Broadcast Center (Broadcast/Sequence, WhatsApp/SMS, métricas 30 días) | ⚠️ sin SMS |
| Control Panel → Settings & Integration (Seguridad, API) | ✅ Ajustes, Webhooks y API |
| Control Panel → User Manager / User Permission | ✅ Equipo (roles admin/agente) |
| Developer (API v1, consola, uso) | ✅ `/api/v1` compatible + registro de uso |
| Learn / Documentation / Support Ticket / Chatty AI | ⛔ servicio de la empresa |

## Mensajería

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| Texto, plantilla, botones (con cabecera de texto o medio), listas, archivos | `/mcp`, consola API, changelog | ✅ | `src/whatsapp/rich.ts` |
| Regla de 24 h | blog, `/mcp` | ✅ | texto libre solo en ventana; plantillas siempre |
| Plantillas: crear, estado, sincronizar | changelog 7-oct, consola | ✅ | requiere credenciales de Meta |
| Variables `{{name}}`, `{{campo}}` | changelog 24-may | ✅ | |
| Subir medios y usar `media_id` | consola `upload/media` | ❌ | se envía por URL pública https |
| Audio con formato de nota de voz | changelog ene-2026 | ❌ | |
| Coexistencia con la app de WhatsApp Business | `/features/whatsapp-coexistence` | ⚠️ | alta en Meta, no código |

## Bandeja compartida

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| Pestañas Mías / Sin asignar / No leídas / Importantes / Seguimiento / Resueltas / Archivadas / Bloqueados | app: Shared Inbox | ✅ | |
| Responder / Nota interna, `/` para respuestas rápidas | app | ✅ | |
| Asignación manual y reparto equitativo | `/features/shared-inbox` | ✅ | |
| Sugerir respuesta, mejorar redacción, traducir, Subscriber IQ | `/features/ai-agent`, cuenta | ✅ | requiere `AI_API_KEY` |
| Firma del agente | app: Cuenta | ✅ | |
| Login por agente, mensajes firmados con su nombre | `/features/shared-inbox` | ✅ | roles admin/agente; sesiones de 12 h |
| Enmascarar teléfonos a los agentes | `/features/shared-inbox` | ✅ | en el servidor; el agente opera por id de contacto |
| Datos del cliente (país, zona horaria, idioma) | app: panel lateral | ❌ | WhatsApp no los envía; habría que inferirlos del prefijo |
| Tiempo real | changelog dic-2025 | ⚠️ | consulta cada 8-12 s (sin websockets en serverless) |

## Automatización

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| Flow builder: preguntas, botones, listas, ramas, condiciones múltiples, HTTP, esperas | `/features/whatsapp-chatbot`, changelog | ✅ | editor por pasos con destino por opción (no es canvas de arrastrar) |
| Respuestas por palabra clave (carpetas, coincidencia exacta/contiene/empieza) | app: Keyword Replies | ✅ | |
| Pedir un dato y guardarlo en un campo; validar número/email/teléfono/fecha | changelog 24-sep-2025 | ✅ | |
| Validación de imágenes con IA en «user input» | changelog 24-may-2026 | ❌ | |
| Secuencias drip, auto-stop al responder, inscripción por etiqueta | `/features/drip-campaigns` | ✅ | |
| Estadísticas por paso (aperturas/clics) | drip-campaigns | ⚠️ | inscritos activos/completados/detenidos |
| Horario comercial por día; el bot responde solo fuera de horario | changelog | ✅ | |
| Seguimientos inteligentes a clientes que no responden | `/features/ai-agent` | ✅ | requiere cron (ver README) |
| Webhook Workflow entrante | `/features/webhook-workflow` | ✅ | |
| Formularios dentro del chat con validación y exportación | `/features/whatsapp-forms` | ✅ | preguntas una a una; no son los *WhatsApp Flows* nativos de Meta |
| *WhatsApp Flows* nativos (multipantalla) | changelog may-2026 | ❌ | exigen cifrado de endpoint con Meta |
| Reserva de citas con huecos, sin dobles reservas, recordatorios | `/features/appointment-booking` | ✅ | recordatorios con plantilla fuera de 24 h |
| Sincronizar citas con un calendario externo | appointment-booking | ❌ | alternativa: workflow/HTTP a Cal.com |
| Click-to-WhatsApp: origen, informe de conversión por anuncio | `/features/click-to-whatsapp-ads` | ✅ | `ctwa:<id>`; sin costes por anuncio |
| Enviar datos de formularios a Google Sheets | changelog ene-2026 | ⚠️ | vía paso HTTP a un Apps Script |
| Plantillas de flujo / asistente IA para crear flujos | changelog 7-jul-2026 | ❌ | |

## Contactos

| Función | Evidencia | Estado |
|---|---|---|
| Listas de contactos (distintas de etiquetas), importar a una lista | app: Subscriber Manager, changelog 25-ago | ✅ |
| Filtros por etiqueta, lista, secuencia, estado y orden; estadísticas | app | ✅ |
| Acciones masivas (etiquetas, listas, secuencia, bloquear, baja, eliminar) | app: Bulk Actions | ✅ |
| Exportar CSV (con campos personalizados) | app: Export/Import | ✅ |
| Perfil: resumen, etiquetas, listas, secuencias, flujos de entrada, campos, notas | app: pestañas del perfil | ✅ |
| Informe descargable de campos personalizados | changelog 1-ene-2026 | ✅ (en la exportación) |
| Reasignar al terminar una secuencia | changelog 7-abr-2026 | ❌ |

## Broadcasts

| Función | Evidencia | Estado |
|---|---|---|
| Segmentar por etiquetas, exclusiones, listas y campos; vista previa de audiencia | `/features/whatsapp-broadcast` | ✅ |
| Imagen y botones; programar envío | idem | ✅ |
| Entrega y lectura por destinatario | idem | ✅ |
| **Clics en botones** | idem | ✅ |
| Métricas 30 días (campañas, completadas, tasa de lectura, enviados, fallidos) | app: Broadcast Center | ✅ |
| Canal SMS | app | ❌ |
| Mensajes de marketing (categoría Meta) | changelog 19-feb-2026 | ⚠️ la categoría se fija en la plantilla |

## Agente de IA

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| Base de conocimiento: texto, web, Google Sheet, **archivos PDF/TXT/MD/CSV/JSON/HTML** | `/features/ai-agent` | ✅ | |
| **Recuperación por relevancia** (solo los fragmentos útiles al prompt; menos tokens) | changelog 18-jul-2026 (vectorial) | ⚠️ | BM25 léxico con raíces en español, no embeddings |
| Acciones automáticas: etiquetas, campos, secuencias, flujos, traspaso, resolver, bloquear, no responder | idem | ✅ | solo sobre el contacto actual |
| Modo «todo» vs «solo si no hay flujo» | idem | ✅ | |
| Espera, temas restringidos, escalado por sentimiento | idem, changelog | ✅ | |
| Entiende imágenes y notas de voz | idem | ❌ | exige descargar medios de Meta y un modelo con visión/transcripción |
| Varios agentes con configuración propia | app: AI → Agents | ❌ | |

## API, webhooks y MCP

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| **API v1 compatible**: mismos endpoints y parámetros (`apiToken`, `phone_number_id`…), GET/POST, respuestas `status 1/0` | consola de desarrolladores | ✅ | 38 de 42; ver CHATSYNCS_API_V1.md |
| Varias claves con permisos, desactivar, borrar, registro de uso | changelog 11-oct, 18-ago | ✅ | |
| Webhooks salientes: entrante, saliente, estado (+ formulario y cita) | `/features/incoming-outgoing-webhooks` | ✅ | firmados con HMAC |
| Servidor MCP | `/mcp` | ✅ (41 tools) | reconstruido; el original eran stubs |
| MCP: órdenes y catálogo | `/mcp` | ⛔ | |

## Seguridad y cuenta

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| Acceso por IP (allowlist) con protección anti-bloqueo | changelog 20-abr-2026, app: IP Manager | ✅ | IPv4/IPv6 exactas y CIDR IPv4 |
| Registro de accesos (correctos y fallidos) y límite de intentos | app: Login Activity Logs | ✅ | 10 fallos / 15 min por IP |
| Sesiones activas y cierre remoto | app: Logged-in Devices | ❌ | |
| 2FA | changelog 14-abr-2026 | ❌ | |
| Alertas de acceso por Telegram | app: Login Alert Telegram | ❌ | |
| Registro de borrado de datos/medios | changelog 11-ago-2026 | ❌ | |
| Credenciales enmascaradas | changelog 17-feb-2026 | ✅ | |
| Contraseñas con scrypt, sesiones firmadas con HMAC | — | ✅ | |
| Cuotas de uso por plan (suscriptores/mensajes/tokens) | app: Dashboard | ⛔ | son límites de facturación |

## Fuera de alcance técnico (no se intenta)

Canales Instagram, Messenger, Telegram y WebChat; conexión de tiendas (Shopify/WooCommerce/Salla); módulo de revendedores;
reservas de soporte por Google Meet y *Chatty AI* (servicios de la empresa).

## Defectos de la versión anterior que este trabajo corrigió

- El «servidor MCP de 43 herramientas» **no hacía nada**: cada herramienta devolvía un eco. Reconstruido.
- Se exponían **todas las herramientas de administración al agente de IA de cara al cliente**. Ahora solo tiene acciones
  acotadas al contacto de la conversación.
- Webhook de Meta con formato incorrecto, sin guardar mensajes, sin validar firma y sin autenticación en toda la API.
- `PATCH /subscribers` borraba los campos personalizados; las esperas de días bloqueaban la función serverless.
- Una regla de IP como `1.2.3.4/` se leía como `/0` (todas las IPs); detectado por un test y corregido.

## Siguiente trabajo recomendado

1. **Conectar un número de WhatsApp de prueba**: nada de lo que depende de Meta se ha probado contra Meta real.
2. Entender imágenes y notas de voz (descarga de medios + modelo con visión/transcripción).
3. Embeddings para el conocimiento si la búsqueda léxica se queda corta.
4. 2FA, sesiones activas con cierre remoto, alertas de acceso.
5. Quick Actions / Outbound Actions y varios agentes de IA.
