// Harvey campaign H01 — leads, email exchanges, stats and follow-up inside sales.gershon.ai.
// Harvey (Hostinger VPS) pushes a full snapshot of its database every 15 minutes to
// POST /api/harvey/ingest and receives back the follow-up actions decided here
// (edit / approve / reject a waiting email, queue a new follow-up). It applies them with
// its own safety checks and confirms through POST /api/harvey/ack. Nothing is ever sent
// from this Worker: Harvey's Sender sends, and only what was approved.

const DAY = 86400000;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export const CRM_STAGES = ['New', 'Contacted', 'Replied', 'Interested', 'Meeting booked', 'Not interested', 'Won', 'Lost'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS harvey_companies (id TEXT PRIMARY KEY, name TEXT, domain TEXT, website TEXT, industry TEXT, location TEXT, size TEXT, source TEXT, description TEXT, notes TEXT, signals TEXT, created_at TEXT, synced_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS harvey_prospects (id TEXT PRIMARY KEY, company_id TEXT, first_name TEXT, last_name TEXT, title TEXT, email TEXT, email_verified INTEGER, linkedin TEXT, status TEXT, score INTEGER, notes TEXT, source_url TEXT, created_at TEXT, updated_at TEXT, synced_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS harvey_emails (id TEXT PRIMARY KEY, prospect_id TEXT, kind TEXT, step INTEGER, to_email TEXT, subject TEXT, body TEXT, status TEXT, send_at TEXT, sent_at TEXT, error TEXT, created_at TEXT, updated_at TEXT, synced_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS harvey_emails_p ON harvey_emails(prospect_id)`,
  `CREATE TABLE IF NOT EXISTS harvey_threads (id TEXT PRIMARY KEY, prospect_id TEXT, intent TEXT, stage TEXT, status TEXT, thread TEXT, updated_at TEXT, synced_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS harvey_threads_p ON harvey_threads(prospect_id)`,
  `CREATE TABLE IF NOT EXISTS harvey_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, prospect_id TEXT, outbox_id TEXT, subject TEXT, body TEXT, status TEXT, result TEXT, created_at INTEGER, done_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS harvey_crm (prospect_id TEXT PRIMARY KEY, stage TEXT, next_followup TEXT, notes TEXT, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS harvey_meta (k TEXT PRIMARY KEY, v TEXT)`,
];
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  schemaReady = true;
}
async function meta(env, k) {
  const r = await env.DB.prepare('SELECT v FROM harvey_meta WHERE k=?').bind(k).first();
  return r ? r.v : null;
}
async function setMeta(env, k, v) {
  await env.DB.prepare('INSERT INTO harvey_meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(v)).run();
}

/* ---------- machine endpoints (Harvey server), token-authenticated ---------- */
async function machineAuth(req, env) {
  const h = req.headers.get('Authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!tok) return false;
  // The token lives only on the Harvey server; this side keeps its SHA-256 (D1 harvey_meta or Worker secret).
  const want = (env.HARVEY_INGEST_SHA256 || (await meta(env, 'ingest_sha256')) || '').toLowerCase();
  return !!want && (await sha256(tok)) === want;
}

export async function harveyMachine(req, env, p) {
  await ensureSchema(env);
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!(await machineAuth(req, env))) return json({ error: 'unauthorized' }, 401);
  if (p === '/api/harvey/ingest') return json(await ingest(env, await req.json()));
  if (p === '/api/harvey/ack') return json(await ack(env, await req.json()));
  return json({ error: 'not found' }, 404);
}

const s = (v, n = 20000) => (v == null ? '' : String(v)).slice(0, n);

async function ingest(env, snap) {
  const now = Date.now();
  const st = [];
  for (const c of snap.companies || [])
    st.push(env.DB.prepare(`INSERT INTO harvey_companies (id,name,domain,website,industry,location,size,source,description,notes,signals,created_at,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,domain=excluded.domain,website=excluded.website,industry=excluded.industry,location=excluded.location,size=excluded.size,source=excluded.source,description=excluded.description,notes=excluded.notes,signals=excluded.signals,created_at=excluded.created_at,synced_at=excluded.synced_at`)
      .bind(s(c.id), s(c.name), s(c.domain), s(c.website), s(c.industry), s(c.location), s(c.company_size), s(c.source), s(c.description, 2000), s(c.notes, 4000), s(c.signals, 4000), s(c.created_at), now));
  for (const x of snap.prospects || [])
    st.push(env.DB.prepare(`INSERT INTO harvey_prospects (id,company_id,first_name,last_name,title,email,email_verified,linkedin,status,score,notes,source_url,created_at,updated_at,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET company_id=excluded.company_id,first_name=excluded.first_name,last_name=excluded.last_name,title=excluded.title,email=excluded.email,email_verified=excluded.email_verified,linkedin=excluded.linkedin,status=excluded.status,score=excluded.score,notes=excluded.notes,source_url=excluded.source_url,created_at=excluded.created_at,updated_at=excluded.updated_at,synced_at=excluded.synced_at`)
      .bind(s(x.id), s(x.company_id), s(x.first_name), s(x.last_name), s(x.title), s(x.email), +x.email_verified || 0, s(x.linkedin_url), s(x.status), +x.score || 0, s(x.personalization_notes, 4000), s(x.source_url), s(x.created_at), s(x.updated_at), now));
  for (const e of snap.outbox || [])
    st.push(env.DB.prepare(`INSERT INTO harvey_emails (id,prospect_id,kind,step,to_email,subject,body,status,send_at,sent_at,error,created_at,updated_at,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET prospect_id=excluded.prospect_id,kind=excluded.kind,step=excluded.step,to_email=excluded.to_email,subject=excluded.subject,body=excluded.body,status=excluded.status,send_at=excluded.send_at,sent_at=excluded.sent_at,error=excluded.error,created_at=excluded.created_at,updated_at=excluded.updated_at,synced_at=excluded.synced_at`)
      .bind(s(e.id), s(e.prospect_id), s(e.kind), +e.step || 1, s(e.to_email), s(e.subject), s(e.body), s(e.status), s(e.send_at), s(e.sent_at), s(e.error, 500), s(e.created_at), s(e.updated_at), now));
  for (const t of snap.conversations || [])
    st.push(env.DB.prepare(`INSERT INTO harvey_threads (id,prospect_id,intent,stage,status,thread,updated_at,synced_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET prospect_id=excluded.prospect_id,intent=excluded.intent,stage=excluded.stage,status=excluded.status,thread=excluded.thread,updated_at=excluded.updated_at,synced_at=excluded.synced_at`)
      .bind(s(t.id), s(t.prospect_id), s(t.intent), s(t.stage), s(t.status), s(t.thread_json, 60000), s(t.updated_at), now));
  for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
  // A full snapshot: rows Harvey no longer has are removed here too.
  if (snap.full !== false)
    await env.DB.batch(['harvey_companies', 'harvey_prospects', 'harvey_emails', 'harvey_threads'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE synced_at < ?`).bind(now)));
  await setMeta(env, 'last_ingest', now);
  await setMeta(env, 'server', JSON.stringify(snap.server || {}));
  const { results: actions } = await env.DB.prepare("SELECT id,type,prospect_id,outbox_id,subject,body FROM harvey_actions WHERE status='pending' ORDER BY id").all();
  return { ok: true, rows: st.length, actions };
}

async function ack(env, body) {
  const now = Date.now();
  const st = (body.results || []).map((r) =>
    env.DB.prepare("UPDATE harvey_actions SET status=?, result=?, done_at=? WHERE id=? AND status='pending'").bind(r.ok ? 'done' : 'failed', s(r.detail, 500), now, +r.id));
  if (st.length) await env.DB.batch(st);
  return { ok: true, acked: st.length };
}

/* ---------- lead model ---------- */
const ts = (v) => { if (!v) return 0; const t = Date.parse(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z')); return isNaN(t) ? 0 : t; };

export function leadStatus(p, emails, threads) {
  const sent = emails.filter((e) => e.status === 'sent');
  const waiting = emails.filter((e) => e.status === 'pending_review');
  const approved = emails.filter((e) => e.status === 'approved' || e.status === 'sending');
  const msgs = threads.flatMap((t) => t.messages || []);
  const replied = msgs.some((m) => m.sender === 'prospect');
  const intent = (threads.find((t) => t.intent) || {}).intent || '';
  const convStatus = threads.map((t) => t.status + ' ' + t.stage).join(' ');
  let auto = 'New';
  if (/meeting_booked|closed_won/.test(convStatus)) auto = 'Meeting booked';
  else if (intent === 'not_interested' || /closed_lost/.test(convStatus)) auto = 'Not interested';
  else if (intent === 'interested') auto = 'Interested';
  else if (replied) auto = 'Replied';
  else if (sent.length) auto = 'Contacted';
  const lastSent = Math.max(0, ...sent.map((e) => ts(e.sent_at)));
  const lastIn = Math.max(0, ...msgs.filter((m) => m.sender === 'prospect').map((m) => ts(m.timestamp)));
  const lastTouch = Math.max(lastSent, lastIn, ...msgs.map((m) => ts(m.timestamp)));
  const bounced = p.status === 'bounced' || /bounce|invalid/i.test(p.status || '');
  const unfit = p.status === 'unfit';
  return { auto, sent: sent.length, waiting: waiting.length, approved: approved.length, replied, intent, lastSent, lastIn, lastTouch, bounced, unfit };
}

function followupDue(stage, info, crm, now) {
  if (crm && crm.next_followup) return ts(crm.next_followup) <= now;
  if (['Not interested', 'Won', 'Lost', 'Meeting booked'].includes(stage)) return false;
  if (info.waiting || info.approved || info.bounced || info.unfit) return false;
  if (info.lastIn && info.lastIn >= info.lastSent) return true; // they wrote last: answer them
  return !!info.lastSent && now - info.lastSent > 5 * DAY;
}

async function loadAll(env) {
  const [{ results: companies }, { results: prospects }, { results: emails }, { results: threads }, { results: crm }, { results: acts }] = await Promise.all([
    env.DB.prepare('SELECT * FROM harvey_companies').all(),
    env.DB.prepare('SELECT * FROM harvey_prospects').all(),
    env.DB.prepare('SELECT id,prospect_id,kind,step,to_email,subject,status,send_at,sent_at,error,created_at,updated_at FROM harvey_emails').all(),
    env.DB.prepare('SELECT id,prospect_id,intent,stage,status,thread,updated_at FROM harvey_threads').all(),
    env.DB.prepare('SELECT * FROM harvey_crm').all(),
    env.DB.prepare("SELECT prospect_id, COUNT(*) AS n FROM harvey_actions WHERE status='pending' GROUP BY prospect_id").all(),
  ]);
  for (const t of threads) { try { t.messages = JSON.parse(t.thread || '[]'); } catch (e) { t.messages = []; } delete t.thread; }
  return { companies, prospects, emails, threads, crm, acts };
}

function by(list, key) { const m = new Map(); for (const x of list) { const k = x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }

async function overview(env) {
  const now = Date.now();
  const d = await loadAll(env);
  const co = new Map(d.companies.map((c) => [c.id, c]));
  const em = by(d.emails, 'prospect_id'), th = by(d.threads, 'prospect_id');
  const crm = new Map(d.crm.map((c) => [c.prospect_id, c]));
  const pend = new Map(d.acts.map((a) => [a.prospect_id, a.n]));
  const leads = d.prospects.map((p) => {
    const info = leadStatus(p, em.get(p.id) || [], th.get(p.id) || []);
    const c = co.get(p.company_id) || {};
    const k = crm.get(p.id);
    const stage = (k && k.stage) || info.auto;
    return {
      id: p.id, name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email || '(unnamed)', title: p.title, email: p.email,
      email_verified: !!p.email_verified, linkedin: p.linkedin, company: c.name || '', domain: c.domain || '', location: c.location || '',
      harvey_status: p.status, score: p.score, stage, stage_auto: info.auto, stage_set: !!(k && k.stage),
      sent: info.sent, waiting: info.waiting, approved: info.approved, replied: info.replied, intent: info.intent,
      bounced: info.bounced, unfit: info.unfit, last_touch: info.lastTouch || null, last_sent: info.lastSent || null,
      next_followup: (k && k.next_followup) || null, followup_due: followupDue(stage, info, k, now), pending_actions: pend.get(p.id) || 0,
      created_at: ts(p.created_at) || null,
    };
  }).sort((a, b) => (b.last_touch || b.created_at || 0) - (a.last_touch || a.created_at || 0));

  // daily activity, last 14 days (UTC)
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(now - i * DAY).toISOString().slice(0, 10));
  const day = (v) => (ts(v) ? new Date(ts(v)).toISOString().slice(0, 10) : '');
  const count = (list, f) => { const m = {}; for (const x of list) { const k = f(x); if (k) m[k] = (m[k] || 0) + 1; } return m; };
  const cDay = count(d.companies, (c) => day(c.created_at)), pDay = count(d.prospects, (p) => day(p.created_at));
  const sDay = count(d.emails.filter((e) => e.status === 'sent'), (e) => day(e.sent_at));
  const rDay = count(d.threads.flatMap((t) => t.messages.filter((m) => m.sender === 'prospect')), (m) => day(m.timestamp));
  const activity = days.map((k) => ({ day: k, companies: cDay[k] || 0, prospects: pDay[k] || 0, sent: sDay[k] || 0, replies: rDay[k] || 0 }));

  const live = leads.filter((l) => !l.unfit);
  const stByStage = {};
  for (const l of live) stByStage[l.stage] = (stByStage[l.stage] || 0) + 1;
  const sentTotal = d.emails.filter((e) => e.status === 'sent').length;
  const repliedLeads = live.filter((l) => l.replied).length;
  const contacted = live.filter((l) => l.sent > 0).length;
  const stats = {
    companies: d.companies.length,
    prospects: live.length,
    unfit: leads.length - live.length,
    verified: live.filter((l) => l.email_verified).length,
    waiting_approval: d.emails.filter((e) => e.status === 'pending_review').length,
    approved_queued: d.emails.filter((e) => e.status === 'approved' || e.status === 'sending').length,
    emails_sent: sentTotal,
    contacted,
    replied: repliedLeads,
    reply_rate: contacted ? Math.round((1000 * repliedLeads) / contacted) / 10 : null,
    interested: live.filter((l) => l.stage === 'Interested').length,
    meetings: live.filter((l) => l.stage === 'Meeting booked' || l.stage === 'Won').length,
    bounced: live.filter((l) => l.bounced).length,
    followup_due: live.filter((l) => l.followup_due).length,
    by_stage: stByStage,
    target_per_day: 10,
  };
  let server = {};
  try { server = JSON.parse((await meta(env, 'server')) || '{}'); } catch (e) { /* ignore */ }
  return { campaign: 'GC Campaign H01 — Harvey', last_sync: +(await meta(env, 'last_ingest')) || null, linked: !!(env.HARVEY_INGEST_SHA256 || (await meta(env, 'ingest_sha256'))), server, stats, activity, leads, stages: CRM_STAGES };
}

async function lead(env, id) {
  const p = await env.DB.prepare('SELECT * FROM harvey_prospects WHERE id=?').bind(id).first();
  if (!p) throw new Error('lead not found');
  const [c, { results: emails }, { results: threads }, crm, { results: actions }] = await Promise.all([
    env.DB.prepare('SELECT * FROM harvey_companies WHERE id=?').bind(p.company_id).first(),
    env.DB.prepare('SELECT * FROM harvey_emails WHERE prospect_id=? ORDER BY step, created_at').bind(id).all(),
    env.DB.prepare('SELECT * FROM harvey_threads WHERE prospect_id=?').bind(id).all(),
    env.DB.prepare('SELECT * FROM harvey_crm WHERE prospect_id=?').bind(id).first(),
    env.DB.prepare('SELECT id,type,outbox_id,subject,status,result,created_at,done_at FROM harvey_actions WHERE prospect_id=? ORDER BY id DESC LIMIT 20').bind(id).all(),
  ]);
  for (const t of threads) { try { t.messages = JSON.parse(t.thread || '[]'); } catch (e) { t.messages = []; } delete t.thread; }
  // One timeline: emails Harvey sent or plans to send + the conversation messages (replies in and out).
  const timeline = [];
  for (const e of emails) timeline.push({ type: 'email', id: e.id, at: ts(e.sent_at) || ts(e.send_at) || ts(e.created_at), dir: 'out', status: e.status, step: e.step, kind: e.kind, to: e.to_email, subject: e.subject, body: e.body, error: e.error });
  const sentBodies = new Set(emails.filter((e) => e.status === 'sent').map((e) => (e.body || '').trim().slice(0, 200)));
  for (const t of threads) for (const m of t.messages) {
    if (m.sender !== 'prospect' && sentBodies.has((m.content || '').trim().slice(0, 200))) continue; // already shown as a sent email
    timeline.push({ type: 'message', at: ts(m.timestamp), dir: m.sender === 'prospect' ? 'in' : 'out', body: m.content, intent: t.intent });
  }
  timeline.sort((a, b) => (a.at || 0) - (b.at || 0));
  const info = leadStatus(p, emails, threads);
  return { prospect: p, company: c || {}, crm: crm || {}, stage_auto: info.auto, stage: (crm && crm.stage) || info.auto, timeline, actions, stages: CRM_STAGES };
}

/* ---------- user endpoints (signed-in) ---------- */
export async function harveyUser(req, env, p, aiFn) {
  try { return await harveyUserInner(req, env, p, aiFn); } catch (e) { return json({ error: String((e && e.message) || e) }, 400); }
}
async function harveyUserInner(req, env, p, aiFn) {
  await ensureSchema(env);
  const post = req.method === 'POST';
  if (p === '/api/harvey' && !post) return json(await overview(env));
  let m = p.match(/^\/api\/harvey\/lead\/([\w-]+)$/);
  if (m && !post) return json(await lead(env, m[1]));
  m = p.match(/^\/api\/harvey\/lead\/([\w-]+)\/(crm|action|aidraft)$/);
  if (m && post) {
    const b = await req.json().catch(() => ({}));
    if (m[2] === 'crm') return json(await saveCrm(env, m[1], b));
    if (m[2] === 'action') return json(await queueAction(env, m[1], b));
    if (m[2] === 'aidraft') return json(await aiDraft(env, m[1], aiFn));
  }
  return json({ error: 'not found' }, 404);
}

async function saveCrm(env, id, b) {
  const stage = b.stage && CRM_STAGES.includes(b.stage) ? b.stage : null;
  const next = b.next_followup && /^\d{4}-\d{2}-\d{2}$/.test(b.next_followup) ? b.next_followup : null;
  await env.DB.prepare('INSERT INTO harvey_crm (prospect_id,stage,next_followup,notes,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(prospect_id) DO UPDATE SET stage=excluded.stage,next_followup=excluded.next_followup,notes=excluded.notes,updated_at=excluded.updated_at')
    .bind(id, stage, next, s(b.notes, 4000), Date.now()).run();
  return { ok: true };
}

const ACTIONS = ['edit', 'approve', 'reject', 'followup'];
async function queueAction(env, id, b) {
  if (!ACTIONS.includes(b.type)) throw new Error('unknown action');
  const p = await env.DB.prepare('SELECT id FROM harvey_prospects WHERE id=?').bind(id).first();
  if (!p) throw new Error('lead not found');
  let outbox = '';
  if (b.type !== 'followup') {
    const e = await env.DB.prepare('SELECT id,status FROM harvey_emails WHERE id=? AND prospect_id=?').bind(s(b.outbox_id), id).first();
    if (!e) throw new Error('email not found');
    if (e.status !== 'pending_review' && !(b.type === 'reject' && e.status === 'approved')) throw new Error('this email is no longer waiting for approval');
    outbox = e.id;
  }
  if ((b.type === 'edit' || b.type === 'followup') && !String(b.body || '').trim()) throw new Error('the email body is empty');
  if (b.type === 'followup' && !String(b.subject || '').trim()) throw new Error('add a subject');
  // An edit sent together with an approval: edit first, then approve (Harvey applies them in order).
  const now = Date.now();
  const st = [];
  if (b.type === 'approve' && (b.subject != null || b.body != null))
    st.push(env.DB.prepare("INSERT INTO harvey_actions (type,prospect_id,outbox_id,subject,body,status,created_at) VALUES ('edit',?,?,?,?,'pending',?)").bind(id, outbox, s(b.subject, 300), s(b.body), now));
  st.push(env.DB.prepare("INSERT INTO harvey_actions (type,prospect_id,outbox_id,subject,body,status,created_at) VALUES (?,?,?,?,?,'pending',?)").bind(b.type, id, outbox, s(b.subject, 300), s(b.body), now));
  await env.DB.batch(st);
  return { ok: true, queued: st.length };
}

async function aiDraft(env, id, aiFn) {
  const L = await lead(env, id);
  const p = L.prospect, c = L.company;
  const hist = L.timeline.filter((t) => t.status === 'sent' || t.type === 'message').slice(-6)
    .map((t) => `${t.dir === 'in' ? 'THEM' : 'US'} (${t.at ? new Date(t.at).toISOString().slice(0, 10) : '?'}): ${t.subject ? t.subject + ' — ' : ''}${(t.body || '').slice(0, 1200)}`).join('\n\n');
  const sys = `You write a follow-up email for Olivier Attia, Managing Director of Gershon Consulting (helps international companies enter the US market: LinkedIn outbound, lead generation, commercial representation). Tone: warm, direct, personal, no fluff, no buzzwords, no AI clichés. Under 90 words. If they replied, answer what they said. If they did not reply, a short, polite nudge that adds one useful point. Never invent facts. One clear next step: a 20-minute call (booking link: https://www.gershonconsulting.com/calendar). Sign "Olivier". Return ONLY JSON: {"subject":"...","body":"..."}`;
  const user = `Prospect: ${p.first_name} ${p.last_name}, ${p.title || ''} at ${c.name || ''} (${c.domain || ''}).\nWhat Harvey found: ${(p.notes || '').slice(0, 1200)}\nCompany: ${(c.description || '').slice(0, 600)}\n\nExchange so far:\n${hist || '(nothing sent yet)'}`;
  const raw = await aiFn(env, [{ role: 'system', content: sys }, { role: 'user', content: user }], 500);
  let subject = 'Re: ' + ((L.timeline.find((t) => t.subject) || {}).subject || (c.name || 'quick follow-up')).replace(/^Re:\s*/i, ''), body = raw;
  try { const m = raw.match(/\{[\s\S]*\}/); const j = JSON.parse(m ? m[0] : raw); subject = j.subject || subject; body = j.body || body; } catch (e) { /* keep raw */ }
  return { subject, body };
}
