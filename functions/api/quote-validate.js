import { clean, normalizePhotoKeys } from './_lib.js';
import { normalizeInlinePhotos } from './photos.js';

export const SERVICES = new Set([
  '',
  'Forestry Mulching',
  'Land Clearing',
  'Brush Removal',
  'Fence-Line Clearing',
  'Trail Cutting',
  'Lot Clearing',
  'Right-of-Way Clearing',
  'Pond & Access Cleanup',
  'Not Sure / Multiple'
]);

export const ACREAGE = new Set([
  'Under 1 acre',
  '1-3 acres',
  '3-10 acres',
  '10-25 acres',
  '25+ acres'
]);

export const DENSITY = new Set([
  'Can walk through',
  'Can drive through',
  'Wall of trees'
]);

export const TIMELINE = new Set([
  'ASAP',
  'Within a month',
  '1-3 months',
  'Just planning'
]);

export const CALLBACK_WINDOW = new Set(['Morning', 'Afternoon', 'Evening']);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP = /^\d{5}(?:-\d{4})?$/;

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function validateQuote(data, { demo = false } = {}) {
  const intake = data?.intake === 'estimate' ? 'estimate' : 'callback';
  const photos = normalizePhotoKeys(data?.photoKeys);
  if (photos.error) return { error: photos.error };
  const inline = normalizeInlinePhotos(data?.photos);
  if (inline.error) return { error: inline.error };

  const payload = {
    intake,
    name: clean(data?.name, 80),
    phone: clean(data?.phone, 30),
    email: clean(data?.email, 120).toLowerCase(),
    zipcode: clean(data?.zipcode, 10),
    acreage: clean(data?.acreage, 40),
    serviceType: clean(data?.serviceType, 80),
    description: clean(data?.description, 1500),
    address: clean(data?.address, 160),
    city: clean(data?.city, 80),
    county: clean(data?.county, 80),
    density: clean(data?.density, 40),
    timeline: clean(data?.timeline, 40),
    callbackWindow: clean(data?.callbackWindow, 40),
    // Accepted so a future owner-approved field can be stored. The page does
    // not render a budget question unless SHOW_BUDGET is turned on.
    budget: clean(data?.budget, 80),
    ref: clean(data?.ref, 40),
    utmSource: clean(data?.utm_source || data?.utmSource, 80),
    utmMedium: clean(data?.utm_medium || data?.utmMedium, 80),
    utmCampaign: clean(data?.utm_campaign || data?.utmCampaign, 80),
    utmContent: clean(data?.utm_content || data?.utmContent, 80),
    utmTerm: clean(data?.utm_term || data?.utmTerm, 80),
    photoKeys: photos.keys,
    photos: inline.photos,
    source: intake === 'estimate' ? 'TX Mulching website /estimate' : 'TX Mulching website',
    demo,
    submittedAt: new Date().toISOString(),
    requestId: crypto.randomUUID()
  };

  if (!payload.name) return { error: 'Name is required.' };
  if (payload.email && !EMAIL.test(payload.email)) return { error: 'Enter a valid email address.' };
  if (payload.phone && digits(payload.phone).length < 10) return { error: 'Enter a valid phone number.' };
  if (payload.zipcode && !ZIP.test(payload.zipcode)) return { error: 'Enter a valid ZIP code.' };
  if (payload.serviceType && !SERVICES.has(payload.serviceType)) return { error: 'Choose a service from the list.' };

  if (intake === 'estimate') {
    if (!payload.phone) return { error: 'A mobile phone number is required.' };
    if (!SERVICES.has(payload.serviceType) || !payload.serviceType) return { error: 'Choose a service.' };
    if (!ACREAGE.has(payload.acreage)) return { error: 'Choose an acreage range.' };
    if (!DENSITY.has(payload.density)) return { error: 'Choose how thick the brush is.' };
    if (!payload.address) return { error: 'Enter the street address or nearest road.' };
    if (!payload.city) return { error: 'Enter the city.' };
    if (!TIMELINE.has(payload.timeline)) return { error: 'Choose a timeline.' };
    if (!CALLBACK_WINDOW.has(payload.callbackWindow)) return { error: 'Choose a callback window.' };
  } else if (!payload.phone && !payload.email) {
    return { error: 'A phone number or email address is required.' };
  }

  if (!payload.description && intake === 'estimate') {
    payload.description = [
      payload.density && `Brush: ${payload.density}`,
      payload.timeline && `Timeline: ${payload.timeline}`,
      payload.callbackWindow && `Callback: ${payload.callbackWindow}`,
      payload.address && `Address: ${payload.address}`,
      payload.city && `City: ${payload.city}`,
      payload.county && `County: ${payload.county}`
    ].filter(Boolean).join('. ').slice(0, 1500);
  }

  return { payload };
}
