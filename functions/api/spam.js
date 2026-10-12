// Scores /estimate and callback leads before they are forwarded.
// A high score is stored in D1 as status 'spam' and is not sent to the Sheet.
// A borderline score is still forwarded, with possibleSpam set when the
// Apps Script knows that field.

import { ensureSchema, hasLeadsDb } from './pipeline.js';

// Same prefixes the /estimate page treats as the usual area around Canton.
// Farther Texas zips (Nacogdoches 759, Vidor 776, and the rest of the state)
// are still real jobs. A far or missing ZIP adds a small score and does not
// block a lead on its own.
export const USUAL_ZIP_PREFIXES = new Set(['751', '754', '756', '757', '758']);

const POSSIBLE_SCORE = 4;
const SPAM_SCORE = 8;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

const PITCH_PATTERNS = [
  { id: 'unsubscribe', re: /\bunsubscribe\b/i, weight: 5 },
  { id: 'seo', re: /\bseo\b/i, weight: 5 },
  { id: 'backlinks', re: /\bback-?links?\b/i, weight: 5 },
  { id: 'b2b', re: /\bb2b\b/i, weight: 5 },
  { id: 'phone_agent', re: /\b(?:ai\s+)?phone\s+agents?\b/i, weight: 5 },
  { id: 'ranking', re: /\brankings?\b/i, weight: 3 },
  { id: 'send_files', re: /\bsend\s+(?:me\s+|us\s+|you\s+|the\s+)?files\b/i, weight: 4 },
  { id: 'farm_project', re: /\bfarm\s+project\b/i, weight: 2 }
];

// "Within a month" is a real timeline. Only a price pitch matches here.
const PRICED_PITCH = /\/\s*mo\b|\bper\s+month\b/i;

const URL_IN_TEXT = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]{1,62}\.(?:com|net|org|io|xyz|info|biz|co|us|link|click|site|online|shop|top)\b/i;

function normalizeText(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasUrl(text) {
  if (!text) return false;
  const withoutEmails = text.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, ' ');
  return URL_IN_TEXT.test(withoutEmails);
}

function messageText(payload) {
  return normalizeText([
    payload?.name,
    payload?.address,
    payload?.city,
    payload?.county,
    payload?.description,
    payload?.acreage
  ].filter(Boolean).join('\n'));
}

function last10(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

export function scoreSpam(payload, { duplicate = false } = {}) {
  const reasons = [];
  let score = 0;
  const text = messageText(payload);

  if (hasUrl(text)) {
    score += 4;
    reasons.push('url');
  }
  if (text && PRICED_PITCH.test(text)) {
    score += 5;
    reasons.push('priced_pitch');
  }
  for (const pattern of PITCH_PATTERNS) {
    if (text && pattern.re.test(text)) {
      score += pattern.weight;
      reasons.push(pattern.id);
    }
  }

  const zip = String(payload?.zipcode || '').replace(/\D/g, '');
  if (zip.length < 5) {
    score += 2;
    reasons.push('zip_missing');
  } else if (!USUAL_ZIP_PREFIXES.has(zip.slice(0, 3))) {
    score += 2;
    reasons.push('zip_out_of_area');
  }

  if (!normalizeText(payload?.acreage)) {
    score += 1;
    reasons.push('acreage_missing');
  }

  if (duplicate) {
    score += 3;
    reasons.push('duplicate');
  }

  let verdict = 'ok';
  if (score >= SPAM_SCORE) verdict = 'spam';
  else if (score >= POSSIBLE_SCORE) verdict = 'possible';
  return { score, reasons, verdict };
}

export function applySpam(payload, spam) {
  if (spam.score > 0) {
    payload.spamScore = spam.score;
    payload.spamReasons = spam.reasons;
  }
  if (spam.verdict === 'possible') payload.possibleSpam = 'yes';
  return spam.verdict;
}

export async function recentDuplicate(env, payload, now = Date.now()) {
  if (!hasLeadsDb(env)) return false;
  const email = normalizeText(payload?.email).toLowerCase();
  const phone = last10(payload?.phone);
  if (!email && !phone) return false;
  await ensureSchema(env);
  const since = new Date(now - DUPLICATE_WINDOW_MS).toISOString();
  const { results } = await env.LEADS.prepare(
    `SELECT payload_json FROM leads
     WHERE created_at >= ?
     ORDER BY created_at DESC
     LIMIT 40`
  ).bind(since).all();
  for (const row of results || []) {
    let previous = null;
    try { previous = JSON.parse(row.payload_json); } catch { previous = null; }
    if (!previous) continue;
    if (email && normalizeText(previous.email).toLowerCase() === email) return true;
    if (phone && last10(previous.phone) === phone) return true;
  }
  return false;
}

export async function assessSpam(env, payload) {
  let duplicate = false;
  try {
    duplicate = await recentDuplicate(env, payload);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'spam_duplicate_check_failed',
      error: error?.message || String(error)
    }));
  }
  return scoreSpam(payload, { duplicate });
}
