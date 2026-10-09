/* GA4 loader + named conversion events.
   Set GA4_ID to the Measurement ID (G-XXXXXXXXXX) from GA4 Admin → Data streams.
   While it is empty nothing loads and txTrack() is a no-op, so the site is safe to deploy first.
   The gtag script loads on idle or the first interaction so it stays off the critical path.
   Events (mark quote_submit, phone_click, and estimate_submit as key events in GA4 Admin → Events):
     quote_submit         — homepage callback form accepted by /api/quote
     phone_click          — any tel: link tapped (param: link_location)
     estimate_view        — /estimate opened (param: ref)
     estimate_step        — step shown (param: step, ref)
     estimate_photo_added — a photo was added (param: count, ref)
     estimate_submit      — /estimate accepted (param: ref, demo)
     estimate_error       — a step or submit failed (param: code, ref) */
(() => {
  'use strict';
  const GA4_ID = 'G-YJD63RVV4V';
  let started = false;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  window.txTrack = (name, params) => {
    if (!GA4_ID) return;
    gtag('event', name, Object.assign({ page_path: location.pathname }, params || {}));
  };

  if (!GA4_ID) return;

  const load = () => {
    if (started) return;
    started = true;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
    document.head.appendChild(script);
    gtag('js', new Date());
    gtag('config', GA4_ID);
  };

  const arm = () => {
    if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 4000 });
    else setTimeout(load, 1500);
  };
  ['pointerdown', 'keydown'].forEach((eventName) => {
    window.addEventListener(eventName, () => {
      if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 1000 });
      else load();
    }, { once: true, passive: true });
  });
  if (document.readyState === 'complete') arm();
  else window.addEventListener('load', arm, { once: true });

  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href^="tel:"]');
    if (!link) return;
    const section = link.closest('[id]');
    window.txTrack('phone_click', { link_location: section ? section.id : 'page' });
  }, true);
})();
