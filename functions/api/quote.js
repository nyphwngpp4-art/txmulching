// Worker route: POST /api/quote
// Validates a callback or /estimate submission. Real leads are stored in D1
// first (when the LEADS binding exists) and then forwarded to Apps Script.
// Demo leads never go to the TX Mulching script.

import {
  callUs,
  clean,
  demoFromRequest,
  enforceBodyLimit,
  isRateLimited,
  json,
  methodNotAllowed,
  submittedTooFast,
  timingError,
  validOrigin,
  verifyTurnstile
} from './_lib.js';
import { validateQuote } from './quote-validate.js';
import { applySpam, assessSpam, spamDisposition } from './spam.js';
import {
  forwardStoredLead,
  hasLeadsDb,
  insertDemoLead,
  insertLead,
  postToScript,
  rememberDemo
} from './pipeline.js';
import { filesToDrivePhotos, promotePhotos, photoUrls } from './photos.js';

// Six photos at about 300 KB, base64, plus the form fields.
const JSON_MAX = 4_500_000;
const FORM_MAX = 32_000_000;

function isHtmlForm(request) {
  const type = request.headers.get('content-type') || '';
  return type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded');
}

function silentAccept(request, html) {
  return html
    ? redirectToEstimate(request, { sent: '1' })
    : json(200, { ok: true });
}

function redirectToEstimate(request, params) {
  const url = new URL(request.url);
  const target = new URL('/estimate', url.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value);
  }
  return Response.redirect(target.toString(), 303);
}

async function readSubmission(request) {
  const html = isHtmlForm(request);
  if (!html) {
    const parsed = await request.json().catch(() => null);
    return { data: parsed && typeof parsed === 'object' ? parsed : {}, files: [], html };
  }
  const form = await request.formData();
  const data = {};
  const files = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const current = data[key];
        data[key] = Array.isArray(current) ? [...current, value] : [current, value];
      } else {
        data[key] = value;
      }
    } else if (value && typeof value.arrayBuffer === 'function' && value.size) {
      files.push(value);
    }
  }
  return { data, files, html };
}

function reject(request, html, status, code, message) {
  return html
    ? redirectToEstimate(request, { error: code })
    : json(status, { error: message });
}

export async function onRequest(context) {
  let { request } = context;
  const { env, ctx } = context;

  if (request.method !== 'POST') return methodNotAllowed('POST');
  if (!validOrigin(request, env, { allowMissing: true })) {
    return json(403, { error: 'Request origin is not allowed.' });
  }

  const html = isHtmlForm(request);
  const limited = await enforceBodyLimit(request, html ? FORM_MAX : JSON_MAX);
  if (limited.tooLarge) {
    return reject(request, html, 413, 'too_large', 'Request is too large.');
  }
  request = limited.request;

  if (await isRateLimited(request, env, 'QUOTE_RL', 5, 60_000)) {
    return reject(request, html, 429, 'rate_limit', 'Too many requests. Please wait before trying again.');
  }

  const submission = await readSubmission(request);
  const body = submission.data;

  const turnstile = await verifyTurnstile(request, env, body['cf-turnstile-response'] || body.turnstileToken);
  if (!turnstile.ok) {
    return reject(request, html, 403, 'bot_check', turnstile.error);
  }

  // No-JS posts have no elapsedMs. A reported time under ~3s is dropped
  // quietly so a bot is not told to wait and retry.
  const hasElapsed = Number.isFinite(Number(body.elapsedMs)) || Number.isFinite(Number(body.formStartedAt));
  if (submittedTooFast(body)) {
    console.error(JSON.stringify({ event: 'quote_fast_drop' }));
    return silentAccept(request, html);
  }
  const timing = timingError(body, { waive: html && !hasElapsed });
  if (timing) {
    return reject(request, html, 400, 'timing', timing);
  }

  const demo = demoFromRequest(body, request);
  const validated = validateQuote(body, { demo });
  if (validated.error) {
    return reject(request, html, 400, 'invalid', validated.error);
  }

  const payload = validated.payload;
  // txm_hp is the current field. `website` is the old name, still honored so a
  // cached page keeps the trap. A hit is stored for review and not emailed.
  if (clean(body.txm_hp || body.website, 200)) {
    return finishHoneypot(request, env, payload, html);
  }
  if (!payload.ref) {
    try {
      const ref = new URL(request.headers.get('referer') || '').searchParams.get('ref');
      if (ref) payload.ref = clean(ref, 40);
    } catch { /* no referer */ }
  }

  const spam = await assessSpam(env, payload);
  applySpam(payload, spam);
  const disposition = spamDisposition(spam);
  // Demo never reaches the owner Sheet, including when the text looks like spam.
  // An obvious pitch (sales phrase or link) at a high score is stored and not
  // emailed. Any other high score is flagged and still sent to the owners.
  if (!demo && disposition === 'spam') return finishSpam(request, env, payload, html);
  if (!demo && disposition === 'review') {
    payload.possibleSpam = 'yes';
    payload.needsReview = 'yes';
  }

  if (!env.LEAD_PHOTOS && submission.files.length) {
    const fromFiles = await filesToDrivePhotos(submission.files);
    if (fromFiles.error) {
      return reject(request, html, 400, 'invalid', fromFiles.error);
    }
    payload.photos = [...(payload.photos || []), ...fromFiles.photos].slice(0, 6);
  }

  try {
    const promoted = await promotePhotos(env, payload.requestId, payload.photoKeys, env.LEAD_PHOTOS ? submission.files : []);
    payload.photoKeys = promoted.keys;
    const signed = await photoUrls(request, env, payload.requestId, promoted.files);
    if (signed.length) payload.photoLinks = signed;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'photo_promote_failed',
      requestId: payload.requestId,
      error: error?.message || String(error)
    }));
    payload.photoLinks = [];
  }

  if (demo) return finishDemo(request, env, ctx, payload, html);
  return finishReal(request, env, ctx, payload, html);
}

