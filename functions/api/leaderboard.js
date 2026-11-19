// Study Hub leaderboard: GET /api/leaderboard (signed-in users), POST /api/leaderboard { hide } (show or hide yourself).
// Ranks students by how many lessons they have completed at 100% (every flashcard known and full marks on the
// quiz, Apply it, exam practice and long answer, as on the Progress page), then by overall progress.
// Progress is what students saved, so it's self-reported. Shows usernames only.
import { json, allowedOrigin, readJson, rateLimited } from "../../lib/shared.js";
import { ensureSchema, currentUser } from "../../lib/auth.js";

const PARTS = [["fcBest", "cards"], ["qzBest", "quiz"], ["apBest", "apply"], ["examScore", "marks"], ["longScore", "long"]];

// How far one lesson is done: { pct: 0-100 average of its parts, complete: every part at full marks }.
export function lessonDone(deck, data) {
  const parts = PARTS.filter(([, t]) => deck[t] > 0);
  if (!parts.length || !data) return { pct: 0, complete: false };
  let sum = 0, complete = true;
  for (const [k, t] of parts) {
    const got = Number(data[k]) || 0;
    sum += Math.min(100, (got / deck[t]) * 100);
    if (got < deck[t]) complete = false;
  }
  return { pct: sum / parts.length, complete };
}

export function rankUsers(rows, decks) {
  const byId = new Map(decks.map((d) => [d.id, d])), users = new Map();
  for (const r of rows) {
    const u = users.get(r.id) || { id: r.id, username: r.username, hidden: !!r.lb_hide, completed: 0, pctSum: 0 };
    users.set(r.id, u);
    const deck = byId.get(r.deck_id);
    if (!deck) continue; // e.g. Business work isn't a lesson
    let data = null; try { data = JSON.parse(r.data); } catch { /* skip a damaged row */ }
    const d = lessonDone(deck, data);
    u.pctSum += d.pct; if (d.complete) u.completed++;
  }
  const list = [...users.values()].map((u) => ({ ...u, overall: decks.length ? Math.round(u.pctSum / decks.length) : 0 }))
    .filter((u) => u.completed > 0)
    .sort((a, b) => b.completed - a.completed || b.overall - a.overall || a.username.localeCompare(b.username));
  return list;
}
// Number the places (equal scores share a place).
export function placeRanks(list) {
  let rank = 0, prev = null;
  return list.map((u, i) => { const key = `${u.completed}:${u.overall}`; if (key !== prev) { rank = i + 1; prev = key; } return { ...u, rank }; });
}

async function signedIn(env, request) {
  if (!env.DB) return { error: json({ error: "accounts_off" }, 503) };
  await ensureSchema(env.DB);
  const me = await currentUser(env.DB, request);
  return me ? { me } : { error: json({ error: "signed_out" }, 401) };
}

export async function onRequestGet({ env, request }) {
  const { me, error } = await signedIn(env, request);
  if (error) return error;
  if (rateLimited("lb:" + me.id, 60)) return json({ error: "rate_limited" }, 429);
  let decks = [];
  try { const res = await env.ASSETS.fetch(new URL("/decks/index.json", request.url)); if (res.ok) decks = (await res.json()).decks || []; } catch { decks = []; }
  const { results } = await env.DB.prepare(
    "SELECT u.id, u.username, u.lb_hide, p.deck_id, p.data FROM users u JOIN progress p ON p.user_id = u.id"
  ).all();
  const all = rankUsers(results || [], decks);
  // Places count only the people shown; a hidden student still sees where they would be.
  const shown = placeRanks(all.filter((u) => !u.hidden));
  const mine = placeRanks(all.filter((u) => !u.hidden || u.id === me.id)).find((u) => u.id === me.id);
  const meRow = await env.DB.prepare("SELECT lb_hide FROM users WHERE id = ?").bind(me.id).first();
  const pub = (u) => ({ rank: u.rank, username: u.username, completed: u.completed, overall: u.overall });
  return json({
    lessons: decks.length,
    top: shown.slice(0, 50).map(pub),
    me: { username: me.username, hidden: !!(meRow && meRow.lb_hide), ...(mine ? { rank: mine.rank, completed: mine.completed, overall: mine.overall } : { completed: 0 }) },
  });
}

export async function onRequestPost({ env, request }) {
  if (!allowedOrigin(request)) return json({ error: "forbidden" }, 403);
  const { me, error } = await signedIn(env, request);
  if (error) return error;
  const body = await readJson(request);
  if (!body || typeof body.hide !== "boolean") return json({ error: "bad_request" }, 400);
  await env.DB.prepare("UPDATE users SET lb_hide = ? WHERE id = ?").bind(body.hide ? 1 : 0, me.id).run();
  return json({ ok: true, hidden: body.hide });
}
