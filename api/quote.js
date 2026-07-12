const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbz4cvrrOyvDmg9pZnd2Qi3MWoREjIXjvPfjkKx_ED_lXNOZdUo5MFmS0Z7A3gnjtKEi/exec';
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const requestLog = new Map();
function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}
function clean(value, maxLength) {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, maxLength);
}
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return Array.isArray(forwarded) ? forwarded[0] : String(forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
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
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin);
}
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed.' });
  }
  if (!validOrigin(req)) return json(res, 403, { error: 'Request origin is not allowed.' });
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 20_000) return json(res, 413, { error: 'Request is too large.' });
  const ip = getClientIp(req);
  if (isRateLimited(ip)) return json(res, 429, { error: 'Too many requests. Please wait before trying again.' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (clean(body.website, 100)) return json(res, 200, { ok: true });
  const formStartedAt = Number(body.formStartedAt);
  const formAge = Date.now() - formStartedAt;
  if (!Number.isFinite(formStartedAt) || formAge < 2_000 || formAge > 2 * 60 * 60 * 1000) {
    return json(res, 400, { error: 'Please refresh the page and try again.' });
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
  if (!payload.name) return json(res, 400, { error: 'Name is required.' });
  if (!payload.phone && !payload.email) return json(res, 400, { error: 'A phone number or email address is required.' });
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return json(res, 400, { error: 'Enter a valid email address.' });
  if (payload.phone && payload.phone.replace(/\D/g, '').length < 10) return json(res, 400, { error: 'Enter a valid phone number.' });
  if (payload.zipcode && !/^\d{5}(?:-\d{4})?$/.test(payload.zipcode)) return json(res, 400, { error: 'Enter a valid ZIP code.' });
  try {
    const upstream = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    if (!upstream.ok) {
      console.error('Quote upstream error', upstream.status, await upstream.text().catch(() => ''));
      return json(res, 502, { error: 'The quote service is temporarily unavailable.' });
    }
    return json(res, 200, { ok: true, requestId: payload.requestId });
  } catch (error) {
    console.error('Quote submission failed', error);
    return json(res, 502, { error: 'The quote service is temporarily unavailable.' });
  }
}
