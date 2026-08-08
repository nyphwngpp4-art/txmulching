// Cloudflare Pages Function: POST /api/quote
// Validates a quote request and forwards it to the Google Apps Script endpoint.

const DEFAULT_GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz4cvrrOyvDmg9pZnd2Qi3MWoREjIXjvPfjkKx_ED_lXNOZdUo5MFmS0Z7A3gnjtKEi/exec';
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const requestLog = new Map();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function clean(value, maxLength) {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, maxLength);
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
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Allow: 'POST' }
    });
  }

  if (!validOrigin(request, env)) return json(403, { error: 'Request origin is not allowed.' });

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 20_000) return json(413, { error: 'Request is too large.' });

  if (isRateLimited(getClientIp(request))) {
    return json(429, { error: 'Too many requests. Please wait before trying again.' });
  }

  const parsed = await request.json().catch(() => null);
  const body = parsed && typeof parsed === 'object' ? parsed : {};

  if (clean(body.website, 100)) return json(200, { ok: true });

  const formStartedAt = Number(body.formStartedAt);
  const formAge = Date.now() - formStartedAt;
  if (!Number.isFinite(formStartedAt) || formAge < 2_000 || formAge > 2 * 60 * 60 * 1000) {
    return json(400, { error: 'Please refresh the page and try again.' });
  }

  const payload = {
    name: clean(body.name, 80),
    phone: clean(body.phone, 30),
    email: clean(body.email, 120).toLowerCase(),
    zipcode: clean(body.zipcode, 10),
    acreage: clean(body.acreage, 40),
    serviceType: clean(body.serviceType, 80),
    description: clean(body.description, 1500),
    source: 'TX Mulching website',
    submittedAt: new Date().toISOString(),
    requestId: crypto.randomUUID()
  };

  if (!payload.name) return json(400, { error: 'Name is required.' });
  if (!payload.phone && !payload.email) return json(400, { error: 'A phone number or email address is required.' });
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return json(400, { error: 'Enter a valid email address.' });
  if (payload.phone && payload.phone.replace(/\D/g, '').length < 10) return json(400, { error: 'Enter a valid phone number.' });
  if (payload.zipcode && !/^\d{5}(?:-\d{4})?$/.test(payload.zipcode)) return json(400, { error: 'Enter a valid ZIP code.' });

  const scriptUrl = env.GOOGLE_SCRIPT_URL || DEFAULT_GOOGLE_SCRIPT_URL;

  try {
    const upstream = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    if (!upstream.ok) {
      console.error('Quote upstream error', upstream.status, await upstream.text().catch(() => ''));
      return json(502, { error: 'The quote service is temporarily unavailable.' });
    }
    return json(200, { ok: true, requestId: payload.requestId });
  } catch (error) {
    console.error('Quote submission failed', error);
    return json(502, { error: 'The quote service is temporarily unavailable.' });
  }
}