async function finishHoneypot(request, env, payload, html) {
  payload.honeypot = 'yes';
  console.error(JSON.stringify({ event: 'quote_honeypot', requestId: payload.requestId }));
  if (hasLeadsDb(env)) {
    try {
      await insertLead(env, payload, { status: 'honeypot' });
    } catch {
      console.error(JSON.stringify({
        event: 'honeypot_store_failed',
        requestId: payload.requestId
      }));
    }
  } else {
    console.error(JSON.stringify({ event: 'honeypot_not_stored', requestId: payload.requestId }));
  }
  return reject(
    request,
    html,
    400,
    'review',
    callUs('We could not send that from the form.')
  );
}

async function finishDemo(request, env, ctx, payload, html) {
  let stored = false;
  if (hasLeadsDb(env)) {
    try {
      await insertDemoLead(env, payload);
      stored = true;
    } catch (error) {
      console.error(JSON.stringify({ event: 'demo_d1_failed', requestId: payload.requestId, error: error?.message || String(error) }));
    }
  }
  if (env.DEMO_STUB === '1' || (!stored && !env.DEMO_SCRIPT_URL)) rememberDemo(payload);
  if (env.DEMO_SCRIPT_URL) {
    const job = postToScript(env.DEMO_SCRIPT_URL, payload, env).then((result) => {
      if (!result.ok) {
        console.error(JSON.stringify({ event: 'demo_forward_failed', requestId: payload.requestId, error: result.error }));
      }
    });
    if (ctx?.waitUntil) ctx.waitUntil(job);
    else await job;
  } else if (!stored) {
    console.error(JSON.stringify({
      event: 'demo_sink_not_configured',
      requestId: payload.requestId,
      note: 'Lead kept in the local stub only. Set DEMO_SCRIPT_URL or the LEADS D1 binding.'
    }));
  }

  const body = { ok: true, requestId: payload.requestId, demo: true };
  return html
    ? redirectToEstimate(request, { sent: '1', id: payload.requestId, demo: '1' })
    : json(200, body);
}

async function finishSpam(request, env, payload, html) {
  console.error(JSON.stringify({
    event: 'quote_spam',
    requestId: payload.requestId,
    score: payload.spamScore || 0,
    reasons: payload.spamReasons || []
  }));
  if (hasLeadsDb(env)) {
    try {
      await insertLead(env, payload, { status: 'spam' });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'quote_spam_store_failed',
        requestId: payload.requestId,
        error: error?.message || String(error)
      }));
    }
  }
  return html
    ? redirectToEstimate(request, { sent: '1', id: payload.requestId })
    : json(200, { ok: true, requestId: payload.requestId });
}

async function finishReal(request, env, ctx, payload, html) {
  const status = payload.possibleSpam === 'yes' ? 'possible' : 'new';
  if (hasLeadsDb(env)) {
    try {
      await insertLead(env, payload, { status });
      const job = forwardStoredLead(env, payload);
      if (ctx?.waitUntil) ctx.waitUntil(job);
      else await job;
      return html
        ? redirectToEstimate(request, { sent: '1', id: payload.requestId })
        : json(200, { ok: true, requestId: payload.requestId });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'quote_store_failed',
        requestId: payload.requestId,
        error: error?.message || String(error)
      }));
    }
  }

  if (!env.GOOGLE_SCRIPT_URL) {
    console.error(JSON.stringify({ event: 'GOOGLE_SCRIPT_URL not configured', requestId: payload.requestId }));
    return reject(request, html, 503, 'unavailable', callUs('The quote service is temporarily unavailable.'));
  }

  const result = await forwardStoredLead(env, payload);
  if (!result.ok) {
    return reject(request, html, 502, 'unavailable', callUs('The quote service is temporarily unavailable.'));
  }
  return html
    ? redirectToEstimate(request, { sent: '1', id: payload.requestId })
    : json(200, { ok: true, requestId: payload.requestId });
}
