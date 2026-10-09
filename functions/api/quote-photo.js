// Worker route: POST /api/quote-photo
// Accepts one already-compressed image and stores it under drafts/ in R2.

import {
  contentTooLarge,
  isRateLimited,
  json,
  methodNotAllowed,
  validOrigin,
  verifyTurnstile
} from './_lib.js';
import { storePhoto } from './photos.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return methodNotAllowed('POST');
  if (!validOrigin(request, env, { allowMissing: false })) {
    return json(403, { error: 'Request origin is not allowed.' });
  }
  if (contentTooLarge(request, 6_000_000)) return json(413, { error: 'That photo is too large.' });
  if (await isRateLimited(request, env, 'PHOTO_RL', 30, 60_000)) {
    return json(429, { error: 'Too many photo uploads. Please wait a moment.' });
  }

  const type = request.headers.get('content-type') || '';
  let bytes;
  let index = 1;
  let token = '';
  try {
    if (type.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      token = String(form.get('cf-turnstile-response') || form.get('turnstileToken') || '');
      index = Number(form.get('n') || 1);
      if (!file || typeof file.arrayBuffer !== 'function') {
        return json(400, { error: 'Choose a photo to upload.' });
      }
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      token = new URL(request.url).searchParams.get('turnstileToken') || '';
      index = Number(new URL(request.url).searchParams.get('n') || 1);
      bytes = new Uint8Array(await request.arrayBuffer());
    }
  } catch {
    return json(400, { error: 'The photo could not be read.' });
  }

  const turnstile = await verifyTurnstile(request, env, token);
  if (!turnstile.ok) return json(403, { error: turnstile.error });

  const stored = await storePhoto(env, bytes, index);
  if (stored.error) return json(stored.status || 400, { error: stored.error, code: stored.code || 'photo_rejected' });
  return json(200, { ok: true, key: stored.key });
}
