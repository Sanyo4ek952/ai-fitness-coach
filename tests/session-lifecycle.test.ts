import "fake-indexeddb/auto";
import { describe, it } from "vitest";
import { runStorageCase } from "./storage-cases";
import { sessionLifecycleCases } from "./session-lifecycle-cases";

describe("M3-01 session/cursor", () => {
  for (const test of sessionLifecycleCases) it(test.name, () => runStorageCase(test));
});
