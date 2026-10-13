import { env, fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { enforceBodyLimit, sheetSafe, sniffImage, submittedTooFast, timingError, verifyTurnstile } from '../functions/api/_lib.js';
import { scoreSpam, spamDisposition } from '../functions/api/spam.js';
import { onRequest as quote } from '../functions/api/quote.js';
import { onRequest as quotePhoto } from '../functions/api/quote-photo.js';
import { onRequest as voiceToken } from '../functions/api/voice-token.js';
import { onRequest as chat } from '../functions/api/chat.js';
import { onRequest as demoLeads } from '../functions/api/demo-leads.js';
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
    expect(submittedTooFast({ elapsedMs: 1000 })).toBe(true);
    expect(timingError({ elapsedMs: 5000 })).toBeNull();
    expect(submittedTooFast({ elapsedMs: 5000 })).toBe(false);
    expect(timingError({ elapsedMs: 10_800_000 })).toBeNull();
    expect(timingError({ elapsedMs: -50 })).toMatch(/wait a moment/i);
    expect(submittedTooFast({})).toBe(false);
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

describe('spam score', () => {
  it('ignores "within a month" and flags a price pitch', () => {
    const timeline = scoreSpam({
      description: 'Brush: Wall of trees. Timeline: Within a month. Callback: Morning.',
      zipcode: '75701',
      acreage: '3-10 acres'
    });
    expect(timeline.verdict).toBe('ok');
    expect(timeline.reasons).not.toContain('priced_pitch');

    const pitch = scoreSpam({
      description: 'SEO plans from $199/mo',
      zipcode: '75701',
      acreage: '1-3 acres'
    });
    expect(pitch.verdict).toBe('spam');
    expect(pitch.reasons).toEqual(expect.arrayContaining(['seo', 'priced_pitch']));

    const far = scoreSpam({
      description: 'Clear the back pasture',
      zipcode: '75961',
      acreage: '3-10 acres'
    });
    expect(far.verdict).toBe('ok');
    expect(far.reasons).toEqual(['zip_out_of_area']);

    const phish = scoreSpam({
      description: 'farm project, please send the files',
      zipcode: '10001',
      acreage: ''
    });
    expect(phish.verdict).toBe('spam');
    expect(spamDisposition(pitch)).toBe('spam');
    expect(spamDisposition({
      verdict: 'spam',
      reasons: ['farm_project', 'zip_out_of_area', 'acreage_missing', 'duplicate']
    })).toBe('review');
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

  it('stores a honeypot for review and does not pretend it was sent', async () => {
    const response = await quote({
      request: quoteRequest({ ...estimateBody, txm_hp: 'filled-by-accident' }, { ip: '203.0.113.21' }),
      env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
      ctx: ctx()
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBeUndefined();
    expect(body.requestId).toBeUndefined();
    expect(body.error).toMatch(/could not send/i);
    const row = await env.LEADS.prepare(
      `SELECT status, forwarded_at FROM leads WHERE payload_json LIKE '%"honeypot":"yes"%'`
    ).first();
    expect(row.status).toBe('honeypot');
    expect(row.forwarded_at).toBeNull();

    const legacy = await quote({
      request: quoteRequest({ ...estimateBody, website: 'https://spam.test', email: 'legacy-hp@example.com' }, { ip: '203.0.113.21' }),
      env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
      ctx: ctx()
    });
    expect(legacy.status).toBe(400);
  });

  it('rejects a budget value while the public form leaves that field off', async () => {
    const response = await quote({
      request: quoteRequest({ ...estimateBody, demo: '1', budget: '5000' }, { ip: '203.0.113.94' }),
      env,
      ctx: ctx()
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/not accepted/i);
  });

  it('redirects a no-JS error to a fixed code', async () => {
    const form = new FormData();
    form.set('intake', 'estimate');
    form.set('name', 'Ada');
    const response = await quote({
      request: new Request('https://txmulching.test/api/quote', {
        method: 'POST',
        headers: {
          Origin: 'https://txmulching.test',
          Host: 'txmulching.test',
          'cf-connecting-ip': '203.0.113.93'
        },
        body: form
      }),
      env,
      ctx: ctx()
    });
    expect(response.status).toBe(303);
    const location = response.headers.get('Location') || '';
    expect(location).toContain('error=invalid');
    expect(location).not.toMatch(/required/i);
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
});

describe('lead spam protection', () => {
  it('drops a too-fast submit without storing it', async () => {
    const response = await quote({
      request: quoteRequest({ ...estimateBody, name: 'FAST-DROP-NAME', elapsedMs: 1000 }, { ip: '203.0.113.80' }),
      env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
      ctx: ctx()
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.requestId).toBeUndefined();
    const row = await env.LEADS.prepare(
      `SELECT request_id FROM leads WHERE payload_json LIKE ?`
    ).bind('%FAST-DROP-NAME%').all().catch(() => ({ results: [] }));
    expect(row.results || []).toHaveLength(0);
  });

  it('stores a sales pitch as spam and does not forward it', async () => {
    const response = await quote({
      request: quoteRequest({
        ...estimateBody,
        name: 'SEO Growth',
        email: 'pitch@example.com',
        description: 'SEO backlinks $199/mo. Unsubscribe http://rank.example'
      }, { ip: '203.0.113.81' }),
      env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
      ctx: ctx()
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.requestId).toBeTruthy();
    const row = await env.LEADS.prepare(
      'SELECT status, forwarded_at, payload_json FROM leads WHERE request_id = ?'
    ).bind(body.requestId).first();
    expect(row.status).toBe('spam');
    expect(row.forwarded_at).toBeNull();
    expect(row.payload_json).toContain('priced_pitch');

    await env.LEADS.prepare(
      `UPDATE leads SET forwarded_at = '2000-01-01T00:00:00.000Z' WHERE request_id != ? AND forwarded_at IS NULL`
    ).bind(body.requestId).run();
    const retried = await retryUnforwarded({ ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' });
    expect(retried.retried).toBe(0);
    const after = await env.LEADS.prepare(
      'SELECT forwarded_at FROM leads WHERE request_id = ?'
    ).bind(body.requestId).first();
    expect(after.forwarded_at).toBeNull();
  });

  it('forwards a single link as possible spam and still forwards a far ZIP', async () => {
    let forwarded = null;
    const original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      forwarded = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    try {
      const wait = ctx();
      const flagged = await quote({
        request: quoteRequest({
          ...estimateBody,
          email: 'link-only@example.com',
          description: 'Brush photos: https://photos.example.com/lot'
        }, { ip: '203.0.113.82' }),
        env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
        ctx: wait
      });
      expect(flagged.status).toBe(200);
      await wait.drain();
      expect(forwarded.possibleSpam).toBe('yes');
      expect(forwarded.spamReasons).toContain('url');
      const flaggedBody = await flagged.json();
      const flaggedRow = await env.LEADS.prepare(
        'SELECT status FROM leads WHERE request_id = ?'
      ).bind(flaggedBody.requestId).first();
      expect(flaggedRow.status).toBe('possible');

      forwarded = null;
      const farWait = ctx();
      const far = await quote({
        request: quoteRequest({
          ...estimateBody,
          email: 'nacogdoches@example.com',
          phone: '(903) 555-0177',
          zipcode: '75961'
        }, { ip: '203.0.113.83' }),
        env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
        ctx: farWait
      });
      expect(far.status).toBe(200);
      await farWait.drain();
      expect(forwarded.possibleSpam).toBeUndefined();
      expect(forwarded.zipcode).toBe('75961');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('treats a second SEO pitch within 10 minutes as spam', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    try {
      const firstWait = ctx();
      const first = await quote({
        request: quoteRequest({
          ...estimateBody,
          name: 'Sam',
          email: 'dup-seo@example.com',
          phone: '(903) 555-0199',
          description: 'We do SEO for local businesses'
        }, { ip: '203.0.113.84' }),
        env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
        ctx: firstWait
      });
      expect(first.status).toBe(200);
      await firstWait.drain();
      expect(calls).toBe(1);

      const second = await quote({
        request: quoteRequest({
          ...estimateBody,
          name: 'Sam',
          email: 'dup-seo@example.com',
          phone: '9035550199',
          description: 'We do SEO for local businesses'
        }, { ip: '203.0.113.85' }),
        env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
        ctx: ctx()
      });
      expect(second.status).toBe(200);
      expect(calls).toBe(1);
      const body = await second.json();
      const row = await env.LEADS.prepare(
        'SELECT status, payload_json FROM leads WHERE request_id = ?'
      ).bind(body.requestId).first();
      expect(row.status).toBe('spam');
      expect(row.payload_json).toContain('duplicate');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('forwards a high score that is not an obvious pitch', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    let last = null;
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      last = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const body = {
      intake: 'callback',
      elapsedMs: 5000,
      name: 'Sam',
      email: 'farm-review@example.com',
      phone: '(903) 555-0166',
      description: 'farm project on the back acre',
      zipcode: '10001'
    };
    try {
      const firstWait = ctx();
      const first = await quote({
        request: quoteRequest(body, { ip: '203.0.113.96' }),
        env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
        ctx: firstWait
      });
      expect(first.status).toBe(200);
      await firstWait.drain();
      expect(calls).toBe(1);

      const secondWait = ctx();
      const second = await quote({
        request: quoteRequest(body, { ip: '203.0.113.97' }),
        env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
        ctx: secondWait
      });
      expect(second.status).toBe(200);
      await secondWait.drain();
      expect(calls).toBe(2);
      expect(last.needsReview).toBe('yes');
      expect(last.possibleSpam).toBe('yes');
      const saved = await second.json();
      const row = await env.LEADS.prepare(
        'SELECT status FROM leads WHERE request_id = ?'
      ).bind(saved.requestId).first();
      expect(row.status).toBe('possible');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('keeps a demo sales pitch off the owner script', async () => {
    const response = await quote({
      request: quoteRequest({
        ...estimateBody,
        demo: '1',
        ref: 'p07',
        description: 'SEO $199/mo unsubscribe https://spam.example'
      }, { ip: '203.0.113.86' }),
      env: { ...env, GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
      ctx: ctx()
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.demo).toBe(true);
    const real = await env.LEADS.prepare(
      'SELECT request_id FROM leads WHERE request_id = ?'
    ).bind(body.requestId).first();
    expect(real).toBeNull();
    const demo = await env.LEADS.prepare(
      'SELECT payload_json FROM demo_leads WHERE request_id = ?'
    ).bind(body.requestId).first();
    expect(demo?.payload_json).toContain('p07');
  });

  it('skips Turnstile until both keys exist and checks siteverify when they do', async () => {
    const skipped = await verifyTurnstile(
      new Request('https://txmulching.test/api/quote'),
      { TURNSTILE_SECRET_KEY: 'secret-only' },
      ''
    );
    expect(skipped.skipped).toBe(true);

    const siteOnly = await quote({
      request: quoteRequest({ ...estimateBody, demo: '1', email: 'turnstile-site-only@example.com' }, { ip: '203.0.113.87' }),
      env: { ...env, TURNSTILE_SITE_KEY: 'site-only', GOOGLE_SCRIPT_URL: 'https://script.test/exec' },
      ctx: ctx()
    });
    expect(siteOnly.status).toBe(200);
    expect((await siteOnly.json()).demo).toBe(true);

    fetchMock
      .get('https://challenges.cloudflare.com')
      .intercept({ path: '/turnstile/v0/siteverify', method: 'POST' })
      .reply(200, { success: false });
    const blocked = await quote({
      request: quoteRequest({
        ...estimateBody,
        email: 'turnstile-blocked@example.com',
        'cf-turnstile-response': 'bad-token'
      }, { ip: '203.0.113.88' }),
      env: { ...env, TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' },
      ctx: ctx()
    });
    expect(blocked.status).toBe(403);

    fetchMock
      .get('https://challenges.cloudflare.com')
      .intercept({ path: '/turnstile/v0/siteverify', method: 'POST' })
      .reply(200, { success: true });
    const passed = await quote({
      request: quoteRequest({
        ...estimateBody,
        demo: '1',
        ref: 'widget',
        email: 'turnstile-ok@example.com',
        'cf-turnstile-response': 'ok-token'
      }, { ip: '203.0.113.89' }),
      env: {
        ...env,
        TURNSTILE_SITE_KEY: 'site',
        TURNSTILE_SECRET: 'legacy-secret-name',
        GOOGLE_SCRIPT_URL: 'https://script.test/exec'
      },
      ctx: ctx()
    });
    expect(passed.status).toBe(200);
    expect((await passed.json()).demo).toBe(true);
  });
});

describe('voice', () => {
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
      env: { ...env, XAI_API_KEY: 'test', TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' }
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
      env: { ...env, XAI_API_KEY: 'test-key' }
    });
    expect(browser.status).toBe(503);
  });
});

describe('chat and demo leads', () => {
  it('refuses chat until both Turnstile keys exist', async () => {
    const response = await chat({
      request: new Request('https://txmulching.test/api/chat', {
        method: 'POST',
        headers: {
          Origin: 'https://txmulching.test',
          Host: 'txmulching.test',
          'Content-Type': 'application/json',
          'cf-connecting-ip': '203.0.113.61'
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })
      }),
      env: { ...env, XAI_API_KEY: 'test-key' }
    });
    expect(response.status).toBe(503);
  });

  it('does not return demo leads for DEMO_STUB or a localhost Host', async () => {
    const open = await demoLeads({
      request: new Request('https://txmulching.test/api/demo-leads', {
        headers: { Host: 'localhost' }
      }),
      env: { ...env, DEMO_STUB: '1' }
    });
    expect(open.status).toBe(404);

    const wrong = await demoLeads({
      request: new Request('https://txmulching.test/api/demo-leads', {
        headers: { Host: 'localhost', 'X-Demo-Leads-Secret': 'nope' }
      }),
      env: { ...env, DEMO_STUB: '1', DEMO_LEADS_SECRET: 'local-secret' }
    });
    expect(wrong.status).toBe(404);

    const allowed = await demoLeads({
      request: new Request('https://txmulching.test/api/demo-leads', {
        headers: { Host: 'evil.example', 'X-Demo-Leads-Secret': 'local-secret' }
      }),
      env: { ...env, DEMO_LEADS_SECRET: 'local-secret' }
    });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).ok).toBe(true);
  });
});

describe('body limit', () => {
  it('rejects a body that has no Content-Length once it passes the cap', async () => {
    const bytes = new Uint8Array(120);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    });
    const request = new Request('https://txmulching.test/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half'
    });
    const limited = await enforceBodyLimit(request, 100);
    expect(limited.tooLarge).toBe(true);
  });
});
