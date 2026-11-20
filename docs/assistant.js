// Study Hub AI helper: the chat bubble in the bottom-right corner.
// Questions go to /api/ask (functions/api/ask.js on Cloudflare), which adds the open lesson's notes.
(function () {
  const MAIN_SITE = 'https://nbastudyhub.pages.dev/';
  const MAX_LEN = 600, MAX_BIZ = 1500; // Business allows pasting a paragraph for feedback
  const SUGGESTIONS = [
    'Explain the key idea more simply',
    'Give me a real-life example',
    'Quiz me with one question',
    'How do I get full marks on a 6-mark question?'
  ];
  const BIZ_SUGGESTIONS = [
    'What makes an objective SMART?',
    'How do I link a point back to the aim?',
    'What\'s the difference between reliability and validity?',
    'Can you check my paragraph? (paste it)'
  ];
  const BUSINESS = { id: 'business', title: 'Business: Unit 2 exam writing', business: true };

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Plain text in, safe HTML out: paragraphs, "- " bullets and **bold**.
  function format(text) {
    const blocks = esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').split(/\n{2,}/);
    return blocks.map(b => {
      const lines = b.split('\n');
      if (lines.every(l => /^\s*[-•]\s+/.test(l))) return '<ul>' + lines.map(l => `<li>${l.replace(/^\s*[-•]\s+/, '')}</li>`).join('') + '</ul>';
      return `<p>${lines.join('<br>')}</p>`;
    }).join('');
  }

  const root = document.createElement('div');
  root.className = 'helper';
  root.innerHTML = `
    <button class="helper-fab" id="helper-fab" aria-expanded="false" aria-controls="helper-panel" aria-label="Ask the AI study helper" title="Ask the AI study helper">
      <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 2.5l2.1 5.6 5.9 2.4-5.9 2.4L12 18.5l-2.1-5.6L4 10.5l5.9-2.4z"/>
        <path fill="currentColor" d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1-2.1-.9 2.1-.9z" opacity=".85"/>
      </svg>
    </button>
    <section class="helper-panel" id="helper-panel" role="dialog" aria-label="Study helper" hidden>
      <header class="helper-head">
        <div>
          <strong>Study helper</strong>
          <div class="helper-lesson" id="helper-lesson"></div>
        </div>
        <button class="helper-close" id="helper-close" aria-label="Close the study helper">×</button>
      </header>
      <div class="helper-log" id="helper-log" aria-live="polite"></div>
      <div class="helper-chips" id="helper-chips"></div>
      <form class="helper-form" id="helper-form">
        <label for="helper-input" class="helper-sr">Your question</label>
        <textarea id="helper-input" rows="2" maxlength="${MAX_LEN}" placeholder="Ask about this lesson…"></textarea>
        <button class="btn" id="helper-send" type="submit">Send</button>
      </form>
      <p class="helper-note">AI can make mistakes. If it disagrees with your teacher, go with your teacher. Your questions are saved for 30 days and can be seen by the site owner, so don't share personal details.</p>
    </section>`;
  document.body.appendChild(root);

  const $ = id => document.getElementById(id);
  const fab = $('helper-fab'), panel = $('helper-panel'), log = $('helper-log'), input = $('helper-input');
  const chats = {}; // per lesson: [{ role, text }]
  let busy = false, shown = 0; // shown: messages already on screen, so only new ones animate in

  let view = 'lessons';
  // On the Business page the helper talks about Business; everywhere else, the open IT lesson.
  const deck = () => view === 'business' ? BUSINESS : (window.studyHub && window.studyHub.deck) || null;
  const chat = () => { const d = deck(); return d ? (chats[d.id] = chats[d.id] || []) : []; };

  function render() {
    const d = deck();
    $('helper-lesson').textContent = d ? d.title : 'Open a lesson to ask about it';
    const msgs = chat();
    log.innerHTML = `<div class="helper-msg bot">${format(!d ? 'Pick a lesson first, then ask me about it.'
      : d.business ? 'Hi! I can help with your **Business Unit 2** work: the aim, SMART objectives, trends, competitors, research, SWOT, PESTLE and the 7 Ps. I can explain ideas, quiz you, or give feedback on a paragraph you paste. I can\'t see your Technective booklet, so paste any facts you want me to use. I won\'t write your set-task answers for you, but I\'ll help you improve your own.'
      : `Hi! Ask me anything about **${d.title}**. I can explain things another way, give examples, quiz you, or help you plan an exam answer.`)}</div>` +
      msgs.map((m, i) => `<div class="helper-msg ${m.role === 'user' ? 'me' : m.error ? 'bot err' : 'bot'}${i >= shown ? ' new' : ''}">${m.role === 'user' ? `<p>${esc(m.text)}</p>` : format(m.text)}</div>`).join('') +
      (busy ? '<div class="helper-msg bot typing"><span></span><span></span><span></span></div>' : '');
    shown = msgs.length;
    input.maxLength = d && d.business ? MAX_BIZ : MAX_LEN;
    input.placeholder = d && d.business ? 'Ask about your Business work, or paste a paragraph…' : 'Ask about this lesson…';
    $('helper-chips').innerHTML = msgs.length || !d ? '' : (d.business ? BIZ_SUGGESTIONS : SUGGESTIONS).map(s => `<button type="button" class="helper-chip">${esc(s)}</button>`).join('');
    $('helper-chips').querySelectorAll('.helper-chip').forEach(b => b.onclick = () => ask(b.textContent));
    $('helper-send').disabled = busy || !d;
    log.scrollTop = log.scrollHeight;
  }

  function errorText(status, code) {
    if (status === 404 && !code) return `The helper only works on the main site. Open ${MAIN_SITE} to use it.`;
    if (code === 'not_configured') return "The study helper isn't switched on yet. Try again later.";
    if (code === 'rate_limited') return "You've asked a lot of questions in a short time. Have a go at the quiz, then try again in a few minutes.";
    if (code === 'busy') return 'Lots of people are asking right now. Please try again in a minute.';
    if (code === 'unknown_lesson') return "I couldn't load this lesson's notes. Refresh the page and try again.";
    return "Sorry, something went wrong. Please try again.";
  }

  async function ask(text) {
    const d = deck(); const q = String(text || '').trim().slice(0, d && d.business ? MAX_BIZ : MAX_LEN);
    if (!d || !q || busy) return;
    const msgs = chat();
    const history = msgs.filter(m => !m.error).slice(-8).map(m => ({ role: m.role, text: m.text }));
    msgs.push({ role: 'user', text: q });
    busy = true; input.value = ''; render();
    try {
      const res = await fetch('api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deckId: d.id, question: q, history }) });
      let data = {}; try { data = await res.json(); } catch (e) {}
      if (res.ok && data.answer) msgs.push({ role: 'assistant', text: data.answer });
      else msgs.push({ role: 'assistant', text: errorText(res.status, data.error), error: true });
    } catch (e) {
      msgs.push({ role: 'assistant', text: "I couldn't connect. Check your internet and try again.", error: true });
    }
    busy = false; render(); input.focus();
  }

  // Opens out of the round button and shrinks back into it when closed (the close is a little quicker).
  let closing = null;
  function open(on) {
    clearTimeout(closing); panel.classList.remove('closing');
    fab.setAttribute('aria-expanded', String(on));
    if (on) { panel.hidden = false; root.classList.add('open'); shown = chat().length; render(); input.focus(); return; }
    const done = () => { panel.hidden = true; panel.classList.remove('closing'); root.classList.remove('open'); fab.focus(); };
    if (panel.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    panel.classList.add('closing'); closing = setTimeout(done, 190);
  }
  fab.onclick = () => open(panel.hidden);
  $('helper-close').onclick = () => open(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) open(false); });
  $('helper-form').onsubmit = e => { e.preventDefault(); ask(input.value); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
  window.addEventListener('studyhub:deck', () => { if (!panel.hidden) { shown = chat().length; render(); } });
  window.addEventListener('studyhub:view', (e) => { view = e.detail.view; if (!panel.hidden) { shown = chat().length; render(); } });
})();
