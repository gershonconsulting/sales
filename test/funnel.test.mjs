import assert from 'node:assert/strict';
import { buildFunnel, clientName } from '../src/funnel.js';

const D = (s) => Date.parse(s);
const pipelineDef = { fields: [{ key: 1003, name: 'Origin', dropdownSettings: { items: [{ key: '9224', name: 'Botdog' }, { key: '9020', name: 'LinkedIn' }] } }] };
const radar = {
  collected: 100, graded_ab: 40, salesnav: 90, pushed: 80, invited: 10, connected: 4,
  connected_list: [{ name: 'A B', company: 'Kleos' }, { name: 'C D', company: 'Acme' }],
  matches: {
    Acme: { pushed: true, first_pushed: '2026-09-01T00:00:00Z' },      // pushed before box -> radar
    Late: { pushed: true, first_pushed: '2026-10-20T00:00:00Z' },      // pushed after box -> not radar
    Client1: { pushed: true, first_pushed: '2026-08-01T00:00:00Z' },   // signed after push -> full cycle
    Client2: { pushed: true, first_pushed: '2026-10-29T00:00:00Z' },   // on radar after signing -> not
  },
};
const gcBoxes = [
  { boxKey: 'b1', name: 'Acme', stageKey: '5011', creationTimestamp: D('2026-09-10'), fields: { 1003: '9020' } },
  { boxKey: 'b2', name: 'Late', stageKey: '5002', creationTimestamp: D('2026-10-01'), fields: {} },
  { boxKey: 'b3', name: 'DLOC', stageKey: '5015', creationTimestamp: D('2026-10-01'), fields: { 1003: '9224' } },
  { boxKey: 'b4', name: 'Old', stageKey: '5012', creationTimestamp: D('2026-01-01'), fields: { 1003: '9224' } },
];
const projectBoxes = [
  { name: 'Client1 (TP)', creationTimestamp: D('2026-09-15') },
  { name: 'Client1 (LF)', creationTimestamp: D('2026-09-20') },
  { name: 'Client2 - Anne (TP)', creationTimestamp: D('2026-06-01') },
];

const f = buildFunnel({ radar, pipelineDef, gcBoxes, projectBoxes, now: D('2026-11-10') });
const step = (id) => f.steps.find((s) => s.id === id).n;

assert.equal(clientName('Altavia - Anne (LF)'), 'Altavia');
assert.equal(clientName('Flying Secoya (TP)'), 'Flying Secoya');
assert.equal(step('collected'), 100);
assert.equal(step('pulse'), null);
assert.deepEqual(f.radar_deals.map((d) => d.name).sort(), ['Acme', 'DLOC']); // recycled + late excluded
assert.equal(step('proposal'), 2); // Acme (5011) + DLOC (5015)
assert.equal(f.clients.length, 2); // Client1 deduped
assert.equal(f.full_cycle, 1);
assert.equal(f.clients.find((c) => c.name === 'Client2').onRadar, true);
assert.equal(f.clients.find((c) => c.name === 'Client2').viaRadar, false);
assert.equal(f.by_source.find((s) => s.origin === 'Unknown').total, 1);
assert.deepEqual(f.accepted_no_deal.map((p) => p.company), ['Kleos']);
const empty = buildFunnel({ radar: null, pipelineDef: {}, gcBoxes: [], projectBoxes: [] });
assert.equal(empty.radar_ok, false);
console.log('funnel tests passed');
