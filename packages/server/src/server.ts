import { createApp } from "./app.js";
import { checkConfig } from "./services/config-check/config-check.js";

const port = 3001;
// Loopback-only per architecture.md §11.2 — never expose to other hosts.
const host = "127.0.0.1";
// The Vite dev server (packages/web/vite.config.ts, strictPort) proxies
// /api here without changeOrigin, so its own Host (port 5173) arrives as-is.
const viteDevServerPort = 5173;

const configStatus = checkConfig();
if (configStatus.warnings.length > 0) {
  console.warn("Configuration warnings (see GET /api/config/status for fix steps):");
  for (const warning of configStatus.warnings) {
    console.warn(`  [${warning.code}] ${warning.message}`);
  }
}

createApp({ allowedHostPorts: [port, viteDevServerPort] }).listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
