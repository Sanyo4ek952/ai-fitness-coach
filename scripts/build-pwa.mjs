import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const routes = ["/", "/workout/", "/progress/", "/coach/", "/profile/"];

export async function buildPwa(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(relative(root, path).split(sep).join("/"));
    }
  }
  await walk(root);
  const assets = new Map();
  for (const file of files.sort()) {
    const route = file === "index.html" ? "/" : "/" + file.replace(/index\.html$/, "");
    const isRoute = file.endsWith("index.html") && routes.includes(route);
    const isRsc = file.endsWith(".txt") && routes.some((page) => {
      const parent = page.slice(1);
      const tail = file.slice(parent.length);
      return file.startsWith(parent) && (tail === "index.txt" || tail.startsWith("__next."));
    });
    if (isRoute || isRsc || file.startsWith("_next/static/") || file.startsWith("icons/") || file === "manifest.webmanifest") {
      assets.set(isRoute ? route : "/" + file, await readFile(resolve(root, file)));
    }
  }
  for (const required of [...routes, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]) {
    if (!assets.has(required)) throw new Error(`Missing PWA resource: ${required}`);
  }
  const template = await readFile(new URL("./pwa-worker.js", import.meta.url), "utf8");
  const hash = createHash("sha256").update(template);
  for (const [path, body] of assets) hash.update(path).update(body);
  const version = hash.digest("hex").slice(0, 24);
  const integrity = Object.fromEntries([...assets].map(([path, body]) => [path, "sha256-" + createHash("sha256").update(body).digest("base64")]));
  const worker = template.replace('"__PWA_VERSION__"', JSON.stringify(version))
    .replace("/* __PWA_ASSETS__ */ []", JSON.stringify([...assets.keys()]))
    .replace("/* __PWA_INTEGRITY__ */ {}", JSON.stringify(integrity));
  await writeFile(resolve(root, "sw.js"), worker);
  console.log(`PWA: ${assets.size} resources, shell ${version}`);
  return { version, assets: [...assets.keys()] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPwa(resolve("out"));
}
