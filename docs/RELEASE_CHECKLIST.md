# Release and submission checklist

Use this checklist after the Cloudflare deployment is live. It combines the project’s release checks with the [WebMCP Devpost rules](https://webmcp.devpost.com/rules).

## Deployment

- [x] The D1 binding in `wrangler.jsonc` points to the intended production database.
- [x] `npm run db:migrate:remote` completes successfully.
- [x] `npm run deploy` prints a stable public HTTPS URL: `https://mycp.dunnstock.workers.dev`.
- [x] `GET /api/health` succeeds on that URL.
- [x] The root and API responses carry the required origin-isolation and `tools=(self)` headers.
- [ ] `crossOriginIsolated` is `true` in Chrome on the public URL.
- [ ] The live app can create, confirm, and persist a draft through a refresh.

## WebMCP proof

- [ ] Test the live URL in Chrome with WebMCP testing enabled.
- [x] Test the same URL in ChatGPT’s in-app browser: the page and its WebMCP tools load successfully.
- [ ] Capture tool activity for context, availability, proposal, and draft creation.
- [ ] Demonstrate that `commit_event` is blocked and that only the visible human confirmation adds the event.

## Devpost submission

- [ ] Public source repository includes the Apache-2.0 [`LICENSE`](../LICENSE).
- [ ] The deployed URL is public, functional, and does not require a special account or paid service to judge.
- [ ] Record a public, English, narrated YouTube video under three minutes using [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).
- [ ] Replace both placeholders in [`DEVPOST.md`](DEVPOST.md) with the live URL and video URL.
- [ ] Add the deployed URL, source URL, and video URL to the Devpost submission.
- [ ] Confirm all team members, eligibility, and submission-time requirements directly against the official rules before submitting.
