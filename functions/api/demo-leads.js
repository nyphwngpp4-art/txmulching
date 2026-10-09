// Worker route: GET /api/demo-leads
// Local stub inspection only. Refuses anything that is not loopback, and
// refuses production unless DEMO_STUB=1 was set on purpose for a local run.

import { json, methodNotAllowed } from './_lib.js';
import { listDemoLeads } from './pipeline.js';

function loopback(request) {
  const host = (request.headers.get('host') || '').split(':')[0];
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return methodNotAllowed('GET');
  if (env.DEMO_STUB !== '1' || !loopback(request)) {
    return json(404, { error: 'Not found.' });
  }
  const leads = await listDemoLeads(env);
  return json(200, { ok: true, leads });
}
