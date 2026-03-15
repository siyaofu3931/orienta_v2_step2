import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { attachWsHub } from "./wsHub";
import { createFlightApiMiddleware } from "./flightApiMiddleware";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  // Load .env from vite/ into process.env so flight middleware can read API key
  const envDir = resolve(__dirname);
  Object.assign(process.env, loadEnv(mode, envDir, ""));

  return {
    plugins: [
      react(),
      {
        name: "orienta-dev-api",
        configureServer(server) {
          // Run flight API before proxy so /api/flight/closest works without backend on 8000
          const stack = server.middlewares.stack;
          const flightHandler = createFlightApiMiddleware();
          stack.unshift({
            route: "",
            handle: (req: any, res: any, next: () => void) => {
              flightHandler(req, res, next).catch((err) => {
                console.error("[orienta-dev-api] flight middleware error:", err);
                next();
              });
            },
          });
          attachWsHub(server);
        }
      }
    ],
    server: {
      port: 5174,
      host: true,
      strictPort: true,
      allowedHosts: [
        ".trycloudflare.com"
      ],
      proxy: {
        "/api": { target: "http://127.0.0.1:8000", changeOrigin: true, xfwd: true },
        "/gate_photo": { target: "http://127.0.0.1:8000", changeOrigin: true, xfwd: true },
        "/flight": { target: "http://127.0.0.1:8000", changeOrigin: true, xfwd: true },
      },
    }
  };
});