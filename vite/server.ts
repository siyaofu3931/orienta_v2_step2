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

/** PDR_API_ORIGIN must be the Python service root (e.g. https://orienta-pdr.onrender.com), not …/api — or proxy becomes /api/api/session → 404. */
function normalizePdrApiOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let u = raw.trim().replace(/\/+$/, "");
  if (/\/api$/i.test(u)) {
    u = u.replace(/\/api$/i, "").replace(/\/+$/, "");
    console.warn("PDR_API_ORIGIN had a trailing /api; use the service root only. Normalized to:", u);
  }
  return u || undefined;
}

const pdrOrigin = normalizePdrApiOrigin(process.env.PDR_API_ORIGIN);
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
  app.use("/pdr-api", (_req, res) => {
    res.status(503).json({
      error: "pdr_proxy_disabled",
      message:
        "未配置 PDR：在 orienta 进程上设置环境变量 PDR_API_ORIGIN 为 orienta-pdr 服务的公网根 URL（无尾部斜杠）。本地开发：在 pdr_airchina 启动 uvicorn 监听 10000，并用 vite dev（会代理 /pdr-api）。",
    });
  });
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
