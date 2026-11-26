import { Dexie, type Table } from "dexie";

// Only storage envelopes here. Domain schemas belong to the entity adapter.
export interface StoredRevision {
  revision: number;
  payload: unknown;
}
export interface StoredVersion extends StoredRevision {
  id: string;
}
export interface StoredSession {
  id: string;
  status: string;
  payload: unknown;
}
export interface StoredCounter {
  key: string;
  value: unknown;
}
export interface StoredExchange {
  requestId: string;
  payload: unknown;
  // Local request provenance only; never included in the external AI DTO.
  baselineKey?: unknown;
  measurementRevision?: unknown;
}
export interface StoredBodyRecord {
  id: string;
  payload: unknown;
}
export interface StoredState {
  key: string;
  payload: unknown;
}

// Never edit an existing version. Add version(N).stores(...).upgrade(...) for
// future changes; IndexedDB rolls schema and data back together on failure.
export const storageSchemaV1 = Object.freeze({
  profileRevisions: "revision",
  programVersions: "id, &revision",
  sessions: "id, status",
  counters: "key",
});
export const storageSchemaV2 = Object.freeze({ ...storageSchemaV1, coachRequests: "requestId", coachResponses: "requestId" });
export const storageSchemaV3 = Object.freeze({ ...storageSchemaV2, programState: "key", coachAcceptances: "requestId" });

export const storageSchemaV4 = Object.freeze({ ...storageSchemaV3, bodyMeasurements: "id", progressPhotos: "id" });

// Page lifetime, shared by short-lived action connections too. A full reload
// discards old form state and captures the restored generation.
const pageGenerations = new Map<string, unknown>();

export class TrainingDatabase extends Dexie {
  private generation: unknown = 0;

  async needsReload(): Promise<boolean> {
    return ((await this.counters.get("restoreGeneration"))?.value ?? 0) !== this.generation;
  }

  // A restore may reuse domain revisions. Old forms/connections must not write
  // against those revisions until the page is fully reloaded.
  async write<T>(tables: readonly Table[], action: () => Promise<T>): Promise<T> {
    return this.transaction("rw", [...tables, this.counters], async () => {
      if (await this.needsReload()) throw new Error("Данные заменены или удалены. Перезагрузите страницу перед изменениями.");
      return action();
    });
  }
  readonly profileRevisions: Table<StoredRevision, number>;
  readonly programVersions: Table<StoredVersion, string>;
  readonly sessions: Table<StoredSession, string>;
  readonly counters: Table<StoredCounter, string>;
  readonly coachRequests: Table<StoredExchange, string>;
  readonly coachResponses: Table<StoredExchange, string>;
  readonly programState: Table<StoredState, string>;
  readonly coachAcceptances: Table<StoredExchange, string>;

  readonly bodyMeasurements: Table<StoredBodyRecord, string>;
  readonly progressPhotos: Table<StoredBodyRecord, string>;

  constructor(name = "ai-fitness-coach") {
    super(name, { autoOpen: false });
    this.version(1).stores(storageSchemaV1);
    this.version(2).stores(storageSchemaV2);
    this.version(3).stores(storageSchemaV3);
    this.version(4).stores(storageSchemaV4);
    this.bodyMeasurements = this.table("bodyMeasurements");
    this.progressPhotos = this.table("progressPhotos");
    this.profileRevisions = this.table("profileRevisions");
    this.programVersions = this.table("programVersions");
    this.sessions = this.table("sessions");
    this.counters = this.table("counters");
    this.coachRequests = this.table("coachRequests");
    this.coachResponses = this.table("coachResponses");
    this.programState = this.table("programState");
    this.coachAcceptances = this.table("coachAcceptances");
    this.on("ready", async () => {
      // Dexie can open a newer database if the declared stores still match.
      // Older application code must never write into an unknown schema.
      if (this.backendDB().version !== 40) {
        throw new Dexie.VersionError("Версия локальной БД не поддерживается этим приложением");
      }
      const currentGeneration = (await this.counters.get("restoreGeneration"))?.value ?? 0;
      if (!pageGenerations.has(this.name)) pageGenerations.set(this.name, currentGeneration);
      this.generation = pageGenerations.get(this.name);
    }, true);
    // Close an old tab on upgrade; further operations reject until reopened.
    this.on("versionchange", () => this.close());
  }
}
