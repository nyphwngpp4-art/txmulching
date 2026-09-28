/* GA4 loader + named conversion events.
   Set GA4_ID to the Measurement ID (G-XXXXXXXXXX) from GA4 Admin → Data streams.
   While it is empty nothing loads and txTrack() is a no-op, so the site is safe to deploy first.
   Events (mark the first three as key events in GA4 Admin → Events):
     estimate_complete  — instant estimate submitted with name + phone (lead captured)
     quote_submit       — callback form accepted by /api/quote
     phone_click        — any tel: link tapped (param: link_location)
     estimate_start     — step 1 of the instant estimate completed */
(() => {
  'use strict';
  const GA4_ID = '';

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  window.txTrack = (name, params) => {
    if (!GA4_ID) return;
    gtag('event', name, Object.assign({ page_path: location.pathname }, params || {}));
  };

  if (!GA4_ID) return;

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
  document.head.appendChild(s);
  gtag('js', new Date());
  gtag('config', GA4_ID);

  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href^="tel:"]');
    if (!link) return;
    const section = link.closest('[id]');
    window.txTrack('phone_click', { link_location: section ? section.id : 'page' });
  }, true);
})();
