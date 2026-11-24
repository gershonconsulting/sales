import assert from 'node:assert/strict';
import { extractLeads, summarize, classify, health } from '../src/claude-campaigns.js';

const now = Date.parse('2026-11-20T12:00:00Z');
const D = 86400000;
const def = (opts) => ({ fields: [{ key: '1002', name: 'Origin', dropdownSettings: { items: opts } }, { key: '1015', name: 'Country', dropdownSettings: { items: [{ key: '9020', name: 'Poland' }] } }] });
const camp = def([{ key: '9212', name: 'CC01' }, { key: '9209', name: 'CC02' }, { key: '9207', name: 'Botdog' }, { key: '9213', name: 'H01' }]);
const pipe = def([{ key: '9500', name: 'CC01' }]);
const box = (key, name, stage, origin, extra = {}) => ({ boxKey: key, name, stageKey: stage, fields: { 1002: origin, ...(extra.fields || {}) }, creationTimestamp: extra.created ?? now - D, lastEmailReceivedTimestamp: extra.in || 0, lastEmailSentTimestamp: extra.out || 0 });

const rows = extractLeads({
  campaigns: { def: camp, boxes: [
    box('a', 'Acme', '5001', '9212'), // reached only
    box('b', 'Bolt', '5001', '9212', { in: now - D }), // email back, still Contacted -> to check
    box('c', 'Crane', '5002', '9212'), // Responded with no email -> false responded
    box('d', 'ACCREA', '5001', '9209', { in: now - 2 * D, fields: { 1015: '9020' } }), // to check, then overridden real
    box('e', 'Dune', '5003', '9209'), // call scheduled
    box('f', 'Other', '5001', '9207'), // Botdog: not a campaign
    box('g', 'Echo Ltd', '5001', '9212', { created: now - 20 * D }), // moved on to the pipeline below
  ] },
  pipeline: { def: pipe, boxes: [box('h', 'Echo Ltd', '5011', '9500', { in: now - D })] },
  clients: { def: null, boxes: null },
});
assert.equal(rows.length, 7, 'only campaign-coded boxes');
assert.ok(rows.every((r) => /^(CC|H)\d+$/.test(r.code)));

const s = summarize(rows, { overrides: { d: 'real' }, now });
assert.deepEqual(s.campaigns.map((c) => c.code), ['CC01', 'CC02']);
const cc01 = s.campaigns[0], cc02 = s.campaigns[1];
assert.equal(cc01.reached, 4, 'Echo counted once across pipelines');
assert.equal(cc01.to_check, 1);
assert.equal(cc01.false_responded, 1);
assert.equal(cc01.replies, 1, 'only Echo (proposal) is a real reply');
assert.equal(cc01.steps.find((x) => x.id === 'proposal').n, 1);
const echo = cc01.leads.find((l) => l.name === 'Echo Ltd');
assert.equal(echo.pipe, 'pipeline');
assert.equal(echo.created, now - 20 * D, 'first touch date kept');
assert.equal(cc02.replies, 2, 'ACCREA by hand + Dune call');
assert.equal(cc02.calls, 1);
assert.equal(cc02.to_check, 0);
assert.equal(cc02.countries[0].country, 'Poland');
assert.equal(cc01.description.startsWith('New companies'), true);
assert.equal(s.totals.reached, 6);
assert.equal(s.activity.length, 14);
assert.equal(s.campaigns.find((c) => c.code === 'CC01').activity.at(-2).reached, 3, 'reached yesterday');
// funnel never grows down the steps
for (const c of s.campaigns) for (let i = 1; i < c.steps.length; i++) assert.ok(c.steps[i].n <= c.steps[i - 1].n, c.code + ' monotonic');
// 'auto' override hides an out-of-office from to-check
assert.equal(classify({ pipe: 'campaigns', stage: '5001', last_in: 1 }, 'auto').toCheck, false);
assert.equal(classify({ pipe: 'campaigns', stage: '5001', last_in: 1 }, 'auto').real, false);
assert.equal(cc01.name, 'E2 New Companies', 'real name after the code');
assert.equal(cc01.health, 'green', 'activity yesterday = green');
assert.equal(cc01.outcome.no_reply + cc01.outcome.to_check + cc01.outcome.replied, cc01.reached, 'outcome split adds up');
assert.equal(health(now - 3 * D, now).health, 'green');
assert.equal(health(now - 4 * D, now).health, 'orange', 'more than 3 days = orange');
assert.equal(health(now - 6 * D, now).health, 'orange');
assert.equal(health(now - 7 * D, now).health, 'red', 'more than 6 days = red');
assert.equal(health(0, now).health, 'red');
console.log('campaigns.test: ok');
