# STATUS — sales.gershon.ai (Sales by Gershon.AI)
Last updated: 2026-11-20 · v1.4.1

Deploy: push to `main` → Cloudflare Workers Builds (Worker `sales-gershon`). Details: HANDOFF.txt.

## Done ✅
- ✅ Chat, due follow-ups, drafts, Streak sync, Monday digest
- ✅ Funnel page (Radar → Botdog → Streak → GC Clients)
- ✅ Harvey H01 campaign page
- ✅ v1.4.0 Overview page (all campaigns on one page)
- ✅ v1.4.1 Claude campaigns: "All campaigns" overview + one page per code (CC01, CC02, …) with its own funnel and dashboard

## Open ❌
- ❌ RADAR_FUNNEL_TOKEN worker secret (Radar part of the Funnel page)
- ❌ Clean false "2. Responded" boxes in Streak GC Campaigns (flagged on campaign pages)
- ❌ Pulse not linked to Radar prospects
- ❌ v2: Gmail replies → Streak notes; real next-step dates

## Tests
`npm test` (version, funnel, harvey, overview, campaigns)
