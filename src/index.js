// sales.gershon.ai — GC Sales Copilot (Cloudflare Worker)
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const STAGES = { '5001': '1. Lead', '5002': '2. Contacted', '5010': '3. Scheduled', '5003': '4. Pitched', '5011': '5. Proposal Sent', '5013': '6. Nurturing', '5005': '7. Negotiating', '5015': '8. Closing', '5012': '9. Recycled' };
// follow-up rhythm in days per stage
const CADENCE = { '5001': 14, '5002': 14, '5010': 7, '5003': 14, '5011': 14, '5013': 30, '5005': 7, '5015': 7 };
const DAY = 86400000;
const enc = new TextEncoder();

const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...h } });
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const rand = () => hex(crypto.getRandomValues(new Uint8Array(24)));
const b64 = (s) => { let bin = ''; for (const c of enc.encode(s)) bin += String.fromCharCode(c); return btoa(bin); };
const b64url = (s) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    const post = req.method === 'POST';
    try {
      if (p === '/api/me') return me(req, env);
      if (p === '/api/setup' && post) return setup(req, env);
      if (p === '/api/login' && post) return login(req, env);
      if (p === '/oauth/google/callback') return googleCallback(env, url);
      const user = await auth(req, env);
      if (!user) return p.startsWith('/oauth') ? Response.redirect(url.origin + '/', 302) : json({ error: 'unauthorized' }, 401);
      if (p === '/oauth/google/start') return googleStart(env, url);
      if (p === '/api/logout' && post) {
        await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(cookie(req, 'sid')).run();
        return json({ ok: true }, 200, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
      }
      if (p === '/api/pipeline') return json(await pipeline(env));
      if (p === '/api/sync' && post) return json(await syncStreak(env));
      if (p === '/api/chat' && post) {
        const b = await req.json();
        return json({ reply: await chat(env, b.message || '', b.history || []) });
      }
      if (p === '/api/drafts') {
        const { results } = await env.DB.prepare("SELECT d.*, b.name, b.stage FROM drafts d LEFT JOIN boxes b ON b.key=d.box_key WHERE d.status IN ('pending','linkedin_queue') ORDER BY d.created_at DESC").all();
        return json(results);
      }
      if (p === '/api/draft' && post) {
        const b = await req.json();
        return json(await makeDraft(env, b.boxKey, b.channel || 'email'));
      }
      const m = p.match(/^\/api\/drafts\/(\d+)\/(approve|reject|update|done)$/);
      if (m && post) return json(await draftAction(env, +m[1], m[2], await req.json().catch(() => ({}))));
      if (p === '/api/weekly' && post) return json(await weekly(env));
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    if (event.cron === '0 6 * * *') ctx.waitUntil(syncStreak(env));
    if (event.cron === '0 10 * * 1') ctx.waitUntil(syncStreak(env).then(() => weekly(env)));
  },
};

