import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { attachWsHub } from "./wsHub";

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      {
        name: "orienta-dev-api",
        configureServer(server) {
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