/* Loads Cloudflare Turnstile only when the Worker has a site key.
   When TURNSTILE_SITE_KEY is empty, token() resolves to '' and the server
   skips the check until TURNSTILE_SECRET is set too. */
(() => {
  'use strict';

  let siteKey = null;
  let widgetId = null;
  let scriptPromise = null;
  let pending = null;

  function loadScript() {
    if (window.turnstile) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Bot check could not load.'));
      document.head.appendChild(script);
    });
    return scriptPromise;
  }

  async function siteKeyFromServer() {
    if (siteKey !== null) return siteKey;
    try {
      const response = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      siteKey = data.turnstileSiteKey || '';
    } catch {
      siteKey = '';
    }
    return siteKey;
  }

  function ensureSlot() {
    let slot = document.getElementById('turnstile-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'turnstile-slot';
      slot.hidden = true;
      document.body.appendChild(slot);
    }
    return slot;
  }

  async function token() {
    const key = await siteKeyFromServer();
    if (!key) return '';
    await loadScript();
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      const finish = (value) => {
        pending = null;
        resolve(value);
      };
      const fail = (error) => {
        pending = null;
        reject(error);
      };
      const options = {
        sitekey: key,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (value) => finish(value || ''),
        'error-callback': () => fail(new Error('Bot check failed. Please try again.')),
        'timeout-callback': () => fail(new Error('Bot check timed out. Please try again.'))
      };
      if (widgetId === null) widgetId = window.turnstile.render(ensureSlot(), options);
      else window.turnstile.reset(widgetId);
      window.turnstile.execute(widgetId);
    });
    return pending;
  }

  window.txTurnstile = { token, siteKeyFromServer };
})();
