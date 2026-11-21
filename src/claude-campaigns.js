// Claude campaigns (CC01, CC02, … and H01): one funnel + dashboard per campaign code.
// Source of truth = the Streak "Origin" field. A campaign's leads are every box whose Origin is its code,
// in GC Campaigns, GC Pipeline or GC Clients (a lead that moved on is counted once, at its furthest point).
import { originMap } from './funnel.js';

export const CODE_RE = /^(CC|H)\d{2,}$/i;
const DAY = 86400000;

// what each code is (editable in the app; these are the defaults)
export const DEFAULT_META = {
  CC01: { description: 'New companies from E2 filings, emailed to the CEO' },
  CC02: { description: 'European companies expanding to the US' },
  CC03: { description: 'Companies that attended SelectUSA' },
  CC08: { description: 'E2 email sequence sent through Snov (finished)' },
  CC09: { description: 'US offices of European trade agencies — referral partners' },
  H01: { description: 'Harvey cold-email agent', page: 'harvey' },
};

// stage keys per pipeline
const CAMPAIGN_STAGES = { '5001': '1. Contacted', '5002': '2. Responded', '5003': '3. Call Scheduled', '5004': '4. Pitched', '5006': '5. Recycled' };
const DEAL_STAGES = { '5001': '1. Lead', '5002': '2. Contacted', '5010': '3. Scheduled', '5003': '4. Pitched', '5011': '5. Proposal Sent', '5013': '6. Nurturing', '5005': '7. Negotiating', '5015': '8. Closing', '5012': '9. Recycled' };
const CLIENT_STAGES = { '5009': 'Started', '5004': 'On Going', '5002': 'Success', '5001': 'Failed', '5003': 'Abandoned' };
const DEAL_CALL = new Set(['5010', '5003', '5011', '5013', '5005', '5015']);
const DEAL_PROPOSAL = new Set(['5011', '5013', '5005', '5015']);
const CLIENT_SIGNED = new Set(['5009', '5004', '5002']);
const RANK = { campaigns: 1, pipeline: 2, clients: 3 };

const norm = (s) => String(s || '').toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const fieldName = (def, name) => {
  const f = (def.fields || []).find((x) => String(x.name).trim().toLowerCase() === name);
  const items = (f && ((f.dropdownSettings && f.dropdownSettings.items) || f.dropdownOptions)) || [];
  return { key: f ? String(f.key) : null, names: Object.fromEntries(items.map((i) => [String(i.key), String(i.name).trim()])) };
};

// Streak boxes -> flat lead rows (only boxes whose Origin is a campaign code). Pure; cached by the Worker.
export function extractLeads(sources) {
  const out = [];
  for (const [pipe, { def, boxes }] of Object.entries(sources)) {
    if (!def || !boxes) continue;
    const om = originMap(def);
    const country = fieldName(def, 'country');
    for (const b of boxes) {
      const origin = (om.key && om.names[String((b.fields || {})[om.key] || '')]) || '';
      if (!CODE_RE.test(origin)) continue;
      out.push({
        code: origin.toUpperCase(), pipe, key: b.boxKey || b.key, name: b.name || '(no name)', stage: String(b.stageKey || ''),
        created: b.creationTimestamp || 0, last_in: b.lastEmailReceivedTimestamp || 0, last_out: b.lastEmailSentTimestamp || 0,
        country: (country.key && country.names[String((b.fields || {})[country.key] || '')]) || '',
      });
    }
  }
  return out;
}

function stageName(l) {
  if (l.pipe === 'clients') return 'Client · ' + (CLIENT_STAGES[l.stage] || l.stage);
  if (l.pipe === 'pipeline') return 'Deal · ' + (DEAL_STAGES[l.stage] || l.stage);
  return CAMPAIGN_STAGES[l.stage] || l.stage;
}

