# CP-sales-001 — Charles: one-time setup for sales.gershon.ai

status: OPEN ❌
owner: Charles (Chrome, browser "oattia")
repo: gershonconsulting/sales

Secrets go into **GitHub → gershonconsulting/sales → Settings → Secrets and variables → Actions → New repository secret**. Never paste them in chat or in a file.

0. ❌ Install the deploy workflow: GitHub web → Add file → Create new file → path `.github/workflows/deploy.yml` → paste the exact content of `deploy/deploy.yml` → Commit to main. (The Claude GitHub integration has no `workflow` scope, so it cannot write this path itself.)
1. ❌ `CLOUDFLARE_ACCOUNT_ID` — Cloudflare dashboard (account holding the gershon.ai zone) → Account ID.
2. ❌ `CLOUDFLARE_API_TOKEN` — Cloudflare → My Profile → API Tokens → Create Custom Token: Account › Workers Scripts: Edit; Account › D1: Edit; Account › Workers AI: Read; Zone gershon.ai › Workers Routes: Edit; Zone gershon.ai › DNS: Edit.
3. ❌ `STREAK_API_KEY` — Streak signed in as oattia@gmail.com (owner of GC Pipeline) → Settings → Integrations → Streak API → Create key.
4. ❌ `RESEND_API_KEY` — Resend → API Keys → sending key for the verified gershon.ai domain.
5. ❌ `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — Google Cloud console (oattia@gmail.com) → enable **Gmail API** → Credentials → OAuth client ID → Web application → authorized redirect URI `https://sales.gershon.ai/oauth/google/callback`. Consent screen: add olivier@gershonconsulting.com as test user.
6. ❌ GitHub → Actions → "Deploy sales.gershon.ai" → Run workflow. Confirm green and that https://sales.gershon.ai loads.
7. ❌ On https://sales.gershon.ai (after Olivier has set his password): click **Connect Gmail** → approve with olivier@gershonconsulting.com → click **Sync Streak** → confirm ~113 deals appear.

Close by editing this file: status CLAIMED + evidence (workflow run URL, deal count shown).
