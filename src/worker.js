// Worker entry: routes /api/* to the Pages-style function handlers and
// serves everything else from the static assets binding.

import { onRequest as chat } from '../functions/api/chat.js';
import { onRequest as quote } from '../functions/api/quote.js';
import { onRequest as voiceToken } from '../functions/api/voice-token.js';

const API_ROUTES = new Map([
  ['/api/chat', chat],
  ['/api/quote', quote],
  ['/api/voice-token', voiceToken]
]);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      const handler = API_ROUTES.get(pathname.replace(/\/+$/, ''));
      if (!handler) {
        return new Response(JSON.stringify({ error: 'Not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
      return handler({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
    }
    return env.ASSETS.fetch(request);
  }
};
