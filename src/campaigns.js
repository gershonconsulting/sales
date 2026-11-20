// Overview: one page with where every Gershon sales campaign stands.
// Sources: Streak GC Campaigns (campaign contacts, Origin = campaign code), Streak GC Pipeline (deals),
// Streak GC Clients (signed), Harvey H01 (D1 snapshot) and Radar (cached funnel).
import { originMap, STAGE_ORDER, STAGE_NAMES, CLIENT_STAGES } from './funnel.js';

export const CAMPAIGN_STAGES = { '5001': 'Contacted', '5002': 'Responded', '5003': 'Call scheduled', '5004': 'Pitched', '5006': 'Recycled' };
const RESPONDED = new Set(['5002', '5003', '5004']);
const PROPOSAL_PLUS = new Set(['5011', '5013', '5005', '5015']);
const HOT = new Set(['5005', '5015']);
const ACTIVE_CLIENT = new Set(['5009', '5004']);
export const DAILY_TARGET = 10; // objective: 10 new leads per day
const DAY = 86400000;

// Display name for a campaign code
export function campaignLabel(code) {
  if (/^CC\d+$/i.test(code)) return code.toUpperCase() + ' · Claude outreach';
  if (/^H\d+$/i.test(code)) return code.toUpperCase() + ' · Harvey cold email';
  if (code === 'Botdog') return 'Botdog · LinkedIn (Radar)';
  return code;
}
// campaign codes first (CC01, CC02…, H01, Botdog), then the rest by size
const rank = (code) => (/^CC\d+$/i.test(code) ? 0 : /^H\d+$/i.test(code) ? 1 : code === 'Botdog' ? 2 : 3);

const ts = (v) => (typeof v === 'number' ? v : Date.parse(v || '') || 0);
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

export function buildOverview({ campaignDef, campaignBoxes, pipelineDef, gcBoxes, clientDef, clientBoxes, harvey, radar, now = Date.now() }) {
  const cm = originMap(campaignDef || {}), pm = originMap(pipelineDef || {}), clm = originMap(clientDef || {});
  const originOf = (map, b) => (map.key && map.names[String((b.fields || {})[map.key] || '')]) || '';

  const rows = {};
  const row = (code) => (rows[code] ||= { code, label: campaignLabel(code), contacted: 0, responded: 0, calls: 0, pitched: 0, recycled: 0, new7: 0, last: 0, deals: 0, proposal: 0, hot: 0, clients: 0, active_clients: 0, src: 'Streak' });

  // GC Campaigns: every box is a contacted company; stage says how far it went
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(dayKey(now - i * DAY));
  const newByDay = Object.fromEntries(days.map((d) => [d, 0]));
  for (const b of campaignBoxes || []) {
    const r = row(originOf(cm, b) || 'No campaign set');
    r.contacted++;
    if (RESPONDED.has(b.stageKey)) r.responded++;
    if (b.stageKey === '5003') r.calls++;
    if (b.stageKey === '5004') r.pitched++;
    if (b.stageKey === '5006') r.recycled++;
    const c = ts(b.creationTimestamp);
    if (c && now - c < 7 * DAY) r.new7++;
    if (c && newByDay[dayKey(c)] != null) newByDay[dayKey(c)]++;
    r.last = Math.max(r.last, ts(b.lastUpdatedTimestamp), c);
  }

  // GC Pipeline: open deals per campaign code (same Origin names across pipelines)
  const stageTotals = Object.fromEntries(STAGE_ORDER.map((k) => [k, 0]));
  let recycledDeals = 0;
  for (const b of gcBoxes || []) {
    if (b.stageKey === '5012') { recycledDeals++; continue; }
    if (stageTotals[b.stageKey] != null) stageTotals[b.stageKey]++;
    const o = originOf(pm, b);
    if (!o || !rows[o]) continue; // only attribute deals to campaigns that exist in GC Campaigns
    const r = rows[o];
    r.deals++;
    if (PROPOSAL_PLUS.has(b.stageKey)) r.proposal++;
    if (HOT.has(b.stageKey)) r.hot++;
  }

  // GC Clients: signed
  const clients = (clientBoxes || []).map((b) => ({ origin: originOf(clm, b), active: ACTIVE_CLIENT.has(b.stageKey), status: CLIENT_STAGES[b.stageKey] || b.stageKey }));
  for (const c of clients) if (rows[c.origin]) { rows[c.origin].clients++; if (c.active) rows[c.origin].active_clients++; }

  // Harvey H01 lives in its own system: its numbers replace the (smaller) Streak echo
  const hv = harvey && harvey.stats;
  if (hv) {
    const r = row('H01');
    r.src = 'Harvey';
    r.contacted = Math.max(r.contacted, hv.contacted || 0);
    r.responded = Math.max(r.responded, hv.replied || 0);
    r.calls = Math.max(r.calls, hv.meetings || 0);
    r.waiting_approval = hv.waiting_approval || 0;
    r.followup_due = hv.followup_due || 0;
    r.bounced = hv.bounced || 0;
    for (const a of harvey.activity || []) if (newByDay[a.day] != null) newByDay[a.day] += a.prospects || 0;
    const act = (harvey.activity || []).filter((a) => now - Date.parse(a.day) < 7 * DAY);
    r.new7 += act.reduce((n, a) => n + (a.prospects || 0), 0);
    if (harvey.last_sync) r.last = Math.max(r.last, ts(harvey.last_sync));
  }

  const list = Object.values(rows).map((r) => ({
    ...r,
    response_rate: r.contacted ? Math.round((1000 * r.responded) / r.contacted) / 10 : null,
    stale_days: r.last ? Math.floor((now - r.last) / DAY) : null,
  })).sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code, 'en', { numeric: true }) || b.contacted - a.contacted);

  const sum = (k) => list.reduce((n, r) => n + (r[k] || 0), 0);
  const openDeals = Object.values(stageTotals).reduce((a, b) => a + b, 0);
  const daily = days.map((d) => ({ day: d, n: newByDay[d] }));
  const last7 = daily.slice(-7).reduce((n, d) => n + d.n, 0);
  const contacted = sum('contacted'), responded = sum('responded');

  return {
    generated_at: now,
    kpis: {
      campaigns: list.filter((r) => rank(r.code) < 3).length,
      contacted, responded,
      response_rate: contacted ? Math.round((1000 * responded) / contacted) / 10 : null,
      calls: sum('calls'),
      new_leads_7d: last7,
      target_7d: DAILY_TARGET * 7,
      open_deals: openDeals,
      proposal_plus: [...PROPOSAL_PLUS].reduce((n, k) => n + (stageTotals[k] || 0), 0),
      hot: [...HOT].reduce((n, k) => n + (stageTotals[k] || 0), 0),
      clients_active: clients.filter((c) => c.active).length,
      clients_total: clients.length,
      radar_collected: radar && radar.collected != null ? radar.collected : null,
      radar_pushed: radar && radar.pushed != null ? radar.pushed : null,
    },
    campaigns: list,
    daily, daily_target: DAILY_TARGET,
    pipeline: STAGE_ORDER.map((k) => ({ stage: k, name: STAGE_NAMES[k], n: stageTotals[k] })),
    recycled_deals: recycledDeals,
    campaign_stages: CAMPAIGN_STAGES,
  };
}
