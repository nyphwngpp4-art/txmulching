// Cloudflare Pages Function: POST /api/chat
// Server-side proxy to the xAI Responses API. Keeps the API key server-side.

import businessData from '../../business-data.json';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 20;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 1_000;
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

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-MAX_MESSAGES)
    .filter((message) => message && ['user', 'assistant'].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').replace(/[<>]/g, '').trim().slice(0, MAX_MESSAGE_LENGTH)
    }))
    .filter((message) => message.content);
}

function extractReply(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text.trim();
    }
  }
  return '';
}

const systemPrompt = `You are the website assistant for ${businessData.businessName}, an owner-led forestry mulching and land-clearing business based in ${businessData.homeBase}.

Verified facts:
- Phone: ${businessData.displayPhone}
- Tagline: ${businessData.tagline}
- Service area: ${businessData.serviceArea}
- Experience: ${businessData.experience.landClearingYears} years of land-clearing experience and ${businessData.experience.heavyEquipmentYears} years operating heavy equipment
- Services: ${businessData.services.join(', ')}
- Positioning: ${businessData.positioning.join('; ')}

Behavior:
- Be practical, concise, straightforward, and helpful. Avoid hype and filler.
- Answer only from the verified facts above and normal general knowledge about these services.
- Never invent prices, availability, job timing, permits, equipment specifications, guarantees, or project suitability.
- Explain that an on-site review or direct discussion may be needed for pricing and scheduling.
- When a visitor appears interested, ask only for useful quote details: name, phone or email, ZIP code, estimated acreage, service needed, property conditions, and desired timing.
- Do not claim that the phone is answered by an AI receptionist or that it is staffed 24/7.
- Direct visitors to the website quote form or to call or text ${businessData.displayPhone}.
- Do not request financial, medical, government-ID, password, or other sensitive information.
- Keep most answers under 120 words.`;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Allow: 'POST' }
    });
  }

  if (!validOrigin(request, env)) return json(403, { error: 'Request origin is not allowed.' });

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 25_000) return json(413, { error: 'Request is too large.' });

  if (isRateLimited(getClientIp(request))) {
    return json(429, { error: 'Too many chat requests. Please wait a few minutes.' });
  }

  if (!env.XAI_API_KEY) {
    return json(503, { error: 'The chat assistant has not been activated yet.' });
  }

  const parsed = await request.json().catch(() => null);
  const messages = sanitizeMessages(parsed?.messages);
  if (!messages.length || messages.at(-1)?.role !== 'user') {
    return json(400, { error: 'Enter a message to continue.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const upstream = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: env.XAI_MODEL || 'grok-4.5',
        // xAI's Responses API takes the system prompt via `instructions`;
        // `input` accepts only user/assistant turns (a system role 400s).
        instructions: systemPrompt,
        input: messages,
        store: false
      }),
      signal: controller.signal
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      // xAI error bodies vary: {error:{message}}, {error:"..."}, or {detail:"..."}.
      const detail = data?.error?.message
        || (typeof data?.error === 'string' ? data.error : '')
        || data?.detail
        || JSON.stringify(data).slice(0, 300);
      console.error('xAI chat error', upstream.status, detail || 'Unknown upstream error');
      return json(502, { error: 'The chat assistant is temporarily unavailable.' });
    }

    const reply = extractReply(data);
    if (!reply) return json(502, { error: 'The chat assistant returned an empty response.' });
    return json(200, { reply });
  } catch (error) {
    console.error('Chat request failed', error?.name || error);
    const message = error?.name === 'AbortError'
      ? 'The chat assistant took too long to respond.'
      : 'The chat assistant is temporarily unavailable.';
    return json(502, { error: message });
  } finally {
    clearTimeout(timeout);
  }
}
