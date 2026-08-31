import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { CalendarEvent, EventDraft, ScheduleCandidate } from "./domain/contracts";
import type { CalendarState } from "./domain/calendar-store";

const DISPLAY_TIME_ZONE = "America/New_York";
const WEEK_DAYS = [
  { key: "2026-09-07", short: "Mon", day: "7" },
  { key: "2026-09-08", short: "Tue", day: "8" },
  { key: "2026-09-09", short: "Wed", day: "9" },
  { key: "2026-09-10", short: "Thu", day: "10" },
  { key: "2026-09-11", short: "Fri", day: "11" }
] as const;
const HOURS = Array.from({ length: 10 }, (_, index) => index + 8);

type EventForm = {
  id?: string;
  revision?: number;
  title: string;
  startsAt: string;
  endsAt: string;
  visibility: CalendarEvent["visibility"];
  attendeeIds: string[];
};

function localParts(instant: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: DISPLAY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

function dayKey(instant: string): string {
  const parts = localParts(instant);
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function timeLabel(instant: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(instant));
}

function inputValue(instant: string): string {
  const parts = localParts(instant);
  return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute;
}

function zonedInputToIso(value: string): string {
  const assumedUtc = Date.parse(value + ":00.000Z");
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: "longOffset"
  })
    .formatToParts(new Date(assumedUtc))
    .find((part) => part.type === "timeZoneName")?.value;
  const match = offsetPart?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
  return new Date(assumedUtc - offsetMinutes * 60_000).toISOString();
}

function eventLayout(event: CalendarEvent) {
  const parts = localParts(event.startsAt);
  const endParts = localParts(event.endsAt);
  const startMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const endMinutes = Number(endParts.hour) * 60 + Number(endParts.minute);
  return {
    top: Math.max(0, ((startMinutes - 8 * 60) / 60) * 68),
    height: Math.max(32, ((endMinutes - startMinutes) / 60) * 68)
  };
}

function toEventForm(event?: CalendarEvent): EventForm {
  if (!event) {
    return {
      title: "",
      startsAt: "2026-09-10T14:00",
      endsAt: "2026-09-10T14:45",
      visibility: "public",
      attendeeIds: ["maya", "sam"]
    };
  }
  return {
    id: event.id,
    revision: event.revision,
    title: event.title,
    startsAt: inputValue(event.startsAt),
    endsAt: inputValue(event.endsAt),
    visibility: event.visibility,
    attendeeIds: event.attendeeIds.filter((id) => id !== "alex")
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "The calendar could not save that change.");
  }
  return body;
}

