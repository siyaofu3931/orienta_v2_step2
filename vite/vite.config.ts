import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import react from "@vitejs/plugin-react";
import { attachWsHub } from "./wsHub";
import { registerApiRoutes } from "./apiRoutes";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const envDir = resolve(__dirname);
  Object.assign(process.env, loadEnv(mode, envDir, ""));

  return {
    plugins: [
      react(),
      {
        name: "orienta-dev-api",
        configureServer(server) {
          // Same /api + /flight routes as production (server.ts) — no proxy to Python :8000
          const apiApp = express();
          apiApp.use(express.json({ limit: "1mb" }));
          registerApiRoutes(apiApp);
          server.middlewares.use((req: any, res: any, next: () => void) => {
            const u = req.url || "";
            if (!u.startsWith("/api") && !u.startsWith("/flight")) return next();
            apiApp(req, res, next);
          });
          attachWsHub(server);
        },
      },
    ],
    server: {
      port: 5174,
      host: true,
      strictPort: true,
      allowedHosts: [".trycloudflare.com"],
    },
  };
});
