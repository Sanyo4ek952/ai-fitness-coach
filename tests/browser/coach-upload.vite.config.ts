import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Next Link's compile-time flags are normally replaced by Next, not Vite.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  define: { "process.env": {} },
  server: { host: "127.0.0.1", port: 4190, strictPort: true, open: false },
});
