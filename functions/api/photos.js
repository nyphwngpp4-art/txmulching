// Photo bytes live in a private R2 bucket when LEAD_PHOTOS is bound.
// Without the binding, uploads fail soft and the rest of the quote still sends.

import { photoLinkIsValid, signPhotoLink, sniffImage } from './_lib.js';

const MAX_BYTES = 5_000_000;
const LINK_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const LINK_MAX_MS = 90 * 24 * 60 * 60 * 1000;

export async function storePhoto(env, bytes, hintedIndex) {
  if (!env.LEAD_PHOTOS) {
    return { error: 'Photo upload is not available yet.', code: 'photos_unconfigured', status: 503 };
  }
  if (bytes.byteLength > MAX_BYTES) {
    return { error: 'Each photo must be 5 MB or smaller.', status: 413 };
  }
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { error: 'Upload a JPEG, PNG, or WebP photo.', status: 415 };
  const n = Math.min(6, Math.max(1, Number(hintedIndex) || 1));
  const key = `drafts/${crypto.randomUUID()}/${n}.${sniffed.ext}`;
  await env.LEAD_PHOTOS.put(key, bytes, {
    httpMetadata: { contentType: sniffed.type }
  });
  return { key, contentType: sniffed.type };
}

export async function promotePhotos(env, requestId, keys, files) {
  const kept = [];
  const names = [];
  if (env.LEAD_PHOTOS && Array.isArray(keys)) {
    let n = 1;
    for (const key of keys) {
      const object = await env.LEAD_PHOTOS.get(key);
      if (!object) continue;
      const ext = (key.split('.').pop() || 'jpg').toLowerCase();
      const file = `${n}.${ext}`;
      const dest = `leads/${requestId}/${file}`;
      const bytes = await object.arrayBuffer();
      await env.LEAD_PHOTOS.put(dest, bytes, { httpMetadata: object.httpMetadata });
      await env.LEAD_PHOTOS.delete(key);
      kept.push(dest);
      names.push(file);
      n += 1;
    }
  }
  if (env.LEAD_PHOTOS && Array.isArray(files)) {
    let n = names.length + 1;
    for (const file of files) {
      if (n > 6) break;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) continue;
      const sniffed = sniffImage(bytes);
      if (!sniffed) continue;
      const name = `${n}.${sniffed.ext}`;
      const dest = `leads/${requestId}/${name}`;
      await env.LEAD_PHOTOS.put(dest, bytes, { httpMetadata: { contentType: sniffed.type } });
      kept.push(dest);
      names.push(name);
      n += 1;
    }
  }
  return { keys: kept, files: names };
}

export async function photoUrls(request, env, requestId, files) {
  if (!env.PHOTO_LINK_SECRET || !files?.length) return [];
  const origin = new URL(request.url).origin;
  const exp = Date.now() + LINK_TTL_MS;
  const links = [];
  for (const file of files) {
    const sig = await signPhotoLink(env.PHOTO_LINK_SECRET, requestId, file, exp);
    links.push(`${origin}/api/lead-photo/${requestId}/${file}?exp=${exp}&sig=${sig}`);
  }
  return links;
}

const FILE_NAME = /^[1-6]\.(jpg|png|webp)$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function readLeadPhoto(request, env, requestId, file) {
  if (!REQUEST_ID.test(requestId) || !FILE_NAME.test(file)) {
    return new Response('Not found.', { status: 404 });
  }
  if (!env.PHOTO_LINK_SECRET || !env.LEAD_PHOTOS) {
    return new Response('Not found.', { status: 404 });
  }
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig') || '';
  const now = Date.now();
  if (!Number.isFinite(exp) || exp < now || exp > now + LINK_MAX_MS) {
    return new Response('This photo link has expired.', { status: 403 });
  }
  if (!await photoLinkIsValid(env.PHOTO_LINK_SECRET, requestId, file, exp, sig)) {
    return new Response('This photo link is not valid.', { status: 403 });
  }
  const object = await env.LEAD_PHOTOS.get(`leads/${requestId}/${file}`);
  if (!object) return new Response('Not found.', { status: 404 });
  const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || type,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
