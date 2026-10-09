// Worker route: POST /api/quote
// Validates a callback or /estimate submission. Real leads are stored in D1
// first (when the LEADS binding exists) and then forwarded to Apps Script.
// Demo leads never go to the TX Mulching script.

import {
  callUs,
  clean,
  contentTooLarge,
  demoFromRequest,
  isRateLimited,
  json,
  methodNotAllowed,
  timingError,
  validOrigin,
  verifyTurnstile
} from './_lib.js';
import { validateQuote } from './quote-validate.js';
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

export async function onRequest(context) {
  const { request, env, ctx } = context;

  if (request.method !== 'POST') return methodNotAllowed('POST');
  if (!validOrigin(request, env, { allowMissing: true })) {
    return json(403, { error: 'Request origin is not allowed.' });
  }

  const html = isHtmlForm(request);
  if (contentTooLarge(request, html ? FORM_MAX : JSON_MAX)) {
    return html
      ? redirectToEstimate(request, { error: 'That submission is too large.' })
      : json(413, { error: 'Request is too large.' });
  }

  if (await isRateLimited(request, env, 'QUOTE_RL', 5, 60_000)) {
    const error = 'Too many requests. Please wait before trying again.';
    return html ? redirectToEstimate(request, { error }) : json(429, { error });
  }

  const submission = await readSubmission(request);
  const body = submission.data;
  if (clean(body.website, 100)) {
    return html
      ? redirectToEstimate(request, { sent: '1' })
      : json(200, { ok: true });
  }

  const turnstile = await verifyTurnstile(request, env, body['cf-turnstile-response'] || body.turnstileToken);
  if (!turnstile.ok) {
    return html
      ? redirectToEstimate(request, { error: turnstile.error })
      : json(403, { error: turnstile.error });
  }

  const timing = timingError(body, { waive: html });
  if (timing) return json(400, { error: timing });

  const demo = demoFromRequest(body, request);
  const validated = validateQuote(body, { demo });
  if (validated.error) {
    return html
      ? redirectToEstimate(request, { error: validated.error })
      : json(400, { error: validated.error });
  }

  const payload = validated.payload;
  if (!payload.ref) {
    try {
      const ref = new URL(request.headers.get('referer') || '').searchParams.get('ref');
      if (ref) payload.ref = clean(ref, 40);
    } catch { /* no referer */ }
  }

  if (!env.LEAD_PHOTOS && submission.files.length) {
    const fromFiles = await filesToDrivePhotos(submission.files);
    if (fromFiles.error) {
      return html
        ? redirectToEstimate(request, { error: fromFiles.error })
        : json(400, { error: fromFiles.error });
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

async function finishReal(request, env, ctx, payload, html) {
  if (hasLeadsDb(env)) {
    try {
      await insertLead(env, payload);
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
    const error = callUs('The quote service is temporarily unavailable.');
    return html ? redirectToEstimate(request, { error }) : json(503, { error });
  }

  const result = await forwardStoredLead(env, payload);
  if (!result.ok) {
    const error = callUs('The quote service is temporarily unavailable.');
    return html ? redirectToEstimate(request, { error }) : json(502, { error });
  }
  return html
    ? redirectToEstimate(request, { sent: '1', id: payload.requestId })
    : json(200, { ok: true, requestId: payload.requestId });
}
