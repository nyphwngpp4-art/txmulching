import { env, fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sheetSafe, sniffImage, timingError } from '../functions/api/_lib.js';
import { onRequest as quote } from '../functions/api/quote.js';
import { onRequest as quotePhoto } from '../functions/api/quote-photo.js';
import { onRequest as voiceToken } from '../functions/api/voice-token.js';
import { readLeadPhoto } from '../functions/api/photos.js';
import { retryUnforwarded } from '../functions/api/pipeline.js';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

function ctx() {
  const jobs = [];
  return {
    waitUntil(promise) { jobs.push(promise); },
    async drain() { await Promise.all(jobs); }
  };
}

function quoteRequest(body, { ip = '203.0.113.10', headers = {} } = {}) {
  return new Request('https://txmulching.test/api/quote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://txmulching.test',
      Host: 'txmulching.test',
      'cf-connecting-ip': ip,
      ...headers
    },
    body: JSON.stringify(body)
  });
}

const estimateBody = {
  intake: 'estimate',
  elapsedMs: 5000,
  name: 'Jane D',
  phone: '(903) 555-0100',
  email: 'jane@example.com',
  serviceType: 'Forestry Mulching',
  acreage: '3-10 acres',
  density: 'Wall of trees',
  address: '100 County Road',
  city: 'Tyler',
  county: 'Smith',
  zipcode: '75701',
  timeline: 'Within a month',
  callbackWindow: 'Morning',
  ref: 'p07'
};

describe('timing and sheet safety', () => {
  it('rejects a 1s elapsed time and accepts 5s and 3h', () => {
    expect(timingError({ elapsedMs: 1000 })).toMatch(/wait a moment/i);
    expect(timingError({ elapsedMs: 5000 })).toBeNull();
    expect(timingError({ elapsedMs: 10_800_000 })).toBeNull();
    expect(timingError({ elapsedMs: -50 })).toMatch(/wait a moment/i);
  });

  it('prefixes formula-like values once', () => {
    expect(sheetSafe('=1+1')).toBe("'=1+1");
    expect(sheetSafe("'+already")).toBe("'+already");
    expect(sheetSafe('+903')).toBe("'+903");
    expect(sheetSafe('Jane')).toBe('Jane');
  });

  it('recognizes jpeg, png and webp, and rejects a renamed executable', () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))?.ext).toBe('jpg');
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))?.ext).toBe('png');
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImage(webp)?.ext).toBe('webp');
    const exe = new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImage(exe)).toBeNull();
  });
});

