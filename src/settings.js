// Settings page: Streak API key entered in the app (stored in D1), with the Cloudflare variable as fallback.
// The key is never sent back to the browser — only its last 4 characters.

const get = async (env, k) => (await env.DB.prepare('SELECT v FROM settings WHERE k=?').bind(k).first())?.v ?? null;
const put = (env, k, v) => env.DB.prepare('INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(v)).run();
const del = (env, k) => env.DB.prepare('DELETE FROM settings WHERE k=?').bind(k).run();

export const maskKey = (k) => (k ? '••••' + String(k).slice(-4) : null);

// Returns a per-request copy of env where STREAK_API_KEY is the key saved in Settings (if any).
export async function withKeys(env) {
  let saved = null;
  try { saved = await get(env, 'streak_api_key'); } catch (e) { /* settings table missing: fall back */ }
  if (saved) return { ...env, STREAK_API_KEY: saved, STREAK_KEY_SOURCE: 'settings' };
  return { ...env, STREAK_KEY_SOURCE: env.STREAK_API_KEY ? 'cloudflare' : null };
}

// Checks a key against Streak; returns the Streak account email or throws a readable error.
export async function checkStreakKey(key, fetchFn = fetch) {
  const r = await fetchFn('https://api.streak.com/api/v1/users/me', { headers: { Authorization: 'Basic ' + btoa(key + ':') } });
  if (r.status === 401 || r.status === 403) throw new Error('Streak refused this key. Copy it again from Streak → Integrations → Streak API.');
  if (!r.ok) throw new Error('Streak answered ' + r.status + ' — try again in a minute.');
  const u = await r.json().catch(() => ({}));
  return u.email || u.displayName || '';
}

export async function settingsView(env) {
  const [savedAt, account, lastSync, gmail, gmailAccount, lastErr] = await Promise.all(
    ['streak_key_saved_at', 'streak_account', 'last_sync', 'google_refresh_token', 'google_email', 'last_sync_error'].map((k) => get(env, k))
  );
  const deals = await env.DB.prepare('SELECT COUNT(*) AS c FROM boxes').first('c').catch(() => null);
  return {
    streak: {
      connected: !!env.STREAK_API_KEY,
      source: env.STREAK_KEY_SOURCE || null, // 'settings' | 'cloudflare' | null
      hint: maskKey(env.STREAK_API_KEY),
      account: env.STREAK_KEY_SOURCE === 'settings' ? account : null,
      saved_at: env.STREAK_KEY_SOURCE === 'settings' ? +savedAt || null : null,
      last_sync: +lastSync || null,
      last_error: lastErr || null,
      deals,
    },
    gmail: { connected: !!gmail, account: gmailAccount },
  };
}

export async function saveStreakKey(env, raw, fetchFn = fetch) {
  const key = String(raw || '').trim();
  if (!key) throw new Error('Paste your Streak API key first.');
  if (key.length < 16 || /\s/.test(key)) throw new Error('That does not look like a Streak API key.');
  const account = await checkStreakKey(key, fetchFn);
  await put(env, 'streak_api_key', key);
  await put(env, 'streak_key_saved_at', Date.now());
  await put(env, 'streak_account', account);
  await del(env, 'funnel_cache');
  return { ok: true, account, hint: maskKey(key) };
}

export async function removeStreakKey(env) {
  for (const k of ['streak_api_key', 'streak_key_saved_at', 'streak_account', 'funnel_cache']) await del(env, k);
  return { ok: true };
}
