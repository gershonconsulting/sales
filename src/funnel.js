// Funnel: Radar -> Sales Navigator -> Botdog -> (Pulse) -> Streak GC Campaigns / GC Pipeline -> signed client (GC Clients)
// Matching key between Radar and Streak = normalised company name (Streak boxes carry no LinkedIn URL).
// A Streak deal or client counts as Radar-sourced only if Radar pushed it to Botdog BEFORE the Streak box was created
// (otherwise Radar simply picked up someone we already knew).

export const STAGE_ORDER = ['5001', '5002', '5010', '5003', '5011', '5013', '5005', '5015'];
export const STAGE_NAMES = { '5001': '1. Lead', '5002': '2. Contacted', '5010': '3. Scheduled', '5003': '4. Pitched', '5011': '5. Proposal Sent', '5013': '6. Nurturing', '5005': '7. Negotiating', '5015': '8. Closing', '5012': '9. Recycled' };
const PROPOSAL_PLUS = new Set(['5011', '5013', '5005', '5015']);

// "Flying Secoya (TP)" -> "Flying Secoya"; "Altavia - Anne (LF)" -> "Altavia"
export const clientName = (n) => String(n || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+-\s+.*$/, '').trim();

export function originMap(pipelineDef) {
  const f = (pipelineDef.fields || []).find((x) => String(x.name).trim().toLowerCase() === 'origin');
  const items = (f && f.dropdownSettings && f.dropdownSettings.items) || [];
  return { key: f ? String(f.key) : null, names: Object.fromEntries(items.map((i) => [String(i.key), String(i.name).trim()])) };
}

function radarSourced(match, createdAt) {
  if (!match || !match.pushed || !match.first_pushed) return false;
  return !createdAt || Date.parse(match.first_pushed) < createdAt;
}

export const CLIENT_STAGES = { '5009': 'Started', '5004': 'On Going', '5002': 'Success', '5001': 'Failed', '5003': 'Abandoned' };
const ACTIVE_CLIENT = new Set(['5009', '5004']);

export function buildFunnel({ radar, pipelineDef, gcBoxes, clientDef, clientBoxes, campaignDef, campaignBoxes, now = Date.now() }) {
  const om = originMap(pipelineDef || {});
  const matches = (radar && radar.matches) || {};
  const deals = (gcBoxes || []).map((b) => {
    const origin = (om.key && om.names[String((b.fields || {})[om.key] || '')]) || '';
    const m = matches[b.name] || null;
    // a source typed by hand wins; the automatic Radar match only fills in boxes with no source (or a generic 'LinkedIn')
    const viaRadar = origin === 'Botdog' || ((!origin || origin === 'LinkedIn') && radarSourced(m, b.creationTimestamp));
    return { key: b.boxKey || b.key, name: b.name, stage: b.stageKey, stage_name: STAGE_NAMES[b.stageKey] || b.stageKey, origin: origin || 'No source set', viaRadar, radar: m };
  });
  const open = deals.filter((d) => d.stage !== '5012');
  const radarDeals = open.filter((d) => d.viaRadar);

  // signed clients = every box in the Streak GC Clients pipeline (one box per client, with its own Origin field)
  const cl = originMap(clientDef || {});
  const clients = (clientBoxes || []).map((b) => {
    const origin = (cl.key && cl.names[String((b.fields || {})[cl.key] || '')]) || '';
    const m = matches[b.name] || null;
    return {
      name: b.name, status: CLIENT_STAGES[b.stageKey] || b.stageKey, active: ACTIVE_CLIENT.has(b.stageKey),
      origin: origin || 'No source set', onRadar: !!m,
      viaRadar: origin === 'Botdog' || ((!origin || origin === 'LinkedIn') && radarSourced(m, b.creationTimestamp)),
    };
  }).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  const radarClients = clients.filter((c) => c.viaRadar);

  // GC Campaigns: accepted LinkedIn contacts turned into campaign boxes (Origin = Botdog)
  const cm = originMap(campaignDef || {});
  const campaignRadar = (campaignBoxes || []).filter((b) => cm.key && cm.names[String((b.fields || {})[cm.key] || '')] === 'Botdog');

  const r = radar || {};
  const steps = [
    { id: 'collected', label: 'Collected on Radar', n: r.collected ?? null, src: 'Radar' },
    { id: 'graded', label: 'Graded A or B', n: r.graded_ab ?? null, src: 'Radar', of: 'collected' },
    { id: 'salesnav', label: 'Listed in Sales Navigator', n: r.salesnav ?? null, src: 'Radar', of: 'collected' },
    { id: 'pushed', label: 'Pushed to Botdog', n: r.pushed ?? null, src: 'Radar', of: 'collected' },
    { id: 'invited', label: 'Invited by Botdog', n: r.invited ?? null, src: 'Botdog', of: 'pushed' },
    { id: 'connected', label: 'Accepted the invitation', n: r.connected ?? null, src: 'Botdog', of: 'invited' },
    { id: 'campaign', label: 'In GC Campaigns (Botdog)', n: campaignRadar.length, src: 'Streak', of: 'connected' },
    { id: 'pulse', label: 'Engaged on LinkedIn (Pulse)', n: null, src: 'Pulse', note: 'Pulse is not linked to Radar prospects yet' },
    { id: 'streak', label: 'Open deal in Streak', n: radarDeals.length, src: 'Streak' },
    { id: 'proposal', label: 'Proposal sent or later', n: radarDeals.filter((d) => PROPOSAL_PLUS.has(d.stage)).length, src: 'Streak', of: 'streak' },
    { id: 'signed', label: 'Signed client (full cycle)', n: radarClients.length, src: 'Streak GC Clients' },
  ];

  // open deals by source x stage
  const bySource = {};
  for (const d of open) {
    const s = (bySource[d.origin] ||= { origin: d.origin, total: 0, stages: {} });
    s.total++;
    s.stages[d.stage] = (s.stages[d.stage] || 0) + 1;
  }

  // people who accepted on LinkedIn but have no Streak deal yet
  const dealNames = new Set(open.map((d) => d.name.toLowerCase()));
  const acceptedNoDeal = (r.connected_list || []).filter((p) => !dealNames.has(String(p.company || '').toLowerCase()));

  return {
    generated_at: now,
    radar_ok: !!radar,
    botdog_synced_at: r.botdog_synced_at || null,
    radar_last_collected: r.radar_last_collected || null,
    steps,
    full_cycle: radarClients.length,
    radar_deals: radarDeals.map(({ key, name, stage, stage_name, origin }) => ({ key, name, stage, stage_name, origin })),
    clients,
    clients_total: clients.length,
    clients_active: clients.filter((c) => c.active).length,
    clients_by_source: Object.entries(clients.reduce((o, c) => ((o[c.origin] = (o[c.origin] || 0) + 1), o), {})).map(([origin, n]) => ({ origin, n })).sort((a, b) => b.n - a.n),
    by_source: Object.values(bySource).sort((a, b) => b.total - a.total),
    accepted_no_deal: acceptedNoDeal,
    stage_order: STAGE_ORDER,
    stage_names: STAGE_NAMES,
  };
}
