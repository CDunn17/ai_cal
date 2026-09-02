# Two-minute demo script

This script stays comfortably within Devpost’s three-minute video limit. Record with system audio or narration, and use the deployed URL in a supported WebMCP browser.

## 0:00–0:15 — Problem and guardrail

Show the week calendar and say:

> MyCP, short for My Calendar Planner, is a shared calendar designed for human-controlled scheduling delegation. The agent can reason about availability and create a visible draft, but it cannot silently add an event or send invitations.

Point out the privacy boundary and the Agent activity rail.

Click Maya in the **Team** list. Show her scheduling-only profile: preferred meeting window, recurring focus block, and office/remote pattern. Say that it contains no home address, live location, or private events.

## 0:15–0:50 — Meeting planning and WebMCP scheduling

Click **New event**. Show the title, meeting length, attendee checkboxes with designated offices, the two office locations, and the date choices. Use a target date with flexibility or choose **Have meeting by**, then click **Find availability**.

Use this request in the browser agent to show the equivalent structured interaction:

> Find a 45-minute launch review with Maya and Sam at Downtown Manhattan by Friday. Avoid focus blocks and show any office-travel trade-offs.

Show the browser’s WebMCP tool activity. Call out that MyCP invokes structured `get_calendar_context`, `get_user_scheduling_profile`, `find_availability`, and `propose_schedule` tools instead of DOM automation. Open a candidate and briefly show its ranked reasons and office-travel warning.

## 0:50–1:20 — Draft, not a hidden write

Ask the agent to create a draft for the best option with a short agenda, or use the visible **Create draft** button. Show the pending-draft card, before/after diff, expiry, and activity rail. Say:

> This is still not on the committed calendar. The app scopes the tool to the active user, redacts private events, and keeps tool responses small and structured.

## 1:20–1:45 — Human approval

Open the draft and click **Review & confirm**. Pause on the modal and show the event time, invitees, reviewed revision, and five-minute expiry. Say:

> The WebMCP `commit_event` tool is deliberately blocked. Only this visible human confirmation can add the event, and the API requires a one-time confirmation plus an idempotency key.

Click **Confirm & add event**, then show the new calendar block and audit entry. The demo deliberately stops there: it displays invitees but does not send email or provider invitations.

## 1:45–2:00 — Why WebMCP

Close with:

> MyCP demonstrates an agent-native calendar interaction: structured, least-privilege scheduling help with visible drafts and a human-controlled final decision.

Before recording, use the deployed URL, start from the seeded state, and confirm the browser shows origin isolation and registered tools.
