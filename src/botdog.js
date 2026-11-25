// Botdog: API key saved in Settings (D1), daily status of every Botdog campaign.
// The key is never sent back to the browser — only its last 4 characters.
// API: https://docs.botdog.co (x-api-key header, keys start with bd_live_).

const API = 'https://api.botdog.co/v1';
const get = async (env, k) => (await env.DB.prepare('SELECT v FROM settings WHERE k=?').bind(k).first())?.v ?? null;
const put = (env, k, v) => env.DB.prepare('INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(v)).run();
const del = (env, k) => env.DB.prepare('DELETE FROM settings WHERE k=?').bind(k).run();
const mask = (k) => (k ? '••••' + String(k).slice(-4) : null);
const MAX_CAMPAIGNS = 40; // stays well under the Worker sub-request limit

async function bd(key, path, fetchFn) {
  const r = await fetchFn(API + path, { headers: { 'x-api-key': key, Accept: 'application/json' } });
  if (r.status === 401 || r.status === 403) throw new Error('Botdog refused this key. Create a new one in Botdog → Settings → Integrations → API.');
  if (!r.ok) throw new Error('Botdog answered ' + r.status + ' — try again in a minute.');
  return r.json();
}

// Pure: turn campaigns + their statistics into the status shown in the app.
export function buildBotdogStatus(campaigns, statsById, at = Date.now()) {
  const n = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
  const rows = campaigns.map((c) => {
    const st = statsById[c.id] || null;
    const s = (st && st.statistics) || {};
    const leads = n(s.totalLeadCount), invited = n(s.invitationsSent), accepted = n(s.invitationsAccepted), replied = n(s.messagesReplied);
    const stuck = c.status === 'CREATED' && leads > 0; // leads waiting in a campaign that was never started
    return {
      id: c.id, name: c.name, status: c.status, owner: c.ownerEmail || (st && st.owner) || '',
      leads, in_progress: n(s.totalLeadsInProgress), skipped: n(s.totalLeadsSkipped),
      invited, accepted, messages: n(s.messagesSent), replied,
      accept_rate: invited ? Math.round((1000 * accepted) / invited) / 10 : null,
      reply_rate: n(s.messagesSent) ? Math.round((1000 * replied) / n(s.messagesSent)) / 10 : null,
      progress: s.progress ?? null, stats: !!st, stuck, created_at: c.createdAt || null,
    };
  });
  const order = { ACTIVE: 0, CREATED: 1, PAUSED: 2, COMPLETED: 3, ARCHIVED: 4 };
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.leads - a.leads);
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
  const totals = { campaigns: rows.length, active: rows.filter((r) => r.status === 'ACTIVE').length, leads: sum('leads'), invited: sum('invited'), accepted: sum('accepted'), replied: sum('replied'), stuck_leads: rows.filter((r) => r.stuck).reduce((t, r) => t + r.leads, 0) };
  totals.accept_rate = totals.invited ? Math.round((1000 * totals.accepted) / totals.invited) / 10 : null;
  return { at, totals, campaigns: rows };
}

export async function syncBotdog(env, fetchFn = fetch) {
  const key = await get(env, 'botdog_api_key');
  if (!key) throw new Error('Botdog is not connected — paste your Botdog API key in Settings.');
  try {
    const all = await bd(key, '/campaigns', fetchFn);
    const list = (Array.isArray(all) ? all : all.data || []).filter((c) => c.status !== 'ARCHIVED').slice(0, MAX_CAMPAIGNS);
    const stats = {};
    for (let i = 0; i < list.length; i += 6) {
      await Promise.all(list.slice(i, i + 6).map(async (c) => {
        try { stats[c.id] = await bd(key, '/campaigns/' + encodeURIComponent(c.id) + '/statistics', fetchFn); } catch (e) { /* keep the row, without numbers */ }
      }));
    }
    const status = buildBotdogStatus(list, stats);
    await put(env, 'botdog_status', JSON.stringify(status));
    await del(env, 'botdog_sync_error');
    return status;
  } catch (e) {
    await put(env, 'botdog_sync_error', String(e.message || e));
    throw e;
  }
}

export async function botdogView(env) {
  const [key, savedAt, raw, err] = await Promise.all(['botdog_api_key', 'botdog_key_saved_at', 'botdog_status', 'botdog_sync_error'].map((k) => get(env, k)));
  let status = null;
  try { status = raw ? JSON.parse(raw) : null; } catch (e) { status = null; }
  return { connected: !!key, hint: mask(key), saved_at: +savedAt || null, last_error: err || null, status };
}

export async function saveBotdogKey(env, raw, fetchFn = fetch) {
  const key = String(raw || '').trim();
  if (!key) throw new Error('Paste your Botdog API key first.');
  if (key.length < 12 || /\s/.test(key)) throw new Error('That does not look like a Botdog API key (it starts with bd_live_).');
  await bd(key, '/campaigns', fetchFn); // checked with Botdog before it is stored
  await put(env, 'botdog_api_key', key);
  await put(env, 'botdog_key_saved_at', Date.now());
  return { ok: true, hint: mask(key) };
}

export async function removeBotdogKey(env) {
  for (const k of ['botdog_api_key', 'botdog_key_saved_at', 'botdog_status', 'botdog_sync_error']) await del(env, k);
  return { ok: true };
}
