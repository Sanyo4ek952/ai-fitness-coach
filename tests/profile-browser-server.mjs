import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { setSeedHtml, setFactsHtml } from "./set-browser-fixture.mjs";

// Manual production UI checks only; never included in out/. Dedicated origin
// isolates synthetic data from the normal app. Faults fire once per page load.
const root = resolve("out");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (process.env.FITNESS_TEST_PORT === "4178" && ["/tests/set-seed", "/tests/set-facts"].includes(url.pathname)) {
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.setHeader("Cache-Control", "no-store");
      response.end(url.pathname === "/tests/set-seed" ? setSeedHtml : setFactsHtml); return;
    }
    let file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    let body = await readFile(file);
    if (extname(file) === ".html") {
      let setup = "";
      if (url.searchParams.get("text") === "200") setup += '<style>:root{font-size:200%}</style>';
      if (url.searchParams.get("fault") === "write") setup += `<script>{const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){if(this.name==='profileRevisions'){IDBObjectStore.prototype.add=add;throw new DOMException('Synthetic quota failure','QuotaExceededError')}return add.apply(this,args)}}</script>`;
      if (url.searchParams.get("fault") === "open") setup += `<script>{const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(...args){IDBFactory.prototype.open=open;throw new DOMException('Synthetic open failure','SecurityError')}}</script>`;
      if (url.searchParams.get("fault") === "analysis-snapshot") setup += `<script>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='programState'&&args[0]?.key==='analysisSnapshot')throw new DOMException('Synthetic analysis quota failure','QuotaExceededError');return put.apply(this,args)}}</script>`;
      if (url.searchParams.get("fault") === "request") setup += `<script>{const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){if(this.name==='coachRequests'){IDBObjectStore.prototype.add=add;throw new DOMException('Synthetic quota failure','QuotaExceededError')}return add.apply(this,args)}}</script>`;
      if (url.searchParams.get("fault") === "response") setup += `<script>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='coachResponses'){IDBObjectStore.prototype.put=put;throw new DOMException('Synthetic quota failure','QuotaExceededError')}return put.apply(this,args)}}</script>`;
      if (url.searchParams.get("fault") === "clipboard") setup += `<script>navigator.clipboard.writeText=async()=>{throw new DOMException('Synthetic clipboard denial','NotAllowedError')}</script>`;
      if (url.searchParams.get("fault") === "acceptance") setup += `<script>{const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){if(this.name==='coachAcceptances'){IDBObjectStore.prototype.add=add;throw new DOMException('Synthetic quota failure','QuotaExceededError')}return add.apply(this,args)}}</script>`;
      if (url.searchParams.get("fault") === "session-start") setup += `<script>{const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){if(this.name==='sessions'){IDBObjectStore.prototype.add=add;throw new DOMException('Synthetic quota failure','QuotaExceededError')}return add.apply(this,args)}}</script>`;
      if (url.searchParams.get("fault") === "session-finish") setup += `<script>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='counters'){IDBObjectStore.prototype.put=put;throw new DOMException('Synthetic quota failure','QuotaExceededError')}return put.apply(this,args)}}</script>`;
      if (url.searchParams.get("fault") === "set-write") setup += `<script>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='counters'){IDBObjectStore.prototype.put=put;throw new DOMException('Synthetic quota failure','QuotaExceededError')}return put.apply(this,args)}}</script>`;
      body = Buffer.from(body.toString().replace("</head>", `${setup}</head>`));
    }
    response.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", "no-store"); response.end(body);
  } catch { response.writeHead(404).end(); }
});
const port = Number(process.env.FITNESS_TEST_PORT ?? 4176);
server.listen(port, "127.0.0.1", () => console.log(`Production UI checks: http://127.0.0.1:${port}/profile/ (synthetic data only)`));
