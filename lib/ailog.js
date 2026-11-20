// Saves what students send to the AI (helper questions and work sent for AI marking) so admins can see it on
// the Admin page. Students are told in the chat and marking areas. Entries are deleted after AI_LOG_DAYS.
// Logging never blocks or breaks the AI reply: it runs after the response, and any error is ignored.
import { ensureSchema, currentUser } from "./auth.js";

export const AI_LOG_DAYS = 30;
const cap = (s, n) => String(s ?? "").slice(0, n);

export async function logAi(env, request, { kind, place, question, answer }) {
  if (!env.DB) return;
  try {
    await ensureSchema(env.DB);
    const me = await currentUser(env.DB, request);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ai_log (user_id, username, kind, place, question, answer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(me ? me.id : null, me ? me.username : null, cap(kind, 20), cap(place, 120), cap(question, 8000), cap(answer, 4000), now),
      env.DB.prepare("DELETE FROM ai_log WHERE created_at < ?").bind(now - AI_LOG_DAYS * 86400000),
    ]);
  } catch { /* never let logging break the AI */ }
}

// Run after the response has been sent, where the platform allows it.
export function later(ctx, promise) {
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(promise); else promise.catch(() => {});
}
