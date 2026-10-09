(() => {
  'use strict';

  const menuButton = document.getElementById('menu-button');
  const navigation = document.getElementById('primary-navigation');

  const setMenuState = (open) => {
    if (!menuButton || !navigation) return;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.querySelector('.sr-only').textContent = open ? 'Close navigation menu' : 'Open navigation menu';
    navigation.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
  };

  menuButton?.addEventListener('click', () => setMenuState(menuButton.getAttribute('aria-expanded') !== 'true'));
  navigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenuState(false)));
  document.addEventListener('click', (event) => {
    if (!navigation?.classList.contains('is-open')) return;
    if (!navigation.contains(event.target) && !menuButton?.contains(event.target)) setMenuState(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) setMenuState(false);
  });

  document.querySelectorAll('.before-after').forEach((card) => {
    card.addEventListener('click', () => {
      const revealed = card.classList.toggle('is-revealed');
      card.setAttribute('aria-pressed', String(revealed));
    });
  });

  // Hero: the still image is the page's first paint. The video loads after the
  // page does, fades in only once it is actually playing, and is skipped for
  // reduced-motion and data-saver visitors.
  const video = document.querySelector('.hero-media video');
  const videoToggle = document.getElementById('hero-video-toggle');
  const connection = navigator.connection;
  const slowConnection = connection?.saveData === true || (connection?.effectiveType && connection.effectiveType !== '4g');
  const openedOnAHash = Boolean(location.hash);
  const skipVideo = window.matchMedia('(prefers-reduced-motion: reduce)').matches || slowConnection || openedOnAHash;
  if (video && !skipVideo) {
    const startVideo = () => {
      video.src = window.matchMedia('(orientation: landscape)').matches ? video.dataset.landscape : video.dataset.portrait;
      video.muted = true;
      video.addEventListener('playing', () => {
        video.classList.add('is-playing');
        if (videoToggle) videoToggle.hidden = false;
      }, { once: true });
      video.play().catch(() => { /* autoplay blocked (e.g. iOS Low Power Mode): the still image stays */ });
    };
    const hero = document.querySelector('.hero');
    const arm = () => {
      if (!hero || !('IntersectionObserver' in window)) {
        startVideo();
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        startVideo();
      }, { threshold: 0.25 });
      observer.observe(hero);
    };
    if (document.readyState === 'complete') arm();
    else window.addEventListener('load', arm, { once: true });
  }
  videoToggle?.addEventListener('click', () => {
    const pausing = !video.paused;
    if (pausing) video.pause();
    else video.play().catch(() => {});
    videoToggle.setAttribute('aria-pressed', String(pausing));
  });

  const year = document.getElementById('current-year');
  if (year) year.textContent = String(new Date().getFullYear());

  const form = document.getElementById('quote-form');
  const elapsed = document.getElementById('elapsed-ms');
  const submitButton = document.getElementById('submit-button');
  const errorBox = document.getElementById('form-error');
  const successBox = document.getElementById('form-success');
  const formStarted = performance.now();

  const setFieldError = (id, message) => {
    const input = document.getElementById(id);
    const slot = document.getElementById(`${id}-error`);
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    if (slot) {
      slot.textContent = message || '';
      slot.hidden = !message;
    }
  };

  const showError = (message) => {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = !message;
    if (message) errorBox.focus?.();
  };

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    const data = Object.fromEntries(new FormData(form).entries());
    const name = String(data.name || '').trim();
    const phone = String(data.phone || '').trim();
    const email = String(data.email || '').trim();
    const zipcode = String(data.zipcode || '').trim();
    const phoneDigits = phone.replace(/\D/g, '');
    const emailOk = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const phoneOk = !phone || phoneDigits.length >= 10;
    const zipOk = !zipcode || /^\d{5}(?:-\d{4})?$/.test(zipcode);

    setFieldError('name', name ? '' : 'Enter your name.');
    setFieldError('phone', phoneOk ? '' : 'Enter a valid phone number.');
    setFieldError('email', emailOk ? '' : 'Enter a valid email address.');
    setFieldError('zipcode', zipOk ? '' : 'Enter a valid ZIP code.');
    if (!phone && !email) setFieldError('phone', 'Enter a phone number or an email address.');

    if (!name || !phoneOk || !emailOk || !zipOk || (!phone && !email)) {
      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }

    if (elapsed) data.elapsedMs = String(Math.round(performance.now() - formStarted));
    submitButton.disabled = true;
    submitButton.textContent = 'Sending…';
    try {
      if (window.txTurnstile) data['cf-turnstile-response'] = await window.txTurnstile.token();
      const response = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'We could not submit the request.');
      if (window.txTrack) window.txTrack('quote_submit', { service_type: data.serviceType || 'unspecified' });
      const requestId = document.getElementById('request-id');
      if (requestId) requestId.textContent = result.requestId || '';
      form.hidden = true;
      successBox.hidden = false;
      successBox.focus?.();
    } catch (error) {
      showError(`${error.message || 'Something went wrong.'} Please try again or call (903) 833-3965.`);
      submitButton.disabled = false;
      submitButton.textContent = 'Request my callback';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    setMenuState(false);
  });
})();
