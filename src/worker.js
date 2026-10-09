// Worker entry: routes /api/* to the handlers, adds byte-range support to
// /video/*, retries unforwarded leads on a cron, and serves everything else
// from the static assets binding.

import { onRequest as chat } from '../functions/api/chat.js';
import { onRequest as quote } from '../functions/api/quote.js';
import { onRequest as voiceToken } from '../functions/api/voice-token.js';
import { onRequest as quotePhoto } from '../functions/api/quote-photo.js';
import { onRequest as publicConfig } from '../functions/api/public-config.js';
import { onRequest as demoLeads } from '../functions/api/demo-leads.js';
import { onRequest as leadPhoto } from '../functions/api/lead-photo.js';
import { retryUnforwarded } from '../functions/api/pipeline.js';

const API_ROUTES = new Map([
  ['/api/chat', chat],
  ['/api/quote', quote],
  ['/api/voice-token', voiceToken],
  ['/api/quote-photo', quotePhoto],
  ['/api/public-config', publicConfig],
  ['/api/demo-leads', demoLeads]
]);

// Static assets answer every Range request with 200 and the whole file, and
// Safari/iOS will not play video from a server that does that. Video comes
// through here so a Range request gets a proper 206 slice.
async function serveVideo(request, env) {
  const range = request.headers.get('Range');
  const headers = new Headers(request.headers);
  headers.delete('Range');
  const asset = await env.ASSETS.fetch(new Request(request.url, { method: request.method, headers }));

  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  const ifRange = request.headers.get('If-Range');
  if (asset.status !== 200 || request.method !== 'GET' || !match || (!match[1] && !match[2])
      || (ifRange && ifRange !== asset.headers.get('ETag'))) {
    const response = new Response(asset.body, asset);
    response.headers.set('Accept-Ranges', 'bytes');
    return response;
  }

  const body = await asset.arrayBuffer();
  const size = body.byteLength;
  // "bytes=-N" asks for the last N bytes; "bytes=N-" runs to the end.
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const response = new Response(body.slice(start, end + 1), { status: 206, headers: asset.headers });
  response.headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  response.headers.set('Accept-Ranges', 'bytes');
  return response;
}

function leadPhotoParams(pathname) {
  const match = /^\/api\/lead-photo\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  return { requestId: decodeURIComponent(match[1]), file: decodeURIComponent(match[2]) };
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      const normalized = pathname.replace(/\/+$/, '') || '/';
      const photo = leadPhotoParams(normalized);
      if (photo) return leadPhoto({ request, env, ctx, params: photo });
      const handler = API_ROUTES.get(normalized);
      if (!handler) {
        return new Response(JSON.stringify({ error: 'Not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
      return handler({ request, env, ctx });
    }
    if (pathname.startsWith('/video/')) return serveVideo(request, env);
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(retryUnforwarded(env));
  }
};
