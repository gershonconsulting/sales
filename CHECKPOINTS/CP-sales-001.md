# CP-sales-001 — one-time setup for sales.gershon.ai

status: IN PROGRESS ❌
repo: gershonconsulting/sales

Deploy route changed 2026-10-07: Cloudflare Workers Builds (Git integration) deploys on every push to main. No GitHub Actions workflow, no Cloudflare API token needed. `deploy/deploy.yml` is kept only as a fallback.

1. ✅ D1 database `sales-db` created (id 33344da0-ae0b-4eae-8d65-7555a3b3612a), schema applied via the D1 console, id committed in wrangler.toml.
2. ✅ Worker `sales-gershon` created from the repo; first build green; https://sales.gershon.ai returns 200.
3. ✅ Google Cloud project `gershon-sales` (under olivier@gershonconsulting.com): Gmail API enabled, consent screen "GC Sales" (External, testing), test user olivier@gershonconsulting.com, OAuth web client "sales.gershon.ai" with redirect https://sales.gershon.ai/oauth/google/callback.
4. ❌ Worker secrets — Cloudflare (oattia@gmail.com account) → Workers & Pages → sales-gershon → Settings → Variables and Secrets → Add (type: Secret) → Deploy. Values must be pasted by a human (Claude is not allowed to type keys into fields):
   - `STREAK_API_KEY` — Streak is on **olivier@gershonconsulting.com** (corrected 2026-10-17; NOT oattia@gmail.com): in Gmail as olivier@gershonconsulting.com → Streak → Settings → Integrations → Streak API → Create key.
   - `GOOGLE_CLIENT_ID` — Google Cloud (olivier@gershonconsulting.com) → project gershon-sales → Google Auth Platform → Clients → sales.gershon.ai.
   - `GOOGLE_CLIENT_SECRET` — the first secret was closed unseen; on the same client page click "Add secret" and copy the new one.
   - `RESEND_API_KEY` — optional (Monday digest).
5. ❌ Cloudflare shows "This project is disconnected from your Git account" — reconnect under Settings → Builds → Manage, or future pushes won't deploy.
6. ❌ Cron "0 10 * * 1" shows as Sunday in Cloudflare — change to MON in wrangler.toml and src/index.js.
7. ❌ In the app: Connect Gmail (olivier@gershonconsulting.com) → Sync Streak → confirm ~113 deals.
