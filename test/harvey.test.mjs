// Harvey H01 integration: ingest → overview/lead → actions → ack, on a real SQLite standing in for D1.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { harveyMachine, harveyUser, leadStatus } from '../src/harvey.js';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async (col) => { const r = db.prepare(sql).get(...args); return r == null ? null : col ? r[col] : r; },
    _exec: () => (/^\s*(select|insert[\s\S]*returning)/i.test(sql) ? db.prepare(sql).all(...args) : db.prepare(sql).run(...args)),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s._exec()) };
}
const TOKEN = 'test-token-123';
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');
const env = { DB: fakeD1(), HARVEY_INGEST_SHA256: await sha(TOKEN) };
const req = (path, body, token, method = 'POST') => new Request('https://sales.example.com' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
const fakeAi = async () => '{"subject":"Re: hello","body":"Hi Ana, a quick follow-up. Olivier"}';

const snap = {
  server: { service: 'active' },
  companies: [{ id: 'c1', name: 'Example Robotics', domain: 'example.com', created_at: '2026-11-09 18:00:00' }, { id: 'c2', name: 'Sample Labs', domain: 'example.org', created_at: '2026-11-10T09:00:00' }],
  prospects: [
    { id: 'p1', company_id: 'c1', first_name: 'Ana', last_name: 'Doe', email: 'ana@example.com', email_verified: 1, status: 'contacted', created_at: '2026-11-09 18:01:00' },
    { id: 'p2', company_id: 'c2', first_name: 'Ben', last_name: 'Roe', email: 'ben@example.org', status: 'new', created_at: '2026-11-10 09:01:00' },
    { id: 'p3', company_id: 'c2', first_name: 'Cy', last_name: 'Poe', status: 'unfit', created_at: '2026-11-10 09:02:00' },
  ],
  outbox: [
    { id: 'o1', prospect_id: 'p1', kind: 'sequence', step: 1, to_email: 'ana@example.com', subject: 'hello', body: 'first email', status: 'sent', sent_at: '2026-11-01 10:00:00', created_at: '2026-11-01 09:00:00' },
    { id: 'o2', prospect_id: 'p2', kind: 'sequence', step: 1, to_email: 'ben@example.org', subject: 'hi', body: 'draft', status: 'pending_review', send_at: '2026-11-12 14:00:00', created_at: '2026-11-10 09:05:00' },
  ],
  conversations: [{ id: 'v1', prospect_id: 'p1', intent: 'interested', stage: 'engaged', status: 'open', thread_json: JSON.stringify([{ sender: 'harvey', content: 'first email', timestamp: '2026-11-01T10:00:00' }, { sender: 'prospect', content: 'Sounds interesting, tell me more', timestamp: '2026-11-02T08:00:00' }]) }],
};

// auth
assert.equal((await harveyMachine(req('/api/harvey/ingest', snap), env, '/api/harvey/ingest')).status, 401);
assert.equal((await harveyMachine(req('/api/harvey/ingest', snap, 'wrong'), env, '/api/harvey/ingest')).status, 401);
let r = await (await harveyMachine(req('/api/harvey/ingest', snap, TOKEN), env, '/api/harvey/ingest')).json();
assert.equal(r.ok, true); assert.deepEqual(r.actions, []);

// overview
let o = await (await harveyUser(req('/api/harvey', null, null, 'GET'), env, '/api/harvey', fakeAi)).json();
assert.equal(o.stats.companies, 2); assert.equal(o.stats.prospects, 2); assert.equal(o.stats.unfit, 1);
assert.equal(o.stats.waiting_approval, 1); assert.equal(o.stats.emails_sent, 1); assert.equal(o.stats.replied, 1); assert.equal(o.stats.interested, 1);
const ana = o.leads.find((l) => l.id === 'p1');
assert.equal(ana.stage, 'Interested'); assert.equal(ana.followup_due, true, 'they wrote last → follow up');
assert.equal(o.leads.find((l) => l.id === 'p2').waiting, 1);
assert.equal(o.server.service, 'active');

// lead detail: sent email + reply in one timeline, no duplicate of the sent body
let L = await (await harveyUser(req('/api/harvey/lead/p1', null, null, 'GET'), env, '/api/harvey/lead/p1', fakeAi)).json();
assert.deepEqual(L.timeline.map((t) => t.dir), ['out', 'in']);
assert.equal(L.company.name, 'Example Robotics');

// actions: approve with edit → two actions (edit then approve); approving a sent email is refused
const act = (id, b) => harveyUser(req(`/api/harvey/lead/${id}/action`, b), env, `/api/harvey/lead/${id}/action`, fakeAi);
assert.equal((await act('p2', { type: 'approve', outbox_id: 'o2', subject: 'hi there', body: 'better draft' })).status, 200);
assert.equal((await act('p1', { type: 'approve', outbox_id: 'o1' })).status, 400);
assert.equal((await act('p1', { type: 'followup', subject: '', body: 'x' })).status, 400);
assert.equal((await act('p1', { type: 'followup', subject: 'Re: hello', body: 'Thanks Ana' })).status, 200);
assert.equal((await act('p1', { type: 'send_now' })).status, 400);

// AI draft
const ai = await (await harveyUser(req('/api/harvey/lead/p1/aidraft', {}), env, '/api/harvey/lead/p1/aidraft', fakeAi)).json();
assert.equal(ai.subject, 'Re: hello');

// next ingest returns pending actions in order, ack closes them
r = await (await harveyMachine(req('/api/harvey/ingest', snap, TOKEN), env, '/api/harvey/ingest')).json();
assert.deepEqual(r.actions.map((a) => a.type), ['edit', 'approve', 'followup']);
await harveyMachine(req('/api/harvey/ack', { results: r.actions.map((a) => ({ id: a.id, ok: true, detail: 'done' })) }, TOKEN), env, '/api/harvey/ack');
r = await (await harveyMachine(req('/api/harvey/ingest', { ...snap, prospects: snap.prospects.slice(0, 2) }, TOKEN), env, '/api/harvey/ingest')).json();
assert.deepEqual(r.actions, []);

// full snapshot removes rows Harvey no longer has; manual status overrides the automatic one
o = await (await harveyUser(req('/api/harvey', null, null, 'GET'), env, '/api/harvey', fakeAi)).json();
assert.equal(o.stats.unfit, 0);
await harveyUser(req('/api/harvey/lead/p1/crm', { stage: 'Meeting booked', next_followup: '2026-11-20', notes: 'call Tuesday' }), env, '/api/harvey/lead/p1/crm', fakeAi);
o = await (await harveyUser(req('/api/harvey', null, null, 'GET'), env, '/api/harvey', fakeAi)).json();
const ana2 = o.leads.find((l) => l.id === 'p1');
assert.equal(ana2.stage, 'Meeting booked'); assert.equal(o.stats.meetings, 1); assert.equal(ana2.next_followup, '2026-11-20');

// bounced / unfit leads are never "follow-up due"
assert.equal(leadStatus({ status: 'bounced' }, [], []).bounced, true);
console.log('harvey tests: all passed');
