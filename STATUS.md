# sales.gershon.ai — STATUS (updated 2026-11-20, v1.4.0)

Worker `sales-gershon` + D1 `sales-db` + Workers AI + static UI (`public/`).
Deploy: Cloudflare Workers Builds on push to `main` (reconnected 2026-11-10). Tests: `npm test`.

## Done ✅
- ✅ v1.4.0 Settings page (sidebar → Account → Settings, or /#settings): paste the Streak API key, it is checked with Streak (`/v1/users/me`), saved in D1 `settings.streak_api_key`, then the pipeline syncs at once. Key saved here wins over the Cloudflare `STREAK_API_KEY` variable; only the last 4 characters are ever shown. Remove key, Sync now, last sync + last sync error, Gmail status.
- ✅ v1.3.x Harvey H01 campaign page, Funnel page, unified design, follow-up rhythm, drafts → Gmail send.

## Open ❌
- ❌ Olivier: paste the Streak key in Settings (first live sync).
- ❌ RADAR_FUNNEL_TOKEN Worker secret (Funnel's Radar part) — could also move into Settings.
- ❌ v2: read Gmail replies → update Streak notes/stage; real next-step date per deal.
- ❌ Botdog campaign stuck in CREATED (2,280 leads not invited).

## Notes
- Streak key is stored in D1 like the Google refresh token (D1 is private to the Worker).
- Cron "0 10 * * 1" displays as Sunday in Cloudflare (known).
