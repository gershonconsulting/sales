# CP-sales-001 — one-time setup for sales.gershon.ai

status: IN PROGRESS ❌
repo: gershonconsulting/sales

Deploy route changed 2026-10-07: Cloudflare Workers Builds (Git integration) deploys on every push to main. No GitHub Actions workflow, no Cloudflare API token needed. `deploy/deploy.yml` is kept only as a fallback.

1. ✅ D1 database `sales-db` created (id 33344da0-ae0b-4eae-8d65-7555a3b3612a), schema applied via the D1 console, id committed in wrangler.toml.
2. ✅ Worker `sales-gershon` created from the repo; first build green; https://sales.gershon.ai returns 200 and /api/me answers {"setup":true}.
3. ❌ Worker secrets — Cloudflare → Workers & Pages → sales-gershon → Settings → Variables and Secrets → Add (type: Secret). Values must be pasted by a human (Claude is not allowed to type keys into fields):
   - `STREAK_API_KEY` — Streak (oattia@gmail.com) → Settings → Integrations → Streak API → Create key.
   - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — Google Cloud console (oattia@gmail.com) → enable Gmail API → Credentials → OAuth client ID (Web) → redirect URI `https://sales.gershon.ai/oauth/google/callback`.
   - `RESEND_API_KEY` — optional (Monday digest); can be dropped if the digest moves to Gmail.
4. ❌ Olivier: open https://sales.gershon.ai and choose his password (first visit = setup).
5. ❌ In the app: Connect Gmail (olivier@gershonconsulting.com) → Sync Streak → confirm ~113 deals.
