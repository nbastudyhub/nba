// Study Hub: Business exam writing (#business), following the teacher's 7 steps for the Unit 2 set task:
// 1 aim, 2 three SMART objectives, 3 two trends, 4 two competitors, 5 market research (reliability,
// validity, bias), 6 SWOT (2 per letter), 7 product life cycle and the 7 Ps, plus an extra PESTLE step.
// Points use the teacher's Point, Evidence, Explain, Link style, and steps can show the teacher's example.
// Each step has its own boxes, a checklist to tick, and AI feedback (functions/api/mark.js, kind "bizstep").
// Steps and key terms live in business/questions.json. Work is saved as progress under the id "business".
// Uses helpers from app.js: esc, stagger, bump, aiErrorText. The AI helper (assistant.js) switches to Business here.
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'sh-prog-business';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  let data = null, prog = null, saveT = null, btab = 'write';

  function save() { clearTimeout(saveT); prog._t = Date.now(); saveT = setTimeout(flush, 500); }
  function flush() { clearTimeout(saveT); saveT = null; if (prog) { ls.set(KEY, prog); if (window.onProgressSaved) window.onProgressSaved('business', prog); } }
  // Save straight away if the page is closed or hidden before the half-second wait.
  addEventListener('pagehide', () => { if (saveT) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveT) flush(); });

  const extra = (step) => /^Extra/i.test(step.title); // extra steps (e.g. PESTLE) aren't numbered
  const stepState = (id) => { const s = (prog.steps = prog.steps || {}); return (s[id] = s[id] || { f: {}, ticks: [] }); };
  const aimText = () => ((prog.steps && prog.steps.aim && prog.steps.aim.f.aim) || '').trim();
  const filled = (step) => { const st = stepState(step.id); return step.fields.filter((f) => (st.f[f.k] || '').trim()).length; };

  function summary() {
    const done = data.steps.filter((s) => filled(s) === s.fields.length).length;
    let got = 0, of = 0;
    data.steps.forEach((s) => { const st = stepState(s.id); got += (st.ticks || []).length; of += s.checks.length; });
    $('bz-sum').innerHTML = `<span class="big score">${done}</span><span class="score"> / ${data.steps.length}</span><span class="muted"> steps complete · ${got} of ${of} checklist points ticked</span><span class="spacer"></span><button class="btn ghost small" id="bz-copy">Copy all my work</button>`;
    $('bz-copy').onclick = copyAll;
    document.querySelectorAll('.bz-step-card').forEach((c) => {
      const s = data.steps.find((x) => x.id === c.dataset.step), n = filled(s);
      c.querySelector('[data-role=count]').textContent = n === s.fields.length ? 'Complete' : `${n} of ${s.fields.length} boxes`;
      c.classList.toggle('complete', n === s.fields.length);
    });
    document.querySelectorAll('[data-role=aim]').forEach((el) => { const a = aimText(); el.innerHTML = a ? `<strong>Your aim:</strong> ${esc(a)}` : '<strong>Your aim:</strong> <span class="muted">write it in step 1 first</span>'; });
  }

  // Everything in one block of text, e.g. to paste into a document when making your own notes.
  async function copyAll() {
    const text = data.steps.map((s, i) => {
      const st = stepState(s.id); let last = null;
      return `${i + 1}. ${s.title.toUpperCase()}\n` + s.fields.map((f) => {
        const head = f.group && f.group !== last ? `\n${f.group}\n` : ''; last = f.group || last;
        return `${head}${f.label}: ${(st.f[f.k] || '').trim() || '–'}`;
      }).join('\n');
    }).join('\n\n');
    const b = $('bz-copy');
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied ✓'; }
    catch (e) { b.textContent = 'Couldn\'t copy'; }
    setTimeout(() => { if ($('bz-copy')) $('bz-copy').textContent = 'Copy all my work'; }, 2500);
  }

  function aiHtml(step, r) {
    return `<div class="row"><strong>AI check</strong><span class="spacer"></span><span class="big score" style="font-size:28px">${r.score} / ${r.max}</span></div>
      ${r.feedback ? `<p class="ai-h">What went well</p><p>${esc(r.feedback)}</p>` : ''}
      ${r.score < r.max && r.improve ? `<p class="ai-h">To improve</p><p>${esc(r.improve)}</p>` : ''}
      <p class="muted small-note">The checklist points the AI thinks you've met are ticked below. AI can make mistakes; if your teacher disagrees, go with your teacher.</p>`;
  }

  function stepCard(step, i) {
    const st = stepState(step.id);
    const el = document.createElement('section'); el.className = 'card bz-step-card'; el.dataset.step = step.id;
    let last = null;
    const fieldsHtml = step.fields.map((f) => {
      const head = f.group && f.group !== last ? `<p class="bz-group">${esc(f.group)}</p>` : ''; last = f.group || last;
      return `${head}<label class="bz-field"><span class="bz-field-l">${esc(f.label)}</span>${f.short
        ? `<input type="text" data-k="${f.k}" value="${esc(st.f[f.k] || '')}" placeholder="${esc(f.hint)}">`
        : `<textarea rows="3" data-k="${f.k}" placeholder="${esc(f.hint)}">${esc(st.f[f.k] || '')}</textarea>`}</label>`;
    }).join('');
    el.innerHTML = `
      <div class="row bz-step-head"><span class="bz-step-num">${extra(step) ? '+' : i + 1}</span><h2>${esc(step.title)}</h2><span class="spacer"></span><span class="muted small-note" data-role="count"></span></div>
      <p>${esc(step.intro)}</p>
      ${step.id !== 'aim' ? '<p class="bz-aim" data-role="aim"></p>' : ''}
      <div class="bz-fields">${fieldsHtml}</div>
      ${step.example ? `<details class="bz-example"><summary><strong>See a good example</strong> <span class="muted">(${esc(step.example.title)})</span></summary>
        ${step.example.text.map((t) => `<p>${esc(t).replace(/(^| )(Point|Evidence|Explain|Link):/g, (m, sp, w) => `${sp ? '<br>' : ''}<strong>${w}:</strong>`)}</p>`).join('')}
        ${step.example.note ? `<p class="bz-example-note"><strong>Tip:</strong> ${esc(step.example.note)}</p>` : ''}</details>` : ''}
      <div class="scheme open">
        <p style="margin:0 0 4px"><strong>Check your work</strong> (tick each one you've done):</p>
        ${step.checks.map((c, j) => `<label><input type="checkbox" data-i="${j}" ${(st.ticks || []).includes(j) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}
        ${step.tip ? `<div class="dstar"><strong>Tip:</strong> ${esc(step.tip)}</div>` : ''}
      </div>
      <div class="row" style="margin-top:10px"><button class="btn small" data-act="ai">${st.ai ? 'Check again with AI' : 'Check this step with AI'}</button><span class="status" data-role="note"></span></div>
      <div class="ai-result ${st.ai ? '' : 'hidden'}" data-role="ai">${st.ai ? aiHtml(step, st.ai) : ''}</div>`;
    el.querySelectorAll('[data-k]').forEach((inp) => inp.oninput = () => { stepState(step.id).f[inp.dataset.k] = inp.value; save(); summary(); });
    el.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.onchange = () => {
      const s2 = stepState(step.id), j = +cb.dataset.i; s2.ticks = (s2.ticks || []).filter((x) => x !== j); if (cb.checked) s2.ticks.push(j);
      save(); summary();
    });
    const ab = el.querySelector('[data-act=ai]'), note = el.querySelector('[data-role=note]'), box = el.querySelector('[data-role=ai]');
    ab.onclick = async () => {
      const s2 = stepState(step.id);
      if (!filled(step)) { note.textContent = 'Fill in some boxes first.'; return; }
      ab.disabled = true; note.textContent = 'Checking…';
      try {
        const res = await fetch('api/mark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'bizstep', step: step.id, fields: s2.f, aim: aimText() }) });
        let r = {}; try { r = await res.json(); } catch (e) {}
        if (res.ok && Number.isInteger(r.score)) {
          s2.ai = { score: r.score, max: r.max, awarded: r.awarded || [], feedback: r.feedback, improve: r.improve };
          s2.ticks = s2.ai.awarded.slice();
          el.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = s2.ticks.includes(+cb.dataset.i); });
          box.innerHTML = aiHtml(step, s2.ai); box.classList.remove('hidden'); bump(box.querySelector('.score'));
          note.textContent = ''; save(); summary();
        } else note.textContent = r.error === 'bad_request' ? 'That\'s too long to check in one go. Shorten some boxes.' : aiErrorText(res.status, r.error);
      } catch (e) { note.textContent = 'Couldn\'t connect. Check your internet and try again.'; }
      ab.disabled = false; ab.textContent = 'Check again with AI';
    };
    return el;
  }

  async function render() {
    const body = $('bz-body');
    if (!data) {
      body.innerHTML = '<p class="muted">Loading…</p>';
      try { data = await (await fetch('business/questions.json', { cache: 'no-cache' })).json(); }
      catch (e) { body.innerHTML = '<p class="muted">Couldn\'t load this page. Check your connection and try again.</p>'; return; }
    }
    prog = ls.get(KEY, null) || {};
    $('bz-lead').textContent = `${data.course}. Work through the steps your teacher uses: Point, Evidence, Explain, then Link everything back to the aim.`;
    const c = (data.cases || [])[0];
    body.innerHTML = `
      <nav class="bz-tabs" aria-label="Business practice">
        <button data-bt="write" aria-pressed="${btab === 'write'}">Exam writing</button>
        <button data-bt="terms" aria-pressed="${btab === 'terms'}">Key terms${(data.terms || []).length ? ` (${data.terms.length})` : ''}</button>
      </nav>
      <div id="bz-terms" class="stack ${btab === 'terms' ? '' : 'hidden'}"></div>
      <div id="bz-write" class="stack ${btab === 'write' ? '' : 'hidden'}">
        <div class="card row bz-sum" id="bz-sum"></div>
        ${c ? `<div class="card bz-booklet"><strong>${esc(c.name)}</strong><p>${esc(c.text)}</p></div>` : ''}
        <ul class="bz-steps-nav">${data.steps.map((s, i) => `<li><a href="#business" data-go="${s.id}"><span class="bz-nav-n">${extra(s) ? '+' : i + 1}</span>${esc(s.title)}</a></li>`).join('')}</ul>
        <div id="bz-steps" class="stack"></div>
      </div>`;
    const list = $('bz-steps');
    data.steps.forEach((s, i) => list.appendChild(stepCard(s, i)));
    body.querySelectorAll('[data-go]').forEach((a) => a.onclick = (e) => { e.preventDefault(); const el = document.querySelector(`.bz-step-card[data-step="${a.dataset.go}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    body.querySelectorAll('[data-bt]').forEach((b) => b.onclick = () => {
      btab = b.dataset.bt;
      body.querySelectorAll('[data-bt]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('bz-write').classList.toggle('hidden', btab !== 'write'); $('bz-terms').classList.toggle('hidden', btab !== 'terms');
      if (btab === 'terms') termsHome(); else stagger($('bz-write').children, 5);
    });
    summary();
    if (btab === 'terms') termsHome();
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

  window.renderBusiness = render;
  window.addEventListener('studyhub:view', (e) => { if (e.detail.view === 'business') render(); });
})();
