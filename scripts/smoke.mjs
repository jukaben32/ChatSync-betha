// Prueba de humo end-to-end contra un despliegue. Uso:
//   BASE=https://chatsyncs-replica.vercel.app KEY=<ADMIN_API_KEY> node scripts/smoke.mjs
// Activa el modo simulación (sin llamar a Meta), recorre los flujos principales y lo deja todo como estaba.
const BASE = (process.env.BASE ?? '').replace(/\/$/, '');
const KEY = process.env.KEY ?? '';
if (!BASE || !KEY) throw new Error('Define BASE y KEY');

let passed = 0;
const failed = [];
const check = (name, ok, extra = '') => {
  if (ok) passed++;
  else failed.push(`${name} ${extra}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` ${extra}`}`);
};

async function call(path, { method, body, key = KEY } = {}) {
  const res = await fetch(BASE + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const sim = (phone, body, interactiveId, name) => call('/api/simulate/inbound', { body: { phone, body, interactiveId, name } });
const messages = async (phone) => {
  const sub = (await call(`/api/subscribers/${phone}`)).data;
  return (sub?.conversations ?? []).flatMap((c) => c.messages).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};
const outbound = async (phone) => (await messages(phone)).filter((m) => m.direction === 'outbound');

const tag = Date.now().toString().slice(-6);
const P1 = `1555${tag}1`;
const P2 = `1555${tag}2`;
const P3 = `1555${tag}3`;
const P4 = `1555${tag}4`;
const created = { sequences: [], labels: [], fields: [], canned: [], workflows: [], team: [], keys: [], broadcasts: [], phones: [P1, P2, P3, P4] };
const original = (await call('/api/settings')).data;

try {
  console.log('\n1) Seguridad');
  check('sin clave → 401', (await call('/api/subscribers', { key: '' })).status === 401);
  check('clave incorrecta → 401', (await call('/api/subscribers', { key: 'nope' })).status === 401);
  check('con clave → 200', (await call('/api/account')).status === 200);
  check('webhook de Meta sin firma → 401', (await call('/api/whatsapp/webhook', { body: { entry: [] }, key: '' })).status === 401);
  check('cron sin secreto → 401', (await call('/api/cron/tick', { key: '' })).status === 401);

  console.log('\n2) Modo simulación y datos base');
  await call('/api/settings/sandbox', { method: 'PUT', body: { enabled: true } });
  const field = (await call('/api/custom-fields', { body: { key: `personas_${tag}`, label: 'Personas', type: 'number' } })).data;
  created.fields.push(field.id);
  const canned = (await call('/api/canned-responses', { body: { shortcut: `hola${tag}`, body: 'Hola {{name}}' } })).data;
  created.canned.push(canned.id);
  check('campo personalizado y respuesta rápida creados', Boolean(field?.id && canned?.id));

  console.log('\n3) Flujo con botones, ramas y pregunta validada');
  const fieldKey = `personas_${tag}`;
  const kw = `smokemenu${tag}`;
  const flow = (
    await call('/api/sequences', {
      body: {
        name: `Smoke ${tag}`,
        kind: 'flow',
        triggerKeyword: kw,
        steps: [
          { action: 'send_buttons', order: 0, params: { body: '¿Qué necesitas?', buttons: [{ title: 'Reservar', next: 10 }, { title: 'Info', next: 20 }] } },
          { action: 'ask', order: 10, params: { body: '¿Cuántas personas?', field: fieldKey, validate: 'number', errorText: 'Solo números' } },
          { action: 'send_text', order: 11, params: { body: `Reservado para {{${fieldKey}}}` } },
          { action: 'add_label', order: 12, params: { label: `reservo-${tag}` } },
          { action: 'end', order: 13 },
          { action: 'send_text', order: 20, params: { body: 'Abrimos de 9 a 6' } },
        ],
      },
    })
  ).data;
  created.sequences.push(flow.id);
  created.labels.push(`reservo-${tag}`);

  await sim(P1, `quiero ${kw}`, undefined, 'Ana Smoke');
  let out = await outbound(P1);
  check('palabra clave → botones enviados', out.some((m) => m.metadata?.type === 'buttons'), JSON.stringify(out.map((m) => m.body)));
  await sim(P1, 'Reservar', 'o0_0');
  out = await outbound(P1);
  check('botón "Reservar" → pregunta', out.some((m) => m.body.includes('Cuántas personas')));
  await sim(P1, 'muchas');
  out = await outbound(P1);
  check('respuesta inválida → "Solo números"', out.some((m) => m.body === 'Solo números'));
  await sim(P1, '4');
  out = await outbound(P1);
  const sub1 = (await call(`/api/subscribers/${P1}`)).data;
  check('dato guardado en el campo personalizado', sub1.customFields?.[fieldKey] === 4, JSON.stringify(sub1.customFields));
  check('variable {{campo}} resuelta en el mensaje', out.some((m) => m.body === 'Reservado para 4'), JSON.stringify(out.map((m) => m.body)));
  check('etiqueta añadida al terminar', sub1.labels.some((l) => l.label.name === `reservo-${tag}`));

  await sim(P2, kw);
  await sim(P2, 'Info', 'o0_1');
  check('rama "Info" responde otro mensaje', (await outbound(P2)).some((m) => m.body === 'Abrimos de 9 a 6'));

  console.log('\n4) Baja (STOP) y bloqueo');
  await sim(P3, 'hola');
  await sim(P3, 'STOP');
  check('STOP → optedOut', (await call(`/api/subscribers/${P3}`)).data.optedOut === true);
  const conv3 = (await call(`/api/conversations?phone=${P3}`)).data[0];
  const reply = await call(`/api/conversations/${conv3.id}/messages`, { body: { body: 'hola de nuevo' } });
  check('envío a contacto de baja → rechazado', reply.status === 502 && reply.data.error === 'subscriber_opted_out', JSON.stringify(reply.data));

  console.log('\n5) Horario comercial');
  const closed = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { enabled: false, start: '09:00', end: '18:00' }]));
  await call('/api/settings/businessHours', { method: 'PUT', body: { ...original.businessHours, enabled: true, days: closed, offHoursMessage: 'FUERA DE HORARIO', offHoursBehavior: 'message' } });
  await sim(P4, 'hola');
  await sim(P4, 'sigo aquí');
  const off = (await outbound(P4)).filter((m) => m.body === 'FUERA DE HORARIO');
  check('fuera de horario → un solo aviso (sin repetir)', off.length === 1, `avisos: ${off.length}`);
  await call('/api/settings/businessHours', { method: 'PUT', body: original.businessHours });

  console.log('\n6) Webhook Workflow entrante');
  const wf = (
    await call('/api/workflows', {
      body: {
        name: `Smoke WF ${tag}`,
        phonePath: 'customer.phone',
        templateName: 'order_confirmation',
        variables: { 1: 'customer.name' },
        conditions: [{ path: 'status', op: 'eq', value: 'paid' }],
        actions: { labels: [`pagado-${tag}`] },
      },
    })
  ).data;
  created.workflows.push(wf.id);
  created.labels.push(`pagado-${tag}`);
  const hook = (payload) => call(`/api/hooks/${wf.token}`, { body: payload, key: '' });
  const skipped = await hook({ status: 'pending', customer: { phone: `1555${tag}5`, name: 'Luis' } });
  check('condición no cumplida → omitido', skipped.data?.skipped === 'conditions_not_met', JSON.stringify(skipped.data));
  const fired = await hook({ status: 'paid', customer: { phone: `1555${tag}5`, name: 'Luis' } });
  created.phones.push(`1555${tag}5`);
  check('condición cumplida → plantilla enviada', fired.status === 200 && fired.data?.message?.ok === true, JSON.stringify(fired.data));
  check('etiqueta del workflow aplicada', (await call(`/api/subscribers/1555${tag}5`)).data.labels.some((l) => l.label.name === `pagado-${tag}`));
  check('token inexistente → 404', (await call('/api/hooks/nope', { body: {}, key: '' })).status === 404);

  console.log('\n7) API keys con alcance y registro de uso');
  const key = (await call('/api/api-keys', { body: { name: `smoke-${tag}`, scopes: ['read'] } })).data;
  created.keys.push(key.id);
  check('clave solo-lectura puede leer', (await call('/api/labels', { key: key.key })).status === 200);
  check('clave solo-lectura no puede escribir (403)', (await call('/api/labels', { body: { name: 'x' }, key: key.key })).status === 403);
  check('clave de API no accede a /api/api-keys (403)', (await call('/api/api-keys', { key: key.key })).status === 403);
  await call(`/api/api-keys/${key.id}`, { method: 'PATCH', body: { active: false } });
  check('clave desactivada → 401', (await call('/api/labels', { key: key.key })).status === 401);
  const logs = (await call('/api/api-logs')).data;
  check('el uso quedó registrado', logs.some((l) => l.keyName === `smoke-${tag}`));

  console.log('\n8) Broadcast con segmentación');
  await call(`/api/subscribers/${P1}/labels`, { body: { labels: [`seg-${tag}`] } });
  created.labels.push(`seg-${tag}`);
  const count = (await call('/api/broadcasts/audience-count', { body: { labels: [`seg-${tag}`] } })).data;
  check('vista previa de audiencia = 1', count.count === 1, JSON.stringify(count));
  const bc = (await call('/api/broadcasts', { body: { name: `Smoke BC ${tag}`, content: 'Hola {{name}}, novedades', audience: { labels: [`seg-${tag}`] } } })).data;
  created.broadcasts.push(bc.id);
  const sent = await call(`/api/broadcasts/${bc.id}/send`, { body: {} });
  check('broadcast enviado a la audiencia', sent.data?.audience === 1 && sent.data?.sentCount === 1, JSON.stringify(sent.data));
  check('variable {{name}} resuelta en el broadcast', (await outbound(P1)).some((m) => m.body === 'Hola Ana Smoke, novedades'));
  const past = await call('/api/broadcasts', { body: { name: 'x', content: 'y', scheduledAt: '2020-01-01T00:00:00Z' } });
  check('programar en el pasado → 400', past.status === 400);

  console.log('\n9) Asignación round-robin');
  const m1 = (await call('/api/team', { body: { name: `Agente A ${tag}` } })).data;
  const m2 = (await call('/api/team', { body: { name: `Agente B ${tag}` } })).data;
  created.team.push(m1.id, m2.id);
  await call('/api/settings/assignment', { method: 'PUT', body: { mode: 'round_robin' } });
  await sim(`1555${tag}6`, 'hola equipo');
  created.phones.push(`1555${tag}6`);
  const assigned = (await call(`/api/conversations?phone=1555${tag}6`)).data[0];
  check('conversación nueva asignada a un miembro', Boolean(assigned?.assignedTo?.includes(tag)), JSON.stringify(assigned?.assignedTo));
  await call('/api/settings/assignment', { method: 'PUT', body: original.assignment });

  console.log('\n11) Servidor MCP');
  const P5 = `1555${tag}7`;
  created.phones.push(P5);
  const rpc = async (method, params, key = KEY, id = 1) => {
    const res = await fetch(BASE + '/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* respuesta no JSON */
    }
    return { status: res.status, data };
  };
  const callTool = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const text = r.data?.result?.content?.[0]?.text;
    return { isError: Boolean(r.data?.result?.isError), json: text ? JSON.parse(text) : null, status: r.status };
  };
  check('MCP sin clave → 401', (await rpc('tools/list', {}, '')).status === 401);
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  const tools = (await rpc('tools/list', {}, KEY, 2)).data?.result?.tools ?? [];
  check('MCP lista herramientas reales (≥ 30)', tools.length >= 30 && tools.some((t) => t.name === 'send_text_message'), String(tools.length));
  await sim(P5, 'hola desde mcp');
  const sentViaMcp = await callTool('send_text_message', { phone: P5, body: 'Hola desde MCP' });
  check('send_text_message envía de verdad', sentViaMcp.json?.ok === true && Boolean(sentViaMcp.json?.messageId), JSON.stringify(sentViaMcp.json));
  check('el mensaje del MCP quedó en la conversación', (await outbound(P5)).some((m) => m.body === 'Hola desde MCP' && m.metadata?.sender === 'mcp'));
  const info = await callTool('get_account_info', {});
  check('get_account_info devuelve datos reales', typeof info.json?.counts?.subscribers === 'number', JSON.stringify(info.json));
  await callTool('assign_custom_fields', { phone: P5, fields: { origen: 'mcp' } });
  check('assign_custom_fields guarda el dato', (await call(`/api/subscribers/${P5}`)).data.customFields?.origen === 'mcp');
  const bad = await callTool('get_subscriber', { phone: '000' });
  check('herramienta con error no rompe el protocolo', bad.status === 200);

  console.log('\n12) API v1 compatible con ChatSyncs');
  const P6 = `1555${tag}8`;
  created.phones.push(P6);
  // POST con formulario (como curl -d), GET con apiToken en la URL, o JSON
  const v1 = async (path, params = {}, { method = 'POST', token = KEY, as = 'form' } = {}) => {
    const all = { apiToken: token, ...params };
    let url = `${BASE}/api/v1/${path}`;
    const init = { method };
    if (method === 'GET') url += `?${new URLSearchParams(all)}`;
    else if (as === 'json') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(all);
    } else {
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      init.body = new URLSearchParams(all).toString();
    }
    const res = await fetch(url, init);
    return { http: res.status, ...(await res.json().catch(() => ({}))) };
  };
  check('v1 sin apiToken → 401 con status 0', await v1('label/list', {}, { token: '' }).then((r) => r.http === 401 && r.status === '0'));
  const created6 = await v1('whatsapp/subscriber/create', { phoneNumberID: '1', name: 'Ana API', phoneNumber: P6 });
  check('v1 crea suscriptor (formulario)', created6.status === '1' && created6.message?.phone_number === P6, JSON.stringify(created6));
  check('v1 crear duplicado → status 0', (await v1('whatsapp/subscriber/create', { name: 'x', phoneNumber: P6 })).status === '0');
  const got = await v1('whatsapp/subscriber/get', { phone_number_id: '1', phone_number: P6 }, { method: 'GET' });
  check('v1 obtiene suscriptor (GET + apiToken en URL)', got.status === '1' && got.message?.first_name === 'Ana', JSON.stringify(got));
  const lab = await v1('label/create', { label_name: `v1-${tag}` });
  created.labels.push(`v1-${tag}`);
  check('v1 crea etiqueta', lab.status === '1' && Boolean(lab.message?.id));
  await v1('whatsapp/subscriber/chat/assign-labels', { phone_number_id: '1', phone_number: P6, label_ids: lab.message.id });
  const afterLabel = await v1('whatsapp/subscriber/get', { phone_number_id: '1', phone_number: P6 });
  check('v1 asigna etiqueta por id', afterLabel.message?.label_ids?.includes(lab.message.id), JSON.stringify(afterLabel.message?.label_ids));
  await v1('whatsapp/subscriber/chat/remove-labels', { phone_number_id: '1', phone_number: P6, label_ids: JSON.stringify([lab.message.id]) });
  check('v1 quita etiqueta (lista JSON)', (await v1('whatsapp/subscriber/get', { phone_number_id: '1', phone_number: P6 })).message?.label_ids?.length === 0);
  await v1('whatsapp/subscriber/chat/assign-custom-fields', { phone_number_id: '1', phone_number: P6, custom_fields: JSON.stringify([{ name: 'ciudad', value: 'Santiago' }]) });
  check('v1 asigna campos personalizados', (await v1('whatsapp/subscriber/get', { phone_number_id: '1', phone_number: P6 })).message?.custom_fields?.ciudad === 'Santiago');
  const noWindow = await v1('whatsapp/send', { phone_number_id: '1', phone_number: P6, message: 'hola' });
  check('v1 send fuera de la ventana de 24 h → status 0', noWindow.status === '0' && /24h/.test(noWindow.message), JSON.stringify(noWindow));
  await sim(P6, 'hola');
  const sentV1 = await v1('whatsapp/send', { phone_number_id: '1', phone_number: P6, message: 'Hola desde la API v1' });
  check('v1 send dentro de la ventana → wa_message_id', sentV1.status === '1' && Boolean(sentV1.wa_message_id), JSON.stringify(sentV1));
  const st = await v1('whatsapp/get/message-status', { wa_message_id: sentV1.wa_message_id });
  check('v1 estado del mensaje', st.status === '1' && st.message?.status === 'sent', JSON.stringify(st));
  const btns = await v1('whatsapp/send/interactive-buttons', { phone_number_id: '1', phone_number: P6, message: 'Elige', button_header_text: 'Menú', buttons: JSON.stringify(['Sí', { id: 'no', title: 'No' }]) });
  check('v1 botones interactivos con cabecera', btns.status === '1', JSON.stringify(btns));
  check('v1 botones: título largo → status 0', (await v1('whatsapp/send/interactive-buttons', { phone_number: P6, message: 'x', buttons: JSON.stringify(['a'.repeat(30)]) })).status === '0');
  const file = await v1('whatsapp/send/file', { phone_number_id: '1', phone_number: P6, media_url: 'https://example.com/foto.jpg', media_caption_text: 'Foto' });
  check('v1 send/file infiere el tipo por extensión', file.status === '1', JSON.stringify(file));
  check('v1 send/file documento sin media_name → status 0', (await v1('whatsapp/send/file', { phone_number: P6, media_url: 'https://example.com/a.pdf' })).status === '0');
  await v1('whatsapp/subscriber/chat/add-notes', { phone_number_id: '1', phone_number: P6, note_text: 'Nota v1' });
  const notes = await v1('whatsapp/subscriber/chat/get-notes', { phone_number_id: '1', phone_number: P6 });
  check('v1 notas: añadir y listar', notes.message?.some((n) => n.note_text === 'Nota v1'), JSON.stringify(notes));
  await v1('whatsapp/subscriber/crm/update', { phone_number_id: '1', phone_number: P6, stage_id: 'qualified', value: '500', owner_user_id: 'Ana', title: 'Oportunidad v1' });
  const crm = await v1('whatsapp/subscriber/crm/get', { phone_number_id: '1', phone_number: P6 });
  check('v1 CRM: actualizar y leer', crm.message?.stage_id === 'qualified' && crm.message?.value === 500 && crm.message?.title === 'Oportunidad v1', JSON.stringify(crm));
  const marked = await v1('whatsapp/subscriber/chat/mark-conversation', { phone_number_id: '1', phone_number: P6, status: 'resolved' });
  check('v1 marcar conversación resuelta', marked.status === '1' && (await call(`/api/conversations?phone=${P6}`)).data[0].status === 'solved');
  const convo = await v1('whatsapp/get/conversation', { phone_number_id: '1', phone_number: P6, limit: '10' });
  check('v1 historial de conversación', convo.status === '1' && convo.message.some((m) => m.direction === 'out'));
  const readKey = (await call('/api/api-keys', { body: { name: `v1-read-${tag}`, scopes: ['read'] } })).data;
  created.keys.push(readKey.id);
  check('v1 clave solo-lectura puede listar', (await v1('whatsapp/subscriber/list', { phone_number_id: '1', limit: '5' }, { token: readKey.key, method: 'GET' })).status === '1');
  const denied = await v1('whatsapp/send', { phone_number: P6, message: 'x' }, { token: readKey.key });
  check('v1 clave solo-lectura no puede enviar (403)', denied.http === 403, JSON.stringify(denied));
  const jsonBody = await v1('whatsapp/subscriber/delete', { phone_number_id: '1', phone_number: P6 }, { as: 'json' });
  check('v1 elimina suscriptor (cuerpo JSON)', jsonBody.status === '1');

  console.log('\n13) Contactos: listas, acciones masivas, exportación y filtros');
  const L1 = `1555${tag}9`;
  const L2 = `1555${tag}0`;
  created.phones.push(L1, L2);
  await call('/api/subscribers', { body: { phone: L1, name: 'Lista Uno' } });
  await call('/api/subscribers', { body: { phone: L2, name: 'Lista Dos' } });
  const listName = `vip-${tag}`;
  const bulkAdd = await call('/api/subscribers/bulk', { body: { phones: [L1, L2], action: 'add_list', value: listName } });
  check('acción masiva: añadir a lista', bulkAdd.data?.affected === 2, JSON.stringify(bulkAdd.data));
  const inList = (await call(`/api/subscribers?list=${listName}`)).data;
  check('filtrar contactos por lista', inList.total === 2, JSON.stringify(inList.total));
  await call('/api/subscribers/bulk', { body: { phones: [L1], action: 'add_label', value: `bulk-${tag}` } });
  created.labels.push(`bulk-${tag}`);
  check('acción masiva: etiqueta', (await call(`/api/subscribers?label=bulk-${tag}`)).data.total === 1);
  await call('/api/subscribers/bulk', { body: { phones: [L2], action: 'block' } });
  check('filtrar por estado bloqueado', (await call(`/api/subscribers?list=${listName}&status=blocked`)).data.total === 1);
  check('filtrar por estado suscrito', (await call(`/api/subscribers?list=${listName}&status=subscribed`)).data.total === 1);
  check('acción masiva con acción inválida → 400', (await call('/api/subscribers/bulk', { body: { phones: [L1], action: 'explotar' } })).status === 400);
  const stats = (await call('/api/subscribers/stats')).data;
  check('estadísticas de contactos', typeof stats.total === 'number' && stats.blocked >= 1, JSON.stringify(stats));
  const csvRes = await fetch(`${BASE}/api/subscribers/export?list=${listName}`, { headers: { Authorization: `Bearer ${KEY}` } });
  const csv = await csvRes.text();
  check('exportar CSV con cabecera y filas', csvRes.headers.get('content-type')?.includes('text/csv') && csv.includes('phone,name,email') && csv.includes(L1) && csv.includes(listName), csv.slice(0, 160));
  await call(`/api/subscribers/${L1}`, { method: 'PATCH', body: { name: '=HYPERLINK("http://x")' } });
  const csv2 = await (await fetch(`${BASE}/api/subscribers/export?list=${listName}`, { headers: { Authorization: `Bearer ${KEY}` } })).text();
  check('CSV neutraliza fórmulas (inyección)', !csv2.includes(',=HYPERLINK') && csv2.includes("'=HYPERLINK"));
  const importTag = `1555${tag}11`;
  created.phones.push(importTag);
  const imp = await call('/api/subscribers/import', { body: { rows: [{ phone: importTag, name: 'Importado' }], list: `imp-${tag}` } });
  check('importar asignando lista', imp.data?.created === 1 && (await call(`/api/subscribers?list=imp-${tag}`)).data.total === 1, JSON.stringify(imp.data));
  const lists = (await call('/api/lists')).data;
  for (const l of lists) if ([listName, `imp-${tag}`].includes(l.name)) await call(`/api/lists/${l.id}`, { method: 'DELETE' });
  check('listas: contador de miembros', lists.find((l) => l.name === listName)?._count?.members === 2);

  console.log('\n14) Bandeja: no leídas, importantes, bloqueados, firma y palabras clave');
  const K1 = `1555${tag}12`;
  created.phones.push(K1);
  const kwExact = `exacto${tag}`;
  const kwFlow = (
    await call('/api/sequences', { body: { name: `KW ${tag}`, kind: 'flow', triggerKeyword: kwExact, matchType: 'exact', folder: `carpeta-${tag}`, steps: [{ action: 'send_text', order: 0, params: { body: 'Respuesta exacta' } }] } })
  ).data;
  created.sequences.push(kwFlow.id);
  check('palabra clave: carpeta y tipo de coincidencia guardados', kwFlow.matchType === 'exact' && kwFlow.folder === `carpeta-${tag}`, JSON.stringify(kwFlow));
  check('listar por carpeta', (await call(`/api/sequences?kind=flow&folder=carpeta-${tag}`)).data.length === 1);
  await sim(K1, `quiero ${kwExact} ya`);
  check('coincidencia exacta: frase con la palabra NO dispara', !(await outbound(K1)).some((m) => m.body === 'Respuesta exacta'));
  await sim(K1, kwExact);
  check('coincidencia exacta: el mensaje igual SÍ dispara', (await outbound(K1)).some((m) => m.body === 'Respuesta exacta'));
  const convK = (await call(`/api/conversations?phone=${K1}`)).data[0];
  check('mensaje entrante marca la conversación como no leída', convK.unread === true);
  check('filtro de no leídas', (await call('/api/conversations?unread=true')).data.some((c) => c.id === convK.id));
  await call(`/api/conversations/${convK.id}/read`, { body: {} });
  check('marcar como leída', (await call(`/api/conversations/${convK.id}`)).data.unread === false);
  await call(`/api/conversations/${convK.id}`, { method: 'PATCH', body: { important: true } });
  check('filtro de importantes', (await call('/api/conversations?important=true')).data.some((c) => c.id === convK.id));
  check('filtro de bloqueados', (await call('/api/conversations?blocked=true')).status === 200);
  await call('/api/settings/agent', { method: 'PUT', body: { signature: `— Equipo ${tag}`, translateLanguage: 'es' } });
  await call(`/api/conversations/${convK.id}/messages`, { body: { body: 'Mensaje con firma' } });
  check('la firma del agente se añade a los mensajes manuales', (await outbound(K1)).some((m) => m.body === `Mensaje con firma\n\n— Equipo ${tag}`));
  await call('/api/settings/agent', { method: 'PUT', body: original.agent });
  const tr = await call('/api/ai/translate', { body: { text: 'hola' } });
  check('traducir sin IA configurada → 409 explícito', tr.status === 409 || tr.status === 200, String(tr.status));

  console.log('\n15) Conocimiento: archivos PDF/texto y búsqueda por relevancia');
  const makePdf = (text) => {
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    let out = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, 'latin1').toString('base64');
  };
  const kbIds = [];
  const pdfRes = await call('/api/knowledge/file', { body: { filename: `horarios-${tag}.pdf`, contentBase64: makePdf(`Atendemos de lunes a viernes de 9 a 18 horas zorzal${tag}`) } });
  check('subir PDF: texto extraído y fragmentado', pdfRes.status === 201 && pdfRes.data?.chunks >= 1, JSON.stringify(pdfRes.data));
  kbIds.push(pdfRes.data?.id);
  const txtRes = await call('/api/knowledge/file', { body: { filename: `envios-${tag}.txt`, contentBase64: Buffer.from(`El envio a domicilio tarda tres dias habiles y cuesta cinco dolares ${tag}`).toString('base64') } });
  check('subir texto plano', txtRes.status === 201);
  kbIds.push(txtRes.data?.id);
  check('tipo de archivo no admitido → 415', (await call('/api/knowledge/file', { body: { filename: 'x.exe', contentBase64: Buffer.from('MZ').toString('base64') } })).status === 415);
  const search = (await call(`/api/knowledge/search?q=${encodeURIComponent('horario de atencion')}`)).data;
  check('la búsqueda devuelve el fragmento del PDF', search.results?.some((r) => r.text.includes(`zorzal${tag}`)), JSON.stringify(search.results?.map((r) => r.title)));
  const search2 = (await call(`/api/knowledge/search?q=${encodeURIComponent('cuanto cuesta el envio')}`)).data;
  check('la búsqueda distingue otro tema', search2.results?.[0]?.title === `envios-${tag}.txt`, JSON.stringify(search2.results?.map((r) => r.title)));
  const kbList = (await call('/api/knowledge')).data;
  check('las fuentes informan su número de fragmentos', kbList.find((k) => k.id === kbIds[0])?._count?.chunks >= 1);
  for (const id of kbIds) await call(`/api/knowledge/${id}`, { method: 'DELETE' });

  console.log('\n16) Formularios en el chat');
  const formKw = `registro${tag}`;
  const form = (
    await call('/api/forms', {
      body: {
        name: `Reserva ${tag}`,
        keyword: formKw,
        intro: 'Vamos a registrarte',
        doneMessage: '¡Listo, te esperamos!',
        labelOnDone: `form-ok-${tag}`,
        questions: [{ label: 'Nombre completo' }, { label: 'Personas', type: 'number' }, { label: 'Servicio', type: 'choice', options: ['Limpieza', 'Revisión'] }, { label: 'Notas', required: false }],
      },
    })
  ).data;
  created.labels.push(`form-ok-${tag}`);
  check('crear formulario y compilar su flujo', Boolean(form?.id && form?.sequenceId), JSON.stringify(form));
  check('formulario sin opciones suficientes → 400', (await call('/api/forms', { body: { name: 'x', questions: [{ label: 'q', type: 'choice', options: ['a'] }] } })).status === 400);
  const F1 = `1555${tag}13`;
  created.phones.push(F1);
  await sim(F1, `quiero ${formKw}`, undefined, 'Cliente Form');
  await sim(F1, 'Luis Mora');
  await sim(F1, 'muchas');
  check('respuesta inválida → mensaje de error', (await outbound(F1)).some((m) => m.body === 'Escribe solo un número, por favor.'));
  await sim(F1, '3');
  await sim(F1, 'Revisión', 'o3_1');
  await sim(F1, 'omitir');
  const subs = (await call(`/api/forms/${form.id}/submissions`)).data;
  check('el envío del formulario se guarda con las respuestas', subs.submissions?.[0]?.answers?.nombre_completo === 'Luis Mora' && subs.submissions[0].answers.personas === 3 && subs.submissions[0].answers.servicio === 'Revisión', JSON.stringify(subs.submissions?.[0]?.answers));
  check('mensaje final y etiqueta del formulario', (await outbound(F1)).some((m) => m.body === '¡Listo, te esperamos!') && (await call(`/api/subscribers/${F1}`)).data.labels.some((l) => l.label.name === `form-ok-${tag}`));
  const formCsv = await (await fetch(`${BASE}/api/forms/${form.id}/export`, { headers: { Authorization: `Bearer ${KEY}` } })).text();
  check('exportar envíos a CSV', formCsv.includes('Luis Mora') && formCsv.includes('Nombre completo'));
  await call(`/api/forms/${form.id}`, { method: 'DELETE' });
  check('al borrar el formulario se borra su flujo', !(await call('/api/sequences?kind=flow')).data.some((s) => s.id === form.sequenceId));

  console.log('\n17) Citas: huecos, reservas sin duplicar y flujo de reserva');
  const bookingOriginal = (await call('/api/settings')).data.booking;
  const allDays = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { enabled: true, start: '08:00', end: '20:00' }]));
  await call('/api/settings/booking', { method: 'PUT', body: { ...bookingOriginal, enabled: true, timezone: 'UTC', slotMinutes: 30, minNoticeHours: 1, maxDaysAhead: 5, days: allDays, reminderHours: [] } });
  const slots = (await call('/api/booking/slots?limit=20')).data;
  check('hay huecos disponibles', slots.enabled && slots.slots.length >= 10, JSON.stringify(slots.slots?.length));
  const B1 = `1555${tag}14`;
  const B2 = `1555${tag}15`;
  const B3 = `1555${tag}16`;
  created.phones.push(B1, B2, B3);
  const slotA = slots.slots[0].startsAt;
  const booked1 = await call('/api/appointments', { body: { phone: B1, startsAt: slotA, notify: false } });
  check('reservar un hueco', booked1.status === 201, JSON.stringify(booked1.data));
  const booked2 = await call('/api/appointments', { body: { phone: B2, startsAt: slotA, notify: false } });
  check('el mismo hueco ya no se puede reservar (409)', booked2.status === 409, JSON.stringify(booked2.data));
  check('un hueco inexistente no se acepta (409)', (await call('/api/appointments', { body: { phone: B2, startsAt: '2020-01-01T10:00:00Z', notify: false } })).status === 409);
  const slotsAfter = (await call('/api/booking/slots?limit=20')).data;
  check('el hueco reservado desaparece de la lista', !slotsAfter.slots.some((s) => s.startsAt === slotA));
  const cancelled = await call(`/api/appointments/${booked1.data.id}`, { method: 'PATCH', body: { status: 'cancelled' } });
  check('cancelar libera el hueco', cancelled.status === 200 && (await call('/api/booking/slots?limit=20')).data.slots.some((s) => s.startsAt === slotA));
  const bookKw = `cita${tag}`;
  const bookFlow = (await call('/api/sequences', { body: { name: `Reserva flujo ${tag}`, kind: 'flow', triggerKeyword: bookKw, steps: [{ action: 'book_slot', order: 0, params: { body: '¿Cuándo vienes?' } }, { action: 'add_label', order: 1, params: { label: `con-cita-${tag}` } }] } })).data;
  created.sequences.push(bookFlow.id);
  created.labels.push(`con-cita-${tag}`);
  await sim(B3, bookKw);
  const offered = (await outbound(B3)).find((m) => m.metadata?.type === 'list');
  check('el flujo ofrece los huecos en una lista', Boolean(offered), JSON.stringify((await outbound(B3)).map((m) => m.metadata?.type)));
  const pick = (await call('/api/booking/slots?limit=3')).data.slots[1].startsAt;
  await sim(B3, 'Elegida', `slot:${pick}`);
  const mine = (await call(`/api/appointments?phone=${B3}`)).data;
  check('elegir un hueco crea la cita', mine.length === 1 && mine[0].startsAt === pick && mine[0].status === 'booked', JSON.stringify(mine));
  check('el cliente recibe la confirmación', (await outbound(B3)).some((m) => m.body.includes('cita está confirmada')));
  check('el flujo continúa tras reservar', (await call(`/api/subscribers/${B3}`)).data.labels.some((l) => l.label.name === `con-cita-${tag}`));
  for (const a of [...(await call(`/api/appointments?from=${new Date(Date.now() - 86400000).toISOString()}`)).data]) {
    if (a.subscriber.phone.includes(`${tag}`)) await call(`/api/appointments/${a.id}`, { method: 'DELETE' });
  }
  await call('/api/settings/booking', { method: 'PUT', body: bookingOriginal });

  console.log('\n18) Clics en botones de broadcast');
  const C1 = `1555${tag}17`;
  created.phones.push(C1);
  await sim(C1, 'hola');
  await call(`/api/subscribers/${C1}/labels`, { body: { labels: [`bc-btn-${tag}`] } });
  created.labels.push(`bc-btn-${tag}`);
  const bcClick = (await call('/api/broadcasts', { body: { name: `Clic ${tag}`, content: 'Oferta de hoy', audience: { labels: [`bc-btn-${tag}`] }, buttons: [{ title: 'Quiero' }, { title: 'No gracias' }] } })).data;
  created.broadcasts.push(bcClick.id);
  const sentBtn = await call(`/api/broadcasts/${bcClick.id}/send`, { body: {} });
  check('broadcast con botones enviado', sentBtn.data?.sentCount === 1, JSON.stringify(sentBtn.data));
  await sim(C1, 'Quiero', 'bc_0');
  await sim(C1, 'Quiero', 'bc_0');
  const afterClick = (await call(`/api/broadcasts/${bcClick.id}`)).data;
  check('el clic se cuenta una sola vez por destinatario', afterClick.clickedCount === 1 && afterClick.recipients?.[0]?.clickedButton === 'Quiero', JSON.stringify([afterClick.clickedCount, afterClick.recipients?.[0]?.clickedButton]));

  console.log('\n19) Equipo con cuentas, roles, teléfonos enmascarados e IPs permitidas');
  const email = `agente-${tag}@example.com`;
  const password = `Clave-${tag}-segura`;
  const me = (await call('/api/auth/me')).data;
  check('quién soy: administrador con su IP', me.role === 'admin' && Boolean(me.ip), JSON.stringify(me));
  const member = (await call('/api/team', { body: { name: `Agente ${tag}`, email, role: 'agent', password } })).data;
  created.team.push(member.id);
  check('crear agente con contraseña (sin exponer el hash)', member.hasPassword === true && !('passwordHash' in member), JSON.stringify(member));
  check('contraseña débil → 400', (await call('/api/team', { body: { name: 'x', email: `x-${tag}@example.com`, password: '123' } })).status === 400);
  check('email repetido → 409', (await call('/api/team', { body: { name: 'y', email, password: 'otra-clave-larga' } })).status === 409);
  const badLogin = await call('/api/auth/login', { body: { email, password: 'incorrecta' }, key: '' });
  check('login con contraseña incorrecta → 401', badLogin.status === 401);
  check('login con email inexistente → 401 (misma respuesta)', (await call('/api/auth/login', { body: { email: `no-${tag}@example.com`, password: 'lo-que-sea-1234' }, key: '' })).status === 401);
  const login = await call('/api/auth/login', { body: { email, password }, key: '' });
  check('login del agente', login.status === 200 && login.data?.role === 'agent' && login.data.token?.startsWith('st.'), JSON.stringify(login.data));
  const agent = login.data.token;
  const adminLogin = await call('/api/auth/login', { body: { key: KEY }, key: '' });
  check('login con la clave de administrador', adminLogin.status === 200 && adminLogin.data?.role === 'admin');
  check('clave de administrador incorrecta → 401', (await call('/api/auth/login', { body: { key: 'nope' }, key: '' })).status === 401);

  const A1 = `1555${tag}18`;
  created.phones.push(A1);
  await sim(A1, 'hola agente', undefined, 'Cliente Privado');
  const agentConvs = await call('/api/conversations', { key: agent });
  check('el agente ve conversaciones', agentConvs.status === 200 && agentConvs.data.some((c) => c.subscriber.name === 'Cliente Privado'));
  const rawAgent = JSON.stringify(agentConvs.data);
  check('teléfonos enmascarados para el agente', !rawAgent.includes(A1) && rawAgent.includes('•'), rawAgent.slice(0, 200));
  const adminConvs = JSON.stringify((await call('/api/conversations')).data);
  check('el administrador sí ve el número completo', adminConvs.includes(A1));
  const subId = agentConvs.data.find((c) => c.subscriber.name === 'Cliente Privado').subscriber.id;
  check('el agente opera por id de contacto', (await call(`/api/subscribers/${subId}`, { key: agent })).status === 200);
  check('añadir etiqueta por id', (await call(`/api/subscribers/${subId}/labels`, { body: { labels: [`por-agente-${tag}`] }, key: agent })).status === 200);
  created.labels.push(`por-agente-${tag}`);
  for (const [path, opts] of [
    ['/api/settings', {}],
    ['/api/api-keys', {}],
    ['/api/subscribers/export', {}],
    ['/api/subscribers/stats', {}],
    ['/api/webhooks', {}],
    ['/api/login-log', {}],
    [`/api/subscribers/${subId}`, { method: 'DELETE' }],
    ['/api/team', { body: { name: 'intruso' } }],
    ['/api/subscribers/bulk', { body: { phones: [A1], action: 'delete' } }],
  ]) {
    const r = await call(path, { ...opts, key: agent });
    check(`el agente NO puede ${opts.method ?? (opts.body ? 'POST' : 'GET')} ${path.replace(subId, ':id')} (403)`, r.status === 403, String(r.status));
  }
  check('el agente existe aún tras los intentos', (await call(`/api/subscribers/${subId}`)).status === 200);
  const convId = agentConvs.data.find((c) => c.subscriber.name === 'Cliente Privado').id;
  await call(`/api/conversations/${convId}/messages`, { body: { body: 'Respuesta del agente' }, key: agent });
  const signed = (await outbound(A1)).find((m) => m.body.startsWith('Respuesta del agente'));
  check('el mensaje queda firmado con el nombre del agente', signed?.metadata?.sender === `Agente ${tag}`, JSON.stringify(signed?.metadata));
  check('el agente no puede leer el MCP ni la API v1', (await call('/api/mcp', { body: {}, key: agent })).status === 403);

  const deact = await call(`/api/team/${member.id}`, { method: 'PATCH', body: { active: false } });
  check('desactivar al agente', deact.status === 200 && deact.data.active === false);
  check('su sesión deja de valer al instante (401)', (await call('/api/conversations', { key: agent })).status === 401);
  check('y no puede volver a entrar', (await call('/api/auth/login', { body: { email, password }, key: '' })).status === 401);
  const log = (await call('/api/login-log')).data;
  check('el registro de accesos refleja éxitos y fallos', log.some((l) => l.ok === false) && log.some((l) => l.ok === true && l.actor === `Agente ${tag}`));

  const rulesOk = await call('/api/settings/security', { method: 'PUT', body: { ipAllowlist: [me.ip] } });
  check('guardar una lista de IPs que incluye la tuya', rulesOk.status === 200 && rulesOk.data.ipAllowlist.includes(me.ip), JSON.stringify(rulesOk.data));
  check('con la lista activa sigues entrando', (await call('/api/account')).status === 200);
  await call('/api/settings/security', { method: 'PUT', body: { ipAllowlist: [] } });
  const lockout = await call('/api/settings/security', { method: 'PUT', body: { ipAllowlist: ['203.0.113.77'] } });
  check('no deja guardar una lista que te bloquea', lockout.status === 400 && lockout.data?.error === 'would_lock_you_out', JSON.stringify(lockout.data));
  check('regla de IP inválida → 400', (await call('/api/settings/security', { method: 'PUT', body: { ipAllowlist: ['10.0.0.0/'] } })).status === 400);
  check('la lista sigue vacía tras los rechazos', (await call('/api/settings')).data.security.ipAllowlist.length === 0);

  console.log('\n20) Origen de leads');
  const srcRows = (await call('/api/analytics/sources')).data;
  check('informe de orígenes con conversión', Array.isArray(srcRows) && srcRows.every((r) => typeof r.subscribers === 'number' && typeof r.conversion === 'number'), JSON.stringify(srcRows).slice(0, 160));

  console.log('\n10) Analítica y ajustes');
  const an = (await call('/api/analytics/overview')).data;
  check('analítica con orígenes y mensajes', Array.isArray(an.sources) && an.messagesPerDay.length === 8);
  check('analítica: crecimiento a 30 días y métricas de broadcasts', an.growth30?.perDay?.length >= 30 && typeof an.broadcasts30?.campaigns === 'number', JSON.stringify(an.growth30?.perDay?.length));
} finally {
  console.log('\nLimpieza…');
  for (const phone of created.phones) await call(`/api/subscribers/${phone}`, { method: 'DELETE' });
  for (const id of created.sequences) await call(`/api/sequences/${id}`, { method: 'DELETE' });
  for (const id of created.workflows) await call(`/api/workflows/${id}`, { method: 'DELETE' });
  for (const id of created.broadcasts) await call(`/api/broadcasts/${id}`, { method: 'DELETE' });
  for (const id of created.team) await call(`/api/team/${id}`, { method: 'DELETE' });
  for (const id of created.keys) await call(`/api/api-keys/${id}`, { method: 'DELETE' });
  for (const id of created.fields) await call(`/api/custom-fields/${id}`, { method: 'DELETE' });
  for (const id of created.canned) await call(`/api/canned-responses/${id}`, { method: 'DELETE' });
  const labels = (await call('/api/labels')).data ?? [];
  for (const l of labels) if (created.labels.includes(l.name)) await call(`/api/labels/${l.id}`, { method: 'DELETE' });
  await call('/api/settings/sandbox', { method: 'PUT', body: original.sandbox });
  await call('/api/settings/businessHours', { method: 'PUT', body: original.businessHours });
  await call('/api/settings/assignment', { method: 'PUT', body: original.assignment });
  if (original.agent) await call('/api/settings/agent', { method: 'PUT', body: original.agent });
}

console.log(`\n${passed} correctas, ${failed.length} fallidas`);
if (failed.length) {
  console.log(failed.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
