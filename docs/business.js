// Study Hub: Business exam writing (#business). No lessons, just exam questions written with a
// structure: plan step by step, write, then self-mark or get AI marking (functions/api/mark.js, kind "biz").
// Questions, case studies and the writing structures live in business/questions.json.
// Answers are saved like a lesson's progress under the id "business", so they sync with accounts.
// Uses helpers from app.js: esc, stagger, bump, bands, LEVELS, aiErrorText.
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'sh-prog-business', POINT_TYPES = ['explain', 'calculate'];
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  let data = null, prog = null, filt = { c: 'all', t: 'all' }, timer = null, saveT = null;

  const entry = (qid) => (prog.answers[qid] = prog.answers[qid] || { text: '', plan: [] });
  function save() {
    clearTimeout(saveT);
    prog._t = Date.now();
    saveT = setTimeout(() => { ls.set(KEY, prog); if (window.onProgressSaved) window.onProgressSaved('business', prog); }, 500);
  }
  const scoreOf = (q, st) => {
    if (!st) return null;
    if (st.self !== undefined && st.self !== '') return Math.min(q.m, +st.self);
    if (POINT_TYPES.includes(q.type) && st.ticks && st.ticks.length) return Math.min(q.m, st.ticks.length);
    return st.ai ? st.ai.score : null;
  };
  function summary() {
    let got = 0, max = 0, n = 0;
    for (const q of data.questions) { const sc = scoreOf(q, prog.answers[q.id]); if (sc !== null) { got += sc; max += q.m; n++; } }
    $('bz-sum').innerHTML = n ? `<span class="big score">${got}</span><span class="score"> / ${max}</span><span class="muted"> marks on ${n} of ${data.questions.length} questions marked</span>` : `<span class="muted">${data.questions.length} questions. Mark an answer to see your score here.</span>`;
  }

  function structureGuide() {
    return `<details class="card bz-guide"><summary><strong>How to structure each type of answer</strong> <span class="muted">(tap to open)</span></summary>
      <div class="bz-structs">${Object.entries(data.structures).map(([k, s]) => `
        <div class="bz-struct"><h3>${esc(s.name)} <span class="muted small-note">${esc(s.marks)}</span></h3>
          <ol>${s.steps.map((x) => `<li><strong>${esc(x.label)}:</strong> ${esc(x.hint)}</li>`).join('')}</ol>
          <p class="small-note"><strong>Tip:</strong> ${esc(s.tip)}</p></div>`).join('')}</div>
      <p class="muted small-note">${esc(data.note)}</p></details>`;
  }
  const chip = (group, val, label) => `<button class="bz-chip" data-g="${group}" data-v="${val}" aria-pressed="${filt[group] === val}">${esc(label)}</button>`;

  function card(q) {
    const c = data.cases.find((x) => x.id === q.case), s = data.structures[q.type], st = prog.answers[q.id] || { text: '', plan: [] };
    const levelled = !POINT_TYPES.includes(q.type), b = bands(q.m), mins = Math.ceil(q.m * 1.5);
    const covered = (st.ai && st.ai.covered) || [], ticks = st.ticks || [];
    const el = document.createElement('div'); el.className = 'card bz-q'; el.dataset.q = q.id;
    el.innerHTML = `
      <div class="row"><span class="bz-type">${esc(s ? s.name : q.type)}</span><span class="bz-case-name">${esc(c ? c.name : '')}</span><span class="spacer"></span><span class="marks">(${q.m} marks)</span></div>
      ${c ? `<details class="scenario bz-case"><summary><strong>Case study: ${esc(c.name)}</strong></summary><p>${esc(c.text)}</p></details>` : ''}
      <h3 class="bz-qtext">${esc(q.q)}</h3>
      <div class="bz-plan">
        <p class="bz-plan-h"><strong>Plan it</strong> <span class="muted">using the ${esc(s ? s.name.toLowerCase() : '')} structure</span></p>
        ${(s ? s.steps : []).map((x, i) => `<label class="bz-step"><span class="bz-step-n">${i + 1}</span><span class="bz-step-l">${esc(x.label)}</span><textarea rows="2" data-step="${i}" placeholder="${esc(x.hint)}">${esc((st.plan || [])[i] || '')}</textarea></label>`).join('')}
        <div class="row"><button class="btn ghost small" data-act="useplan">Copy my plan into the answer</button></div>
      </div>
      <p class="bz-plan-h" style="margin-top:12px"><strong>Write it</strong></p>
      <textarea class="bz-answer" aria-label="Your answer" placeholder="Write your full answer here, in sentences and paragraphs…">${esc(st.text || '')}</textarea>
      <div class="row small-note muted"><span data-role="words"></span><span class="spacer"></span><button class="btn ghost small" data-act="timer">Start timer (${mins} min)</button><span class="score bz-time" data-role="time"></span></div>
      <div class="row" style="margin-top:6px">
        <button class="btn ghost small" data-act="guide">${levelled ? 'Show what to include' : 'Show mark scheme'}</button>
        <button class="btn small" data-act="ai">${st.ai ? 'Mark again' : 'Mark my answer with AI'}</button>
        <span class="status" data-role="note"></span>
      </div>
      <div class="ai-result ${st.ai ? '' : 'hidden'}" data-role="ai">${st.ai ? aiHtml(q, st.ai) : ''}</div>
      <div class="scheme hidden" data-role="guide">
        ${levelled
          ? `<p style="margin:0 0 4px"><strong>Indicative content</strong> (you don't need every point to reach Level 3):</p>
             <ul class="tight long-pts">${q.pts.map((pt, i) => `<li class="${covered.includes(i) ? 'got' : ''}">${esc(pt)}</li>`).join('')}</ul>
             <table class="levels"><tbody>${LEVELS.map((l, i) => `<tr><td><strong>Level ${i + 1}</strong><br><span class="muted">${b[i][0]}–${b[i][1]} marks</span></td><td>${esc(l)}</td></tr>`).join('')}</tbody></table>
             <label class="self-mark">Mark it yourself: <select data-role="self"><option value="">–</option>${Array.from({ length: q.m + 1 }, (_, n) => `<option value="${n}" ${st.self !== undefined && st.self !== '' && +st.self === n ? 'selected' : ''}>${n}</option>`).join('')}</select> / ${q.m}</label>`
          : `<p style="margin:0 0 4px"><strong>Mark scheme</strong> (tick what you got, max ${q.m}):</p>
             ${q.pts.map((pt, i) => `<label><input type="checkbox" data-i="${i}" ${ticks.includes(i) ? 'checked' : ''}><span>${esc(pt)}</span></label>`).join('')}`}
        ${q.tip ? `<div class="dstar"><strong>Top-grade tip:</strong> ${esc(q.tip)}</div>` : ''}
      </div>`;
    wire(el, q);
    return el;
  }
  function aiHtml(q, r) {
    return `<div class="row"><strong>AI mark${r.level !== undefined ? `: Level ${r.level}` : ''}</strong><span class="spacer"></span><span class="big score" style="font-size:28px">${r.score} / ${r.max}</span></div>
      ${r.awarded && r.awarded.length ? `<p class="ai-h">Points you earned</p><ul class="tight">${r.awarded.map((i) => `<li>✓ ${esc(q.pts[i])}</li>`).join('')}</ul>` : ''}
      ${r.feedback ? `<p class="ai-h">What went well</p><p>${esc(r.feedback)}</p>` : ''}
      ${r.score < r.max && r.improve ? `<p class="ai-h">${r.level !== undefined ? 'To reach the next level' : 'To get full marks'}</p><p>${esc(r.improve)}</p>` : ''}
      <p class="muted small-note">AI marking can make mistakes. If your teacher disagrees, go with your teacher.</p>`;
  }

  function wire(el, q) {
    const ta = el.querySelector('.bz-answer'), words = el.querySelector('[data-role=words]'), note = el.querySelector('[data-role=note]');
    const count = () => { const n = (ta.value.trim().match(/\S+/g) || []).length; words.textContent = `${n} word${n === 1 ? '' : 's'}`; };
    count();
    ta.oninput = () => { entry(q.id).text = ta.value; count(); save(); };
    el.querySelectorAll('[data-step]').forEach((t) => t.oninput = () => { const e = entry(q.id); e.plan = e.plan || []; e.plan[+t.dataset.step] = t.value; save(); });
    el.querySelector('[data-act=useplan]').onclick = () => {
      const parts = [...el.querySelectorAll('[data-step]')].map((t) => t.value.trim()).filter(Boolean);
      if (!parts.length) { note.textContent = 'Fill in your plan first.'; return; }
      ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + parts.join('\n\n');
      ta.oninput(); ta.focus(); note.textContent = 'Now turn your plan into full sentences.';
    };
    const guide = el.querySelector('[data-role=guide]'), gb = el.querySelector('[data-act=guide]'), label = gb.textContent;
    gb.onclick = () => { const h = guide.classList.toggle('hidden'); guide.classList.toggle('open', !h); gb.textContent = h ? label : label.replace('Show', 'Hide'); };
    const sel = el.querySelector('[data-role=self]');
    if (sel) sel.onchange = () => { entry(q.id).self = sel.value; save(); summary(); };
    el.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.onchange = () => {
      const e = entry(q.id), i = +cb.dataset.i; e.ticks = (e.ticks || []).filter((x) => x !== i); if (cb.checked) e.ticks.push(i);
      save(); summary();
    });
    // Exam timer: about 1.5 minutes per mark. It only shows the time; it never stops you writing.
    const tb = el.querySelector('[data-act=timer]'), tl = el.querySelector('[data-role=time]');
    tb.onclick = () => {
      if (timer && timer.el === el) { clearInterval(timer.id); timer = null; tl.textContent = ''; tb.textContent = tb.textContent.replace('Stop timer', 'Start timer'); return; }
      if (timer) { clearInterval(timer.id); timer.tl.textContent = ''; timer.tb.textContent = timer.label; }
      const label = tb.textContent, end = Date.now() + Math.ceil(q.m * 1.5) * 60000;
      const tick = () => { const left = Math.max(0, end - Date.now()), m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
        tl.textContent = left ? `${m}:${String(s).padStart(2, '0')}` : 'Time\'s up'; tl.classList.toggle('late', !left); if (!left) clearInterval(timer.id); };
      timer = { el, tl, tb, label, id: setInterval(tick, 1000) }; tick(); tb.textContent = label.replace('Start timer', 'Stop timer');
    };
    const ab = el.querySelector('[data-act=ai]'), box = el.querySelector('[data-role=ai]');
    ab.onclick = async () => {
      if (ta.value.trim().length < 20) { note.textContent = 'Write your answer first.'; return; }
      ab.disabled = true; note.textContent = 'Marking…';
      try {
        const res = await fetch('api/mark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'biz', qid: q.id, answer: ta.value }) });
        let r = {}; try { r = await res.json(); } catch (e) {}
        if (res.ok && Number.isInteger(r.score)) {
          const e = entry(q.id);
          e.ai = { score: r.score, max: r.max, awarded: r.awarded || [], covered: r.covered || [], feedback: r.feedback, improve: r.improve, text: ta.value };
          if (r.level !== undefined) e.ai.level = r.level;
          delete e.self; if (sel) sel.value = '';
          if (!POINT_TYPES.includes(q.type)) el.querySelectorAll('.long-pts li').forEach((li, i) => li.classList.toggle('got', e.ai.covered.includes(i)));
          else { e.ticks = e.ai.awarded.slice(); el.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = e.ticks.includes(+cb.dataset.i); }); }
          box.innerHTML = aiHtml(q, e.ai); box.classList.remove('hidden'); bump(box.querySelector('.score'));
          note.textContent = ''; save(); summary();
        } else note.textContent = r.error === 'bad_request' ? 'Your answer is too long to mark. Keep it under 6,000 characters.' : aiErrorText(res.status, r.error);
      } catch (e) { note.textContent = 'Couldn\'t connect. Check your internet and try again.'; }
      ab.disabled = false; ab.textContent = 'Mark again';
    };
  }

  function renderList() {
    const list = $('bz-list'); list.innerHTML = '';
    const qs = data.questions.filter((q) => (filt.c === 'all' || q.case === filt.c) && (filt.t === 'all' || q.type === filt.t));
    qs.forEach((q) => list.appendChild(card(q)));
    if (!qs.length) list.innerHTML = '<p class="muted">No questions match those filters yet.</p>';
    document.querySelectorAll('.bz-chip').forEach((b) => b.setAttribute('aria-pressed', String(filt[b.dataset.g] === b.dataset.v)));
    stagger(list.children, 6);
  }

  async function render() {
    const body = $('bz-body');
    if (!data) {
      body.innerHTML = '<p class="muted">Loading…</p>';
      try { data = await (await fetch('business/questions.json', { cache: 'no-cache' })).json(); }
      catch (e) { body.innerHTML = '<p class="muted">Couldn\'t load the questions. Check your connection and try again.</p>'; return; }
    }
    prog = ls.get(KEY, null) || { answers: {} };
    if (!prog.answers) prog.answers = {};
    $('bz-lead').textContent = `${data.course}. Plan with the structure, write your answer, then mark it yourself or with the AI.`;
    const types = [...new Set(data.questions.map((q) => q.type))];
    body.innerHTML = `
      <div class="card row bz-sum" id="bz-sum"></div>
      ${structureGuide()}
      <div class="bz-filters">
        <div class="row">${chip('c', 'all', 'All case studies')}${data.cases.map((c) => chip('c', c.id, c.name)).join('')}</div>
        <div class="row">${chip('t', 'all', 'All question types')}${types.map((t) => chip('t', t, data.structures[t] ? data.structures[t].name : t)).join('')}</div>
      </div>
      <div id="bz-list" class="stack"></div>`;
    body.querySelectorAll('.bz-chip').forEach((b) => b.onclick = () => { filt[b.dataset.g] = b.dataset.v; renderList(); });
    summary(); renderList();
    stagger(body.children, 4);
  }
  window.renderBusiness = render;
  window.addEventListener('studyhub:view', (e) => { if (e.detail.view === 'business') render(); });
})();
