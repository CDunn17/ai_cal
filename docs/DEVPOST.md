# Devpost submission copy

## Project name

MyCP — My Calendar Planner

## Tagline

My Calendar Planner: an agent-native shared calendar that turns scheduling requests into visible, reviewable drafts instead of silent calendar writes.

## Inspiration

Calendar work is full of small but consequential trade-offs: time zones, focus time, travel buffers, and private events. Existing assistants often force people to choose between manually coordinating everything and granting broad write access. We wanted to show a better default: give the agent just enough structured context to help, then keep the final decision visible and human-owned.

## What it does

MyCP is a seeded shared-calendar demo for a distributed launch team. A browser agent uses WebMCP tools to inspect narrowly scoped context, find one-time or weekly availability, and rank meeting options. A weekly proposal checks every requested occurrence against private busy time, protected focus blocks, work patterns, travel buffers, and time preferences without revealing why another person is unavailable. When one weekly check-in conflicts with the manager’s existing meeting, it can stage one bounded reschedule for that instance without moving the existing event.

The same pattern works for time away: the agent can prepare one compact change-set draft containing a private absence, proposed cancellation of the manager’s owned meetings, and a transfer to an approved delegate. It cannot apply any of those changes or send notifications.

The person reviews a before/after diff in the calendar, opens a confirmation dialog, and explicitly adds the event. That API path requires the reviewed draft revision, a five-minute one-time confirmation, and an idempotency key. Private events remain generic Busy blocks outside the owner’s access.

## How we built it

- React, TypeScript, and Vite for the calendar interface.
- A Cloudflare Worker for static assets, same-origin API routes, and the WebMCP headers.
- Cloudflare D1 for persistent seeded-demo state with revision-checked writes.
- Zod schemas shared at the command boundary.
- WebMCP imperative tools registered through `document.modelContext.registerTool`.
- Vitest coverage for scheduling, redaction, draft lifecycle, confirmation, idempotency, and rate limits.

## WebMCP usage

MyCP registers fourteen intent-level tools rather than exposing DOM selectors or database access. `get_calendar_context` provides bounded calendar/team identifiers, while `get_user_scheduling_profile` reads a purpose-limited profile with meeting preferences, recurring focus blocks, and office/remote work patterns—never a home address, live location, or private events. `propose_recurring_schedule` validates one weekly local-time slot across 2–26 occurrences and can return no more than four explicit, reviewable exceptions. `get_events_in_range` and `propose_time_away_changes` return only active events the user owns, while `create_time_away_change_set_draft` can only stage—not apply—cancellations and approved-delegate transfers. Read tools are annotated as read-only. Tool outputs carrying calendar content are marked untrusted and limited to 1.4 KB of UTF-8 data; the adapter returns compact events and candidate slots, or a safe truncation response. `commit_event` is intentionally blocked so an agent cannot bypass the human confirmation flow.

## Challenges we ran into

The key challenge was making the agent useful without making it overly powerful. We separated recommendation, draft creation, and final commit; applied server-side ownership and revision checks; and designed bounded result shapes that still give an agent enough information to continue safely. Persisting the deterministic demo across Worker isolates also required an explicit D1 persistence boundary rather than relying on in-memory state.

## Accomplishments we’re proud of

- A demo where WebMCP is central to the product interaction, not an afterthought.
- A clear, inspectable draft-to-confirmation safety model.
- Private-event redaction and untrusted-content handling built into the tool contracts.
- A deployment architecture that keeps the SPA, APIs, headers, and D1 binding under one origin.

## What’s next

After the hackathon, we would add real authentication, provider OAuth, per-user notification preferences, RSVP-aware recurrence exceptions, delegate acceptance, outbound notifications, and a normalized D1 schema. Those additions would preserve the same visible-draft and explicit-confirmation boundaries.

## Submission links

- Live demo: `https://mycp.dunnstock.workers.dev`
- Source repository: `https://github.com/CDunn17/ai_cal`
- Demo video: `REPLACE_WITH_PUBLIC_YOUTUBE_URL`