// level: 1 reached, 2 email back, 3 real reply, 4 call/meeting, 5 proposal, 6 signed
export function classify(l, override) {
  let level = 1;
  const inbound = l.last_in > 0;
  if (l.pipe === 'clients' && CLIENT_SIGNED.has(l.stage)) level = 6;
  else if (l.pipe === 'pipeline' && DEAL_PROPOSAL.has(l.stage)) level = 5;
  else if ((l.pipe === 'pipeline' && DEAL_CALL.has(l.stage)) || (l.pipe === 'campaigns' && (l.stage === '5003' || l.stage === '5004'))) level = 4;
  // a real reply = an email came back AND the lead was moved on (Responded or a deal) — or marked by hand.
  // An email back on a lead still in "Contacted" is usually an out-of-office or bounce: it waits in "To check".
  let real = level >= 4 || (inbound && (l.pipe !== 'campaigns' || l.stage === '5002'));
  if (override === 'real') real = true;
  if (override === 'auto' && level < 4) real = false;
  if (real) level = Math.max(level, 3);
  else if (inbound) level = Math.max(level, 2);
  const toCheck = inbound && !real && !override;
  const falseResponded = l.pipe === 'campaigns' && l.stage === '5002' && !inbound && override !== 'real';
  return { level, inbound, real, toCheck, falseResponded };
}

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

export function summarize(rows, { overrides = {}, meta = {}, now = Date.now(), generated_at = now } = {}) {
  // dedupe per campaign by company name, keeping the furthest pipeline
  const byCode = {};
  for (const l of rows) {
    const m = (byCode[l.code] ||= new Map());
    const k = norm(l.name) || l.key;
    const prev = m.get(k);
    if (!prev || RANK[l.pipe] > RANK[prev.pipe] || (RANK[l.pipe] === RANK[prev.pipe] && l.created > prev.created)) {
      m.set(k, { ...l, created: prev ? Math.min(prev.created || l.created, l.created || prev.created) : l.created, last_in: Math.max(l.last_in, prev ? prev.last_in : 0), last_out: Math.max(l.last_out, prev ? prev.last_out : 0), also: prev ? [...(prev.also || []), prev.pipe] : [] });
    } else prev.also = [...(prev.also || []), l.pipe];
  }
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(dayKey(now - i * DAY));
  const campaigns = Object.entries(byCode).map(([code, m]) => {
    const md = { ...(DEFAULT_META[code] || {}), ...(meta[code] || {}) };
    const leads = [...m.values()].map((l) => {
      const c = classify(l, overrides[l.key]);
      return { key: l.key, name: l.name, pipe: l.pipe, also: [...new Set(l.also || [])], stage: l.stage, stage_name: stageName(l), created: l.created, last_in: l.last_in, last_out: l.last_out, country: l.country, override: overrides[l.key] || null, ...c };
    }).sort((a, b) => b.level - a.level || (b.toCheck - a.toCheck) || b.created - a.created);
    const n = (lv) => leads.filter((x) => x.level >= lv).length;
    const steps = [
      { id: 'reached', label: 'Companies reached', n: leads.length },
      { id: 'back', label: 'Email came back', n: leads.filter((x) => x.inbound || x.level >= 3).length },
      { id: 'reply', label: 'Real reply', n: n(3) },
      { id: 'call', label: 'Call / meeting', n: n(4) },
      { id: 'proposal', label: 'Proposal sent or later', n: n(5) },
      { id: 'signed', label: 'Signed client', n: n(6) },
    ];
    const perDay = Object.fromEntries(days.map((d) => [d, { day: d, reached: 0, replies: 0 }]));
    for (const l of leads) {
      if (l.created && perDay[dayKey(l.created)]) perDay[dayKey(l.created)].reached++;
      if (l.real && l.last_in && perDay[dayKey(l.last_in)]) perDay[dayKey(l.last_in)].replies++;
    }
    const last7 = leads.filter((x) => x.created > now - 7 * DAY).length;
    const lastCreated = Math.max(0, ...leads.map((x) => x.created || 0));
    const countries = Object.entries(leads.reduce((o, x) => (x.country && (o[x.country] = (o[x.country] || 0) + 1), o), {})).map(([c, k]) => ({ country: c, n: k })).sort((a, b) => b.n - a.n);
    const target = md.target != null && md.target !== '' ? +md.target : null;
    return {
      code, description: md.description || 'Claude campaign', page: md.page || null, target,
      status: last7 ? 'active' : 'quiet', last_created: lastCreated || null, last7,
      reached: leads.length, replies: n(3), calls: n(4), signed: n(6),
      reply_rate: leads.length ? Math.round((1000 * n(3)) / leads.length) / 10 : null,
      to_check: leads.filter((x) => x.toCheck).length, false_responded: leads.filter((x) => x.falseResponded).length,
      by_pipe: { campaigns: leads.filter((x) => x.pipe === 'campaigns').length, pipeline: leads.filter((x) => x.pipe === 'pipeline').length, clients: leads.filter((x) => x.pipe === 'clients').length },
      steps, activity: Object.values(perDay), countries, leads,
    };
  }).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  const allDays = days.map((d) => ({ day: d, reached: campaigns.reduce((s, c) => s + c.activity.find((a) => a.day === d).reached, 0) }));
  return {
    generated_at, daily_target: +(meta._target || 10),
    totals: { campaigns: campaigns.length, active: campaigns.filter((c) => c.status === 'active').length, reached: campaigns.reduce((s, c) => s + c.reached, 0), replies: campaigns.reduce((s, c) => s + c.replies, 0), calls: campaigns.reduce((s, c) => s + c.calls, 0), signed: campaigns.reduce((s, c) => s + c.signed, 0), to_check: campaigns.reduce((s, c) => s + c.to_check, 0) },
    activity: allDays, campaigns,
  };
}