export function App() {
  const [state, setState] = useState<CalendarState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [proposals, setProposals] = useState<ScheduleCandidate[] | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [isFindingTime, setIsFindingTime] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setLoadError(null);
      setState(await request<CalendarState>("/api/calendar-state"));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The calendar is unavailable.");
    }
  };

  useEffect(() => {
    let isCurrent = true;
    void request<CalendarState>("/api/calendar-state")
      .then((nextState) => {
        if (isCurrent) {
          setLoadError(null);
          setState(nextState);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setLoadError(error instanceof Error ? error.message : "The calendar is unavailable.");
        }
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  const selectedEvent = useMemo(
    () => state?.events.find((event) => event.id === selectedEventId) ?? null,
    [selectedEventId, state]
  );
  const activeCalendar = state?.calendars.find((calendar) => calendar.ownerId === state.activeUserId);
  const selectedDraft = state?.drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const calendarColors = new Map(state?.calendars.map((calendar) => [calendar.id, calendar.color]));

  const findTime = async () => {
    setIsFindingTime(true);
    setProposalError(null);
    try {
      const response = await request<{ proposals: ScheduleCandidate[] }>("/api/proposals", {
        method: "POST",
        body: JSON.stringify({
          attendeeIds: ["maya", "sam"],
          durationMinutes: 45,
          rangeStartsAt: "2026-09-07T12:00:00.000Z",
          rangeEndsAt: "2026-09-12T00:00:00.000Z"
        })
      });
      setProposals(response.proposals);
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : "Could not find scheduling options.");
    } finally {
      setIsFindingTime(false);
    }
  };

  const createDraftFromProposal = async (proposal: ScheduleCandidate) => {
    if (!activeCalendar) return;
    setProposalError(null);
    try {
      const response = await request<{ draft: EventDraft }>("/api/event-drafts", {
        method: "POST",
        body: JSON.stringify({
          calendarId: activeCalendar.id,
          title: "Launch review",
          startsAt: proposal.startsAt,
          endsAt: proposal.endsAt,
          timeZone: DISPLAY_TIME_ZONE,
          visibility: "public",
          attendeeIds: ["maya", "sam"],
          agenda: "Review launch readiness, risks, and owners."
        })
      });
      setSelectedDraftId(response.draft.id);
      await refresh();
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : "Could not create the draft.");
    }
  };

  const discardDraft = async (draft: EventDraft) => {
    try {
      await request("/api/event-drafts/" + draft.id, {
        method: "DELETE",
        body: JSON.stringify({ expectedRevision: draft.revision })
      });
      setSelectedDraftId(null);
      await refresh();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The draft could not be discarded.");
    }
  };

  const saveForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form || !activeCalendar) return;

    setIsSaving(true);
    setFormError(null);
    const payload = {
      title: form.title.trim(),
      startsAt: zonedInputToIso(form.startsAt),
      endsAt: zonedInputToIso(form.endsAt),
      timeZone: DISPLAY_TIME_ZONE,
      visibility: form.visibility,
      attendeeIds: form.attendeeIds
    };

    try {
      if (form.id) {
        await request("/api/events/" + form.id, {
          method: "PATCH",
          body: JSON.stringify({ ...payload, expectedRevision: form.revision })
        });
      } else {
        await request("/api/events", {
          method: "POST",
          body: JSON.stringify({ ...payload, calendarId: activeCalendar.id })
        });
      }
      setForm(null);
      await refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The event could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const moveEvent = async (minutes: number) => {
    if (!selectedEvent) return;
    const startsAt = new Date(Date.parse(selectedEvent.startsAt) + minutes * 60_000).toISOString();
    const endsAt = new Date(Date.parse(selectedEvent.endsAt) + minutes * 60_000).toISOString();
    try {
      await request("/api/events/" + selectedEvent.id, {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: selectedEvent.revision, startsAt, endsAt })
      });
      await refresh();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The event could not move.");
    }
  };

  if (loadError && !state) {
    return (
      <main className="load-state">
        <p className="eyebrow">Calendar unavailable</p>
        <h1>Run CoPlan through its Worker.</h1>
        <p>{loadError}</p>
        <code>npm run dev:worker</code>
        <button type="button" onClick={() => void refresh()}>Try again</button>
      </main>
    );
  }

  if (!state) {
    return <main className="load-state"><p>Loading CoPlan…</p></main>;
  }

  return (
    <main className="calendar-app">
      <header className="calendar-header">
        <div className="brand"><span className="brand-mark">C</span><strong>CoPlan</strong></div>
        <div className="week-controls"><button type="button" className="icon-button" aria-label="Previous week">‹</button><strong>September 2026</strong><button type="button" className="icon-button" aria-label="Next week">›</button></div>
        <div className="header-actions"><span className="timezone-label">{DISPLAY_TIME_ZONE.replace("_", " ")}</span><button type="button" className="secondary-button" disabled={isFindingTime} onClick={() => void findTime()}>{isFindingTime ? "Finding…" : "Find time"}</button><button type="button" className="primary-button" onClick={() => setForm(toEventForm())}>New event</button></div>
      </header>

      {loadError && <p className="error-banner" role="alert">{loadError}</p>}

      {(proposals || proposalError) && (
        <section className="proposal-panel" aria-labelledby="proposal-title">
          <div className="proposal-heading"><div><p className="eyebrow">Scheduling assistant</p><h2 id="proposal-title">Launch review · 45 minutes</h2><p>Options use working hours, protected focus time, busy blocks, and travel buffers.</p></div><button type="button" className="close-button" aria-label="Close scheduling options" onClick={() => { setProposals(null); setProposalError(null); }}>×</button></div>
          {proposalError && <p className="form-error" role="alert">{proposalError}</p>}
          {proposals?.length === 0 && <p className="muted">No slot met the current constraints. Adjust the time range or attendees.</p>}
          {proposals && proposals.length > 0 && <div className="proposal-grid">{proposals.map((proposal) => <article className="proposal-card" key={proposal.startsAt}><div><p className="proposal-time">{timeLabel(proposal.startsAt)}–{timeLabel(proposal.endsAt)}</p><strong>{new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, weekday: "long", month: "short", day: "numeric" }).format(new Date(proposal.startsAt))}</strong></div><p className="proposal-score">Score {proposal.score}</p><ul>{proposal.reasons.slice(0, 2).map((reason) => <li key={reason}>{reason}</li>)}</ul>{proposal.warnings.length > 0 && <p className="proposal-warning">{proposal.warnings[0]}</p>}<button type="button" className="secondary-button" onClick={() => void createDraftFromProposal(proposal)}>Create draft</button></article>)}</div>}
        </section>
      )}

      <div className="calendar-layout">
        <aside className="sidebar">
          <section>
            <p className="eyebrow">Calendars</p>
            <div className="calendar-list">
              {state.calendars.map((calendar) => (
                <div className="calendar-item" key={calendar.id}>
                  <span className="calendar-color" style={{ background: calendar.color }} />
                  <span>{calendar.name}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="free-busy-note">
            <p className="eyebrow">Privacy boundary</p>
            <strong>Private events show as busy.</strong>
            <p>CoPlan exposes time blocks without revealing another person’s title, attendees, location, or agenda.</p>
          </section>
          <section className="draft-section">
            <p className="eyebrow">Pending drafts</p>
            {state.drafts.length === 0 ? <p className="muted">Scheduling proposals become visible drafts before anything is committed.</p> : (
              <div className="draft-list">{state.drafts.map((draft) => <button type="button" className="draft-card" key={draft.id} onClick={() => setSelectedDraftId(draft.id)}><strong>{draft.event.title}</strong><span>{timeLabel(draft.event.startsAt)} · review required</span></button>)}</div>
            )}
          </section>
          <section className="audit-section">
            <p className="eyebrow">Your activity</p>
            {state.auditEntries.length === 0 ? <p className="muted">Human edits will appear here.</p> : (
              <ol className="audit-list">
                {state.auditEntries.slice(0, 5).map((entry) => <li key={entry.id}>{entry.summary}</li>)}
              </ol>
            )}
          </section>
        </aside>

        <section className="week-panel" aria-label="Week calendar">
          <div className="week-title-row"><div /><div className="week-title"><span>Week 37</span><small>Human-first scheduling</small></div></div>
          <div className="week-grid">
            <div className="time-column">
              <div className="grid-corner" />
              {HOURS.map((hour) => <div className="time-label" key={hour}>{hour === 12 ? "12 PM" : hour > 12 ? String(hour - 12) + " PM" : String(hour) + " AM"}</div>)}
            </div>
            {WEEK_DAYS.map((day) => (
              <div className="day-column" key={day.key}>
                <div className="day-header"><span>{day.short}</span><strong>{day.day}</strong></div>
                <div className="day-body">
                  {HOURS.map((hour) => <div className="hour-line" key={hour} />)}
                  {state.events.filter((event) => dayKey(event.startsAt) === day.key).map((event) => {
                    const layout = eventLayout(event);
                    const isBusyOnly = event.title === "Busy";
                    const style = {
                      top: layout.top,
                      height: layout.height,
                      "--event-color": calendarColors.get(event.calendarId) ?? "#8466f6"
                    } as CSSProperties & Record<"--event-color", string>;
                    return (
                      <button
                        type="button"
                        className={"event-block" + (isBusyOnly ? " busy-only" : "")}
                        style={style}
                        key={event.id}
                        onClick={() => setSelectedEventId(event.id)}
                      >
                        <strong>{event.title}</strong>
                        <span>{timeLabel(event.startsAt)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {selectedDraft && (
        <aside className="event-details draft-details" aria-label="Draft review">
          <button className="close-button" type="button" aria-label="Close draft review" onClick={() => setSelectedDraftId(null)}>×</button>
          <p className="eyebrow">Reviewable draft</p>
          <h2>{selectedDraft.event.title}</h2>
          <p>{timeLabel(selectedDraft.event.startsAt)}–{timeLabel(selectedDraft.event.endsAt)} · {DISPLAY_TIME_ZONE.replace("_", " ")}</p>
          <div className="event-diff">
            <div><span>Before</span><strong>No event or invitations</strong><p>The calendar remains unchanged.</p></div>
            <div><span>After approval</span><strong>{selectedDraft.event.title}</strong><p>{selectedDraft.event.attendeeIds.map((id) => state.people.find((person) => person.id === id)?.displayName).filter(Boolean).join(", ")}</p></div>
          </div>
          <p className="draft-expiry">Draft expires {new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(selectedDraft.expiresAt))}.</p>
          <div className="detail-actions"><button type="button" onClick={() => void discardDraft(selectedDraft)}>Discard draft</button><span className="commit-disabled">Invitation sending is disabled until a later confirmation milestone.</span></div>
        </aside>
      )}

      {selectedEvent && (
        <aside className="event-details" aria-label="Event details">
          <button className="close-button" type="button" aria-label="Close event details" onClick={() => setSelectedEventId(null)}>×</button>
          <p className="eyebrow">{selectedEvent.title === "Busy" ? "Private time" : "Event details"}</p>
          <h2>{selectedEvent.title}</h2>
          <p>{timeLabel(selectedEvent.startsAt)}–{timeLabel(selectedEvent.endsAt)} · {DISPLAY_TIME_ZONE.replace("_", " ")}</p>
          {selectedEvent.title === "Busy" ? (
            <p className="muted">This event is private. Only its busy time is available for scheduling.</p>
          ) : (
            <>
              <dl>
                <div><dt>Attendees</dt><dd>{selectedEvent.attendeeIds.map((id) => state.people.find((person) => person.id === id)?.displayName).filter(Boolean).join(", ")}</dd></div>
                <div><dt>Visibility</dt><dd>{selectedEvent.visibility}</dd></div>
                {selectedEvent.location && <div><dt>Location</dt><dd>{selectedEvent.location}</dd></div>}
              </dl>
              {selectedEvent.calendarId === activeCalendar?.id && (
                <div className="detail-actions">
                  <button type="button" onClick={() => void moveEvent(-30)}>Move 30m earlier</button>
                  <button type="button" onClick={() => void moveEvent(30)}>Move 30m later</button>
                  <button type="button" className="primary-button" onClick={() => setForm(toEventForm(selectedEvent))}>Edit event</button>
                </div>
              )}
            </>
          )}
        </aside>
      )}

      {form && (
        <div className="modal-backdrop" role="presentation">
          <form className="event-form" onSubmit={saveForm}>
            <div className="form-header"><div><p className="eyebrow">{form.id ? "Edit event" : "New event"}</p><h2>{form.id ? "Revise a calendar event" : "Schedule time"}</h2></div><button type="button" className="close-button" onClick={() => setForm(null)} aria-label="Close form">×</button></div>
            <label>Title<input autoFocus required maxLength={140} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <div className="form-row"><label>Starts<input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label><label>Ends<input required type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label></div>
            <p className="field-hint">Times are interpreted in {DISPLAY_TIME_ZONE.replace("_", " ")}.</p>
            <label>Visibility<select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value as CalendarEvent["visibility"] })}><option value="public">Public</option><option value="private">Private (free/busy only)</option></select></label>
            <fieldset><legend>Invite demo teammates</legend>{state.people.filter((person) => person.id !== state.activeUserId).map((person) => <label className="check-row" key={person.id}><input type="checkbox" checked={form.attendeeIds.includes(person.id)} onChange={(event) => setForm({ ...form, attendeeIds: event.target.checked ? [...form.attendeeIds, person.id] : form.attendeeIds.filter((id) => id !== person.id) })} />{person.displayName}</label>)}</fieldset>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="form-actions"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving…" : form.id ? "Save changes" : "Create event"}</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
