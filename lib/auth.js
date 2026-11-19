// Study Hub accounts: username + password, sessions in an HttpOnly cookie, data in Cloudflare D1.
// The D1 database is bound to the Pages project as `DB`. Tables are created on first use.
// Stored per user: username, a PBKDF2 hash of the password, a hash of the recovery code, and
// study progress. No email, no real name.

const enc = new TextEncoder();
const COOKIE = "sh_session";
export const SESSION_DAYS = 60;
const ITERATIONS = 100000; // the most PBKDF2 iterations Cloudflare Workers allows

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256 = async (text) => b64url(await crypto.subtle.digest("SHA-256", enc.encode(text)));

export async function hashSecret(secret, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: ITERATIONS }, key, 256);
  return b64url(bits);
}

// Compares two strings without stopping at the first difference.
export function sameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Recovery codes look like K7QM-2XRT-9PWD-H4CN (no 0/O, 1/I/L to avoid mix-ups).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return chars.match(/.{4}/g).join("-");
}
export const normaliseCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const validUsername = (u) => typeof u === "string" && /^[a-z0-9_]{3,20}$/.test(u);
export const validPassword = (p) => typeof p === "string" && p.length >= 8 && p.length <= 128;

let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL,
      rec_hash TEXT NOT NULL, rec_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS progress (
      user_id INTEGER NOT NULL,
      deck_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, deck_id))`),
  ]);
  // Added later: when each sign-in started (older rows don't have it).
  try { await db.prepare("ALTER TABLE sessions ADD COLUMN created_at INTEGER").run(); } catch { /* already there */ }
  // Added later: 1 = hide this user from the leaderboard.
  try { await db.prepare("ALTER TABLE users ADD COLUMN lb_hide INTEGER DEFAULT 0").run(); } catch { /* already there */ }
  schemaReady = true;
}

// maxAgeSeconds = null makes a browser-session cookie, removed when the browser is closed.
export const sessionCookie = (token, maxAgeSeconds) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAgeSeconds === null ? "" : `; Max-Age=${maxAgeSeconds}`}`;
export const clearCookie = () => sessionCookie("", 0);

function readCookie(request) {
  const header = request.headers.get("Cookie") || "";
  const match = header.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  return match ? match.slice(COOKIE.length + 1) : "";
}

// Starts a session and returns the Set-Cookie header value.
// remember = true: lasts SESSION_DAYS. remember = false ("Remember me" unticked, e.g. a school computer):
// the cookie goes when the browser closes, and the session ends after a day at most.
export const SHORT_SESSION_DAYS = 1;
export async function createSession(db, userId, remember = true) {
  const token = randomToken();
  const now = Date.now(), days = remember ? SESSION_DAYS : SHORT_SESSION_DAYS;
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at < ?").bind(userId, now),
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(token), userId, now + days * 86400000, now),
  ]);
  return sessionCookie(token, remember ? SESSION_DAYS * 86400 : null);
}

// The signed-in user for this request, or null.
export async function currentUser(db, request) {
  const token = readCookie(request);
  if (!token || token.length > 100) return null;
  const row = await db.prepare(
    "SELECT users.id AS id, users.username AS username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?"
  ).bind(await sha256(token), Date.now()).first();
  return row || null;
}

export async function endSession(db, request) {
  const token = readCookie(request);
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

// Admins are the usernames listed in the Cloudflare variable ADMIN_USERS (comma-separated), e.g. "anointed".
export const isAdmin = (env, username) =>
  !!username && String(env.ADMIN_USERS || "").toLowerCase().split(",").map((u) => u.trim()).filter(Boolean).includes(username);

// A temporary password an admin can give a locked-out student, e.g. "k7pm-x3qd-9hvt".
// No easily confused characters (0/o, 1/l/i).
export function tempPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(12));
  const s = [...b].map((x) => abc[x % abc.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
