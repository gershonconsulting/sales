// Botdog key in Settings + campaign status sync.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildBotdogStatus, saveBotdogKey, syncBotdog, botdogView, removeBotdogKey } from '../src/botdog.js';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT)');
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  run: async () => { db.prepare(sql).run(...args); return { success: true }; },
  first: async (col) => { const r = db.prepare(sql).get(...args); return r == null ? null : col ? r[col] : r; },
});
const env = { DB: { prepare: (sql) => stmt(sql) } };
const GOOD = 'bd_live_goodkey123456';
const camps = [
  { id: 'a', name: 'Radar push', status: 'CREATED', ownerEmail: 'o@g.com' },
  { id: 'b', name: 'BD26', status: 'ACTIVE', ownerEmail: 'o@g.com' },
  { id: 'c', name: 'Old', status: 'ARCHIVED' },
];
const stat = (lead, inv, acc, msg, rep) => ({ statistics: { totalLeadCount: lead, invitationsSent: inv, invitationsAccepted: acc, messagesSent: msg, messagesReplied: rep }, rates: {} });
const fakeFetch = async (url, opts) => {
  if (opts.headers['x-api-key'] !== GOOD) return new Response('no', { status: 401 });
  if (url.endsWith('/v1/campaigns')) return Response.json(camps);
  if (url.endsWith('/a/statistics')) return Response.json(stat(2545, 0, 0, 0, 0));
  if (url.endsWith('/b/statistics')) return Response.json(stat(900, 139, 50, 50, 4));
  assert.fail('unexpected call ' + url);
};

// pure status
const s = buildBotdogStatus(camps.slice(0, 2), { a: stat(10, 0, 0, 0, 0), b: stat(5, 4, 1, 1, 0) }, 1);
assert.equal(s.campaigns[0].name, 'BD26', 'active first');
assert.equal(s.campaigns[1].stuck, true);
assert.equal(s.totals.stuck_leads, 10);
assert.equal(s.totals.accept_rate, 25);

// key checks
await assert.rejects(saveBotdogKey(env, ''), /Paste/);
await assert.rejects(saveBotdogKey(env, 'bd_live_badkey00000', fakeFetch), /refused/);
await assert.rejects(syncBotdog(env, fakeFetch), /not connected/);
assert.equal((await botdogView(env)).connected, false);

// save + sync
await saveBotdogKey(env, '  ' + GOOD + ' ', fakeFetch);
const st = await syncBotdog(env, fakeFetch);
assert.equal(st.campaigns.length, 2, 'archived skipped');
assert.equal(st.totals.stuck_leads, 2545);
assert.equal(st.totals.invited, 139);
const v = await botdogView(env);
assert.equal(v.connected, true);
assert.equal(v.hint, '••••3456');
assert.ok(!JSON.stringify(v).includes(GOOD), 'key must not leak to the browser');

await removeBotdogKey(env);
assert.equal((await botdogView(env)).connected, false);
console.log('botdog tests passed');
