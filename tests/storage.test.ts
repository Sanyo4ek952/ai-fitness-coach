import "fake-indexeddb/auto";
import { describe, it } from "vitest";
import { runStorageCase, storageCases } from "./storage-cases";

describe("M1-02 IndexedDB (fake-indexeddb)", () => {
  for (const test of storageCases) it(test.name, () => runStorageCase(test));
});
