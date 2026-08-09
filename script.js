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

  const video = document.querySelector('.hero video');
  if (video && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.removeAttribute('autoplay');
    video.pause();
  }

  const year = document.getElementById('current-year');
  if (year) year.textContent = String(new Date().getFullYear());

  const form = document.getElementById('quote-form');
  const startedAt = document.getElementById('form-started-at');
  const submitButton = document.getElementById('submit-button');
  const errorBox = document.getElementById('form-error');
  const successBox = document.getElementById('form-success');
  if (startedAt) startedAt.value = String(Date.now());

  const showError = (message) => {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.focus?.();
  };

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const data = Object.fromEntries(new FormData(form).entries());
    const name = String(data.name || '').trim();
    const phone = String(data.phone || '').trim();
    const email = String(data.email || '').trim();

    if (!name) {
      showError('Please enter your name.');
      document.getElementById('name')?.focus();
      return;
    }
    if (!phone && !email) {
      showError('Please provide at least a phone number or an email address.');
      document.getElementById('phone')?.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Sending…';
    try {
      const response = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'We could not submit the request.');
      form.hidden = true;
      successBox.hidden = false;
      successBox.focus?.();
    } catch (error) {
      showError(`${error.message || 'Something went wrong.'} Please try again or call (903) 833-3965.`);
      submitButton.disabled = false;
      submitButton.textContent = 'Get My Free Quote';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    setMenuState(false);
  });
})();
