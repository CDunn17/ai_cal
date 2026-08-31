import { ZodError } from "zod";
import { CalendarStore, CalendarStoreError } from "./domain/calendar-store";
import { demoData } from "./domain/seed";

interface Env {
  ASSETS: Fetcher;
}

const activeDemoUserId = "alex";
const calendarStore = new CalendarStore(demoData);

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return apiResponse({ status: "ok", service: "coplan", timestamp: new Date().toISOString() });
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/calendar-state") {
        return apiResponse(calendarStore.stateFor(activeDemoUserId));
      }
      if (request.method === "POST" && url.pathname === "/api/events") {
        return apiResponse({ event: calendarStore.create(activeDemoUserId, await requestJson(request)) }, { status: 201 });
      }
      const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
      if (request.method === "PATCH" && eventMatch) {
        return apiResponse({ event: calendarStore.update(activeDemoUserId, decodeURIComponent(eventMatch[1]), await requestJson(request)) });
      }
    } catch (error) {
      return errorResponse(error);
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  }
} satisfies ExportedHandler<Env>;
