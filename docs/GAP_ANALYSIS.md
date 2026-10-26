# Análisis de carencias: réplica vs. ChatSyncs

**Método.** Capturas con REA (`capture-browser-scenario`, Chromium headless) de 33 páginas públicas de chatsyncs.com:
home, pricing, mcp, changelog, services, compare, `/ai-agents/*`, `/features/*` (todas), industrias y blog.
El texto se extrajo del árbol de accesibilidad. El escenario reproducible está en `docs/rea-captures/public-scenario.json`;
las capturas en bruto no se versionan (pesan ~1,7 MB y son contenido de terceros).

**No cubierto:** la app con sesión (`platform.chatsyncs.com`). La ventana de login se abrió pero la sesión no llegó a
capturarse, así que **no hay evidencia de las pantallas internas** ni del contenido de la consola de desarrolladores.
Todo lo de la columna «Evidencia» sale de páginas públicas (marketing, changelog y documentación de producto).

**Fuera de alcance por decisión del usuario (uso privado, sin cobros):** WhatsApp Payments, Razorpay/Paytm, planes y
facturación, pedidos y catálogo con precios/cupones, depósitos en citas, revendedores.

Leyenda: ✅ hecho · ⚠️ parcial · ❌ pendiente · ⛔ excluido

## Mensajería

