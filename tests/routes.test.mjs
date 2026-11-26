import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { after, before, test } from "node:test";

// Проверяем именно результат next build, без Next dev/server runtime.
const root = resolve("out");
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = pathname.endsWith("/")
    ? resolve(root, `.${decodeURIComponent(pathname)}`, "index.html")
    : resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".txt": "text/plain", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
    response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
let origin;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

for (const [path, title] of [
  ["/", "Тренировка"], ["/workout/", "Тренировка"],
  ["/progress/", "Прогресс"], ["/coach/", "Тренер"], ["/profile/", "Профиль"],
]) {
  test(`production ${path}: HTTP 200, русский заголовок и навигация`, async () => {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<html lang="ru">/);
    assert.ok(html.includes(path === "/profile/" || path === "/coach/" ? `>${title}</h1>` : "Проверяем сохранённый профиль"));
    assert.match(html, /aria-label="Основная навигация"/);
    for (const href of ["/workout", "/progress", "/coach", "/profile"]) {
      assert.ok(html.includes(`href="${href}/"`), `Missing link to ${href}/`);
      const linkedPage = await fetch(`${origin}${href}/`);
      assert.equal(linkedPage.status, 200);
    }
  });
}

test("production PWA: manifest, PNG icons and metadata", async () => {
  const response = await fetch(`${origin}/manifest.webmanifest`);
  assert.match(response.headers.get("content-type"), /manifest\+json/);
  const manifest = await response.json();
  assert.equal(manifest.lang, "ru");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.start_url, "/workout/");
  for (const [path, size] of [["/icons/icon-192.png", 192], ["/icons/icon-512.png", 512], ["/icons/apple-touch-icon.png", 180]]) {
    const icon = await fetch(origin + path);
    assert.equal(icon.status, 200);
    const bytes = Buffer.from(await icon.arrayBuffer());
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  const html = await (await fetch(origin + "/")).text();
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /name="theme-color"/);
});

test("production PWA: every generated precache URL is served; private files excluded", async () => {
  const response = await fetch(origin + "/sw.js");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  const worker = await response.text();
  const match = worker.match(/const ASSETS = (\[.*\]);/);
  assert.ok(match);
  const assets = JSON.parse(match[1]);
  const integrity = JSON.parse(worker.match(/const INTEGRITY = (\{.*\});/)[1]);
  for (const path of ["/", "/workout/", "/progress/", "/coach/", "/profile/", "/coach/index.txt", "/coach/__next.coach/__PAGE__.txt"]) assert.ok(assets.includes(path), path);
  assert.ok(assets.length > 20);
  for (const path of assets) {
    assert.doesNotMatch(path, /tests|backup|photo|request\.json|sw\.js/);
    const resource = await fetch(origin + path);
    assert.equal(resource.status, 200, path);
    const bytes = Buffer.from(await resource.arrayBuffer());
    assert.ok(bytes.byteLength > 0, path);
    assert.equal(integrity[path], "sha256-" + createHash("sha256").update(bytes).digest("base64"), path);
    if (path.endsWith(".txt")) assert.match(resource.headers.get("content-type"), /text\/plain/);
  }
});
