/**
 * Production server for Render deployment.
 * Serves static build + WebSocket for real-time chat & location.
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachWsHub } from "./wsHub";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");

const app = express();
app.use(express.static(distDir));
// SPA fallback: all non-file routes serve index.html
app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const server = http.createServer(app);
attachWsHub(server);

const PORT = Number(process.env.PORT) || 5174;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Orienta server listening on http://0.0.0.0:${PORT}`);
  console.log(`  Admin: http://localhost:${PORT}`);
  console.log(`  Pax (TX1): http://localhost:${PORT}/pax?pid=TX1&direct=1`);
});