/* ---------------- Worker side ---------------- */
async function getJSON(env, k, dflt) {
  const r = await env.DB.prepare('SELECT v FROM settings WHERE k=?').bind(k).first();
  try { return r ? JSON.parse(r.v) : dflt; } catch (e) { return dflt; }
}
async function putJSON(env, k, v) {
  await env.DB.prepare('INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, JSON.stringify(v)).run();
}

export async function refreshCampaigns(env, streak) {
  if (!env.STREAK_API_KEY) throw new Error('STREAK_API_KEY secret is not set');
  const get = (key) => key ? Promise.all([streak(env, `v1/pipelines/${key}`).catch(() => null), streak(env, `v1/pipelines/${key}/boxes`).catch(() => null)]) : Promise.resolve([null, null]);
  const [c, p, k] = await Promise.all([get(env.CAMPAIGNS_PIPELINE_KEY), get(env.PIPELINE_KEY), get(env.CLIENTS_PIPELINE_KEY)]);
  const rows = extractLeads({ campaigns: { def: c[0], boxes: c[1] }, pipeline: { def: p[0], boxes: p[1] }, clients: { def: k[0], boxes: k[1] } });
  const cache = { at: Date.now(), rows, missing: [!c[1] && 'GC Campaigns', !p[1] && 'GC Pipeline', !k[1] && 'GC Clients'].filter(Boolean) };
  await putJSON(env, 'campaigns_cache', cache);
  return cache;
}

export async function campaignsApi(req, env, p, streak) {
  const url = new URL(req.url);
  if (p === '/api/campaigns') {
    let cache = await getJSON(env, 'campaigns_cache', null);
    if (!cache || url.searchParams.has('refresh') || Date.now() - cache.at > 30 * 60000) {
      try { cache = await refreshCampaigns(env, streak); } catch (e) { if (!cache) throw e; cache.error = String(e.message || e); }
    }
    const out = summarize(cache.rows, { overrides: await getJSON(env, 'campaign_overrides', {}), meta: await getJSON(env, 'campaign_meta', {}), generated_at: cache.at });
    out.missing = cache.missing || [];
    out.error = cache.error || null;
    return out;
  }
  if (p === '/api/campaigns/override' && req.method === 'POST') {
    const { key, value } = await req.json();
    if (!key) throw new Error('key required');
    const o = await getJSON(env, 'campaign_overrides', {});
    if (value === 'real' || value === 'auto') o[key] = value; else delete o[key];
    await putJSON(env, 'campaign_overrides', o);
    return { ok: true };
  }
  if (p === '/api/campaigns/meta' && req.method === 'POST') {
    const { code, description, target } = await req.json();
    if (!code || !(CODE_RE.test(code) || code === '_target')) throw new Error('bad campaign code');
    const m = await getJSON(env, 'campaign_meta', {});
    if (code === '_target') m._target = +target || 10;
    else m[code.toUpperCase()] = { ...(m[code.toUpperCase()] || {}), ...(description != null ? { description: String(description).slice(0, 200) } : {}), ...(target !== undefined ? { target: target === '' || target == null ? null : +target } : {}) };
    await putJSON(env, 'campaign_meta', m);
    return { ok: true };
  }
  return null;
}
