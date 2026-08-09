// Cloudflare Pages Function: POST /api/voice-token
// Mints a short-lived ephemeral client secret for the Grok Voice realtime API
// so the browser can connect to wss://api.x.ai without exposing XAI_API_KEY.

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 10;
const requestLog = new Map();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function getClientIp(request) {
  return request.headers.get('cf-connecting-ip')
    || String(request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
}

function isRateLimited(ip) {
  const now = Date.now();
  const existing = (requestLog.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (existing.length >= MAX_REQUESTS) return true;
  existing.push(now);
  requestLog.set(ip, existing);
  return false;
}

function validOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (allowed.length) return allowed.includes(origin);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  return origin === `https://${host}` || origin === `http://${host}`;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }
  if (!validOrigin(request, env)) return json(403, { error: 'Request origin is not allowed.' });
  if (isRateLimited(getClientIp(request))) {
    return json(429, { error: 'Too many voice sessions. Please wait a few minutes.' });
  }
  if (!env.XAI_API_KEY) {
    return json(503, { error: 'Voice has not been activated yet.' });
  }

  try {
    const upstream = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.XAI_API_KEY}`
      },
      // xAI's client_secrets endpoint takes only expires_after (no `session`
      // field); the agent/model is chosen by the client's WebSocket URL.
      body: JSON.stringify({
        expires_after: { seconds: 300 }
      })
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const detail = data?.error?.message
        || (typeof data?.error === 'string' ? data.error : '')
        || data?.detail
        || JSON.stringify(data).slice(0, 300);
      console.error('voice-token upstream error', upstream.status, detail || 'unknown');
      return json(502, { error: 'Voice is temporarily unavailable.' });
    }
    // Pass through only what the client needs.
    const value = data.value || data.client_secret?.value;
    const expires_at = data.expires_at || data.client_secret?.expires_at;
    if (!value) return json(502, { error: 'Voice token response was malformed.' });
    return json(200, { value, expires_at });
  } catch (error) {
    console.error('voice-token failed', error?.name || error);
    return json(502, { error: 'Voice is temporarily unavailable.' });
  }
}
