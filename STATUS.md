# STATUS — sales.gershon.ai (Sales by Gershon.AI)
Last updated: 2026-11-24 · v1.5.1

Deploy: push to `main` → Cloudflare Workers Builds (Worker `sales-gershon`). Details: HANDOFF.txt.

## Done ✅
- ✅ Chat, due follow-ups, drafts, Streak sync, Monday digest
- ✅ Funnel page (Radar → Botdog → Streak → GC Clients)
- ✅ Harvey H01 campaign page
- ✅ v1.4.0 Overview page (all campaigns on one page)
- ✅ v1.4.1 Claude campaigns: "All campaigns" overview + one page per code (CC01, CC02, …) with its own funnel and dashboard
- ✅ v1.4.2 Settings page (sidebar → Account → Settings, or /#settings): paste the Streak API key, checked with Streak (`/v1/users/me`), saved in D1 `settings.streak_api_key`, pipeline syncs at once. Key saved here wins over the Cloudflare `STREAK_API_KEY` variable; only the last 4 characters are ever shown.

- ✅ v1.5.0 Campaigns dashboard: real name after each code (CC01 · E2 New Companies…, editable), health colours green ≤3 days idle / orange >3 / red >6, health tiles, coloured daily bars vs target, results-by-campaign stacked bars (replied / to check / no reply), 14-day activity heatmap, coloured funnel + outcome bar per campaign
- ✅ v1.5.1 Overview redesigned in the All-campaigns style: 4 traffic-light verdict cards (leads vs target, reply rate, deals moving, campaigns running), one funnel contact → client, health tiles, results-by-campaign bars, coloured daily bars vs target, pipeline stages coloured early/proposal/hot, clickable rows → campaign page (front-end only, same /api/overview data)

## Open ❌
- ❌ v1.4.2 Settings page held for Olivier's OK (API key = secrets rule); then Olivier pastes the Streak key once.
- ❌ RADAR_FUNNEL_TOKEN worker secret (Radar part of the Funnel page)
- ❌ Clean false "2. Responded" boxes in Streak GC Campaigns (flagged on campaign pages)
- ❌ Pulse not linked to Radar prospects
- ❌ v2: Gmail replies → Streak notes; real next-step dates

## Tests
`npm test` (version, funnel, harvey, overview, campaigns, settings)
