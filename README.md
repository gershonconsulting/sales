# sales.gershon.ai — GC Sales Copilot

Chat + follow-up engine for the Streak **GC Pipeline**.

- Nightly sync of every open GC Pipeline box from Streak (stage, owner, notes, last email in/out).
- Follow-up rhythm per stage: weekly (Scheduled, Negotiating, Closing), every 2 weeks (Lead, Contacted, Pitched, Proposal Sent), monthly (Nurturing). Recycled is skipped.
- Every Monday: drafts a follow-up for each due deal and emails the "GC Sales" digest to report@gershonconsulting.com.
- Emails go out from Olivier's Gmail **only after approval** in the app; each send is logged as a comment on the Streak box.
- LinkedIn messages are drafted into a queue that Charles sends via Chrome (no LinkedIn API exists).
- Chat with the pipeline, powered by Cloudflare Workers AI (Llama 3.3 70B). No Anthropic/OpenAI keys.

Stack: Cloudflare Worker + D1 + Workers AI + static assets. Push to `main` deploys via GitHub Actions.

See `HANDOFF.txt` for status and `CHECKPOINTS/` for setup tasks.