/* ---------------- auth (app's own accounts; Olivier picks his password on first visit) ---------------- */
async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
function cookie(req, name) {
  const c = req.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? m[1] : '';
}
async function auth(req, env) {
  const t = cookie(req, 'sid');
  if (!t) return null;
  const r = await env.DB.prepare('SELECT email FROM sessions WHERE token=? AND expires>?').bind(t, Date.now()).first();
  return r ? r.email : null;
}
async function session(env, email) {
  const t = rand();
  await env.DB.prepare('INSERT INTO sessions (token,email,expires) VALUES (?,?,?)').bind(t, email, Date.now() + 30 * DAY).run();
  return { 'Set-Cookie': `sid=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}` };
}
async function me(req, env) {
  const n = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first('c');
  if (!n) return json({ setup: true });
  const user = await auth(req, env);
  if (!user) return json({ auth: false });
  return json({ auth: true, email: user, gmail: !!(await getSetting(env, 'google_refresh_token')), gmailAccount: await getSetting(env, 'google_email'), lastSync: +(await getSetting(env, 'last_sync')) || null });
}
async function setup(req, env) {
  const n = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first('c');
  if (n) return json({ error: 'already set up' }, 400);
  const { email, password } = await req.json();
  if (!email || !password || password.length < 8) return json({ error: 'email and a password of 8+ characters required' }, 400);
  const salt = rand();
  await env.DB.prepare('INSERT INTO users (email,salt,hash) VALUES (?,?,?)').bind(email.toLowerCase(), salt, await hashPw(password, salt)).run();
  return json({ ok: true }, 200, await session(env, email.toLowerCase()));
}
async function login(req, env) {
  const { email, password } = await req.json();
  const u = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind((email || '').toLowerCase()).first();
  if (!u || (await hashPw(password || '', u.salt)) !== u.hash) return json({ error: 'wrong email or password' }, 401);
  return json({ ok: true }, 200, await session(env, u.email));
}
async function getSetting(env, k) {
  const r = await env.DB.prepare('SELECT v FROM settings WHERE k=?').bind(k).first();
  return r ? r.v : null;
}
async function setSetting(env, k, v) {
  await env.DB.prepare('INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(v)).run();
}

/* ---------------- Streak ---------------- */
async function streak(env, path, opts = {}) {
  const r = await fetch('https://api.streak.com/api/' + path, {
    ...opts,
    headers: { Authorization: 'Basic ' + btoa(env.STREAK_API_KEY + ':'), ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Streak ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function syncStreak(env) {
  if (!env.STREAK_API_KEY) throw new Error('STREAK_API_KEY secret is not set');
  const boxes = await streak(env, `v1/pipelines/${env.PIPELINE_KEY}/boxes`);
  const now = Date.now();
  const stmts = [];
  for (const b of boxes) {
    if (!STAGES[b.stageKey]) continue;
    const key = b.boxKey || b.key;
    const owner = (b.assignedToSharingEntries || []).map((e) => e.fullName || e.email).join(', ');
    const emails = JSON.stringify(b.emailAddresses || []);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO boxes (key,name,stage,notes,owner,emails,last_in,last_out,last_update,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET name=excluded.name, stage=excluded.stage, notes=excluded.notes, owner=excluded.owner, emails=excluded.emails,
         last_in=excluded.last_in, last_out=excluded.last_out, last_update=excluded.last_update, synced_at=excluded.synced_at`
      ).bind(key, b.name, b.stageKey, b.notes || '', owner, emails, b.lastEmailReceivedTimestamp || 0, b.lastEmailSentTimestamp || 0, b.lastUpdatedTimestamp || 0, now)
    );
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  await env.DB.prepare('DELETE FROM boxes WHERE synced_at < ?').bind(now).run(); // boxes removed from the pipeline
  await setSetting(env, 'last_sync', now);
  return { synced: stmts.length, at: now };
}
async function streakComment(env, key, message) {
  try {
    await streak(env, `v2/boxes/${key}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
  } catch (e) {
    try {
      await streak(env, `v1/boxes/${key}/comments`, { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ message }) });
    } catch (e2) { /* non-fatal */ }
  }
}

/* ---------------- pipeline view ---------------- */
async function pipeline(env) {
  const { results } = await env.DB.prepare(
    "SELECT b.*, (SELECT MAX(at) FROM touches t WHERE t.box_key=b.key) AS last_touch FROM boxes b WHERE b.stage != '5012'"
  ).all();
  const now = Date.now();
  return results
    .map((b) => {
      const last = Math.max(b.last_in || 0, b.last_out || 0, b.last_touch || 0);
      const next = last + (CADENCE[b.stage] || 30) * DAY;
      return {
        key: b.key, name: b.name, stage: b.stage, stage_name: STAGES[b.stage], owner: b.owner, notes: b.notes,
        emails: JSON.parse(b.emails || '[]'), last_in: b.last_in, last_out: b.last_out, last, next,
        due: next <= now, days_silent: last ? Math.floor((now - last) / DAY) : null,
      };
    })
    .sort((a, b) => b.stage.localeCompare(a.stage) || a.next - b.next);
}

/* ---------------- AI (Cloudflare Workers AI) ---------------- */
async function ai(env, messages, max_tokens = 1200) {
  const r = await env.AI.run(MODEL, { messages, max_tokens });
  return typeof r.response === 'string' ? r.response : JSON.stringify(r.response);
}
async function chat(env, message, history) {
  const deals = await pipeline(env);
  const lines = deals.map((d) => `${d.name} | ${d.stage_name} | owner: ${d.owner || 'none'} | silent: ${d.days_silent ?? '?'}d | follow-up due: ${d.due ? 'YES' : 'no'} | ${(d.notes || '').replace(/\s+/g, ' ').slice(0, 160)}`);
  const sys = `You are the sales copilot of Gershon Consulting (US market entry for international companies: LinkedIn outbound, lead generation, commercial representation). You talk with Olivier Attia, the founder.
Today is ${new Date().toISOString().slice(0, 10)}. Open deals in the Streak GC Pipeline (name | stage | owner | days since last email | follow-up due | notes):
${lines.join('\n')}

Rules: be concise and concrete, answer in Olivier's language, always name the deals. Never invent facts that are not in the data. When you recommend contacting a deal, add a line exactly like:
DRAFT: <deal name> | email
(or | linkedin). The app turns those lines into buttons.`;
  const clean = (history || []).slice(-8).filter((m) => m && (m.role === 'user' || m.role === 'assistant')).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  return ai(env, [{ role: 'system', content: sys }, ...clean, { role: 'user', content: message }]);
}
async function contactEmail(env, box) {
  const own = (e) => /gershon(consulting)?\.(com|net|ai)$/i.test(e) || /oattia@gmail\.com/i.test(e);
  const list = JSON.parse(box.emails || '[]').filter((e) => !own(e));
  if (!list.length) {
    try {
      const threads = await streak(env, `v1/boxes/${box.key}/threads`);
      for (const t of threads) for (const e of t.emailAddresses || []) if (!own(e)) list.push(e);
    } catch (e) { /* ignore */ }
  }
  return list[0] || '';
}
async function makeDraft(env, boxKey, channel) {
  const box = await env.DB.prepare('SELECT * FROM boxes WHERE key=?').bind(boxKey).first();
  if (!box) throw new Error('deal not found — run a sync');
  const last = Math.max(box.last_in || 0, box.last_out || 0);
  const silent = last ? Math.floor((Date.now() - last) / DAY) : 'unknown';
  const sys = `You write follow-up messages for Olivier Attia, Managing Director of Gershon Consulting (helps companies enter the US market: LinkedIn outbound, lead generation, commercial representation). Tone: warm, direct, personal, no fluff, no buzzwords. ${channel === 'linkedin' ? 'LinkedIn message: under 60 words.' : 'Email: under 120 words.'} Write in the language used in the notes (French or English). Refer to the last known step from the notes; never invent facts. End with ONE clear next step (a 30-minute call with a proposed timeframe). Sign "Olivier". Return ONLY JSON: {"subject":"...","body":"..."}`;
  const user = `Company: ${box.name}\nStage: ${STAGES[box.stage]}\nDays since last email: ${silent}\nNotes:\n${(box.notes || '(no notes)').slice(0, 3000)}`;
  const raw = await ai(env, [{ role: 'system', content: sys }, { role: 'user', content: user }], 600);
  let subject = `${box.name} — next step`, body = raw;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : raw);
    subject = j.subject || subject;
    body = j.body || body;
  } catch (e) { /* keep raw text */ }
  const to = channel === 'email' ? await contactEmail(env, box) : '';
  const now = Date.now();
  const r = await env.DB.prepare('INSERT INTO drafts (box_key,channel,to_addr,subject,body,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id')
    .bind(boxKey, channel, to, subject, body, 'pending', now, now).first();
  return { id: r.id, box_key: boxKey, name: box.name, channel, to_addr: to, subject, body, status: 'pending' };
}

/* ---------------- drafts ---------------- */
async function draftAction(env, id, action, data) {
  const d = await env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(id).first();
  if (!d) throw new Error('draft not found');
  const now = Date.now();
  if (action === 'update') {
    await env.DB.prepare('UPDATE drafts SET to_addr=?, subject=?, body=?, updated_at=? WHERE id=?').bind(data.to_addr ?? d.to_addr, data.subject ?? d.subject, data.body ?? d.body, now, id).run();
    return { ok: true };
  }
  if (action === 'reject') {
    await env.DB.prepare("UPDATE drafts SET status='rejected', updated_at=? WHERE id=?").bind(now, id).run();
    return { ok: true };
  }
  if (action === 'approve' && d.channel === 'email') {
    const to = data.to_addr ?? d.to_addr, subject = data.subject ?? d.subject, body = data.body ?? d.body;
    if (!to) throw new Error('no recipient email — add one before approving');
    await gmailSend(env, to, subject, body);
    await env.DB.prepare("UPDATE drafts SET status='sent', to_addr=?, subject=?, body=?, updated_at=? WHERE id=?").bind(to, subject, body, now, id).run();
    await env.DB.prepare('INSERT INTO touches (box_key,channel,at,note) VALUES (?,?,?,?)').bind(d.box_key, 'email', now, subject).run();
    await streakComment(env, d.box_key, `[sales.gershon.ai] Follow-up email sent to ${to}: "${subject}"`);
    return { ok: true, sent: true };
  }
  if (action === 'approve' && d.channel === 'linkedin') {
    await env.DB.prepare("UPDATE drafts SET status='linkedin_queue', body=?, updated_at=? WHERE id=?").bind(data.body ?? d.body, now, id).run();
    return { ok: true, queued: true };
  }
  if (action === 'done') {
    await env.DB.prepare("UPDATE drafts SET status='sent', updated_at=? WHERE id=?").bind(now, id).run();
    await env.DB.prepare('INSERT INTO touches (box_key,channel,at,note) VALUES (?,?,?,?)').bind(d.box_key, d.channel, now, 'sent').run();
    await streakComment(env, d.box_key, `[sales.gershon.ai] LinkedIn follow-up sent: "${(d.body || '').slice(0, 200)}"`);
    return { ok: true };
  }
  throw new Error('unknown action');
}

/* ---------------- Gmail (OAuth; sends only after approval) ---------------- */
function googleStart(env, url) {
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + '/oauth/google/callback', response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline', prompt: 'consent', state: rand(),
  });
  return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q, 302);
}
async function googleCallback(env, url) {
  const code = url.searchParams.get('code');
  if (!code) return Response.redirect(url.origin + '/?gmail=error', 302);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + '/oauth/google/callback', grant_type: 'authorization_code' }),
  });
  const j = await r.json();
  if (!j.refresh_token) return Response.redirect(url.origin + '/?gmail=error', 302);
  await setSetting(env, 'google_refresh_token', j.refresh_token);
  try {
    const info = JSON.parse(atob(j.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (info.email) await setSetting(env, 'google_email', info.email);
  } catch (e) { /* ignore */ }
  return Response.redirect(url.origin + '/?gmail=ok', 302);
}
async function gmailToken(env) {
  const rt = await getSetting(env, 'google_refresh_token');
  if (!rt) throw new Error('Gmail is not connected yet');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: rt, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('Gmail token refresh failed');
  return j.access_token;
}
async function gmailSend(env, to, subject, body) {
  const tok = await gmailToken(env);
  const raw = [`To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(body)].join('\r\n');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(raw) }) });
  if (!r.ok) throw new Error('Gmail send failed: ' + (await r.text()).slice(0, 200));
}

/* ---------------- Monday: drafts for every due deal + digest ---------------- */
async function weekly(env) {
  const due = (await pipeline(env)).filter((d) => d.due).sort((a, b) => a.next - b.next);
  const { results: pend } = await env.DB.prepare("SELECT box_key FROM drafts WHERE status IN ('pending','linkedin_queue')").all();
  const has = new Set(pend.map((r) => r.box_key));
  let made = 0;
  for (const d of due) {
    if (made >= 30) break;
    if (has.has(d.key)) continue;
    try { await makeDraft(env, d.key, 'email'); made++; } catch (e) { /* skip */ }
  }
  const rows = due.map((d) => `<tr><td style="padding:4px 8px">${esc(d.name)}</td><td style="padding:4px 8px">${esc(d.stage_name)}</td><td style="padding:4px 8px">${esc(d.owner || '—')}</td><td style="padding:4px 8px;text-align:right">${d.days_silent ?? '?'}</td></tr>`).join('');
  const date = new Date().toISOString().slice(0, 10);
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px"><h2>GC Sales — follow-ups due (${date})</h2><p><b>${due.length}</b> deals are due for a touch. <b>${made}</b> new email drafts are waiting for approval at <a href="${env.APP_URL}">${env.APP_URL}</a>.</p><table style="border-collapse:collapse" border="1"><tr><th>Deal</th><th>Stage</th><th>Owner</th><th>Days silent</th></tr>${rows}</table></div>`;
  let emailed = false;
  if (env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.DIGEST_FROM, to: [env.DIGEST_TO], subject: `[GC Sales] ${due.length} follow-ups due — ${date}`, html }) });
    emailed = r.ok;
  }
  return { due: due.length, drafts: made, emailed };
}
