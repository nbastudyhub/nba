// Study Hub accounts: sign up / sign in / sign out, and syncing progress with /api/progress.
// Progress is still saved on the device first (so it works offline); when signed in, every
// change is also sent to the account, and signing in merges the device's and account's progress.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const PREFIX = 'sh-prog-';

  let me = null;           // signed-in username, or null
  let admin = false;       // true for usernames in the ADMIN_USERS setting
  let available = true;    // false on the GitHub Pages backup, or before the database is set up
  let offReason = 'no_accounts_here';
  let syncState = '';      // '', 'syncing', 'synced', 'offline', 'error'
  let lastSynced = 0;
  let mode = 'login';      // which form to show: login, signup, reset
  let notice = null;       // { kind, html } shown at the top of the account page
  let recovery = null;     // a recovery code to show once

  async function api(method, path, body) {
    try {
      const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      let data = {}; try { data = await res.json(); } catch (e) { data = { error: res.status === 404 ? 'no_accounts_here' : 'bad_reply' }; }
      return { ok: res.ok, status: res.status, data };
    } catch (e) { return { ok: false, status: 0, data: { error: 'offline' } }; }
  }

  // ---------- merging ----------
  const localIds = () => { const ids = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PREFIX)) ids.push(k.slice(PREFIX.length)); } } catch (e) {} return ids; };
  const hasContent = (e) => e && ((e.text && e.text.trim()) || (e.ticks && e.ticks.length) || e.ai || (e.self !== undefined && e.self !== ''));
  function merge(a, b) {
    if (!a) return b; if (!b) return a;
    const newer = (b._t || 0) > (a._t || 0) ? b : a, older = newer === a ? b : a;
    const out = { ...older, ...newer, answers: {} };
    for (const k of ['fcBest', 'qzBest', 'apBest']) out[k] = Math.max(a[k] || 0, b[k] || 0);
    const qids = new Set([...Object.keys(a.answers || {}), ...Object.keys(b.answers || {})]);
    for (const q of qids) {
      const n = (newer.answers || {})[q], o = (older.answers || {})[q];
      out.answers[q] = hasContent(n) ? n : (o || n);
    }
    out._t = Math.max(a._t || 0, b._t || 0);
    return out;
  }

  // ---------- pushing changes ----------
  const dirty = new Set(ls.get('sh-dirty', []));
  const keepDirty = () => ls.set('sh-dirty', [...dirty]);
  let pushTimer = null;
  function queue(id) { dirty.add(id); keepDirty(); clearTimeout(pushTimer); pushTimer = setTimeout(flush, 1500); }
  async function flush() {
    if (!me || !dirty.size) return true;
    setSync('syncing');
    for (const id of [...dirty]) {
      const data = ls.get(PREFIX + id, null) || { answers: {}, _t: Date.now() };
      const r = await api('POST', 'api/progress', { deckId: id, data });
      if (r.ok) { dirty.delete(id); keepDirty(); }
      else if (r.data.error === 'signed_out') { signedOut(); return false; }
      else { setSync(r.status === 0 ? 'offline' : 'error'); return false; }
    }
    lastSynced = Date.now(); setSync('synced'); return true;
  }
  window.onProgressSaved = (id) => { if (me) queue(id); };
  window.onProgressReset = (ids) => { if (me) ids.forEach(queue); };
  addEventListener('online', () => { if (me) flush(); });

  async function fullSync() {
    setSync('syncing');
    const r = await api('GET', 'api/progress');
    if (!r.ok) { if (r.data.error === 'signed_out') signedOut(); else setSync(r.status === 0 ? 'offline' : 'error'); return; }
    const server = r.data.decks || {};
    const ids = new Set([...localIds(), ...Object.keys(server)]);
    for (const id of ids) {
      const local = ls.get(PREFIX + id, null), remote = server[id] ? server[id].data : null;
      const merged = merge(local, remote);
      if (!merged) continue;
      ls.set(PREFIX + id, merged);
      if (JSON.stringify(merged) !== JSON.stringify(remote)) dirty.add(id);
    }
    keepDirty();
    if (window.studyHub) window.studyHub.reloadProgress();
    await flush();
  }

  function clearDevice() {
    localIds().forEach((id) => ls.del(PREFIX + id));
    dirty.clear(); keepDirty();
    if (window.studyHub) window.studyHub.reloadProgress();
  }

  // ---------- state ----------
  function setSync(s) { syncState = s; renderLink(); if (isOpen()) render(); }
  // remember = false: keep the username only for this browser session (sessionStorage), and mark the device
  // so its progress is cleared next time the site opens without a signed-in user (shared/school computers).
  const ss = { get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { sessionStorage.removeItem(k); } catch (e) {} } };
  function signedIn(username, remember = !ss.get('sh-user')) {
    me = username;
    if (remember) { ls.set('sh-user', username); ss.del('sh-user'); ls.del('sh-temp'); }
    else { ss.set('sh-user', username); ls.del('sh-user'); ls.set('sh-temp', true); }
    renderLink();
  }
  function signedOut() { me = null; setAdmin(false); ls.del('sh-user'); ss.del('sh-user'); syncState = ''; renderLink(); gate(true); if (isOpen()) render(); }

  // ---------- Leaderboard (on the Progress page) ----------
  // Students ranked by lessons completed at 100%, then overall progress (functions/api/leaderboard.js).
  async function renderLeaderboard() {
    const box = $('pv-lb');
    if (!available || !me) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (!box.innerHTML) box.innerHTML = '<p class="muted">Loading the leaderboard…</p>';
    await flush(); // send your latest progress first, so your own row is up to date
    const r = await api('GET', 'api/leaderboard');
    if (!r.ok) { if (r.status === 404 || r.data.error === 'no_accounts_here') box.classList.add('hidden'); else box.innerHTML = '<p class="muted">Couldn\'t load the leaderboard. Try again later.</p>'; return; }
    const { top, me: mine, lessons } = r.data, medal = (n) => ['🥇', '🥈', '🥉'][n - 1] || n;
    box.innerHTML = `<div class="row"><h2 style="margin:0">🏆 Leaderboard</h2><span class="spacer"></span><span class="muted small-note">Lessons completed at 100%</span></div>
      <p class="muted small-note">A lesson counts when every flashcard is known and you have full marks in its Quiz, Apply it, Exam practice and Long answer (the Progress bars all full).</p>
      ${top.length ? `<div class="tablebox"><table class="lb-table"><thead><tr><th>#</th><th>Student</th><th>Lessons at 100%</th><th>Overall</th></tr></thead><tbody>
        ${top.map((u) => `<tr class="${u.username === mine.username ? 'lb-me' : ''}"><td class="lb-rank">${medal(u.rank)}</td><td><strong>${esc(u.username)}</strong>${u.username === mine.username ? ' (you)' : ''}</td><td class="score">${u.completed} / ${lessons}</td><td class="score">${u.overall}%</td></tr>`).join('')}
        </tbody></table></div>` : '<p>Nobody has completed a lesson at 100% yet. Be the first!</p>'}
      <p class="lb-mine">${mine.rank ? `You're <strong>#${mine.rank}</strong> with ${mine.completed} lesson${mine.completed === 1 ? '' : 's'} at 100%${mine.hidden ? ' (hidden from others)' : ''}.` : 'Complete a lesson at 100% to join the leaderboard.'}
        <button class="btn ghost small" id="lb-hide">${mine.hidden ? 'Show me on the leaderboard' : 'Hide me from the leaderboard'}</button></p>`;
    $('lb-hide').onclick = async () => { const res = await api('POST', 'api/leaderboard', { hide: !mine.hidden }); if (res.ok) renderLeaderboard(); };
  }
  window.renderLeaderboard = renderLeaderboard;

  // ---------- Sign-in screen ----------
  // Everyone signs in (or creates an account) before using the site. index.html hides the site at once
  // unless this device remembers a signed-in user; this confirms it with the server. If accounts
  // aren't available (backup site) or the device is offline, people are let in.
  let goAfter = null; // where to go once signed in, e.g. a lesson link they opened
  const gated = () => document.documentElement.classList.contains('gated');
  function gate(on) {
    if (on && !available) on = false;
    if (on === gated()) { if (on && location.hash !== '#account') location.hash = '#account'; return; }
    if (on) {
      if (location.hash && location.hash !== '#account') goAfter = location.hash;
      document.documentElement.classList.add('gated');
      if (location.hash !== '#account') location.hash = '#account';
      else window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      document.documentElement.classList.remove('gated');
      if (!recovery) leaveGate();
    }
  }
  function leaveGate() {
    const to = goAfter && goAfter !== '#account' ? goAfter : '#';
    goAfter = null;
    if (location.hash === to || (to === '#' && !location.hash)) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = to;
  }
  const isOpen = () => !$('accountview').classList.contains('hidden');

  // ---------- Admin page (#admin), only for admins ----------
  function setAdmin(on) {
    admin = on;
    $('admin-link').classList.toggle('hidden', !on);
    if (!on && location.hash === '#admin') $('ad-body').innerHTML = '<div class="card">This page is only for the site owner.</div>';
  }
  const when = (t) => {
    if (!t) return '–';
    const d = new Date(t), days = Math.floor((Date.now() - t) / 86400000);
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${date}${days === 0 ? ' (today)' : days === 1 ? ' (yesterday)' : days < 31 ? ` (${days} days ago)` : ''}`;
  };
  async function renderAdmin() {
    const body = $('ad-body');
    if (!me) { body.innerHTML = '<div class="card">Sign in with your admin account to see this page. <a href="#account">Sign in</a></div>'; return; }
    body.innerHTML = '<p class="muted">Loading…</p>';
    const r = await api('GET', 'api/admin');
    if (!r.ok) {
      body.innerHTML = `<div class="card">${r.data.error === 'not_admin' ? 'This page is only for the site owner.' : r.data.error === 'signed_out' ? 'Your sign-in has expired. <a href="#account">Sign in again</a>.' : 'Couldn\'t load the admin data. Try again in a minute.'}</div>`;
      return;
    }
    const { totals, users, lessons } = r.data;
    const titles = Object.fromEntries(((window.studyHub && window.studyHub.index) || []).map((d) => [d.id, d.title]));
    titles.business = 'Business: exam writing';
    const tile = (n, label) => `<div class="card ad-tile"><div class="big">${n}</div><div class="muted">${label}</div></div>`;
    body.innerHTML = `
      <div class="ad-tiles">${tile(totals.users, 'accounts')}${tile(totals.newThisWeek, 'new this week')}${tile(totals.activeThisWeek, 'active this week')}${tile(totals.signedInNow, 'signed in now')}</div>
      <div class="card tablebox"><h3>Accounts</h3>
        ${users.length ? `<table><thead><tr><th>Username</th><th>Signed up</th><th>Last sign-in</th><th>Last studied</th><th>Lessons</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr data-user="${esc(u.username)}"><td><strong>${esc(u.username)}</strong>${u.admin ? ' <span class="ad-live ad-admin">admin</span>' : ''}${u.signedIn ? ' <span class="ad-live">signed in</span>' : ''}</td><td>${when(u.signedUp)}</td><td>${when(u.lastSignIn)}</td><td>${when(u.lastStudied)}</td><td>${u.lessons}</td>
          <td class="ad-actions">${u.admin ? '' : `<button class="btn ghost small" data-resetpw="${esc(u.username)}">Reset password</button> <button class="btn danger small" data-remove="${esc(u.username)}">Remove</button>`}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No accounts yet.</p>'}
        <div id="ad-confirm"></div>
        <p class="muted small-note">"Last sign-in" only covers sign-ins that haven't been signed out or expired. Passwords are never shown: they are stored scrambled.</p>
      </div>
      <div class="card tablebox"><h3>Most studied lessons</h3>
        ${lessons.length ? `<table><thead><tr><th>Lesson</th><th>Learners</th><th>Last studied</th></tr></thead><tbody>
        ${lessons.map((l) => `<tr><td>${esc(titles[l.id] || l.id)}</td><td>${l.learners}</td><td>${when(l.last)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">Nobody has saved progress to an account yet.</p>'}
      </div>
      <div class="card stack" id="ad-ai"><div class="row"><h3 style="margin:0">AI questions</h3><span class="spacer"></span><span class="muted small-note">Kept for 30 days</span></div>
        <p class="muted small-note">What students asked the AI helper and sent for AI marking, newest first. Students are told their questions are saved.</p>
        <div class="row"><select class="ac-input ad-ai-user" id="ad-ai-user" aria-label="Student"><option value="">All students</option>${users.map((u) => `<option value="${esc(u.username)}">${esc(u.username)}</option>`).join('')}</select>
          <input class="ac-input ad-ai-q" id="ad-ai-q" type="search" placeholder="Search questions, answers or lessons…" aria-label="Search AI questions">
          <button class="btn small" id="ad-ai-go">Show</button></div>
        <div id="ad-ai-list" class="stack"></div></div>
      <div class="row"><button class="btn ghost small" id="ad-refresh">Refresh</button></div>`;
    $('ad-refresh').onclick = renderAdmin;
    $('ad-ai-go').onclick = loadAi; $('ad-ai-user').onchange = loadAi;
    $('ad-ai-q').onkeydown = (e) => { if (e.key === 'Enter') loadAi(); };
    loadAi();
    body.querySelectorAll('[data-remove]').forEach((btn) => btn.onclick = () => confirmRemove(btn.dataset.remove));
    body.querySelectorAll('[data-resetpw]').forEach((btn) => btn.onclick = () => confirmResetPw(btn.dataset.resetpw));
  }
  // Give a locked-out student a temporary password. Their real password is never shown (it's only stored scrambled).
  function confirmResetPw(username) {
    const box = $('ad-confirm');
    box.innerHTML = `<div class="ad-remove ad-reset card">
      <p><strong>Reset ${esc(username)}'s password?</strong> They'll get a new temporary password and be signed out on every device. Their progress is kept.</p>
      <div class="row"><button class="btn" id="ad-rp-go">Make a temporary password</button><button class="btn ghost" id="ad-rp-cancel">Cancel</button><span class="status" id="ad-rp-note"></span></div></div>`;
    $('ad-rp-cancel').onclick = () => { box.innerHTML = ''; };
    $('ad-rp-go').onclick = async () => {
      $('ad-rp-go').disabled = true; $('ad-rp-note').textContent = 'Resetting…';
      const r = await api('POST', 'api/admin', { action: 'resetpw', username });
      if (!r.ok) { $('ad-rp-note').textContent = { cant_remove_admin: 'Admin passwords can\'t be reset here.', not_found: 'That account no longer exists.', not_admin: 'Only admins can do this.', rate_limited: 'Too many changes in a short time. Try again shortly.' }[r.data.error] || 'Couldn\'t reset it. Try again.'; $('ad-rp-go').disabled = false; return; }
      box.innerHTML = `<div class="ad-reset card"><p><strong>Temporary password for ${esc(username)}</strong> (shown once, so give it to them now):</p>
        <p class="code-big" id="ad-rp-code">${esc(r.data.tempPassword)}</p>
        <p class="muted small-note">Tell them to sign in with it, then go to Account → Change my password to pick their own. Share it with them privately.</p>
        <div class="row"><button class="btn ghost small" id="ad-rp-copy">Copy</button><span class="spacer"></span><button class="btn small" id="ad-rp-done">Done</button></div></div>`;
      $('ad-rp-copy').onclick = async () => { try { await navigator.clipboard.writeText(r.data.tempPassword); $('ad-rp-copy').textContent = 'Copied ✓'; } catch (e) { $('ad-rp-copy').textContent = 'Select and copy it'; } };
      $('ad-rp-done').onclick = () => { box.innerHTML = ''; };
    };
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  // ---------- AI questions (admin) ----------
  const kindLabel = { helper: 'AI helper', mark: 'AI marking', long: 'Long answer marking', bizstep: 'Business AI check' };
  async function loadAi() {
    const list = $('ad-ai-list'); if (!list) return;
    list.innerHTML = '<p class="muted">Loading…</p>';
    const qs = new URLSearchParams({ view: 'ai', user: $('ad-ai-user').value, q: $('ad-ai-q').value.trim() });
    const r = await api('GET', 'api/admin?' + qs);
    if (!r.ok) { list.innerHTML = '<p class="muted">Couldn\'t load the AI questions. Try again.</p>'; return; }
    const titles = Object.fromEntries(((window.studyHub && window.studyHub.index) || []).map((d) => [d.id, d.title]));
    const place = (p) => { const id = String(p || '').split(' ')[0]; return titles[id] ? titles[id] + String(p).slice(id.length) : p === 'business' ? 'Business' : p; };
    list.innerHTML = r.data.entries.length ? r.data.entries.map((e) => `<details class="ad-ai-item">
        <summary><span class="ad-ai-meta"><strong>${esc(e.username || 'unknown')}</strong> · ${esc(kindLabel[e.kind] || e.kind)} · ${esc(place(e.place) || '')} · <span class="muted">${new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></span>
          <span class="ad-ai-q-text">${esc(String(e.question).slice(0, 180))}${String(e.question).length > 180 ? '…' : ''}</span></summary>
        <p class="ai-h">${e.kind === 'helper' ? 'Question' : 'What they sent'}</p><p class="ad-ai-pre">${esc(e.question)}</p>
        <p class="ai-h">${e.kind === 'helper' ? 'AI answer' : 'AI mark'}</p><p class="ad-ai-pre">${esc(e.answer || '')}</p></details>`).join('')
      : '<p class="muted">Nothing found.</p>';
  }

  // Removing an account can't be undone, so the admin types the username to confirm.
  function confirmRemove(username) {
    const box = $('ad-confirm');
    box.innerHTML = `<div class="ad-remove card">
      <p><strong>Remove ${esc(username)}?</strong> This deletes the account, all of its saved progress and signs it out everywhere. It can't be undone.</p>
      <label class="ac-label" for="ad-confirm-name">Type <strong>${esc(username)}</strong> to confirm</label>
      <input class="ac-input" id="ad-confirm-name" autocomplete="off" autocapitalize="none" spellcheck="false">
      <div class="row" style="margin-top:10px"><button class="btn danger" id="ad-confirm-go" disabled>Remove account</button><button class="btn ghost" id="ad-confirm-cancel">Cancel</button><span class="status" id="ad-confirm-note"></span></div></div>`;
    const inp = $('ad-confirm-name'), go = $('ad-confirm-go');
    inp.oninput = () => { go.disabled = inp.value.trim().toLowerCase() !== username; };
    $('ad-confirm-cancel').onclick = () => { box.innerHTML = ''; };
    go.onclick = async () => {
      go.disabled = true; $('ad-confirm-note').textContent = 'Removing…';
      const r = await api('POST', 'api/admin', { action: 'delete', username });
      if (r.ok) { await renderAdmin(); const n = $('ad-confirm'); if (n) n.innerHTML = `<div class="ac-notice ok">${esc(username)} has been removed.</div>`; }
      else { $('ad-confirm-note').textContent = { cant_remove_admin: 'Admin accounts can\'t be removed here.', not_found: 'That account no longer exists.', not_admin: 'Only admins can remove accounts.', rate_limited: 'Too many removals in a short time. Try again shortly.' }[r.data.error] || 'Couldn\'t remove that account. Try again.'; go.disabled = false; }
    };
    inp.focus(); box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  window.addEventListener('studyhub:view', (e) => { if (e.detail.view === 'admin') renderAdmin(); });

  function renderLink() {
    const a = $('account-link');
    if (!a) return;
    const icon = syncState === 'syncing' ? '⟳' : syncState === 'offline' || syncState === 'error' ? '⚠' : '✓';
    a.textContent = me ? `👤 ${me} ${icon}` : 'Sign in';
    a.title = me ? syncLabel() : 'Sign in to sync your progress between devices';
  }
  function syncLabel() {
    if (syncState === 'syncing') return 'Syncing…';
    if (syncState === 'offline') return 'Offline. Your changes are saved on this device and will sync when you\'re back online.';
    if (syncState === 'error') return 'Couldn\'t sync just now. Your changes are saved on this device and will sync later.';
    return lastSynced ? `Synced at ${new Date(lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Synced';
  }

  // ---------- page ----------
  const errorText = {
    bad_username: 'Usernames are 3 to 20 characters: letters, numbers and _ only.',
    bad_password: 'Passwords need at least 8 characters.',
    taken: 'That username is taken. Try another.',
    wrong_login: 'That username and password don\'t match.',
    wrong_code: 'That username and recovery code don\'t match.',
    locked: 'Too many wrong tries. Wait 15 minutes, then try again.',
    rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
    accounts_off: 'Accounts aren\'t switched on yet.',
    no_accounts_here: 'Accounts only work on the main site: nbastudyhub.pages.dev',
    offline: 'You\'re offline. Connect to the internet and try again.'
  };
  const say = (kind, text) => { notice = { kind, html: esc(text) }; };
  const privacy = `<p class="muted small-note">Your account stores only your username, a scrambled (hashed) password and your study progress. Questions you ask the AI helper and work you send for AI marking are saved for 30 days and can be seen by the site owner. No email or real name needed, so please don't use your full name as your username.</p>`;

  function render() {
    const body = $('ac-body');
    let html = notice ? `<div class="ac-notice ${notice.kind}">${notice.html}</div>` : '';
    if (recovery) {
      html += `<div class="card ac-code"><h3>Your recovery code</h3>
        <p>If you ever forget your password, this code is the <strong>only</strong> way back into your account. Write it down or save it somewhere safe. It won't be shown again.</p>
        <p class="code-big" id="ac-code">${esc(recovery)}</p>
        <div class="row"><button class="btn ghost small" id="ac-copy" type="button">Copy code</button><span class="spacer"></span><button class="btn" id="ac-saved" type="button">I've saved it</button></div></div>`;
    } else if (!available) {
      html += `<div class="card"><p>${esc(errorText[offReason])}</p></div>`;
    } else if (me) {
      html += `<div class="card stack">
          <div><div class="code">SIGNED IN AS</div><h2 style="margin:0">👤 ${esc(me)}</h2><p class="muted" id="ac-sync">${esc(syncLabel())}</p></div>
          <p>Your flashcards, quiz and exam scores, written answers and AI marks are saved to your account, so they appear on any device you sign in on.</p>
          <div class="row"><button class="btn" id="ac-syncnow" type="button">Sync now</button><button class="btn ghost" id="ac-logout" type="button">Sign out</button></div>
          <p class="muted small-note">Signing out removes your progress from this device (it stays safe in your account). Good for shared computers.</p>
        </div>
        <details class="card"><summary><strong>Change my password</strong></summary>
          <form class="stack" id="ac-pw-form" style="margin-top:10px">
            <p>If an admin gave you a temporary password, change it here to one only you know. This signs you out on your other devices.</p>
            <label class="ac-label" for="ac-pw-old">Current password</label>
            <input class="ac-input" type="password" id="ac-pw-old" autocomplete="current-password" required>
            <label class="ac-label" for="ac-pw-new">New password (at least 8 characters)</label>
            <input class="ac-input" type="password" id="ac-pw-new" autocomplete="new-password" minlength="8" maxlength="128" required>
            <div class="row"><button class="btn" type="submit" id="ac-pw-go">Change password</button><span class="status" id="ac-pw-note"></span></div>
          </form>
        </details>
        <details class="card"><summary><strong>Delete my account</strong></summary>
          <form class="stack" id="ac-del-form" style="margin-top:10px">
            <p>This permanently deletes your account and all its saved progress. Type your password to confirm.</p>
            <input class="ac-input" type="password" id="ac-del-pw" autocomplete="current-password" aria-label="Your password" placeholder="Your password">
            <div class="row"><button class="btn danger" type="submit">Delete my account</button></div>
          </form>
        </details>${privacy}`;
    } else {
      const tabs = `<div class="views ac-tabs">
        <button type="button" class="view-link" data-mode="login" aria-current="${mode === 'login' ? 'page' : 'false'}">Sign in</button>
        <button type="button" class="view-link" data-mode="signup" aria-current="${mode === 'signup' ? 'page' : 'false'}">Create account</button>
        <button type="button" class="view-link" data-mode="reset" aria-current="${mode === 'reset' ? 'page' : 'false'}">Forgot password</button></div>`;
      const intro = {
        login: 'Sign in to sync your progress between your phone and computer.',
        signup: 'Pick a username and password. Any progress already on this device will be added to your new account.',
        reset: 'Use the recovery code you saved when you created your account to set a new password.'
      }[mode];
      html += `<div class="card stack">${tabs}<p>${intro}</p>
        <form class="stack" id="ac-form">
          <label class="ac-label" for="ac-user">Username</label>
          <input class="ac-input" id="ac-user" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required>
          ${mode === 'reset' ? `<label class="ac-label" for="ac-rec">Recovery code</label>
          <input class="ac-input" id="ac-rec" autocomplete="off" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX-XXXX" required>` : ''}
          <label class="ac-label" for="ac-pw">${mode === 'reset' ? 'New password' : 'Password'}</label>
          <div class="pw-wrap">
            <input class="ac-input" id="ac-pw" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="${mode === 'login' ? 1 : 8}" maxlength="128" required>
            <button type="button" class="pw-toggle" id="ac-pw-show" aria-controls="ac-pw" aria-pressed="false" aria-label="Show password">Show</button>
          </div>
          ${mode === 'login' ? '' : '<p class="muted small-note">Username: 3 to 20 letters, numbers or _. Password: at least 8 characters.</p>'}
          <label class="ac-remember"><input type="checkbox" id="ac-remember" checked> <span><strong>Remember me on this device</strong><br><span class="muted small-note">Untick on a school or shared computer: you'll be signed out when the browser closes, and your progress won't stay on it.</span></span></label>
          <div class="row"><button class="btn" type="submit" id="ac-submit">${{ login: 'Sign in', signup: 'Create account', reset: 'Set new password' }[mode]}</button></div>
        </form></div>${privacy}`;
    }
    body.innerHTML = html;
    wire();
  }

  function wire() {
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    document.querySelectorAll('.ac-tabs [data-mode]').forEach((b) => b.onclick = () => { mode = b.dataset.mode; notice = null; render(); });
    on('ac-copy', async () => { try { await navigator.clipboard.writeText(recovery); $('ac-copy').textContent = 'Copied ✓'; } catch (e) { $('ac-copy').textContent = 'Select and copy it yourself'; } });
    on('ac-saved', () => { recovery = null; if (goAfter !== null) leaveGate(); else render(); });
    on('ac-syncnow', () => fullSync());
    on('ac-logout', logout);
    // Show / hide the password so people can check what they typed (especially when creating an account).
    on('ac-pw-show', () => {
      const pw = $('ac-pw'), btn = $('ac-pw-show'), show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      pw.focus();
    });
    const form = $('ac-form');
    if (form) form.onsubmit = (e) => { e.preventDefault(); submit(); };
    const pwf = $('ac-pw-form');
    if (pwf) pwf.onsubmit = async (e) => {
      e.preventDefault();
      const note = $('ac-pw-note'), go = $('ac-pw-go'); go.disabled = true; note.textContent = 'Changing…';
      const r = await api('POST', 'api/account/password', { password: $('ac-pw-old').value, newPassword: $('ac-pw-new').value, remember: !ss.get('sh-user') });
      go.disabled = false;
      if (r.ok) { say('ok', 'Your password has been changed. You\'ve been signed out on your other devices.'); render(); }
      else note.textContent = r.data.error === 'wrong_login' ? 'Your current password isn\'t right.' : errorText[r.data.error] || 'Couldn\'t change your password. Try again.';
    };
    const del = $('ac-del-form');
    if (del) del.onsubmit = async (e) => {
      e.preventDefault();
      const r = await api('POST', 'api/account/delete', { password: $('ac-del-pw').value });
      if (r.ok) { clearDevice(); signedOut(); say('ok', 'Your account and its saved progress have been deleted.'); render(); }
      else { say('bad', errorText[r.data.error] || 'Couldn\'t delete your account. Try again.'); render(); }
    };
  }

  async function submit() {
    const btn = $('ac-submit'); btn.disabled = true;
    const username = $('ac-user').value.trim().toLowerCase(), password = $('ac-pw').value, remember = $('ac-remember').checked;
    const r = mode === 'reset'
      ? await api('POST', 'api/account/reset', { username, recoveryCode: $('ac-rec').value, newPassword: password, remember })
      : await api('POST', 'api/account/' + mode, { username, password, remember });
    if (!r.ok) {
      if (r.data.error === 'no_accounts_here' || r.data.error === 'accounts_off') { available = false; offReason = r.data.error; notice = null; render(); return; }
      say('bad', errorText[r.data.error] || 'Something went wrong. Please try again.');
      render(); return;
    }
    signedIn(r.data.username, remember);
    if (r.data.recoveryCode) recovery = r.data.recoveryCode;
    if (gated()) { if (goAfter === null) goAfter = '#'; gate(false); }
    say('ok', mode === 'signup' ? `Welcome, ${r.data.username}! Your account is ready.` : mode === 'reset' ? 'Your password has been changed, and you\'ve been signed out on other devices. Here is your NEW recovery code.' : `Signed in as ${r.data.username}.`);
    render();
    await fullSync();
  }

  async function logout() {
    const btn = $('ac-logout');
    const synced = await flush();
    if (!synced && btn.dataset.sure !== '1') {
      btn.dataset.sure = '1'; btn.textContent = 'Some changes haven\'t synced. Tap again to sign out anyway';
      return;
    }
    await api('POST', 'api/account/logout');
    clearDevice(); signedOut();
    say('ok', 'You\'ve signed out, and your progress has been removed from this device.');
    render();
  }

  window.addEventListener('studyhub:view', (e) => { if (e.detail.view === 'account') { if (!me) notice = notice && notice.kind === 'ok' ? notice : null; render(); } });

  // ---------- start ----------
  (async function init() {
    if (gated() && location.hash && location.hash !== '#account') goAfter = location.hash;
    const remembered = ls.get('sh-user', null) || ss.get('sh-user');
    // Last person here didn't tick "Remember me" and their browser session has ended: clear their progress.
    if (!remembered && ls.get('sh-temp', false)) { clearDevice(); ls.del('sh-temp'); }
    if (remembered) { me = remembered; renderLink(); } // show straight away; checked below
    const r = await api('GET', 'api/account/me');
    if (r.ok) { signedIn(r.data.username); setAdmin(!!r.data.admin); gate(false); fullSync(); }
    else if (r.status === 401) signedOut(); // sign-in expired: keep this device's progress; it merges back when you sign in. Shows the sign-in screen.
    else if (r.data.error === 'no_accounts_here' || r.data.error === 'accounts_off') { available = false; offReason = r.data.error; if (me) signedOut(); gate(false); }
    else { if (me) setSync('offline'); gate(false); } // offline: let them in and keep working on this device; sync later
    if (isOpen()) render();
    if (location.hash === '#admin') renderAdmin();
  })();
})();
