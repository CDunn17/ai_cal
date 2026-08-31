import { demoData, demoWindow } from "./domain/seed";

type Diagnostic = Readonly<{
  label: string;
  value: string;
  healthy: boolean;
  explanation: string;
}>;

function createDiagnostics(): Diagnostic[] {
  const documentWithWebMcp = document as Document & { modelContext?: unknown };

  return [
    {
      label: "Origin isolation",
      value: window.crossOriginIsolated ? "Active" : "Not active",
      healthy: window.crossOriginIsolated,
      explanation: "Required before the browser exposes WebMCP tools."
    },
    {
      label: "WebMCP API",
      value: documentWithWebMcp.modelContext ? "Detected" : "Not detected",
      healthy: Boolean(documentWithWebMcp.modelContext),
      explanation: "Expected in ChatGPT’s in-app browser or Chrome with WebMCP testing enabled."
    },
    {
      label: "Demo data",
      value: `${demoData.events.length} events · ${demoData.people.length} people`,
      healthy: true,
      explanation: "Seeded, fictional data keeps the demo reproducible and private."
    }
  ];
}

export function App() {
  const diagnostics = createDiagnostics();

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Milestone 1 · Foundation</p>
          <h1>CoPlan</h1>
          <p className="hero-copy">A human-controlled calendar built for collaboration with agents.</p>
        </div>
        <span className="environment-badge">Seeded demo</span>
      </header>

      <section className="overview" aria-labelledby="overview-title">
        <div>
          <p className="eyebrow">Demo window</p>
          <h2 id="overview-title">September 7–13, 2026</h2>
          <p>
            {demoWindow.startsAt.slice(0, 10)} to {demoWindow.endsAt.slice(0, 10)} · all timestamps are stored in UTC.
          </p>
        </div>
        <div className="people" aria-label="Demo team">
          {demoData.people.map((person) => (
            <article className="person-card" key={person.id}>
              <span className="avatar" aria-hidden="true">{person.displayName.slice(0, 1)}</span>
              <div>
                <strong>{person.displayName}</strong>
                <small>{person.timeZone.replace("_", " ")}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="diagnostics" aria-labelledby="diagnostics-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Runtime check</p>
            <h2 id="diagnostics-title">WebMCP readiness</h2>
          </div>
          <p>Run this deployed page in a WebMCP-capable browser before registering tools.</p>
        </div>
        <div className="diagnostic-grid">
          {diagnostics.map((diagnostic) => (
            <article className="diagnostic-card" key={diagnostic.label}>
              <div className="diagnostic-heading">
                <span className={diagnostic.healthy ? "status-dot healthy" : "status-dot"} aria-hidden="true" />
                <h3>{diagnostic.label}</h3>
              </div>
              <strong>{diagnostic.value}</strong>
              <p>{diagnostic.explanation}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="next-step" aria-labelledby="next-step-title">
        <p className="eyebrow">Next up</p>
        <h2 id="next-step-title">Build the human-first calendar slice.</h2>
        <p>Week view, event detail, and visibility-safe free/busy overlays will use these same validated contracts.</p>
      </section>
    </main>
  );
}
