import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  define: { "process.env": {} },
  server: { host: "127.0.0.1", port: 4195, strictPort: true, open: false,
    watch: { ignored: ["**/.next/**", "**/out/**"] } },
});
