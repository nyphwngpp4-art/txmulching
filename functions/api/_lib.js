// Shared helpers for the Worker API routes.
// Rate-limit bindings are per Cloudflare location and keyed by IP because these
// routes are anonymous. The in-memory map is only a fallback when a binding is
// missing (local tests, or a deploy that has not added `ratelimits` yet).

const MEMORY_BUCKETS = new Map();
const MEMORY_CAP = 5000;

export function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

export function methodNotAllowed(allow) {
  return json(405, { error: 'Method not allowed.' }, { Allow: allow });
}

export function getClientIp(request) {
  return request.headers.get('cf-connecting-ip')
    || String(request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim()
    || 'unknown';
}

export function clean(value, maxLength) {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, maxLength);
}

// Sheets treats a leading = + - @ tab or CR as a formula. A leading apostrophe
// forces the literal text. The Apps Script applies the same rule, and skips a
// value that already starts with the apostrophe.
export function sheetSafe(value) {
  const text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

export function sheetSafePayload(payload) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') out[key] = sheetSafe(value);
    else if (Array.isArray(value)) out[key] = value.map((item) => (typeof item === 'string' ? sheetSafe(item) : item));
    else out[key] = value;
  }
  return out;
}

export function validOrigin(request, env, { allowMissing = false } = {}) {
  const origin = request.headers.get('origin');
  if (!origin) return allowMissing;
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (allowed.length) return allowed.includes(origin);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  return origin === `https://${host}` || origin === `http://${host}`;
}

// Browsers set Sec-Fetch-Site and page scripts cannot override it. curl can,
// so this is a speed bump until Turnstile is configured — not a credential.
export function browserSameOrigin(request) {
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

function memoryLimited(bucketName, ip, limit, windowMs) {
  const now = Date.now();
  const key = `${bucketName}:${ip}`;
  const hits = (MEMORY_BUCKETS.get(key) || []).filter((time) => now - time < windowMs);
  if (hits.length >= limit) {
    MEMORY_BUCKETS.set(key, hits);
    return true;
  }
  hits.push(now);
  MEMORY_BUCKETS.set(key, hits);
  if (MEMORY_BUCKETS.size > MEMORY_CAP) {
    const oldest = MEMORY_BUCKETS.keys().next().value;
    MEMORY_BUCKETS.delete(oldest);
  }
  return false;
}

export async function isRateLimited(request, env, bindingName, limit, windowMs) {
  const ip = getClientIp(request);
  const limiter = env?.[bindingName];
  if (limiter && typeof limiter.limit === 'function') {
    try {
      const { success } = await limiter.limit({ key: ip });
      return success === false;
    } catch (error) {
      console.error(JSON.stringify({
        event: 'rate_limit_binding_failed',
        binding: bindingName,
        error: error?.message || String(error)
      }));
    }
  }
  return memoryLimited(bindingName, ip, limit, windowMs);
}

export function contentTooLarge(request, maxBytes) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > maxBytes;
}

export function isDemoFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function demoFromRequest(data, request) {
  if (isDemoFlag(data?.demo)) return true;
  const referer = request.headers.get('referer') || '';
  try {
    return new URL(referer).searchParams.get('demo') === '1';
  } catch {
    return false;
  }
}

const ELAPSED_MIN_MS = 3000;
const ELAPSED_MAX_MS = 24 * 60 * 60 * 1000;

export function timingError(data, { waive = false } = {}) {
  if (waive) return null;
  const elapsed = Number(data?.elapsedMs);
  if (Number.isFinite(elapsed)) {
    if (elapsed < ELAPSED_MIN_MS || elapsed > ELAPSED_MAX_MS) {
      return 'Please wait a moment and tap Send again.';
    }
    return null;
  }
  // Pages cached before elapsedMs existed stamp the wall clock. Accept that
  // only when it is a plausible positive age; a fast device clock should send
  // elapsedMs from the updated script instead.
  const started = Number(data?.formStartedAt);
  const age = Date.now() - started;
  if (Number.isFinite(started) && age >= 2000 && age <= ELAPSED_MAX_MS) return null;
  return 'Please wait a moment and tap Send again.';
}

export async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: 'Bot check failed. Please try again.' };
  const body = new URLSearchParams();
  body.set('secret', env.TURNSTILE_SECRET);
  body.set('response', String(token));
  const ip = getClientIp(request);
  if (ip && ip !== 'unknown') body.set('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
      return { ok: false, error: 'Bot check failed. Please try again.' };
    }
    return { ok: true };
  } catch (error) {
    console.error(JSON.stringify({ event: 'turnstile_failed', error: error?.message || String(error) }));
    return { ok: false, error: 'Bot check failed. Please try again.' };
  }
}

export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { type: 'image/png', ext: 'png' };
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { type: 'image/webp', ext: 'webp' };
  }
  return null;
}

const PHOTO_KEY = /^drafts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[1-6]\.(jpg|png|webp)$/;

export function normalizePhotoKeys(value) {
  let list = value;
  if (typeof list === 'string' && list.trim()) {
    try {
      list = JSON.parse(list);
    } catch {
      list = [list];
    }
  }
  if (list == null || list === '') return { keys: [] };
  if (!Array.isArray(list)) return { error: 'Photo list was not understood.' };
  if (list.length > 6) return { error: 'Send 6 photos or fewer.' };
  const keys = [];
  for (const item of list) {
    const key = String(item || '').trim();
    if (!key) continue;
    if (!PHOTO_KEY.test(key)) return { error: 'A photo upload was not recognized. Remove it and try again.' };
    keys.push(key);
  }
  return { keys };
}

export function bytesToBase64Url(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function signPhotoLink(secret, requestId, file, exp) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${requestId}/${file}/${exp}`));
  return bytesToBase64Url(mac);
}

export async function photoLinkIsValid(secret, requestId, file, exp, sig) {
  if (!secret || !sig) return false;
  const expected = await signPhotoLink(secret, requestId, file, exp);
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(String(sig));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function callUs(message) {
  return `${message} Please call (903) 833-3965.`;
}
