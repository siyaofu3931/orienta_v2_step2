/**
 * Production server for Render deployment.
 * Serves static build + WebSocket + /api routes for flight/airport/gate.
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

// API routes (flight, airport, gate) — must be before static
registerApiRoutes(app);

const pdrOrigin = process.env.PDR_API_ORIGIN?.trim();
const pdrProxy =
  pdrOrigin &&
  createProxyMiddleware({
    target: pdrOrigin,
    changeOrigin: true,
    ws: true,
    pathRewrite: { "^/pdr-api": "" },
  });
if (pdrProxy) {
  app.use("/pdr-api", pdrProxy);
  console.log("PDR API proxy: /pdr-api ->", pdrOrigin);
} else {
  console.log("PDR API proxy: disabled (set PDR_API_ORIGIN to enable /pdr-api on this host)");
}

app.use(
  express.static(distDir, {
    setHeaders(res, filePath) {
      if (/\.mp4$/i.test(filePath)) res.setHeader("Content-Type", "video/mp4");
    },
  })
);
// SPA fallback: serve index.html only for non-API routes (never for /api/*)
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "not_found", path: req.path });
  // Missing static files must not return HTML (breaks <video> and confuses debugging)
  if (/\.(mp4|webm|m4v|mov|csv|png|jpg|jpeg|gif|svg|ico|woff2?)$/i.test(req.path)) {
    return res.status(404).type("text/plain").send("Not found");
  }
  res.sendFile(path.join(distDir, "index.html"));
});

const server = http.createServer(app);
if (pdrProxy) {
  server.on("upgrade", (req, socket, head) => {
    try {
      const pathname = new URL(req.url || "", "http://localhost").pathname;
      if (pathname.startsWith("/pdr-api")) {
        (pdrProxy as { upgrade?: (r: typeof req, s: typeof socket, h: typeof head) => void }).upgrade?.(
          req,
          socket,
          head
        );
      }
    } catch {
      /* ignore */
    }
  });
}
attachWsHub(server);

const PORT = Number(process.env.PORT) || 5174;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Orienta server listening on http://0.0.0.0:${PORT}`);
  console.log(`  Admin: http://localhost:${PORT}`);
  console.log(`  Pax (TX1): http://localhost:${PORT}/pax?pid=TX1&direct=1`);
});