describe('POST /api/quote', () => {
  it('returns 503 when nothing can store the lead', async () => {
    const response = await quote({
      request: quoteRequest({ intake: 'callback', elapsedMs: 5000, name: 'Ada', phone: '9035550100' }, { ip: '203.0.113.20' }),
      env: {},
      ctx: ctx()
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/833-3965/);
  });

  it('accepts a honeypot without storing a lead', async () => {
    const response = await quote({
      request: quoteRequest({ ...estimateBody, website: 'https://spam.test' }, { ip: '203.0.113.21' }),
      env,
      ctx: ctx()
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.requestId).toBeUndefined();
    const row = await env.LEADS.prepare('SELECT COUNT(*) AS n FROM leads').first().catch(() => ({ n: 0 }));
    expect(Number(row?.n || 0)).toBe(0);
  });

  it('rejects a missing estimate phone and a bad service', async () => {
    const missing = await quote({
      request: quoteRequest({ ...estimateBody, phone: '' }, { ip: '203.0.113.22' }),
      env,
      ctx: ctx()
    });
    expect(missing.status).toBe(400);
    const bad = await quote({
      request: quoteRequest({ ...estimateBody, serviceType: 'Roofing' }, { ip: '203.0.113.23' }),
      env,
      ctx: ctx()
    });
    expect(bad.status).toBe(400);
  });

  it('keeps a callback that has email and no phone', async () => {
    fetchMock.get('https://script.test').intercept({ path: '/exec', method: 'POST' }).reply(200, { ok: true });
    const background = ctx();
    const response = await quote({
      request: quoteRequest({
        intake: 'callback',
        elapsedMs: 5000,
        name: 'Ada',
        email: 'ada@example.com',
        serviceType: 'Land Clearing'
      }, { ip: '203.0.113.24' }),
      env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
      ctx: background
    });
    expect(response.status).toBe(200);
    await background.drain();
  });

  it('stores a demo lead away from the owner script', async () => {
    const response = await quote({
      request: quoteRequest({ ...estimateBody, demo: '1', name: '=1+1' }, { ip: '203.0.113.25' }),
      env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
      ctx: ctx()
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.demo).toBe(true);
    const demo = await env.LEADS.prepare('SELECT payload_json FROM demo_leads WHERE request_id = ?').bind(body.requestId).first();
    expect(demo?.payload_json).toContain('=1+1');
    const real = await env.LEADS.prepare('SELECT request_id FROM leads WHERE request_id = ?').bind(body.requestId).first();
    expect(real).toBeNull();
  });

  it('returns 200 when the script times out and the cron forwards later', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (String(url).includes('script.test')) {
        return new Promise((_resolve, reject) => {
          const fail = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          if (init?.signal?.aborted) fail();
          else init?.signal?.addEventListener('abort', fail, { once: true });
        });
      }
      return original(input, init);
    };
    const background = ctx();
    try {
      const response = await quote({
        request: quoteRequest(estimateBody, { ip: '203.0.113.26' }),
        env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec', FORWARD_TIMEOUT_MS: '30' },
        ctx: background
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      await background.drain();
      const row = await env.LEADS.prepare('SELECT forwarded_at, attempts, last_error FROM leads WHERE request_id = ?').bind(body.requestId).first();
      expect(row.forwarded_at).toBeNull();
      expect(Number(row.attempts)).toBeGreaterThan(0);
      expect(row.last_error).toMatch(/timeout/i);

      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (String(url).includes('script.test')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return original(input, init);
      };
      await env.LEADS.prepare('UPDATE leads SET last_attempt_at = ? WHERE request_id = ?').bind('2000-01-01T00:00:00.000Z', body.requestId).run();
      const retried = await retryUnforwarded({ ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' });
      expect(retried.retried).toBeGreaterThan(0);
      const after = await env.LEADS.prepare('SELECT forwarded_at FROM leads WHERE request_id = ?').bind(body.requestId).first();
      expect(after.forwarded_at).toBeTruthy();
    } finally {
      globalThis.fetch = original;
    }
  });
});

function tinyJpegBase64() {
  const jpeg = new Uint8Array(16);
  jpeg[0] = 0xff;
  jpeg[1] = 0xd8;
  jpeg[2] = 0xff;
  let binary = '';
  jpeg.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

describe('photos and voice', () => {
  it('forwards inline photos to Apps Script and leaves the bytes out of D1', async () => {
    const data = tinyJpegBase64();
    let forwarded = null;
    const original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      forwarded = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    try {
      const wait = ctx();
      const response = await quote({
        request: quoteRequest({ ...estimateBody, photos: [{ data }] }, { ip: '203.0.113.70' }),
        env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
        ctx: wait
      });
      expect(response.status).toBe(200);
      await wait.drain();
      expect(forwarded.photos[0].contentType).toBe('image/jpeg');
      expect(forwarded.photos[0].data).toBe(data);
      const body = await response.json();
      const row = await env.LEADS.prepare(
        'SELECT payload_json FROM leads WHERE request_id = ?'
      ).bind(body.requestId).first();
      expect(JSON.parse(row.payload_json).photos).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejects a photo that is not an image', async () => {
    const exe = new Uint8Array(16);
    exe[0] = 0x4d;
    exe[1] = 0x5a;
    let binary = '';
    exe.forEach((byte) => { binary += String.fromCharCode(byte); });
    const response = await quote({
      request: quoteRequest({ ...estimateBody, demo: '1', photos: [{ data: btoa(binary) }] }, { ip: '203.0.113.71' }),
      env,
      ctx: ctx()
    });
    expect(response.status).toBe(400);
    await response.json();
  });

  it('rejects a fake jpeg and serves a signed photo', async () => {
    const rejected = await quotePhoto({
      request: new Request('https://txmulching.test/api/quote-photo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Origin: 'https://txmulching.test',
          Host: 'txmulching.test',
          'cf-connecting-ip': '203.0.113.40'
        },
        body: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0])
      }),
      env
    });
    expect(rejected.status).toBe(415);

    const jpeg = new Uint8Array(32);
    jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff; jpeg[3] = 0xd9;
    const uploaded = await quotePhoto({
      request: new Request('https://txmulching.test/api/quote-photo?n=1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Origin: 'https://txmulching.test',
          Host: 'txmulching.test',
          'cf-connecting-ip': '203.0.113.41'
        },
        body: jpeg
      }),
      env
    });
    expect(uploaded.status).toBe(200);
    const saved = await uploaded.json();
    expect(saved.key).toMatch(/^drafts\//);

    const requestId = crypto.randomUUID();
    const promoted = await quote({
      request: quoteRequest({ ...estimateBody, demo: '1', photoKeys: [saved.key] }, { ip: '203.0.113.42' }),
      env: { ...env, PHOTO_LINK_SECRET: 'test-photo-secret' },
      ctx: ctx()
    });
    const lead = await promoted.json();
    expect(promoted.status).toBe(200);
    const stored = JSON.parse((await env.LEADS.prepare('SELECT payload_json FROM demo_leads WHERE request_id = ?').bind(lead.requestId).first()).payload_json);
    expect(stored.photoLinks?.[0] || '').toContain(`/api/lead-photo/${lead.requestId}/`);

    const good = new URL(stored.photoLinks[0]);
    const ok = await readLeadPhoto(
      new Request(good),
      { ...env, PHOTO_LINK_SECRET: 'test-photo-secret' },
      lead.requestId,
      good.pathname.split('/').pop()
    );
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();

    good.searchParams.set('sig', 'tampered');
    const denied = await readLeadPhoto(
      new Request(good),
      { ...env, PHOTO_LINK_SECRET: 'test-photo-secret' },
      requestId,
      good.pathname.split('/').pop()
    );
    expect(denied.status).toBe(403);
    await denied.arrayBuffer().catch(() => {});
  });

  it('refuses a voice token that is not from the same origin', async () => {
    const spoofed = await voiceToken({
      request: new Request('https://txmulching.test/api/voice-token', {
        method: 'POST',
        headers: {
          Origin: 'https://txmulching.test',
          Host: 'txmulching.test',
          'Content-Type': 'application/json',
          'cf-connecting-ip': '203.0.113.50'
        },
        body: '{}'
      }),
      env: { ...env, XAI_API_KEY: 'test' }
    });
    expect(spoofed.status).toBe(403);

    const browser = await voiceToken({
      request: new Request('https://txmulching.test/api/voice-token', {
        method: 'POST',
        headers: {
          Origin: 'https://txmulching.test',
          Host: 'txmulching.test',
          'Sec-Fetch-Site': 'same-origin',
          'Content-Type': 'application/json',
          'cf-connecting-ip': '203.0.113.51'
        },
        body: '{}'
      }),
      env
    });
    expect(browser.status).toBe(503);
  });
});
