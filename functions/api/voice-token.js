// Worker route: POST /api/voice-token
// Mints a short-lived ephemeral client secret for the Grok Voice realtime API
// so the browser can connect to wss://api.x.ai without exposing XAI_API_KEY.
//
// Origin alone is not enough: a non-browser client can set it. Sec-Fetch-Site
// blocks ordinary cross-site browser calls and naive curl. A client that
// forges that header still needs a Turnstile token once TURNSTILE_SECRET is set.

import {
  browserSameOrigin,
  isRateLimited,
  json,
  methodNotAllowed,
  validOrigin,
  verifyTurnstile
} from './_lib.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') return methodNotAllowed('POST');
  if (!validOrigin(request, env)) return json(403, { error: 'Request origin is not allowed.' });
  if (!browserSameOrigin(request)) return json(403, { error: 'Request origin is not allowed.' });
  if (await isRateLimited(request, env, 'VOICE_RL', 5, 60_000)) {
    return json(429, { error: 'Too many voice sessions. Please wait a few minutes.' });
  }

  const parsed = await request.json().catch(() => ({}));
  const turnstile = await verifyTurnstile(request, env, parsed?.turnstileToken || parsed?.['cf-turnstile-response']);
  if (!turnstile.ok) return json(403, { error: turnstile.error });

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
      console.error(JSON.stringify({ event: 'voice_token_upstream', status: upstream.status, detail: detail || 'unknown' }));
      return json(502, { error: 'Voice is temporarily unavailable.' });
    }
    const value = data.value || data.client_secret?.value;
    const expires_at = data.expires_at || data.client_secret?.expires_at;
    if (!value) return json(502, { error: 'Voice token response was malformed.' });
    return json(200, { value, expires_at });
  } catch (error) {
    console.error(JSON.stringify({ event: 'voice_token_failed', error: error?.name || String(error) }));
    return json(502, { error: 'Voice is temporarily unavailable.' });
  }
}