| Función | Evidencia (chatsyncs.com) | Estado | Notas |
|---|---|---|---|
| Texto, plantilla, botones, archivos | `/mcp` (send_*), `/features/whatsapp-broadcast`, changelog may-2026 | ✅ | `src/whatsapp/rich.ts`; listas además de botones |
| Regla de 24 h | blog `whatsapp-24-hour-rule`, `/mcp` | ✅ | texto libre solo dentro de la ventana; plantillas siempre |
| Plantillas: crear, estado, sincronizar | changelog 7-oct (API create/check template) | ✅ | requiere credenciales de Meta |
| Variables en mensajes (`{{name}}`, campos) | changelog 24-may («#» en campos), broadcast | ✅ | sintaxis `{{campo}}` |
| Mensaje de audio / voz con formato propio | changelog ene/abr-2026 | ❌ | solo envío de audio por URL |
| Coexistencia con la app de WhatsApp Business | `/features/whatsapp-coexistence` | ⚠️ | es un alta en Meta, no código; el webhook ya recibe los eventos |

## Bandeja compartida

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| Asignación manual y por reparto equitativo | `/features/shared-inbox` | ✅ | round-robin por menos chats abiertos |
| Notas internas, etiquetas, historial | idem | ✅ | |
| Estados resolver / archivar / bloquear | changelog 5-mar-2026 | ✅ | |
| Respuestas rápidas (canned) | changelog nov-2025 / abr-2026 | ✅ | `/atajo` en el composer |
| Seguimiento (follow-up) | changelog 16-ago-2026 | ✅ | recordatorio por conversación + pestaña «Seguimiento» |
| Botón «AI Reply» / reescribir | `/features/ai-agent`, changelog nov-2025 | ✅ | sugerir respuesta y mejorar redacción |
| Subscriber IQ (lead score, abandono, sentimiento) | `/features/ai-agent` | ✅ | bajo demanda, requiere `AI_API_KEY` |
| Enmascarar teléfonos a los agentes | `/features/shared-inbox` | ❌ | requiere login por agente |
| Login propio por agente | `/features/shared-inbox` | ❌ | hoy hay una sola clave de administrador |
| Tiempo real | changelog dic-2025 (eventos de lectura) | ⚠️ | polling cada 8-12 s (sin websockets en serverless) |

## Automatización

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| Flow builder: preguntas, botones, ramas, condiciones | `/features/whatsapp-chatbot`, changelog 24-may-2026 | ✅ | editor por pasos con destino por opción (no es canvas de arrastrar) |
| Pedir un dato y guardarlo en un campo («user input») | changelog 24-sep-2025 | ✅ | con validación número/email/teléfono |
| Condición con varias reglas (If/Else) | changelog 24-may-2026 | ✅ | todas / alguna |
| Llamada HTTP desde el flujo | chatbot, changelog 7-jul-2026 | ✅ | bloquea destinos internos |
| Retrasos | changelog nov-2025 (smart delay hasta 24 h) | ⚠️ | funciona; precisión = frecuencia del cron (5 min con GitHub Actions, diaria solo con Vercel) |
| Traspaso a humano con contexto | chatbot | ✅ | |
| Secuencias drip, auto-stop al responder | `/features/drip-campaigns` | ✅ | |
| Inscripción por etiqueta | drip-campaigns | ✅ | |
| Estadísticas por paso (abiertos/clics) | drip-campaigns | ⚠️ | solo inscritos activos/completados/detenidos |
| Horario comercial por día + respuesta fuera de horario | changelog 25-feb / 9-abr-2026 | ✅ | |
| Webhook Workflow entrante (URL, mapeo, condiciones, retraso, acciones) | `/features/webhook-workflow` | ✅ | |
| Plantillas de flujo reutilizables / asistente IA para armar flujos | changelog 7-jul-2026 | ❌ | |
| WhatsApp Forms / WhatsApp Flows (formularios nativos) | `/features/whatsapp-forms`, changelog may-2026 | ❌ | alternativa actual: preguntas en el flow builder |
| Reserva de citas con disponibilidad | `/features/appointment-booking` | ❌ | alternativa: flujo + HTTP a Cal.com/Calendly |
| Click-to-WhatsApp: origen del lead | `/features/click-to-whatsapp-ads` | ⚠️ | guarda `ctwa:<id>` como origen y lo muestra; sin informe de costes |
| Integración con Google Sheets (envío de datos) | changelog ene/sep-2026 | ❌ | solo lectura de hojas como conocimiento de la IA |

## Broadcasts

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| Segmentar por etiquetas, exclusiones y campos | `/features/whatsapp-broadcast` | ✅ | con vista previa de audiencia |
| Imagen y botones | idem | ✅ | |
| Entrega/lectura por destinatario | idem | ✅ | vía webhook de estados de Meta |
| Clics en botones | idem | ❌ | |
| Programar envío | changelog | ✅ | |
| Mensajes de marketing (categoría Meta) | changelog 19-feb-2026 | ⚠️ | la categoría se fija en la plantilla |

## Agente de IA

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| Base de conocimiento: texto, web, Google Sheet | `/features/ai-agent` | ✅ | PDF/archivos: ❌ |
| Acciones automáticas: etiquetas, campos, secuencias, flujos, traspaso | idem | ✅ | **solo sobre el contacto actual** (seguridad) |
| Modo «todo» vs «solo si no hay flujo» | idem | ✅ | |
| Espera antes de responder, temas restringidos | idem, changelog 19-feb | ✅ | |
| Escalar por sentimiento negativo | idem | ✅ | |
| Entiende imágenes y notas de voz | idem | ❌ | |
| Entrenamiento vectorial (RAG) | changelog 18-jul-2026 | ❌ | hoy se inyecta el texto en el prompt (límite ~24 000 caracteres) |

## API, webhooks y MCP

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| API REST con clave | `/features/rest-api` | ✅ | base `/api`, no `/api/v1` ni GET/POST indistinto |
| Varias claves con permisos, desactivar, borrar | changelog 11-oct-2026 | ✅ | permisos leer / escribir / enviar |
| Registro de uso de la API | changelog 18-ago-2026 | ✅ | |
| Webhooks salientes: entrante, saliente, estado | `/features/incoming-outgoing-webhooks` | ✅ | firmados con HMAC |
| Endpoints: notas, CRM overview, equipo, estado de conversación | changelog 16-ago / 7-oct | ✅ | |
| Servidor MCP (≈43 tools) | `/mcp` | ✅ (≈35) | reconstruido: el anterior eran stubs que no hacían nada |
| MCP: docs/guías, órdenes, catálogo | `/mcp` | ⛔ / ❌ | órdenes y catálogo excluidos |

## Seguridad y cuenta

| Función | Evidencia | Estado | Notas |
|---|---|---|---|
| 2FA, registro de accesos, «direct login» | changelog 14-abr-2026 | ❌ | un solo usuario |
| IP allowlist | changelog 20-abr-2026 | ❌ | |
| Credenciales enmascaradas | changelog 17-feb-2026 | ✅ | las variables sensibles no se leen |
| Importar contactos asignando lista | changelog 25-ago-2026 | ✅ | CSV con columna `labels` |
| Borrado de datos/medios con registro | changelog 11-ago-2026 | ⚠️ | se puede borrar; sin registro de auditoría |

## Fuera de alcance técnico (no se intenta)

Canales Instagram, Messenger, Telegram y WebChat; módulo de revendedores; reservas de soporte por Google Meet (servicio humano
de la empresa); Subscriber IQ continuo en segundo plano.

## Defectos de la versión anterior que este trabajo corrigió

- El «servidor MCP de 43 herramientas» **no hacía nada**: cada herramienta devolvía un eco. Reconstruido en `src/mcp/server.ts`.
- Se exponían **todas las herramientas de administración al agente de IA de cara al cliente** (enviar a cualquier número, leer
  contactos). Ahora solo tiene acciones acotadas al contacto de la conversación.
- Webhook de Meta con formato incorrecto, sin guardar mensajes, sin validar firma y sin autenticación en toda la API.
- `PATCH /subscribers` borraba los campos personalizados; las esperas de días bloqueaban la función serverless.

## Siguiente trabajo recomendado

1. Conectar un número de WhatsApp de prueba (lo más importante: nada de Meta se ha probado de verdad).
2. Login por agente y enmascarado de teléfonos.
3. Entrenamiento por archivos (PDF) y RAG con embeddings.
4. Formularios/WhatsApp Flows y reserva de citas.
5. Informe de clics y de costes por anuncio.
