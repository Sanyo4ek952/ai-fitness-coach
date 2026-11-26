import { z } from "zod";
import type { TrainingDatabase } from "@/shared/infrastructure/db";

export function privacyStorage(db: TrainingDatabase) {
  async function snapshot() {
    // Read raw envelopes so even a damaged domain record can be explicitly erased.
    // Photo bytes are immutable under their ID through the public adapter.
    return db.transaction("r", db.tables, async () => Promise.all(db.tables.map(async (table) => ({
      name: table.name, rows: await table.toArray(),
    }))));
  }
  async function preview() {
    const stores = await snapshot();
    return { expectedToken: JSON.stringify(stores), counts: stores.map(({ name, rows }) => ({ name, count: rows.length })) };
  }
  async function erase(expectedToken: string, confirmed: unknown) {
    z.literal(true).parse(confirmed);
    z.string().min(1).parse(expectedToken);
    await db.write(db.tables, async () => {
      if (JSON.stringify(await snapshot()) !== expectedToken) {
        throw new Error("Данные изменились. Отмените удаление и проверьте состав заново.");
      }
      for (const table of db.tables) await table.clear();
      // Keep only a non-personal tombstone. Deleting the database would lose the
      // generation guard and let old forms recreate revision 1 after reopening.
      await db.counters.put({ key: "restoreGeneration", value: crypto.randomUUID() });
    });
  }
  return { preview, erase };
}
