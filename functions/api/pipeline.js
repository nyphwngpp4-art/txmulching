// Store a lead before forwarding it. D1 is optional: when the binding is
// missing the caller falls back to a single synchronous forward.

import { sheetSafePayload } from './_lib.js';

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS leads (
    request_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    forwarded_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt_at TEXT,
    backup_alerted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS demo_leads (
    request_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    ref TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS leads_unforwarded ON leads (forwarded_at, created_at)`
];

export const SCHEMA_SQL = SCHEMA_STATEMENTS.join(';\n');

export function hasLeadsDb(env) {
  return Boolean(env?.LEADS && typeof env.LEADS.prepare === 'function');
}

export async function ensureSchema(env) {
  if (!hasLeadsDb(env)) return false;
  // CREATE IF NOT EXISTS is cheap and keeps a wiped local database usable.
  for (const statement of SCHEMA_STATEMENTS) {
    await env.LEADS.prepare(statement).run();
  }
  return true;
}

function storedPayload(payload) {
  const copy = { ...payload };
  delete copy.token;
  return copy;
}

export async function insertLead(env, payload) {
  await ensureSchema(env);
  await env.LEADS.prepare(
    `INSERT INTO leads (request_id, created_at, payload_json, attempts)
     VALUES (?, ?, ?, 0)`
  ).bind(payload.requestId, payload.submittedAt, JSON.stringify(storedPayload(payload))).run();
}

export async function insertDemoLead(env, payload) {
  await ensureSchema(env);
  await env.LEADS.prepare(
    `INSERT OR REPLACE INTO demo_leads (request_id, created_at, payload_json, ref)
     VALUES (?, ?, ?, ?)`
  ).bind(payload.requestId, payload.submittedAt, JSON.stringify(storedPayload(payload)), payload.ref || '').run();
}

export async function postToScript(url, payload, env) {
  const timeoutMs = Number(env.FORWARD_TIMEOUT_MS || 10_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = sheetSafePayload(storedPayload(payload));
    if (env.APPS_SCRIPT_TOKEN) body.token = env.APPS_SCRIPT_TOKEN;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: controller.signal
    });
    const text = await upstream.text().catch(() => '');
    let data = null;
    try { data = JSON.parse(text); } catch { /* HTML error pages are not success */ }
    if (!upstream.ok || !data || data.ok !== true) {
      return { ok: false, error: `status ${upstream.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : (error?.message || 'fetch failed');
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function markForward(env, payload, result) {
  const now = new Date().toISOString();
  const row = await env.LEADS.prepare(
    'SELECT attempts FROM leads WHERE request_id = ?'
  ).bind(payload.requestId).first();
  const attempts = Number(row?.attempts || 0) + 1;
  await env.LEADS.prepare(
    `UPDATE leads
     SET attempts = ?, last_error = ?, last_attempt_at = ?, forwarded_at = ?
     WHERE request_id = ?`
  ).bind(
    attempts,
    result.ok ? null : String(result.error || 'forward failed').slice(0, 300),
    now,
    result.ok ? now : null,
    payload.requestId
  ).run();
  return attempts;
}

export async function forwardStoredLead(env, payload) {
  if (!env.GOOGLE_SCRIPT_URL) {
    console.error(JSON.stringify({ event: 'GOOGLE_SCRIPT_URL not configured', requestId: payload.requestId }));
    if (hasLeadsDb(env)) {
      try {
        await markForward(env, payload, { ok: false, error: 'GOOGLE_SCRIPT_URL not configured' });
      } catch (error) {
        console.error(JSON.stringify({ event: 'lead_mark_failed', error: error?.message || String(error) }));
      }
    }
    return { ok: false, error: 'GOOGLE_SCRIPT_URL not configured' };
  }
  const result = await postToScript(env.GOOGLE_SCRIPT_URL, payload, env);
  if (hasLeadsDb(env)) {
    try {
      const attempts = await markForward(env, payload, result);
      if (!result.ok) {
        console.error(JSON.stringify({
          event: 'quote_forward_failed',
          requestId: payload.requestId,
          attempts,
          error: result.error
        }));
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'lead_mark_failed', requestId: payload.requestId, error: error?.message || String(error) }));
    }
  } else if (!result.ok) {
    console.error(JSON.stringify({ event: 'quote_forward_failed', requestId: payload.requestId, error: result.error }));
  }
  return result;
}

function backoffMs(attempts) {
  const steps = Math.max(0, Number(attempts) - 1);
  return Math.min(60 * 60 * 1000, 5 * 60 * 1000 * (2 ** steps));
}

export function retryIsDue(row, now = Date.now()) {
  if (!row?.last_attempt_at) return true;
  const last = Date.parse(row.last_attempt_at);
  if (!Number.isFinite(last)) return true;
  return now - last >= backoffMs(row.attempts);
}

async function sendBackupAlert(env, row, payload) {
  if (row.backup_alerted_at) return;
  const summary = {
    requestId: row.request_id,
    name: payload.name || '',
    phone: payload.phone || '',
    email: payload.email || '',
    serviceType: payload.serviceType || '',
    acreage: payload.acreage || '',
    city: payload.city || ''
  };
  let noted = false;
  try {
    if (env.RESEND_API_KEY && env.BACKUP_ALERT_EMAIL) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: env.BACKUP_ALERT_FROM || 'TX Mulching Leads <leads@txmulching.com>',
          to: [env.BACKUP_ALERT_EMAIL],
          subject: `Lead not forwarded: ${summary.name || summary.requestId}`,
          text: `${JSON.stringify(summary, null, 2)}\n\nThe full lead is in the D1 leads table and has not reached the Sheet.`
        })
      });
      noted = response.ok;
      if (!response.ok) {
        console.error(JSON.stringify({ event: 'backup_email_failed', requestId: row.request_id, status: response.status }));
      }
    } else if (env.BACKUP_ALERT_URL) {
      const response = await fetch(env.BACKUP_ALERT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summary)
      });
      noted = response.ok;
    } else {
      console.error(JSON.stringify({
        event: 'backup_alert_not_configured',
        requestId: row.request_id,
        summary
      }));
      noted = true;
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'backup_alert_failed', requestId: row.request_id, error: error?.message || String(error) }));
  }
  if (noted) {
    await env.LEADS.prepare(
      'UPDATE leads SET backup_alerted_at = ? WHERE request_id = ?'
    ).bind(new Date().toISOString(), row.request_id).run();
  }
}

