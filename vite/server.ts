/**
 * Production server for Render deployment.
 * Serves static build + WebSocket + /api routes for flight/airport/gate.
 * Optional: proxy /pdr-api → PDR_API_ORIGIN (Python PDR service).
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { attachWsHub } from "./wsHub";
import { registerApiRoutes } from "./apiRoutes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");

const app = express();
app.use(express.json());

registerApiRoutes(app);

const pdrTarget = (process.env.PDR_API_ORIGIN || "").trim().replace(/\/$/, "");
let pdrProxy: ReturnType<typeof createProxyMiddleware> | null = null;
if (pdrTarget) {
  pdrProxy = createProxyMiddleware({
    target: pdrTarget,
    changeOrigin: true,
    pathRewrite: { "^/pdr-api": "" },
    ws: true,
  });
  app.use("/pdr-api", pdrProxy);
}

app.use(
  express.static(distDir, {
    setHeaders(res, filePath) {
      if (/\.mp4$/i.test(filePath)) res.setHeader("Content-Type", "video/mp4");
    },
  })
);
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "not_found", path: req.path });
  res.sendFile(path.join(distDir, "index.html"));
});

const server = http.createServer(app);

if (pdrProxy) {
  server.on("upgrade", (req, socket, head) => {
    try {
      const pathname = new URL(req.url || "", "http://localhost").pathname;
      if (pathname.startsWith("/pdr-api")) {
        pdrProxy.upgrade(req, socket, head);
      }
    } catch {
      /* wsHub handles /ws */
    }
  });
}

attachWsHub(server);

const PORT = Number(process.env.PORT) || 5174;
server.listen(PORT, "0.0.0.0", () => {
  const publicBase = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || "")
    .replace(/\/$/, "");
  console.log(`Orienta server listening on 0.0.0.0:${PORT}`);
  if (pdrTarget) {
    console.log(`  PDR proxy: /pdr-api → ${pdrTarget}`);
  } else {
    console.log(`  PDR proxy: disabled (set PDR_API_ORIGIN for /pdr-api)`);
  }
  if (publicBase) {
    console.log(`  Public URL: ${publicBase}`);
    console.log(`  Pax (TX1): ${publicBase}/pax?pid=TX1&direct=1`);
  } else {
    console.log(`  Local: http://localhost:${PORT}`);
    console.log(`  Pax (TX1): http://localhost:${PORT}/pax?pid=TX1&direct=1`);
  }
});
