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

  console.log('\n10) Analítica y ajustes');
  const an = (await call('/api/analytics/overview')).data;
  check('analítica con orígenes y mensajes', Array.isArray(an.sources) && an.messagesPerDay.length === 8);
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
}

console.log(`\n${passed} correctas, ${failed.length} fallidas`);
if (failed.length) {
  console.log(failed.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
