/* Stepped /estimate intake. With JavaScript off, estimate-boot.js never runs
   and the form posts as one page to /api/quote. */
(() => {
  'use strict';

  const STEPS = 5;
  const DRAFT_KEY = 'txm-estimate-draft';
  const META_KEY = 'txm-estimate-meta';
  const STARTED = performance.now();
  const USUAL_ZIPS = new Set(['751', '754', '756', '757', '758']);
  // Owners have not approved a budget question. Leave this false.
  const SHOW_BUDGET = false;

  const form = document.getElementById('estimate-form');
  if (!form) return;

  const params = new URLSearchParams(location.search);
  let meta = {};
  try { meta = JSON.parse(sessionStorage.getItem(META_KEY) || '{}'); } catch { meta = {}; }
  if (params.get('demo') === '1') meta.demo = true;
  if (params.get('ref')) meta.ref = params.get('ref').slice(0, 40);
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((key) => {
    const value = params.get(key);
    if (value) meta[key] = value.slice(0, 80);
  });
  sessionStorage.setItem(META_KEY, JSON.stringify(meta));

  const track = (name, extra) => {
    if (!window.txTrack) return;
    window.txTrack(name, Object.assign({ ref: meta.ref || '' }, extra || {}));
  };

  const banner = document.getElementById('demo-banner');
  if (meta.demo && sessionStorage.getItem('txm-demo-banner-dismissed') !== '1') banner.hidden = false;
  document.getElementById('demo-dismiss')?.addEventListener('click', () => {
    banner.hidden = true;
    sessionStorage.setItem('txm-demo-banner-dismissed', '1');
  });
  document.getElementById('demo-field').value = meta.demo ? '1' : '';
  document.getElementById('ref-field').value = meta.ref || '';
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((key) => {
    const input = form.querySelector(`[name="${key}"]`);
    if (input && meta[key]) input.value = meta[key];
  });

  const year = document.getElementById('current-year');
  if (year) year.textContent = String(new Date().getFullYear());

  if (SHOW_BUDGET) {
    // Intentionally empty until the owners approve wording. The API already
    // accepts an optional `budget` string. Do not render price ranges here.
  }

  const steps = [...form.querySelectorAll('.estimate-step')];
  const backButton = document.getElementById('back-button');
  const nextButton = document.getElementById('next-button');
  const formError = document.getElementById('form-error');
  const success = document.getElementById('estimate-success');
  let step = 1;
  const photos = [];

  function fieldError(id, message) {
    const input = document.getElementById(id);
    const error = document.getElementById(`${id}-error`);
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    if (error) {
      error.textContent = message || '';
      error.hidden = !message;
    }
  }

  function groupError(setId, messageId, message) {
    const set = document.getElementById(setId);
    const error = document.getElementById(messageId);
    if (set) {
      if (message) set.setAttribute('aria-invalid', 'true');
      else set.removeAttribute('aria-invalid');
    }
    if (error && messageId.endsWith('-error') && document.getElementById(messageId)) {
      error.textContent = message || '';
      error.hidden = !message;
    }
  }

  function showFormError(message) {
    formError.textContent = message || '';
    formError.hidden = !message;
  }

  function checked(name) {
    return form.querySelector(`input[name="${name}"]:checked`)?.value || '';
  }

  function saveDraft() {
    const data = {
      step,
      serviceType: checked('serviceType'),
      acreage: checked('acreage'),
      density: checked('density'),
      address: form.address.value,
      city: form.city.value,
      county: form.county.value,
      zipcode: form.zipcode.value,
      timeline: checked('timeline'),
      callbackWindow: checked('callbackWindow'),
      name: form.name.value,
      phone: form.phone.value,
      email: form.email.value
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  }

  function restoreDraft() {
    let data = null;
    try { data = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { data = null; }
    if (!data) return;
    ['serviceType', 'acreage', 'density', 'timeline', 'callbackWindow'].forEach((name) => {
      if (!data[name]) return;
      const input = form.querySelector(`input[name="${name}"][value="${CSS.escape(data[name])}"]`);
      if (input) input.checked = true;
    });
    ['address', 'city', 'county', 'zipcode', 'name', 'phone', 'email'].forEach((name) => {
      if (data[name] && form[name]) form[name].value = data[name];
    });
    if (data.step >= 1 && data.step <= STEPS) step = data.step;
  }

  function showStep(next) {
    step = next;
    steps.forEach((section) => {
      section.classList.toggle('is-current', Number(section.dataset.step) === step);
    });
    backButton.hidden = step === 1;
    nextButton.textContent = step === STEPS ? 'Send to TX Mulching' : 'Continue';
    const label = document.getElementById('progress-label');
    const fill = document.getElementById('progress-fill');
    const bar = document.getElementById('progress');
    if (label) label.textContent = `Step ${step} of ${STEPS}`;
    if (fill) fill.style.width = `${(step / STEPS) * 100}%`;
    if (bar) bar.setAttribute('aria-valuenow', String(step));
    track('estimate_step', { step: String(step) });
    saveDraft();
    const current = steps.find((section) => Number(section.dataset.step) === step);
    current?.querySelector('h2')?.focus?.({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function zipLooksFar(zip) {
    const digits = zip.replace(/\D/g, '');
    if (digits.length < 5) return false;
    return !USUAL_ZIPS.has(digits.slice(0, 3));
  }

  function refreshAreaNote() {
    const note = document.getElementById('area-note');
    if (!note) return;
    note.hidden = !zipLooksFar(form.zipcode.value);
  }

  function validateStep(current) {
    showFormError('');
    if (current === 1) {
      const ok = checked('serviceType') && checked('acreage') && checked('density');
      const error = document.getElementById('step-1-error');
      if (error) {
        error.textContent = ok ? '' : 'Choose a service, an acreage range, and how thick the brush is.';
        error.hidden = ok;
      }
      ['service-set', 'acreage-set', 'density-set'].forEach((id) => {
        document.getElementById(id)?.toggleAttribute('aria-invalid', !ok);
      });
      return ok;
    }
    if (current === 2) {
      const address = form.address.value.trim();
      const city = form.city.value.trim();
      const zip = form.zipcode.value.trim();
      fieldError('address', address ? '' : 'Enter the street address or nearest road.');
      fieldError('city', city ? '' : 'Enter the city.');
      const zipBad = zip && !/^\d{5}(?:-\d{4})?$/.test(zip);
      fieldError('zipcode', zipBad ? 'Enter a 5-digit ZIP code.' : '');
      return Boolean(address && city && !zipBad);
    }
    if (current === 3) return !photos.some((photo) => photo.status === 'uploading');
    if (current === 4) {
      const ok = checked('timeline') && checked('callbackWindow');
      const error = document.getElementById('step-4-error');
      if (error) {
        error.textContent = ok ? '' : 'Choose a timeline and a callback window.';
        error.hidden = ok;
      }
      return ok;
    }
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();
    const email = form.email.value.trim();
    const phoneDigits = phone.replace(/\D/g, '');
    fieldError('name', name ? '' : 'Enter your name.');
    fieldError('phone', phoneDigits.length >= 10 ? '' : 'Enter a mobile number we can call.');
    fieldError('email', email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Enter a valid email address.' : '');
    return Boolean(name && phoneDigits.length >= 10 && !(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)));
  }

  function renderPhotos() {
    const list = document.getElementById('photo-list');
    list.replaceChildren();
    photos.forEach((photo) => {
      const item = document.createElement('li');
      item.className = 'photo-item';
      const img = document.createElement('img');
      img.src = photo.blobUrl;
      img.alt = '';
      const meta = document.createElement('div');
      meta.className = 'photo-meta';
      const name = document.createElement('p');
      name.textContent = photo.name;
      const state = document.createElement('p');
      state.textContent = photo.status === 'done' ? 'Ready' : photo.status === 'error' ? (photo.error || 'Could not upload') : `Uploading ${photo.progress}%`;
      const bar = document.createElement('div');
      bar.className = 'photo-bar';
      const fill = document.createElement('span');
      fill.style.width = `${photo.progress}%`;
      bar.append(fill);
      meta.append(name, state, bar);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'photo-remove';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(photo.blobUrl);
        const index = photos.indexOf(photo);
        if (index >= 0) photos.splice(index, 1);
        syncPhotoKeys();
        renderPhotos();
      });
      item.append(img, meta, remove);
      list.append(item);
    });
    syncPhotoKeys();
  }

  function syncPhotoKeys() {
    document.getElementById('photo-keys').value = JSON.stringify(photos.filter((photo) => photo.key).map((photo) => photo.key));
  }

  async function compress(file) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (!blob) throw new Error('encode failed');
      return blob;
    } catch {
      if (file.size <= 10 * 1024 * 1024) return file;
      throw new Error('That photo is too large.');
    }
  }

  function upload(photo, blob) {
    photo.status = 'uploading';
    photo.progress = 5;
    renderPhotos();
    const body = new FormData();
    body.set('file', blob, 'brush.jpg');
    body.set('n', String(photos.indexOf(photo) + 1));
    const request = new XMLHttpRequest();
    request.open('POST', '/api/quote-photo');
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      photo.progress = Math.max(5, Math.round((event.loaded / event.total) * 100));
      renderPhotos();
    };
    request.onload = () => {
      let data = {};
      try { data = JSON.parse(request.responseText || '{}'); } catch { data = {}; }
      if (request.status >= 200 && request.status < 300 && data.key) {
        photo.status = 'done';
        photo.key = data.key;
        photo.progress = 100;
        photo.error = '';
      } else if (data.code === 'photos_unconfigured') {
        photo.status = 'local';
        photo.progress = 100;
        photo.error = '';
      } else {
        photo.status = 'error';
        photo.error = data.error || 'Could not upload this photo.';
        track('estimate_error', { code: 'photo' });
      }
      renderPhotos();
    };
    request.onerror = () => {
      photo.status = 'error';
      photo.error = 'Could not upload this photo.';
      renderPhotos();
    };
    const send = () => request.send(body);
    if (window.txTurnstile) {
      window.txTurnstile.token().then((token) => {
        if (token) body.set('turnstileToken', token);
        send();
      }).catch(() => send());
    } else send();
  }

  document.getElementById('photos').addEventListener('change', async (event) => {
    const error = document.getElementById('photo-error');
    error.hidden = true;
    const files = [...event.target.files];
    event.target.value = '';
    for (const file of files) {
      if (photos.length >= 6) {
        error.textContent = '6 photos is the maximum.';
        error.hidden = false;
        break;
      }
      try {
        const blob = await compress(file);
        const photo = {
          name: file.name,
          blobUrl: URL.createObjectURL(blob),
          blob,
          key: '',
          status: 'queued',
          progress: 0,
          error: ''
        };
        photos.push(photo);
        track('estimate_photo_added', { count: String(photos.length) });
        upload(photo, blob);
      } catch (err) {
        error.textContent = err.message || 'That photo could not be added.';
        error.hidden = false;
      }
    }
  });

  form.zipcode.addEventListener('input', refreshAreaNote);

  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);

  backButton.addEventListener('click', () => {
    if (step > 1) showStep(step - 1);
  });

  nextButton.addEventListener('click', () => {
    if (!validateStep(step)) return;
    if (step < STEPS) showStep(step + 1);
    else form.requestSubmit();
  });

  function showSuccess(requestId) {
    form.hidden = true;
    document.querySelector('.estimate-intro')?.setAttribute('hidden', '');
    success.classList.add('is-on');
    document.getElementById('request-id').textContent = requestId || '';
    if (meta.demo) {
      const card = document.getElementById('owner-alert');
      card.hidden = false;
      const phone = form.phone.value.trim();
      const tel = phone.replace(/[^\d+]/g, '');
      document.getElementById('alert-summary').textContent = `${form.name.value.trim()} · ${form.city.value.trim() || 'city not given'}`;
      const phoneLine = document.getElementById('alert-phone');
      phoneLine.replaceChildren();
      if (tel) {
        const link = document.createElement('a');
        link.href = `tel:${tel}`;
        link.textContent = phone;
        phoneLine.append('Call ', link);
      }
      document.getElementById('alert-job').textContent = [
        checked('acreage'),
        checked('density'),
        checked('timeline'),
        checked('callbackWindow') && `callback ${checked('callbackWindow').toLowerCase()}`
      ].filter(Boolean).join(' · ');
      const map = document.getElementById('alert-map');
      map.replaceChildren();
      const query = [form.address.value, form.city.value, form.county.value, form.zipcode.value, 'TX'].filter((part) => part && part.trim()).join(', ');
      if (query) {
        const link = document.createElement('a');
        link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
        link.textContent = query;
        link.rel = 'noopener';
        map.append(link);
      }
      const strip = document.getElementById('alert-photos');
      strip.replaceChildren();
      photos.forEach((photo) => {
        const img = document.createElement('img');
        img.src = photo.blobUrl;
        img.alt = 'Brush photo from this request';
        strip.append(img);
      });
    }
    success.focus();
    sessionStorage.removeItem(DRAFT_KEY);
  }

  async function submitJson(event) {
    event.preventDefault();
    if (!validateStep(5)) return;
    if (photos.some((photo) => photo.status === 'uploading')) {
      showFormError('Photos are still uploading. Wait a moment and tap Send again.');
      return;
    }
    document.getElementById('elapsed-ms').value = String(Math.round(performance.now() - STARTED));
    syncPhotoKeys();
    const data = Object.fromEntries(new FormData(form).entries());
    delete data.photos;
    try {
      data.photoKeys = JSON.parse(data.photoKeys || '[]');
    } catch {
      data.photoKeys = [];
    }
    nextButton.disabled = true;
    nextButton.textContent = 'Sending…';
    try {
      if (window.txTurnstile) data['cf-turnstile-response'] = await window.txTurnstile.token();
      const response = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        track('estimate_error', { code: String(response.status) });
        throw new Error(result.error || 'We could not submit the request.');
      }
      track('estimate_submit', { demo: meta.demo ? '1' : '0' });
      showSuccess(result.requestId);
    } catch (error) {
      showFormError(error.message || 'Something went wrong. Call (903) 833-3965.');
      nextButton.disabled = false;
      nextButton.textContent = 'Send to TX Mulching';
    }
  }

  form.addEventListener('submit', (event) => {
    if (!document.documentElement.classList.contains('js')) return;
    submitJson(event);
  });

  restoreDraft();
  refreshAreaNote();
  if (params.get('sent') === '1') {
    if (params.get('demo') === '1') meta.demo = true;
    showSuccess(params.get('id') || '');
  } else if (params.get('error')) {
    showFormError(params.get('error'));
    showStep(step);
  } else {
    showStep(step);
  }
  track('estimate_view');
})();
