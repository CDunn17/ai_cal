import { ZodError } from "zod";
import { CalendarStoreError } from "./domain/calendar-store";
import { D1CalendarRepository } from "./domain/d1-calendar-repository";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
}

const activeDemoUserId = "alex";

const securityHeaders: Readonly<Record<string, string>> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "tools=(self)",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) {
    headers.set(name, value);
  }

  return new Response(response.body, { status: response.status, headers });
}

function apiResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return withSecurityHeaders(Response.json(body, { ...init, headers }));
}

function errorResponse(error: unknown): Response {
  if (error instanceof CalendarStoreError) {
    return apiResponse({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return apiResponse({ error: "Invalid event data.", issues: error.issues }, { status: 400 });
  }
  return apiResponse({ error: "Unexpected server error." }, { status: 500 });
}

async function requestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new CalendarStoreError(400, "Expected a JSON request body.");
  }
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key");
  if (!key) throw new CalendarStoreError(400, "An Idempotency-Key header is required to commit a draft.");
  return key;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const calendarStore = new D1CalendarRepository(env.DB);
    if (url.pathname === "/api/health") {
      return apiResponse({ status: "ok", service: "mycp", timestamp: new Date().toISOString() });
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/calendar-state") {
        return apiResponse(await calendarStore.stateFor(activeDemoUserId));
      }
      const profileMatch = url.pathname.match(/^\/api\/team-members\/([^/]+)\/scheduling-profile$/);
      if (request.method === "GET" && profileMatch) {
        return apiResponse({ profile: await calendarStore.schedulingProfileFor(activeDemoUserId, decodeURIComponent(profileMatch[1])) });
      }
      if (request.method === "POST" && url.pathname === "/api/events") {
        return apiResponse({ event: await calendarStore.create(activeDemoUserId, await requestJson(request)) }, { status: 201 });
      }
      if (request.method === "POST" && url.pathname === "/api/proposals") {
        return apiResponse({ proposals: await calendarStore.propose(activeDemoUserId, await requestJson(request)) });
      }
      if (request.method === "POST" && url.pathname === "/api/recurring-proposals") {
        return apiResponse({ proposals: await calendarStore.proposeRecurring(activeDemoUserId, await requestJson(request)) });
      }
      if (request.method === "POST" && url.pathname === "/api/calendar-events-in-range") {
        return apiResponse({ events: await calendarStore.eventsInRange(activeDemoUserId, await requestJson(request)) });
      }
      if (request.method === "POST" && url.pathname === "/api/time-away-proposals") {
        return apiResponse({ plan: await calendarStore.proposeTimeAway(activeDemoUserId, await requestJson(request)) });
      }
      if (request.method === "POST" && url.pathname === "/api/time-away-change-sets") {
        return apiResponse({ changeSet: await calendarStore.createTimeAwayChangeSet(activeDemoUserId, await requestJson(request)) }, { status: 201 });
      }
      if (request.method === "POST" && url.pathname === "/api/event-drafts") {
        return apiResponse({ draft: await calendarStore.createDraft(activeDemoUserId, await requestJson(request)) }, { status: 201 });
      }
      const draftMatch = url.pathname.match(/^\/api\/event-drafts\/([^/]+)$/);
      if (request.method === "PATCH" && draftMatch) {
        return apiResponse({ draft: await calendarStore.updateDraft(activeDemoUserId, decodeURIComponent(draftMatch[1]), await requestJson(request)) });
      }
      const commitConfirmationMatch = url.pathname.match(/^\/api\/event-drafts\/([^/]+)\/commit-confirmation$/);
      if (request.method === "POST" && commitConfirmationMatch) {
        const body = await requestJson(request);
        const expectedRevision = body && typeof body === "object" && "expectedRevision" in body ? body.expectedRevision : undefined;
        return apiResponse({ confirmation: await calendarStore.prepareDraftCommit(activeDemoUserId, decodeURIComponent(commitConfirmationMatch[1]), expectedRevision) });
      }
      const commitMatch = url.pathname.match(/^\/api\/event-drafts\/([^/]+)\/commit$/);
      if (request.method === "POST" && commitMatch) {
        return apiResponse(
          { event: await calendarStore.commitDraft(activeDemoUserId, decodeURIComponent(commitMatch[1]), await requestJson(request), idempotencyKey(request)) },
          { status: 201 }
        );
      }
      const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
      if (request.method === "PATCH" && eventMatch) {
        return apiResponse({ event: await calendarStore.update(activeDemoUserId, decodeURIComponent(eventMatch[1]), await requestJson(request)) });
      }
      if (request.method === "DELETE" && draftMatch) {
        const body = await requestJson(request);
        const expectedRevision =
          body && typeof body === "object" && "expectedRevision" in body
            ? body.expectedRevision
            : undefined;
        await calendarStore.discardDraft(activeDemoUserId, decodeURIComponent(draftMatch[1]), expectedRevision);
        return apiResponse({ discarded: true });
      }
      const changeSetMatch = url.pathname.match(/^\/api\/time-away-change-sets\/([^/]+)$/);
      if (request.method === "DELETE" && changeSetMatch) {
        const body = await requestJson(request);
        const expectedRevision = body && typeof body === "object" && "expectedRevision" in body ? body.expectedRevision : undefined;
        await calendarStore.discardTimeAwayChangeSet(activeDemoUserId, decodeURIComponent(changeSetMatch[1]), expectedRevision);
        return apiResponse({ discarded: true });
      }
      const changeSetConfirmationMatch = url.pathname.match(/^\/api\/time-away-change-sets\/([^/]+)\/commit-confirmation$/);
      if (request.method === "POST" && changeSetConfirmationMatch) {
        const body = await requestJson(request);
        const expectedRevision = body && typeof body === "object" && "expectedRevision" in body ? body.expectedRevision : undefined;
        return apiResponse({ confirmation: await calendarStore.prepareTimeAwayChangeSetCommit(activeDemoUserId, decodeURIComponent(changeSetConfirmationMatch[1]), expectedRevision) });
      }
      const changeSetCommitMatch = url.pathname.match(/^\/api\/time-away-change-sets\/([^/]+)\/commit$/);
      if (request.method === "POST" && changeSetCommitMatch) {
        return apiResponse({ events: await calendarStore.commitTimeAwayChangeSet(activeDemoUserId, decodeURIComponent(changeSetCommitMatch[1]), await requestJson(request), idempotencyKey(request)) }, { status: 201 });
      }
    } catch (error) {
      return errorResponse(error);
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  }
} satisfies ExportedHandler<Env>;
