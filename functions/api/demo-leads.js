// Worker route: GET /api/demo-leads
// Returns stored demo leads only when DEMO_LEADS_SECRET is set and the
// request sends the same value in X-Demo-Leads-Secret. DEMO_STUB and the
// Host header do not grant access.

import { json, methodNotAllowed } from './_lib.js';
import { listDemoLeads } from './pipeline.js';

function secretMatches(provided, expected) {
  const token = String(expected || '');
  if (!token) return false;
  const a = new TextEncoder().encode(String(provided || ''));
  const b = new TextEncoder().encode(token);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const provided = request.headers.get('x-demo-leads-secret') || '';
  if (!secretMatches(provided, env.DEMO_LEADS_SECRET)) {
    return json(404, { error: 'Not found.' });
  }
  const leads = await listDemoLeads(env);
  return json(200, { ok: true, leads });
}
