// Worker route: GET /api/public-config
// Returns only values that are safe to put in a browser. The site key is
// public by design; the Turnstile secret never leaves the Worker.

import { json, methodNotAllowed } from './_lib.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return methodNotAllowed('GET');
  return json(200, {
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    // "drive" is the live path. "r2" only when the optional binding exists.
    photos: env.LEAD_PHOTOS ? 'r2' : 'drive'
  });
}
