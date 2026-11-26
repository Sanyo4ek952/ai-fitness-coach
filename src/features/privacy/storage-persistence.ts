export type PersistenceStatus = "unsupported" | "persistent" | "best-effort";
type StorageAccess = Pick<StorageManager, "persisted" | "persist">;

export async function storagePersistence(storage: Partial<StorageAccess> | undefined, request = false): Promise<PersistenceStatus> {
  if (!storage || typeof storage.persisted !== "function") return "unsupported";
  if (await storage.persisted()) return "persistent";
  if (!request) return "best-effort";
  if (typeof storage.persist !== "function") return "unsupported";
  return await storage.persist() ? "persistent" : "best-effort";
}
