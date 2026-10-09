// Worker route: GET /api/lead-photo/:requestId/:file?exp=&sig=
// Streams a private R2 object after checking an HMAC signed by PHOTO_LINK_SECRET.

import { readLeadPhoto } from './photos.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method !== 'GET') {
    return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET' } });
  }
  return readLeadPhoto(request, env, params.requestId, params.file);
}
