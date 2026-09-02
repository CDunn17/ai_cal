import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { CalendarEvent, DraftCommitConfirmation, EventDraft, ScheduleCandidate, SchedulingProfile } from "./domain/contracts";
import type { CalendarState } from "./domain/calendar-store";
import { formatTravelMinutes, officeById, OFFICES, type OfficeId } from "./domain/offices";
import { ACTIVITY_EVENT, registerCalendarTools, STATE_CHANGED_EVENT, type ToolActivity } from "./webmcp/calendar-tools";

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

type MeetingPlannerForm = {
  title: string;
  durationMinutes: number;
  attendeeIds: string[];
  officeId: OfficeId;
  dateMode: "target" | "deadline";
  targetDate: string;
  flexDays: number;
  deadlineDate: string;
};

const PLANNING_START_DATE = "2026-09-07";

function newMeetingPlannerForm(): MeetingPlannerForm {
  return {
    title: "",
    durationMinutes: 45,
    attendeeIds: ["maya", "sam"],
    officeId: "downtown-manhattan",
    dateMode: "target",
    targetDate: "2026-09-10",
    flexDays: 2,
    deadlineDate: "2026-09-11"
  };
}

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

function addDays(date: string, days: number): string {
  const value = new Date(date + "T12:00:00.000Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateRangeForPlan(plan: MeetingPlannerForm): { rangeStartsAt: string; rangeEndsAt: string } {
  const firstDate = plan.dateMode === "target" ? addDays(plan.targetDate, -plan.flexDays) : PLANNING_START_DATE;
  const lastDate = plan.dateMode === "target" ? addDays(plan.targetDate, plan.flexDays) : plan.deadlineDate;
  return {
    rangeStartsAt: zonedInputToIso(firstDate + "T00:00"),
    rangeEndsAt: zonedInputToIso(addDays(lastDate, 1) + "T00:00")
  };
}

function dateConstraintLabel(plan: MeetingPlannerForm): string {
  if (plan.dateMode === "deadline") return "Held by " + plan.deadlineDate;
  if (plan.flexDays === 0) return "On " + plan.targetDate;
  return "Around " + plan.targetDate + " ± " + plan.flexDays + " day" + (plan.flexDays === 1 ? "" : "s");
}

function weekdayLabel(weekday: string): string {
  return weekday.slice(0, 1).toUpperCase() + weekday.slice(1);
}

function workPatternLabel(entry: SchedulingProfile["weeklyWorkPattern"][number]): string {
  return entry.mode === "remote" ? "Working from home" : "In office at " + officeById(entry.officeId ?? "downtown-manhattan").name;
}

function eventOwnerLabel(ownerName: string): string {
  return ownerName.endsWith("s") ? ownerName + "’ Event" : ownerName + "’s Event";
}

function recurrenceLabel(event: CalendarEvent): string | null {
  if (!event.recurrence) return null;
  return "Weekly on " + weekdayLabel(event.recurrence.weekday) + " · " + event.recurrence.occurrenceCount + " occurrences";
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
  const [selectedProfileUserId, setSelectedProfileUserId] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [meetingPlanner, setMeetingPlanner] = useState<MeetingPlannerForm | null>(null);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ScheduleCandidate[] | null>(null);
  const [plannedMeeting, setPlannedMeeting] = useState<MeetingPlannerForm | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [isFindingAvailability, setIsFindingAvailability] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [commitConfirmation, setCommitConfirmation] = useState<DraftCommitConfirmation | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);

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

  useEffect(() => {
    let disposeTools: () => void = () => {};
    const onActivity = (event: Event) => {
      const activity = (event as CustomEvent<ToolActivity>).detail;
      setToolActivities((current) => [activity, ...current.filter((candidate) => candidate.id !== activity.id)].slice(0, 8));
    };
    const onStateChanged = () => {
      void refresh();
    };
    window.addEventListener(ACTIVITY_EVENT, onActivity);
    window.addEventListener(STATE_CHANGED_EVENT, onStateChanged);
    void registerCalendarTools().then((dispose) => {
      disposeTools = dispose;
    });
    return () => {
      window.removeEventListener(ACTIVITY_EVENT, onActivity);
      window.removeEventListener(STATE_CHANGED_EVENT, onStateChanged);
      disposeTools();
    };
  }, []);

  const selectedEvent = useMemo(
    () => state?.events.find((event) => event.id === selectedEventId) ?? null,
    [selectedEventId, state]
  );
  const selectedEventCalendar = selectedEvent ? state?.calendars.find((calendar) => calendar.id === selectedEvent.calendarId) ?? null : null;
  const activeCalendar = state?.calendars.find((calendar) => calendar.ownerId === state.activeUserId);
  const selectedDraft = state?.drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const calendarColors = new Map(state?.calendars.map((calendar) => [calendar.id, calendar.color]));
  const teamMemberColors = new Map(state?.calendars.map((calendar) => [calendar.ownerId, calendar.color]));
  const profilesByPersonId = useMemo(() => new Map(state?.schedulingProfiles.map((profile) => [profile.personId, profile])), [state]);
  const selectedProfile = selectedProfileUserId ? profilesByPersonId.get(selectedProfileUserId) ?? null : null;
  const selectedProfilePerson = selectedProfileUserId ? state?.people.find((person) => person.id === selectedProfileUserId) ?? null : null;
  const profileOfficeName = (personId: string) => officeById(profilesByPersonId.get(personId)?.defaultOfficeId ?? "downtown-manhattan").name;

  const findAvailability = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!meetingPlanner) return;
    if (!meetingPlanner.title.trim()) {
      setPlannerError("Add a meeting title before finding availability.");
      return;
    }
    if (meetingPlanner.attendeeIds.length === 0) {
      setPlannerError("Choose at least one attendee for a meeting.");
      return;
    }
    setIsFindingAvailability(true);
    setPlannerError(null);
    try {
      const range = dateRangeForPlan(meetingPlanner);
      const response = await request<{ proposals: ScheduleCandidate[] }>("/api/proposals", {
        method: "POST",
        body: JSON.stringify({
          attendeeIds: meetingPlanner.attendeeIds,
          durationMinutes: meetingPlanner.durationMinutes,
          officeId: meetingPlanner.officeId,
          ...range
        })
      });
      setPlannedMeeting({ ...meetingPlanner, title: meetingPlanner.title.trim() });
      setProposals(response.proposals);
      setMeetingPlanner(null);
    } catch (error) {
      setPlannerError(error instanceof Error ? error.message : "Could not find scheduling options.");
    } finally {
      setIsFindingAvailability(false);
    }
  };

  const createDraftFromProposal = async (proposal: ScheduleCandidate) => {
    if (!activeCalendar || !plannedMeeting) return;
    setProposalError(null);
    try {
      const office = officeById(plannedMeeting.officeId);
      const response = await request<{ draft: EventDraft }>("/api/event-drafts", {
        method: "POST",
        body: JSON.stringify({
          calendarId: activeCalendar.id,
          title: plannedMeeting.title,
          startsAt: proposal.startsAt,
          endsAt: proposal.endsAt,
          timeZone: DISPLAY_TIME_ZONE,
          visibility: "public",
          attendeeIds: plannedMeeting.attendeeIds,
          location: office.name,
          agenda: "Planned for " + office.name + ". Travel feedback uses the demo's fixed office assignments."
        })
      });
      setSelectedDraftId(response.draft.id);
      await refresh();
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : "Could not create the draft.");
    }
  };

  const revisePlannedMeeting = () => {
    if (!plannedMeeting) return;
    setPlannerError(null);
    setProposalError(null);
    setProposals(null);
    setMeetingPlanner({ ...plannedMeeting });
  };

  const discardDraft = async (draft: EventDraft) => {
    try {
      await request("/api/event-drafts/" + draft.id, {
        method: "DELETE",
        body: JSON.stringify({ expectedRevision: draft.revision })
      });
      setSelectedDraftId(null);
      setCommitConfirmation(null);
      await refresh();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The draft could not be discarded.");
    }
  };

  const prepareDraftCommit = async (draft: EventDraft) => {
    setCommitError(null);
    try {
      const response = await request<{ confirmation: DraftCommitConfirmation }>("/api/event-drafts/" + draft.id + "/commit-confirmation", {
        method: "POST",
        body: JSON.stringify({ expectedRevision: draft.revision })
      });
      setCommitConfirmation(response.confirmation);
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : "The draft could not be prepared for review.");
    }
  };

  const commitDraft = async () => {
    if (!selectedDraft || !commitConfirmation) return;
    setIsCommitting(true);
    setCommitError(null);
    try {
      await request("/api/event-drafts/" + selectedDraft.id + "/commit", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expectedRevision: selectedDraft.revision, confirmationId: commitConfirmation.id })
      });
      setCommitConfirmation(null);
      setSelectedDraftId(null);
      await refresh();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : "The event could not be committed.");
    } finally {
      setIsCommitting(false);
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
        <h1>Run MyCP through its Worker.</h1>
        <p>{loadError}</p>
        <code>npm run dev:worker</code>
        <button type="button" onClick={() => void refresh()}>Try again</button>
      </main>
    );
  }

  if (!state) {
    return <main className="load-state"><p>Loading MyCP…</p></main>;
  }

  return (
    <main className="calendar-app">
      <header className="calendar-header">
        <div className="brand"><span className="brand-mark">M</span><strong>MyCP</strong></div>
        <div className="week-controls"><button type="button" className="icon-button" aria-label="Previous week">‹</button><strong>September 2026</strong><button type="button" className="icon-button" aria-label="Next week">›</button></div>
        <div className="header-actions"><span className="timezone-label">{DISPLAY_TIME_ZONE.replace("_", " ")}</span><button type="button" className="primary-button" onClick={() => { setPlannerError(null); setMeetingPlanner(newMeetingPlannerForm()); }}>New event</button></div>
      </header>

      {loadError && <p className="error-banner" role="alert">{loadError}</p>}

      {(proposals || proposalError) && plannedMeeting && (
        <section className="proposal-panel" aria-labelledby="proposal-title">
          <div className="proposal-heading"><div><p className="eyebrow">Scheduling assistant</p><h2 id="proposal-title">{plannedMeeting.title} · {plannedMeeting.durationMinutes} minutes</h2><p>{officeById(plannedMeeting.officeId).name} · {dateConstraintLabel(plannedMeeting)}. Options use working hours, protected focus time, busy blocks, and travel buffers.</p></div><div className="proposal-actions"><button type="button" className="secondary-button" onClick={revisePlannedMeeting}>Revise event</button><button type="button" className="close-button" aria-label="Close scheduling options" onClick={() => { setProposals(null); setPlannedMeeting(null); setProposalError(null); }}>×</button></div></div>
          {proposalError && <p className="form-error" role="alert">{proposalError}</p>}
          {proposals?.length === 0 && <p className="muted">No slot met the current constraints. Adjust the time range or attendees.</p>}
          {proposals && proposals.length > 0 && <div className="proposal-grid">{proposals.map((proposal) => <article className="proposal-card" key={proposal.startsAt}><div><p className="proposal-time">{timeLabel(proposal.startsAt)}–{timeLabel(proposal.endsAt)}</p><strong>{new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, weekday: "long", month: "short", day: "numeric" }).format(new Date(proposal.startsAt))}</strong></div><p className="proposal-score">Score {proposal.score}</p><ul>{proposal.reasons.slice(0, 2).map((reason) => <li key={reason}>{reason}</li>)}</ul>{proposal.warnings.length > 0 && <p className="proposal-warning">{proposal.warnings[0]}</p>}<button type="button" className="secondary-button" onClick={() => void createDraftFromProposal(proposal)}>Create draft</button></article>)}</div>}
        </section>
      )}

      <div className="calendar-layout">
        <aside className="sidebar">
          <section className="team-section">
            <p className="eyebrow">Team</p>
            <div className="team-list">
              {state.people.map((person) => <button type="button" className="team-member-card" key={person.id} onClick={() => setSelectedProfileUserId(person.id)}><span className="team-avatar" style={{ background: teamMemberColors.get(person.id) ?? "#6547cd" }}>{person.displayName.slice(0, 1)}</span><span><strong>{person.displayName}{person.id === state.activeUserId ? " (you)" : ""}</strong><small>Scheduling profile · {profileOfficeName(person.id)}</small></span></button>)}
            </div>
          </section>
          <section className="free-busy-note">
            <p className="eyebrow">Privacy boundary</p>
            <strong>Private events show as busy.</strong>
            <p>MyCP exposes time blocks without revealing another person’s title, attendees, location, or agenda.</p>
          </section>
          <section className="draft-section">
            <p className="eyebrow">Pending drafts</p>
            {state.drafts.length === 0 ? <p className="muted">Scheduling proposals become visible drafts before anything is committed.</p> : (
              <div className="draft-list">{state.drafts.map((draft) => <button type="button" className="draft-card" key={draft.id} onClick={() => setSelectedDraftId(draft.id)}><strong>{draft.event.title}</strong><span>{timeLabel(draft.event.startsAt)}{recurrenceLabel(draft.event) ? " · repeats weekly" : ""} · review required</span></button>)}</div>
            )}
          </section>
          <section className="tool-activity-section">
            <p className="eyebrow">Live WebMCP trace</p>
            {toolActivities.length === 0 ? <p className="muted">Agent tool calls will appear here with their structured request and result.</p> : (
              <ol className="tool-activity-list">{toolActivities.map((activity, index) => <li key={activity.id}><span className={"activity-dot " + activity.outcome} /><div className="tool-activity-card"><div className="tool-activity-heading"><strong>{activity.tool}</strong><span className={"activity-status " + activity.outcome}>{activity.outcome}</span></div><p>{activity.summary}</p><details className="tool-trace-details" open={index === 0}><summary>Request &amp; result</summary>{activity.requestPreview && <><span className="trace-label">Tool input</span><pre>{activity.requestPreview}</pre></>}{activity.responsePreview && <><span className="trace-label">Tool result <em>untrusted data</em></span><pre>{activity.responsePreview}</pre></>}</details></div></li>)}</ol>
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
                    const isBusyOnly = event.visibility === "private" && event.title === "Busy";
                    const isPrivateEvent = event.visibility === "private";
                    const style = {
                      top: layout.top,
                      height: layout.height,
                      "--event-color": calendarColors.get(event.calendarId) ?? "#8466f6"
                    } as CSSProperties & Record<"--event-color", string>;
                    return (
                      <button
                        type="button"
                        className={"event-block" + (isPrivateEvent ? " private-event" : "") + (isBusyOnly ? " busy-only" : "")}
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
          {recurrenceLabel(selectedDraft.event) && <p className="recurrence-note">{recurrenceLabel(selectedDraft.event)}. The entire series remains a draft until you review and confirm it.</p>}
          <div className="event-diff">
            <div><span>Before</span><strong>No event or invitations</strong><p>The calendar remains unchanged.</p></div>
            <div><span>After approval</span><strong>{selectedDraft.event.title}</strong><p>{selectedDraft.event.attendeeIds.map((id) => state.people.find((person) => person.id === id)?.displayName).filter(Boolean).join(", ")}</p></div>
          </div>
          <p className="draft-expiry">Draft expires {new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(selectedDraft.expiresAt))}.</p>
          <div className="detail-actions"><button type="button" onClick={() => void discardDraft(selectedDraft)}>Discard draft</button><button type="button" className="primary-button" onClick={() => void prepareDraftCommit(selectedDraft)}>Review &amp; confirm</button></div>
          <p className="commit-note">Only a visible, current review can add this event. The WebMCP commit tool remains blocked.</p>
        </aside>
      )}

      {selectedEvent && (
        <aside className="event-details" aria-label="Event details">
          <button className="close-button" type="button" aria-label="Close event details" onClick={() => setSelectedEventId(null)}>×</button>
          <p className="eyebrow">{eventOwnerLabel(selectedEventCalendar?.name ?? "Calendar")}</p>
          <h2>{selectedEvent.title}</h2>
          <p>{timeLabel(selectedEvent.startsAt)}–{timeLabel(selectedEvent.endsAt)} · {DISPLAY_TIME_ZONE.replace("_", " ")}</p>
          {selectedEvent.title === "Busy" ? (
            <p className="muted">This event is private. Only its busy time is available for scheduling.</p>
          ) : (
            <>
              <dl>
                <div><dt>Attendees</dt><dd>{selectedEvent.attendeeIds.map((id) => state.people.find((person) => person.id === id)?.displayName).filter(Boolean).join(", ")}</dd></div>
                <div><dt>Visibility</dt><dd>{selectedEvent.visibility}</dd></div>
                {recurrenceLabel(selectedEvent) && <div><dt>Recurrence</dt><dd>{recurrenceLabel(selectedEvent)}</dd></div>}
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

      {selectedProfile && selectedProfilePerson && (
        <aside className="event-details profile-details" aria-label="Team member scheduling profile">
          <button className="close-button" type="button" aria-label="Close scheduling profile" onClick={() => setSelectedProfileUserId(null)}>×</button>
          <p className="eyebrow">Team scheduling profile</p>
          <h2>{selectedProfilePerson.displayName}</h2>
          <p>Profile revision {selectedProfile.revision} · scheduling-only details</p>
          <dl>
            <div><dt>Preferred meeting time</dt><dd>{selectedProfile.meetingPreferences.preferredMeetingWindow === "any" ? "No preference" : selectedProfile.meetingPreferences.preferredMeetingWindow}</dd></div>
            <div><dt>Default office</dt><dd>{officeById(selectedProfile.defaultOfficeId).name}</dd></div>
            <div><dt>Travel buffer</dt><dd>{selectedProfile.meetingPreferences.travelBufferMinutes} minutes around existing events</dd></div>
          </dl>
          <section className="profile-block"><p className="eyebrow">Typical week</p><ul className="profile-work-pattern">{selectedProfile.weeklyWorkPattern.map((entry) => <li key={entry.weekday}><strong>{weekdayLabel(entry.weekday)}</strong><span>{workPatternLabel(entry)}</span></li>)}</ul></section>
          <section className="profile-block"><p className="eyebrow">Recurring focus time</p>{selectedProfile.recurringFocusBlocks.length === 0 ? <p className="muted">No recurring focus blocks shared.</p> : <ul className="profile-focus-list">{selectedProfile.recurringFocusBlocks.map((block) => <li key={block.weekday + block.start}>{weekdayLabel(block.weekday)} · {block.start}–{block.end}</li>)}</ul>}</section>
          <p className="profile-privacy-note">This profile intentionally excludes home address, live location, and private calendar-event details.</p>
        </aside>
      )}

      {meetingPlanner && (
        <div className="modal-backdrop" role="presentation">
          <form className="event-form meeting-planner" onSubmit={findAvailability}>
            <div className="form-header"><div><p className="eyebrow">New event</p><h2>Plan a meeting</h2><p className="planner-intro">MyCP will propose times; choosing one creates a reviewable draft, never a committed event.</p></div><button type="button" className="close-button" onClick={() => setMeetingPlanner(null)} aria-label="Close meeting planner">×</button></div>
            <label>Title<input autoFocus required maxLength={140} value={meetingPlanner.title} onChange={(event) => setMeetingPlanner({ ...meetingPlanner, title: event.target.value })} /></label>
            <label>Length of meeting<select value={meetingPlanner.durationMinutes} onChange={(event) => setMeetingPlanner({ ...meetingPlanner, durationMinutes: Number(event.target.value) })}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={90}>1 hour 30 minutes</option><option value={120}>2 hours</option></select></label>
            <fieldset><legend>Attendees</legend><p className="field-hint">You ({state.people.find((person) => person.id === state.activeUserId)?.displayName}) are included automatically · designated office: {profileOfficeName(state.activeUserId)}.</p>{state.people.filter((person) => person.id !== state.activeUserId).map((person) => <label className="check-row attendee-row" key={person.id}><input type="checkbox" checked={meetingPlanner.attendeeIds.includes(person.id)} onChange={(event) => setMeetingPlanner({ ...meetingPlanner, attendeeIds: event.target.checked ? [...meetingPlanner.attendeeIds, person.id] : meetingPlanner.attendeeIds.filter((id) => id !== person.id) })} /><span>{person.displayName}<small>Designated office: {profileOfficeName(person.id)}</small></span></label>)}</fieldset>
            <label>Office<select value={meetingPlanner.officeId} onChange={(event) => setMeetingPlanner({ ...meetingPlanner, officeId: event.target.value as OfficeId })}>{OFFICES.map((office) => <option value={office.id} key={office.id}>{office.name}</option>)}</select></label>
            <p className="office-note">The two demo offices are {formatTravelMinutes(OFFICES[0].travelMinutesToOtherOffice)} apart. Proposal feedback calls out anyone travelling from their designated office.</p>
            <fieldset><legend>Date</legend><label className="radio-row"><input type="radio" name="date-mode" checked={meetingPlanner.dateMode === "target"} onChange={() => setMeetingPlanner({ ...meetingPlanner, dateMode: "target" })} /><span>Target date</span></label>
              {meetingPlanner.dateMode === "target" && <div className="form-row date-row"><label>Date<input required type="date" min={PLANNING_START_DATE} value={meetingPlanner.targetDate} onChange={(event) => setMeetingPlanner({ ...meetingPlanner, targetDate: event.target.value })} /></label><label>Flexibility<select value={meetingPlanner.flexDays} onChange={(event) => setMeetingPlanner({ ...meetingPlanner, flexDays: Number(event.target.value) })}><option value={0}>Exact date</option><option value={1}>± 1 day</option><option value={2}>± 2 days</option><option value={3}>± 3 days</option><option value={5}>± 5 days</option></select></label></div>}
              <label className="radio-row"><input type="radio" name="date-mode" checked={meetingPlanner.dateMode === "deadline"} onChange={() => setMeetingPlanner({ ...meetingPlanner, dateMode: "deadline" })} /><span>Have meeting by</span></label>
              {meetingPlanner.dateMode === "deadline" && <label>Deadline<input required type="date" min={PLANNING_START_DATE} value={meetingPlanner.deadlineDate} onChange={(event) => setMeetingPlanner({ ...meetingPlanner, deadlineDate: event.target.value })} /></label>}
            </fieldset>
            {plannerError && <p className="form-error" role="alert">{plannerError}</p>}
            <div className="form-actions"><button type="button" onClick={() => setMeetingPlanner(null)}>Cancel</button><button className="primary-button" disabled={isFindingAvailability} type="submit">{isFindingAvailability ? "Finding availability…" : "Find availability"}</button></div>
          </form>
        </div>
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

      {commitConfirmation && selectedDraft && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
            <button type="button" className="close-button" aria-label="Close confirmation" disabled={isCommitting} onClick={() => setCommitConfirmation(null)}>×</button>
            <p className="eyebrow">Human approval required</p>
            <h2 id="confirmation-title">Add this event to your calendar?</h2>
            <p>This will create the confirmed event below. MyCP does not send invitations in this demo.</p>
            <dl>
              <div><dt>Event</dt><dd>{selectedDraft.event.title}</dd></div>
              <div><dt>Time</dt><dd>{timeLabel(selectedDraft.event.startsAt)}–{timeLabel(selectedDraft.event.endsAt)} · {DISPLAY_TIME_ZONE.replace("_", " ")}</dd></div>
              <div><dt>Invitees</dt><dd>{selectedDraft.event.attendeeIds.map((id) => state.people.find((person) => person.id === id)?.displayName).filter(Boolean).join(", ")}</dd></div>
              <div><dt>Review</dt><dd>Draft revision {selectedDraft.revision}; confirmation expires in five minutes.</dd></div>
            </dl>
            {commitError && <p className="form-error" role="alert">{commitError}</p>}
            <div className="form-actions"><button type="button" disabled={isCommitting} onClick={() => setCommitConfirmation(null)}>Keep reviewing</button><button type="button" className="primary-button" disabled={isCommitting} onClick={() => void commitDraft()}>{isCommitting ? "Adding…" : "Confirm & add event"}</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
