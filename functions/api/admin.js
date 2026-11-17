// Study Hub admin: GET /api/admin
// Only for usernames listed in the Cloudflare variable ADMIN_USERS. Shows sign-ups, sign-ins and
// study activity. Never returns password hashes, recovery codes or anyone's answers.
import { json, rateLimited } from "../../lib/shared.js";
import { ensureSchema, currentUser, isAdmin, SESSION_DAYS } from "../../lib/auth.js";

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
    // Each sign-in lasts SESSION_DAYS, so a session's start = its expiry minus that.
    db.prepare("SELECT user_id, MAX(expires_at) AS last_expiry, SUM(expires_at > ?) AS live FROM sessions GROUP BY user_id").bind(now),
    db.prepare("SELECT deck_id, COUNT(*) AS learners, MAX(updated_at) AS last FROM progress GROUP BY deck_id ORDER BY learners DESC"),
  ]);
  const byUser = new Map((sessions.results || []).map((r) => [r.user_id, r]));
  const list = (users.results || []).map((u) => {
    const s = byUser.get(u.id);
    return {
      username: u.username,
      signedUp: u.created_at,
      lastSignIn: s ? s.last_expiry - SESSION_DAYS * DAY : null,
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
