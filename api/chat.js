import fs from 'node:fs';

const businessData = JSON.parse(
  fs.readFileSync(new URL('../business-data.json', import.meta.url), 'utf8')
);

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 20;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 1_000;
const requestLog = new Map();

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return Array.isArray(forwarded)
    ? forwarded[0]
    : String(forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function isRateLimited(ip) {
  const now = Date.now();
  const existing = (requestLog.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (existing.length >= MAX_REQUESTS) return true;
  existing.push(now);
  requestLog.set(ip, existing);
  return false;
}

function validOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin === `https://${host}` || origin === `http://${host}`) return true;
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return allowed.includes(origin);
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed.' });
  }

  if (!validOrigin(req)) return json(res, 403, { error: 'Request origin is not allowed.' });

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 25_000) return json(res, 413, { error: 'Request is too large.' });

  if (isRateLimited(getClientIp(req))) {
    return json(res, 429, { error: 'Too many chat requests. Please wait a few minutes.' });
  }

  if (!process.env.XAI_API_KEY) {
    return json(res, 503, { error: 'The chat assistant has not been activated yet.' });
  }

  const messages = sanitizeMessages(req.body?.messages);
  if (!messages.length || messages.at(-1)?.role !== 'user') {
    return json(res, 400, { error: 'Enter a message to continue.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const upstream = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.XAI_MODEL || 'grok-4.5',
        input: [{ role: 'system', content: systemPrompt }, ...messages],
        store: false
      }),
      signal: controller.signal
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error('xAI chat error', upstream.status, data?.error?.message || 'Unknown upstream error');
      return json(res, 502, { error: 'The chat assistant is temporarily unavailable.' });
    }

    const reply = extractReply(data);
    if (!reply) return json(res, 502, { error: 'The chat assistant returned an empty response.' });
    return json(res, 200, { reply });
  } catch (error) {
    console.error('Chat request failed', error?.name || error);
    const message = error?.name === 'AbortError'
      ? 'The chat assistant took too long to respond.'
      : 'The chat assistant is temporarily unavailable.';
    return json(res, 502, { error: message });
  } finally {
    clearTimeout(timeout);
  }
}
