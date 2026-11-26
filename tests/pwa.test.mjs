import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { buildPwa, routes } from "../scripts/build-pwa.mjs";

const origin = "https://fitness.test";
const resources = ["/", "/workout/", "/coach/", "/profile/", "/progress/", "/coach/__next._full.txt", "/_next/static/app.js"];
const template = await readFile(new URL("../scripts/pwa-worker.js", import.meta.url), "utf8");

// Lifecycle/CacheStorage simulator, NOT evidence of browser offline support.
function harness({ fail = false, existing = new Map(), version = "new" } = {}) {
  const handlers = new Map();
  const network = [];
  const cacheName = `fitness-shell-${version}`;
  let claimed = false;
  let offline = false;
  const caches = {
    async keys() { return [...existing.keys()]; },
    async delete(key) { return existing.delete(key); },
    async open(key) {
      if (!existing.has(key)) existing.set(key, new Map());
      const entries = existing.get(key);
      return {
        async addAll(requests) {
          if (offline) throw new Error("offline");
          if (fail) throw new Error("Missing asset / quota");
          for (const request of requests) entries.set(new URL(request.url).pathname, new Response(request.url));
        },
        async match(path) { return entries.get(path)?.clone(); },
      };
    },
  };
  runInNewContext(template.replace('"__PWA_VERSION__"', JSON.stringify(version))
    .replace("/* __PWA_ASSETS__ */ []", JSON.stringify(resources)), {
    URL, Request, caches,
    fetch: async (request) => {
      network.push(request.url);
      if (offline) throw new Error("offline");
      return new Response("network");
    },
    self: {
      location: { origin },
      clients: { async claim() { claimed = true; } },
      addEventListener(type, handler) { handlers.set(type, handler); },
      // skipWaiting intentionally absent: using it fails the test.
    },
  });
  return {
    network, existing, cacheName,
    get claimed() { return claimed; },
    offline() { offline = true; },
    online() { offline = false; },
    async lifecycle(type) {
      let promise;
      handlers.get(type)({ waitUntil(value) { promise = value; } });
      await promise;
    },
    async status(type = "OFFLINE_STATUS") {
      let promise;
      let result;
      handlers.get("message")({ data: { type }, ports: [{ postMessage(value) { result = value; } }], waitUntil(value) { promise = value; } });
      await promise;
      return result;
    },
    async request(path, { method = "GET", mode = "cors" } = {}) {
      let response;
      handlers.get("fetch")({ request: { url: new URL(path, origin).href, method, mode }, respondWith(value) { response = value; } });
      return response;
    },
  };
}

test("all five pages, RSC and chunks are available without network after full install", async () => {
  const sw = harness();
  await sw.lifecycle("install");
  await sw.lifecycle("activate");
  assert.equal(sw.claimed, true);
  assert.equal((await sw.status()).ready, true);
  sw.offline();
  for (const path of resources) {
    const response = await sw.request(path);
    assert.equal(await response.text(), origin + path);
  }
  assert.equal(await (await sw.request("/workout", { mode: "navigate" })).text(), origin + "/workout/");
  assert.equal(await (await sw.request("/coach/__next._full.txt?_rsc=cache-key")).text(), origin + "/coach/__next._full.txt");
  assert.deepEqual(sw.network, []);
});

test("partial install rejects; old shell and unrelated caches survive", async () => {
  const old = new Map([["/", new Response("old")]]);
  const sw = harness({ fail: true, existing: new Map([["fitness-shell-old", old], ["other-app", new Map()]]) });
  await assert.rejects(sw.lifecycle("install"), /Missing asset/);
  assert.equal((await sw.status()).ready, false);
  assert.equal(sw.existing.get("fitness-shell-old"), old);
  assert.ok(sw.existing.has("other-app"));
  assert.equal(sw.claimed, false);
});

test("update install leaves old shell; activation cleans only owned caches", async () => {
  const sw = harness({ existing: new Map([["fitness-shell-old", new Map()], ["other-app", new Map()]]) });
  await sw.lifecycle("install");
  assert.ok(sw.existing.has("fitness-shell-old"));
  assert.equal(sw.claimed, false);
  await sw.lifecycle("activate");
  assert.deepEqual([...sw.existing.keys()].sort(), ["fitness-shell-new", "other-app"]);
});

test("exports, photos, other origins, unknown routes, writes and test queries are not intercepted", async () => {
  const sw = harness();
  await sw.lifecycle("install");
  for (const path of ["/request.json", "/backup.json", "blob:https://fitness.test/photo", "https://external.test/", "/unknown/", "/tests/set-facts", "/coach/?fault=request", "/coach/?text=200"]) {
    assert.equal(await sw.request(path), undefined, path);
  }
  assert.equal(await sw.request("/coach/", { method: "POST" }), undefined);
});

test("cache eviction removes ready state and does not invent offline success", async () => {
  const sw = harness();
  await sw.lifecycle("install");
  sw.existing.get(sw.cacheName).delete("/workout/");
  assert.equal((await sw.status()).ready, false);
  assert.equal(await (await sw.request("/workout/")).text(), "network");
  sw.offline();
  await assert.rejects(sw.request("/workout/"), /offline/);
  assert.equal((await sw.status("PREPARE_OFFLINE")).ready, false);
  sw.online();
  assert.equal((await sw.status("PREPARE_OFFLINE")).ready, true);
});

test("generator includes lazy chunks and route segments, excludes private/test files; versions content", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "fitness-pwa-"));
  async function put(path, body = "synthetic") {
    const file = resolve(root, path);
    await mkdir(resolve(file, ".."), { recursive: true });
    await writeFile(file, body);
  }
  try {
    for (const page of routes) await put(page.slice(1) + "index.html");
    for (const file of ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "_next/static/lazy.js", "coach/__next.coach/__PAGE__.txt", "coach/index.txt", "__next._tree.txt", "tests/private.json", "backup.json", "404/index.html"]) await put(file);
    const first = await buildPwa(root);
    assert.ok(first.assets.includes("/coach/__next.coach/__PAGE__.txt"));
    assert.ok(first.assets.includes("/_next/static/lazy.js"));
    assert.ok(first.assets.includes("/__next._tree.txt"));
    assert.ok(!first.assets.some((path) => /private|backup|404/.test(path)));
    assert.equal((await buildPwa(root)).version, first.version);
    await put("_next/static/lazy.js", "changed");
    assert.notEqual((await buildPwa(root)).version, first.version);
    await rm(resolve(root, "coach/index.html"));
    await assert.rejects(buildPwa(root), /Missing PWA resource/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