export async function retryUnforwarded(env) {
  if (!hasLeadsDb(env)) return { retried: 0 };
  try {
    await ensureSchema(env);
  } catch (error) {
    console.error(JSON.stringify({ event: 'schema_failed', error: error?.message || String(error) }));
    return { retried: 0 };
  }
  const { results } = await env.LEADS.prepare(
    `SELECT request_id, payload_json, attempts, last_attempt_at, backup_alerted_at
     FROM leads
     WHERE forwarded_at IS NULL AND attempts < 8
     ORDER BY created_at
     LIMIT 20`
  ).all();
  let retried = 0;
  for (const row of results || []) {
    let payload = null;
    try { payload = JSON.parse(row.payload_json); } catch { payload = null; }
    if (!payload) continue;
    if (Number(row.attempts) >= 3) await sendBackupAlert(env, row, payload);
    if (!retryIsDue(row)) continue;
    retried += 1;
    await forwardStoredLead(env, payload);
  }
  return { retried };
}

const demoMemory = [];

export function rememberDemo(payload) {
  demoMemory.push({ ...storedPayload(payload), storedAt: new Date().toISOString() });
  if (demoMemory.length > 50) demoMemory.shift();
}

export function listDemoMemory() {
  return demoMemory.slice();
}

export async function listDemoLeads(env) {
  const fromMemory = listDemoMemory();
  if (!hasLeadsDb(env)) return fromMemory;
  try {
    await ensureSchema(env);
    const { results } = await env.LEADS.prepare(
      'SELECT payload_json FROM demo_leads ORDER BY created_at DESC LIMIT 50'
    ).all();
    const fromDb = (results || []).map((row) => {
      try { return JSON.parse(row.payload_json); } catch { return null; }
    }).filter(Boolean);
    return fromDb.length ? fromDb : fromMemory;
  } catch {
    return fromMemory;
  }
}
