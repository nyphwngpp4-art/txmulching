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

  menuButton?.addEventListener('click', () => {
    setMenuState(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  navigation?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setMenuState(false));
  });

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
      showError(`${error.message || 'Something went wrong.'} Please try again or call (903) 567-9917.`);
      submitButton.disabled = false;
      submitButton.textContent = 'Get My Free Quote';
    }
  });

  const chatToggle = document.getElementById('chat-toggle');
  const chatPanel = document.getElementById('chat-panel');
  const chatClose = document.getElementById('chat-close');
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  const chatError = document.getElementById('chat-error');
  const quoteOffer = document.getElementById('chat-quote-offer');
  const quoteButton = document.getElementById('chat-quote-button');

  const chatHistory = [{
    role: 'assistant',
    content: 'Hi. I’m the TX Mulching assistant. I can explain our services, service area, process, or help you decide what information to include in a free quote request. What are you looking to clear?'
  }];

  const setChatOpen = (open) => {
    if (!chatPanel || !chatToggle) return;
    chatPanel.hidden = !open;
    chatToggle.setAttribute('aria-expanded', String(open));
    chatToggle.setAttribute('aria-label', open ? 'Close TX Mulching chat assistant' : 'Open TX Mulching chat assistant');
    chatToggle.querySelector('.sr-only').textContent = open ? 'Close chat assistant' : 'Open chat assistant';
    if (open) {
      renderChat();
      window.setTimeout(() => chatInput?.focus(), 0);
    }
  };

  const renderChat = () => {
    if (!chatMessages) return;
    chatMessages.replaceChildren();
    chatHistory.forEach((message) => {
      const row = document.createElement('div');
      row.className = `chat-message chat-message-${message.role}`;
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.textContent = message.content;
      row.appendChild(bubble);
      chatMessages.appendChild(row);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  const addThinkingMessage = () => {
    const row = document.createElement('div');
    row.className = 'chat-message chat-message-assistant';
    row.id = 'chat-thinking';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-thinking';
    bubble.textContent = 'Thinking…';
    row.appendChild(bubble);
    chatMessages?.appendChild(row);
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  const setChatBusy = (busy) => {
    if (chatInput) chatInput.disabled = busy;
    if (chatSend) chatSend.disabled = busy;
    chatPanel?.setAttribute('aria-busy', String(busy));
  };

  const showChatError = (message) => {
    if (!chatError) return;
    chatError.textContent = message;
    chatError.hidden = false;
  };

  chatToggle?.addEventListener('click', () => setChatOpen(chatPanel?.hidden ?? true));
  chatClose?.addEventListener('click', () => setChatOpen(false));

  quoteButton?.addEventListener('click', () => {
    setChatOpen(false);
    document.getElementById('quote')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => document.getElementById('name')?.focus(), 550);
  });

  chatForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const content = String(chatInput?.value || '').trim();
    if (!content) return;

    chatError.hidden = true;
    chatHistory.push({ role: 'user', content: content.slice(0, 500) });
    chatInput.value = '';
    renderChat();
    addThinkingMessage();
    setChatBusy(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ messages: chatHistory.slice(-12) })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The chat assistant is temporarily unavailable.');
      chatHistory.push({ role: 'assistant', content: String(result.reply || '').trim() });
      if (chatHistory.filter((message) => message.role === 'user').length >= 3) quoteOffer.hidden = false;
    } catch (error) {
      showChatError(`${error.message || 'The chat assistant is unavailable.'} You can still call, text, or use the quote form.`);
    } finally {
      document.getElementById('chat-thinking')?.remove();
      renderChat();
      setChatBusy(false);
      chatInput?.focus();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    setMenuState(false);
    if (chatPanel && !chatPanel.hidden) {
      setChatOpen(false);
      chatToggle?.focus();
    }
  });

  renderChat();
})();
