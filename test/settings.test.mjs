// Settings: Streak key saved in the app (D1) overrides the Cloudflare variable and is never returned in full.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { withKeys, settingsView, saveStreakKey, removeStreakKey, maskKey } from '../src/settings.js';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT); CREATE TABLE boxes (key TEXT PRIMARY KEY)');
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  run: async () => { db.prepare(sql).run(...args); return { success: true }; },
  first: async (col) => { const r = db.prepare(sql).get(...args); return r == null ? null : col ? r[col] : r; },
});
const base = { DB: { prepare: (sql) => stmt(sql) } };
const GOOD = 'goodkey0123456789abcdef', BAD = 'badkey0123456789abcdefg';
const fakeFetch = async (url, opts) => {
  assert.equal(url, 'https://api.streak.com/api/v1/users/me');
  const ok = opts.headers.Authorization === 'Basic ' + btoa(GOOD + ':');
  return new Response(ok ? JSON.stringify({ email: 'olivier@gershonconsulting.com' }) : 'no', { status: ok ? 200 : 401 });
};

// nothing configured
let env = await withKeys(base);
assert.equal(env.STREAK_KEY_SOURCE, null);
assert.equal((await settingsView(env)).streak.connected, false);

// Cloudflare variable only
env = await withKeys({ ...base, STREAK_API_KEY: 'cloudflarekey9999' });
assert.equal(env.STREAK_KEY_SOURCE, 'cloudflare');
assert.equal((await settingsView(env)).streak.hint, '••••9999');

// bad / empty keys are refused and not stored
await assert.rejects(saveStreakKey(base, ''), /Paste/);
await assert.rejects(saveStreakKey(base, 'short'), /does not look/);
await assert.rejects(saveStreakKey(base, BAD, fakeFetch), /refused/);
assert.equal((await withKeys(base)).STREAK_KEY_SOURCE, null);

// good key saved → wins over the Cloudflare variable; full key never in the view
db.prepare("INSERT INTO settings VALUES ('funnel_cache','{}')").run();
const r = await saveStreakKey(base, '  ' + GOOD + ' ', fakeFetch);
assert.equal(r.account, 'olivier@gershonconsulting.com');
env = await withKeys({ ...base, STREAK_API_KEY: 'cloudflarekey9999' });
assert.equal(env.STREAK_API_KEY, GOOD);
assert.equal(env.STREAK_KEY_SOURCE, 'settings');
const view = await settingsView(env);
assert.equal(view.streak.hint, maskKey(GOOD));
assert.equal(view.streak.account, 'olivier@gershonconsulting.com');
assert.ok(!JSON.stringify(view).includes(GOOD), 'key must not leak to the browser');
assert.equal(db.prepare("SELECT v FROM settings WHERE k='funnel_cache'").get(), undefined, 'funnel cache cleared');

// remove → falls back to Cloudflare
await removeStreakKey(base);
assert.equal((await withKeys({ ...base, STREAK_API_KEY: 'cloudflarekey9999' })).STREAK_KEY_SOURCE, 'cloudflare');
console.log('settings tests passed');
