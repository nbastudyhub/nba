// Study Hub admin: GET /api/admin (data), POST /api/admin { action: "delete" | "resetpw", username }
// (remove an account, or give a locked-out student a temporary password). Real passwords are never stored or shown.
// Only for usernames listed in the Cloudflare variable ADMIN_USERS. Shows sign-ups, sign-ins and
// study activity. Never returns password hashes, recovery codes or anyone's answers.
import { json, rateLimited, allowedOrigin, readJson } from "../../lib/shared.js";
import { ensureSchema, currentUser, isAdmin, validUsername, hashSecret, randomToken, tempPassword, SESSION_DAYS } from "../../lib/auth.js";

const DAY = 86400000;

export async function onRequestGet({ env, request }) {
  if (!env.DB) return json({ error: "accounts_off" }, 503);
  await ensureSchema(env.DB);
  const me = await currentUser(env.DB, request);
  if (!me) return json({ error: "signed_out" }, 401);
  if (!isAdmin(env, me.username)) return json({ error: "not_admin" }, 403);
  if (rateLimited("admin:" + me.id, 60)) return json({ error: "rate_limited" }, 429);

  const now = Date.now(), db = env.DB;
  const [users, sessions, lessons] = await db.batch([
    db.prepare(
      `SELECT u.id, u.username, u.created_at, MAX(p.updated_at) AS last_studied, COUNT(p.deck_id) AS lessons
       FROM users u LEFT JOIN progress p ON p.user_id = u.id
       GROUP BY u.id ORDER BY u.created_at DESC LIMIT 1000`
    ),
    // When each sign-in started (older sessions without created_at: expiry minus SESSION_DAYS).
    db.prepare("SELECT user_id, MAX(COALESCE(created_at, expires_at - ?)) AS last_start, SUM(expires_at > ?) AS live FROM sessions GROUP BY user_id").bind(SESSION_DAYS * DAY, now),
    db.prepare("SELECT deck_id, COUNT(*) AS learners, MAX(updated_at) AS last FROM progress GROUP BY deck_id ORDER BY learners DESC"),
  ]);
  const byUser = new Map((sessions.results || []).map((r) => [r.user_id, r]));
  const list = (users.results || []).map((u) => {
    const s = byUser.get(u.id);
    return {
      username: u.username,
      admin: isAdmin(env, u.username),
      signedUp: u.created_at,
      lastSignIn: s ? s.last_start : null,
      signedIn: !!(s && s.live > 0),
      lastStudied: u.last_studied || null,
      lessons: u.lessons || 0,
    };
  });
  const week = now - 7 * DAY;
  return json({
    totals: {
      users: list.length,
      newThisWeek: list.filter((u) => u.signedUp >= week).length,
      activeThisWeek: list.filter((u) => (u.lastStudied || 0) >= week || (u.lastSignIn || 0) >= week).length,
      signedInNow: list.filter((u) => u.signedIn).length,
    },
    users: list,
    lessons: (lessons.results || []).map((r) => ({ id: r.deck_id, learners: r.learners, last: r.last })),
  });
}

// Remove an account (the user, their saved progress and all their sign-ins), or reset its password.
// Admin accounts (including your own) can't be removed here; people delete their own account on the Account page.
export async function onRequestPost({ env, request }) {
  if (!allowedOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ error: "accounts_off" }, 503);
  await ensureSchema(env.DB);
  const me = await currentUser(env.DB, request);
  if (!me) return json({ error: "signed_out" }, 401);
  if (!isAdmin(env, me.username)) return json({ error: "not_admin" }, 403);
  if (rateLimited("admin-del:" + me.id, 30)) return json({ error: "rate_limited" }, 429);
  const body = (await readJson(request)) || {};
  const username = String(body.username || "").trim().toLowerCase();
  if (!["delete", "resetpw"].includes(body.action) || !validUsername(username)) return json({ error: "bad_request" }, 400);
  if (username === me.username || isAdmin(env, username)) return json({ error: "cant_remove_admin" }, 400);
  const db = env.DB;
  const user = await db.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (!user) return json({ error: "not_found" }, 404);
  if (body.action === "resetpw") {
    // A new temporary password, shown to the admin once. Signs the student out everywhere.
    const temp = tempPassword(), salt = randomToken(16);
    await db.batch([
      db.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?").bind(await hashSecret(temp, salt), salt, user.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    ]);
    return json({ ok: true, username, tempPassword: temp });
  }
  await db.batch([
    db.prepare("DELETE FROM progress WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return json({ ok: true, removed: username });
}
