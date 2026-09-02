import { CalendarStore, type CalendarState, type CalendarStoreSnapshot } from "./calendar-store";
import { demoData } from "./seed";

type StoredState = Readonly<{ value: string; revision: number }>;

export class D1CalendarRepository {
  constructor(private readonly database: D1Database) {}

  async stateFor(activeUserId: string): Promise<CalendarState> {
    return this.withStore((store) => store.stateFor(activeUserId));
  }

  async propose(activeUserId: string, input: unknown) {
    return this.withStore((store) => store.propose(activeUserId, input));
  }

  async proposeRecurring(activeUserId: string, input: unknown) {
    return this.withStore((store) => store.proposeRecurring(activeUserId, input));
  }

  async schedulingProfileFor(activeUserId: string, personId: string) {
    return this.withStore((store) => store.schedulingProfileFor(activeUserId, personId));
  }

  async create(activeUserId: string, input: unknown) {
    return this.withStore((store) => store.create(activeUserId, input));
  }

  async update(activeUserId: string, eventId: string, input: unknown) {
    return this.withStore((store) => store.update(activeUserId, eventId, input));
  }

  async createDraft(activeUserId: string, input: unknown) {
    return this.withStore((store) => store.createDraft(activeUserId, input));
  }

  async updateDraft(activeUserId: string, draftId: string, input: unknown) {
    return this.withStore((store) => store.updateDraft(activeUserId, draftId, input));
  }

  async discardDraft(activeUserId: string, draftId: string, expectedRevision: unknown) {
    return this.withStore((store) => store.discardDraft(activeUserId, draftId, expectedRevision));
  }

  async prepareDraftCommit(activeUserId: string, draftId: string, expectedRevision: unknown) {
    return this.withStore((store) => store.prepareDraftCommit(activeUserId, draftId, expectedRevision));
  }

  async commitDraft(activeUserId: string, draftId: string, input: unknown, idempotencyKey: string) {
    return this.withStore((store) => store.commitDraft(activeUserId, draftId, input, idempotencyKey));
  }

  private async withStore<T>(operation: (store: CalendarStore) => T): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stored = await this.database
        .prepare("SELECT value, revision FROM mycp_state WHERE id = ?")
        .bind("demo")
        .first<StoredState>();
      const store = stored
        ? CalendarStore.fromSnapshot(JSON.parse(stored.value) as CalendarStoreSnapshot)
        : new CalendarStore(demoData);
      const result = operation(store);
      const value = JSON.stringify(store.snapshot());

      if (!stored) {
        const inserted = await this.database
          .prepare("INSERT OR IGNORE INTO mycp_state (id, value, revision, updated_at) VALUES (?, ?, ?, ?)")
          .bind("demo", value, 1, new Date().toISOString())
          .run();
        if (inserted.meta.changes === 1) return result;
        continue;
      }

      const updated = await this.database
        .prepare("UPDATE mycp_state SET value = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
        .bind(value, new Date().toISOString(), "demo", stored.revision)
        .run();
      if (updated.meta.changes === 1) return result;
    }
    throw new Error("Calendar state changed concurrently. Retry the request.");
  }
}
