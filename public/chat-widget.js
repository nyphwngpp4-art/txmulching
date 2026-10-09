/* TX Mulching chat + Grok Voice widget.
   Text: POST /api/chat (existing Pages Function).
   Voice: POST /api/voice-token -> ephemeral secret -> wss://api.x.ai/v1/realtime
   NOTE: voice event names follow the OpenAI Realtime spec (xAI-compatible per
   docs.x.ai). Verify against docs on first live test if audio doesn't flow. */
(() => {
  'use strict';
  const PHONE_DISPLAY = '(903) 833-3965';
  const AGENT_ID = 'agent_1o0Tc1tCk11pJSLW';  /* saved agent in xAI console; set '' to use VOICE_MODEL + inline instructions */
  const VOICE_MODEL = 'grok-voice-latest';
  const SAMPLE_RATE = 24000;

  /* ---------- DOM ---------- */
  const root = document.createElement('div');
  root.className = 'chat-widget';
  root.innerHTML = `
    <button class="chat-toggle" type="button" aria-expanded="false" aria-controls="chat-panel" aria-label="Open chat">
      <svg class="chat-toggle-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>
    </button>
    <div class="chat-panel" id="chat-panel" role="dialog" aria-modal="true" aria-labelledby="chat-title" hidden>
      <div class="chat-header">
        <div class="chat-brand-mark" aria-hidden="true">TX</div>
        <div class="chat-header-copy">
          <h2 id="chat-title">TX Mulching Assistant</h2>
          <p>Ask about clearing your land</p>
        </div>
        <button class="chat-close" type="button" aria-label="Close chat">&times;</button>
      </div>
      <div class="chat-messages" role="log" aria-live="polite"></div>
      <div class="chat-quote-offer" hidden>
        <button class="chat-quote-button" type="button">Request a callback &rarr;</button>
      </div>
      <form class="chat-form">
        <div class="chat-input-row">
          <input type="text" name="message" placeholder="Type a question&hellip;" autocomplete="off" maxlength="1000">
          <button class="chat-mic" type="button" aria-pressed="false" aria-label="Talk with Grok Voice"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg></button>
          <button type="submit">Send</button>
        </div>
        <div class="chat-error" hidden></div>
        <p class="chat-note">AI assistant &mdash; for a quote, <a href="/#quote">request a callback</a> or call ${PHONE_DISPLAY}.</p>
      </form>
    </div>`;
  document.body.appendChild(root);

  const toggle = root.querySelector('.chat-toggle');
  const panel = root.querySelector('.chat-panel');
  const closeBtn = root.querySelector('.chat-close');
  const log = root.querySelector('.chat-messages');
  const form = root.querySelector('.chat-form');
  const input = form.querySelector('input');
  const send = form.querySelector('button[type=submit]');
  const micBtn = root.querySelector('.chat-mic');
  const errBox = root.querySelector('.chat-error');
  const quoteOffer = root.querySelector('.chat-quote-offer');
  root.querySelector('.chat-quote-button').addEventListener('click', () => { closePanel(); location.href = '/#quote'; });

  const history = [];
  let greeted = false;

  function bubble(role, text, thinking) {
    const row = document.createElement('div');
    row.className = 'chat-message chat-message-' + role;
    const b = document.createElement('div');
    b.className = 'chat-bubble' + (thinking ? ' chat-thinking' : '');
    b.textContent = text;
    row.appendChild(b);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return b;
  }
  function showError(msg) { errBox.textContent = msg; errBox.hidden = false; }
  function clearError() { errBox.hidden = true; }
  function maybeOfferQuote(text) {
    if (/acre|price|cost|quote|estimate|how much/i.test(text)) quoteOffer.hidden = false;
  }

  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !greeted) {
      greeted = true;
      bubble('assistant', "Howdy — I'm the TX Mulching assistant. Ask me about forestry mulching, land clearing, or what we can do for your property. Tap the mic to talk instead of type.");
    }
    if (open) input.focus();
    if (!open) stopVoice();
  });
  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    stopVoice();
    toggle.focus();
  }
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    event.stopPropagation();
    closePanel();
  });
  document.addEventListener('focusin', (event) => {
    const tag = event.target && event.target.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !root.contains(event.target)) {
      document.body.classList.add('form-field-focus');
    }
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const active = document.activeElement;
      const tag = active && active.tagName;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) document.body.classList.remove('form-field-focus');
    }, 0);
  });

  /* ---------- Text chat ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    clearError();
    input.value = '';
    bubble('user', text);
    history.push({ role: 'user', content: text });
    const thinking = bubble('assistant', 'Thinking…', true);
    input.disabled = true; send.disabled = true;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-12) })
      });
      const data = await res.json().catch(() => ({}));
      thinking.parentElement.remove();
      if (!res.ok || !data.reply) {
        showError(data.error || 'The assistant is unavailable right now — call ' + PHONE_DISPLAY + '.');
      } else {
        history.push({ role: 'assistant', content: data.reply });
        bubble('assistant', data.reply);
        maybeOfferQuote(text + ' ' + data.reply);
      }
    } catch {
      thinking.parentElement.remove();
      showError('Connection problem — call ' + PHONE_DISPLAY + '.');
    } finally {
      input.disabled = false; send.disabled = false; input.focus();
    }
  });

  /* ---------- Grok Voice (realtime speech-to-speech) ---------- */
  let ws = null, mediaStream = null, audioCtx = null, procNode = null;
  let playCtx = null, playTime = 0, playing = [];
  let voiceOn = false;
  let userLine = null, botLine = null;

  function floatTo16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }
  function b64(bytes) {
    let bin = '';
    const u8 = new Uint8Array(bytes.buffer || bytes);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64ToF32(b) {
    const bin = atob(b);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const i16 = new Int16Array(u8.buffer);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
    return f32;
  }
  function playChunk(f32) {
    if (!playCtx) { playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE }); playTime = playCtx.currentTime; }
    const buf = playCtx.createBuffer(1, f32.length, SAMPLE_RATE);
    buf.getChannelData(0).set(f32);
    const src = playCtx.createBufferSource();
    src.buffer = buf; src.connect(playCtx.destination);
    playTime = Math.max(playTime, playCtx.currentTime);
    src.start(playTime);
    playTime += buf.duration;
    playing.push(src);
    src.onended = () => { playing = playing.filter((s) => s !== src); };
  }
  function stopPlayback() { playing.forEach((s) => { try { s.stop(); } catch {} }); playing = []; if (playCtx) playTime = playCtx.currentTime; }

  async function startVoice() {
    clearError();
    micBtn.disabled = true;
    try {
      let turnstileToken = '';
      if (window.txTurnstile) turnstileToken = await window.txTurnstile.token();
      const tokRes = await fetch('/api/voice-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnstileToken })
      });
      const tok = await tokRes.json().catch(() => ({}));
      const secret = tok.value || tok.client_secret?.value;
      if (!tokRes.ok || !secret) throw new Error(tok.error || 'Voice is not activated yet.');

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const wsUrl = AGENT_ID
        ? 'wss://api.x.ai/v1/realtime?agent_id=' + AGENT_ID
        : 'wss://api.x.ai/v1/realtime?model=' + VOICE_MODEL;
      ws = new WebSocket(wsUrl, ['xai-client-secret.' + secret]);

      ws.onopen = () => {
        const session = {
          turn_detection: { type: 'server_vad' },
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'grok-stt' }
        };
        if (!AGENT_ID) {
          session.voice = 'eve';
          session.instructions = 'You are the friendly voice assistant for TX Mulching, an owner-led forestry mulching and land clearing company in Canton, Texas serving East Texas. Specialty: heavy timber and large acreage with a high-horsepower purpose-built forestry machine — finished in days, not weeks. Never give prices or price ranges; for a quote, send people to the callback request form on txmulching.com or have them call ' + PHONE_DISPLAY + '. Do not collect names or phone numbers: nothing said here reaches the owner. Keep replies short and conversational.';
        }
        ws.send(JSON.stringify({ type: 'session.update', session }));
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        const srcNode = audioCtx.createMediaStreamSource(mediaStream);
        // ScriptProcessorNode is deprecated. Planned follow-up: move this PCM
        // tap into an AudioWorklet served from /audio-worklet.js and keep this
        // node only when AudioWorklet is missing (older iOS).
        procNode = audioCtx.createScriptProcessor(4096, 1, 1);
        srcNode.connect(procNode); procNode.connect(audioCtx.destination);
        procNode.onaudioprocess = (ev) => {
          if (!ws || ws.readyState !== 1) return;
          const pcm = floatTo16(ev.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64(pcm) }));
        };
        voiceOn = true;
        micBtn.classList.add('on');
        micBtn.setAttribute('aria-pressed', 'true');
        micBtn.disabled = false;
        bubble('assistant', 'Voice on — go ahead and talk. Tap the mic again to stop.');
      };

      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        const t = msg.type || '';
        if (t === 'response.audio.delta' || t === 'response.output_audio.delta') {
          playChunk(b64ToF32(msg.delta));
        } else if (t === 'input_audio_buffer.speech_started') {
          stopPlayback(); userLine = null;
        } else if (t === 'conversation.item.input_audio_transcription.completed') {
          if (msg.transcript) bubble('user', msg.transcript);
        } else if (t === 'response.audio_transcript.delta' || t === 'response.output_audio_transcript.delta') {
          if (!botLine) botLine = bubble('assistant', '');
          botLine.textContent += msg.delta || '';
          log.scrollTop = log.scrollHeight;
        } else if (t === 'response.done') {
          botLine = null;
        } else if (t === 'error') {
          showError(msg.error?.message || 'Voice error — try again or call ' + PHONE_DISPLAY + '.');
        }
      };
      ws.onerror = () => { showError('Voice connection failed — you can still type, or call ' + PHONE_DISPLAY + '.'); stopVoice(); };
      ws.onclose = () => { if (voiceOn) stopVoice(); };
    } catch (err) {
      showError(err.message || 'Could not start voice.');
      micBtn.disabled = false;
      stopVoice();
    }
  }

  function stopVoice() {
    voiceOn = false;
    micBtn.classList.remove('on');
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.disabled = false;
    if (procNode) { try { procNode.disconnect(); } catch {} procNode = null; }
    if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
    if (mediaStream) { mediaStream.getTracks().forEach((tr) => tr.stop()); mediaStream = null; }
    if (ws) { try { ws.close(); } catch {} ws = null; }
    stopPlayback();
  }

  micBtn.addEventListener('click', () => { voiceOn ? stopVoice() : startVoice(); });
  window.addEventListener('pagehide', stopVoice);
})();
