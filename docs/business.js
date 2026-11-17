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
  let data = null, prog = null, filt = { c: 'all', t: 'all' }, timer = null, saveT = null, btab = 'write';

  const entry = (qid) => (prog.answers[qid] = prog.answers[qid] || { text: '', plan: [] });
  function save() {
    clearTimeout(saveT);
    prog._t = Date.now();
    saveT = setTimeout(flush, 500);
  }
  function flush() { clearTimeout(saveT); saveT = null; if (prog) { ls.set(KEY, prog); if (window.onProgressSaved) window.onProgressSaved('business', prog); } }
  // Save straight away if the page is closed or hidden before the half-second wait.
  addEventListener('pagehide', () => { if (saveT) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveT) flush(); });
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
      ${c ? (c.booklet
        ? `<div class="scenario bz-case"><strong>Case study: ${esc(c.name)}.</strong> Use your own booklet for the facts and figures.</div>`
        : `<details class="scenario bz-case"><summary><strong>Case study: ${esc(c.name)}</strong></summary><p>${esc(c.text)}</p></details>`) : ''}
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
      <nav class="bz-tabs" aria-label="Business practice">
        <button data-bt="write" aria-pressed="${btab === 'write'}">Exam writing</button>
        <button data-bt="terms" aria-pressed="${btab === 'terms'}">Key terms${(data.terms || []).length ? ` (${data.terms.length})` : ''}</button>
      </nav>
      <div id="bz-terms" class="stack ${btab === 'terms' ? '' : 'hidden'}"></div>
      <div id="bz-write" class="stack ${btab === 'write' ? '' : 'hidden'}">
      <div class="card row bz-sum" id="bz-sum"></div>
      ${data.cases.filter((c) => c.booklet).map((c) => `<div class="card bz-booklet"><strong>${esc(c.name)}</strong><p>${esc(c.text)}</p></div>`).join('')}
      ${structureGuide()}
      <details class="card bz-planner" id="bz-planner"><summary><strong>Media plan budget planner</strong> <span class="muted">(tap to open)</span></summary><div id="bz-plan-body"></div></details>
      <div class="bz-filters">
        <div class="row">${chip('c', 'all', 'All case studies')}${data.cases.map((c) => chip('c', c.id, c.name)).join('')}</div>
        <div class="row">${chip('t', 'all', 'All question types')}${types.map((t) => chip('t', t, data.structures[t] ? data.structures[t].name : t)).join('')}</div>
      </div>
      <div id="bz-list" class="stack"></div>
      </div>`;
    body.querySelectorAll('[data-bt]').forEach((b) => b.onclick = () => {
      btab = b.dataset.bt;
      body.querySelectorAll('[data-bt]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('bz-write').classList.toggle('hidden', btab !== 'write'); $('bz-terms').classList.toggle('hidden', btab !== 'terms');
      if (btab === 'terms') termsHome(); else stagger($('bz-write').children, 5);
    });
    if (btab === 'terms') termsHome();
    body.querySelectorAll('.bz-chip').forEach((b) => b.onclick = () => { filt[b.dataset.g] = b.dataset.v; renderList(); });
    summary(); renderList(); planner();
    stagger(btab === 'write' ? $('bz-write').children : body.children, 5);
  }
  // ---------- Key terms: match the term to its definition ----------
  // One term on the left, four definitions on the right (distractors come from the same topic
  // where possible, so they're close). Missed terms are kept in prog.terms.missed to retry.
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let kt = null; // the round in progress: { list, i, score, wrong: [], answered }
  const tstate = () => (prog.terms = prog.terms || { best: 0, missed: [] });
  function termsHome() {
    const box = $('bz-terms'), st = tstate(), all = data.terms || [];
    const missed = st.missed.filter((t) => all.some((x) => x.t === t));
    box.innerHTML = `
      <div class="card"><h2>Key terms</h2>
        <p class="lead">A term appears on the left. Pick the definition that matches it on the right. Every answer shows the right definition, so you learn as you go.</p>
        <div class="row">
          <button class="btn" data-kt="10">Play a round (10 terms)</button>
          <button class="btn ghost" data-kt="all">All ${all.length} terms</button>
          ${missed.length ? `<button class="btn ghost" data-kt="missed">Retry terms I missed (${missed.length})</button>` : ''}
        </div>
        ${st.best ? `<p class="muted small-note">Best round: ${st.best.score} / ${st.best.of}</p>` : ''}
      </div>
      <details class="card"><summary><strong>See all the terms and definitions</strong> <span class="muted">(tap to open)</span></summary>
        <dl class="kt-list">${all.map((x) => `<div class="gv-item"><dt>${esc(x.t)}</dt><dd>${esc(x.d)}</dd></div>`).join('')}</dl></details>`;
    box.querySelectorAll('[data-kt]').forEach((b) => b.onclick = () => {
      const m = b.dataset.kt, pool = m === 'missed' ? all.filter((x) => missed.includes(x.t)) : all;
      startTerms(m === '10' ? shuffle(pool).slice(0, 10) : shuffle(pool));
    });
    stagger(box.children, 3);
  }
  function startTerms(list) { kt = { list, i: 0, score: 0, wrong: [], answered: 0 }; termQ(); }
  function termQ() {
    const box = $('bz-terms'), all = data.terms;
    if (kt.i >= kt.list.length) return termsDone();
    const it = kt.list[kt.i];
    const same = shuffle(all.filter((x) => x.t !== it.t && x.g === it.g)), other = shuffle(all.filter((x) => x.t !== it.t && x.g !== it.g));
    const opts = shuffle([it, ...[...same, ...other].slice(0, 3)]);
    box.innerHTML = `
      <div class="row"><span class="score">Term ${kt.i + 1} of ${kt.list.length}</span><span class="spacer"></span><span class="score" id="kt-score">Score: ${kt.score}</span></div>
      <div class="progress"><div style="width:${kt.i / kt.list.length * 100}%"></div></div>
      <div class="kt-match">
        <div class="kt-term card"><span class="kt-label">Term</span><div class="kt-word">${esc(it.t)}</div><span class="muted small-note">Which definition matches?</span></div>
        <div class="kt-defs options">${opts.map((o) => `<button class="opt" data-t="${esc(o.t)}">${esc(o.d)}</button>`).join('')}</div>
      </div>
      <div id="kt-fb"></div>
      <div class="row"><button class="btn ghost small" id="kt-quit">End round</button></div>`;
    box.querySelectorAll('.kt-defs .opt').forEach((b) => b.onclick = () => pick(b, it));
    $('kt-quit').onclick = termsDone;
    stagger([box.querySelector('.kt-term'), ...box.querySelectorAll('.kt-defs .opt')]);
  }
  function pick(btn, it) {
    const btns = $('bz-terms').querySelectorAll('.kt-defs .opt');
    if (btns[0].disabled) return;
    const ok = btn.dataset.t === it.t, st = tstate();
    kt.answered++;
    btns.forEach((b) => { b.disabled = true; if (b.dataset.t === it.t) b.classList.add('right'); else if (b === btn) b.classList.add('wrong'); });
    if (ok) { kt.score++; st.missed = st.missed.filter((t) => t !== it.t); bump($('kt-score')); }
    else { kt.wrong.push(it); if (!st.missed.includes(it.t)) st.missed.push(it.t); }
    save();
    $('kt-score').textContent = `Score: ${kt.score}`;
    const chosen = data.terms.find((x) => x.t === btn.dataset.t);
    $('kt-fb').innerHTML = `<div class="feedback"><strong>${ok ? 'Correct.' : 'Not quite.'}</strong> <strong>${esc(it.t)}</strong>: ${esc(it.d)}${!ok && chosen ? `<br><span class="muted">The one you picked describes <strong>${esc(chosen.t)}</strong>.</span>` : ''}</div>
      <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="kt-next">${kt.i + 1 < kt.list.length ? 'Next term →' : 'See my score'}</button></div>`;
    const nx = $('kt-next'); nx.focus(); nx.onclick = () => { kt.i++; termQ(); };
  }
  function termsDone() {
    const box = $('bz-terms'), st = tstate(), done = kt.answered, of = Math.max(done, 1);
    if (done && (!st.best || kt.score / of > st.best.score / st.best.of)) { st.best = { score: kt.score, of: done }; save(); }
    box.innerHTML = `<div class="card"><div class="big">${kt.score} / ${done}</div>
      <p>${!done ? 'No terms answered.' : kt.score === done ? 'Perfect round!' : kt.score / done >= .7 ? 'Good work. Look over the ones you missed below.' : 'Keep going. Read the ones you missed, then retry them.'}</p>
      ${kt.wrong.length ? `<p class="ai-h">To learn</p><dl>${kt.wrong.map((x) => `<div class="gv-item"><dt>${esc(x.t)}</dt><dd>${esc(x.d)}</dd></div>`).join('')}</dl>` : ''}
      <div class="row" style="margin-top:12px"><button class="btn" id="kt-again">Back to key terms</button>${kt.wrong.length ? `<button class="btn ghost" id="kt-retry">Retry these (${kt.wrong.length})</button>` : ''}</div></div>`;
    $('kt-again').onclick = termsHome;
    if (kt.wrong.length) { const w = kt.wrong; $('kt-retry').onclick = () => startTerms(shuffle(w)); }
    stagger(box.children, 2);
  }

  // ---------- Media plan budget planner ----------
  // Type in the media options and costs from your booklet; it adds them up and checks the budget.
  // Saved with your answers (prog.planner).
  const money = (n) => '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  function planner() {
    const pl = (prog.planner = prog.planner || { budget: '', rows: [{ m: '', cost: '', unit: '', qty: '' }] });
    const box = $('bz-plan-body');
    box.innerHTML = `
      <p class="muted small-note">Add each media choice from your booklet: the cost, what it is per (e.g. per month, per week, per 1,000) and how many you'll buy. It adds them up so you can check you're within the budget in the brief.</p>
      <label class="bz-budget">Total budget (£) <input type="number" min="0" step="any" id="pl-budget" value="${esc(pl.budget)}" placeholder="from the brief"></label>
      <div class="tablebox"><table class="bz-plan-table"><thead><tr><th>Media</th><th>Cost (£)</th><th>Per</th><th>How many</th><th>Total</th><th>% of budget</th><th></th></tr></thead><tbody>
      ${pl.rows.map((r, i) => `<tr data-i="${i}">
        <td><input type="text" data-k="m" value="${esc(r.m)}" placeholder="e.g. fitness magazine ad" aria-label="Media"></td>
        <td><input type="number" min="0" step="any" data-k="cost" value="${esc(r.cost)}" aria-label="Cost"></td>
        <td><input type="text" data-k="unit" value="${esc(r.unit)}" placeholder="month" aria-label="Per"></td>
        <td><input type="number" min="0" step="any" data-k="qty" value="${esc(r.qty)}" aria-label="How many"></td>
        <td class="score" data-role="line"></td><td class="score" data-role="pct"></td>
        <td><button class="btn ghost small" data-act="del" aria-label="Remove this row">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row"><button class="btn ghost small" id="pl-add">Add a row</button><span class="spacer"></span><span id="pl-total" class="bz-total"></span></div>`;
    const update = () => {
      const budget = parseFloat(pl.budget) || 0;
      let total = 0;
      box.querySelectorAll('tbody tr').forEach((tr) => {
        const r = pl.rows[+tr.dataset.i], line = (parseFloat(r.cost) || 0) * (parseFloat(r.qty) || 0);
        total += line;
        tr.querySelector('[data-role=line]').textContent = line ? money(line) : '–';
        tr.querySelector('[data-role=pct]').textContent = line && budget ? Math.round(line / budget * 100) + '%' : '–';
      });
      const left = budget - total, el = $('pl-total');
      el.className = 'bz-total' + (budget && left < 0 ? ' over' : '');
      el.innerHTML = `Total <strong>${money(total)}</strong>${budget ? ` · ${left >= 0 ? `<strong>${money(left)}</strong> left (${Math.round(total / budget * 100)}% used)` : `<strong>${money(-left)} over budget</strong>`}` : ''}`;
    };
    $('pl-budget').oninput = (e) => { pl.budget = e.target.value; save(); update(); };
    box.querySelectorAll('tbody input').forEach((inp) => inp.oninput = () => { pl.rows[+inp.closest('tr').dataset.i][inp.dataset.k] = inp.value; save(); update(); });
    box.querySelectorAll('[data-act=del]').forEach((b) => b.onclick = () => { pl.rows.splice(+b.closest('tr').dataset.i, 1); if (!pl.rows.length) pl.rows.push({ m: '', cost: '', unit: '', qty: '' }); save(); planner(); $('bz-planner').open = true; });
    $('pl-add').onclick = () => { pl.rows.push({ m: '', cost: '', unit: '', qty: '' }); save(); planner(); $('bz-planner').open = true; };
    update();
  }

  window.renderBusiness = render;
  window.addEventListener('studyhub:view', (e) => { if (e.detail.view === 'business') render(); });
})();
