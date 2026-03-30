# PDR Air China — backend (in monorepo)

Realtime pedestrian dead reckoning: **FastAPI** + **WebSocket** (`/ws/pdr/{session_id}`), `POST /api/session`, optional OSM tile proxy (`/api/tiles/...`).

The **video page** (`vite/public/route_site/`) uses **`orienta-pdr-client.js`**: phone IMU → this service → trajectory on the map. There is **no standalone HTML UI** in this folder.

## Run locally

```bash
cd pdr_airchina
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export PORT=10000
python3 run.py
```

From `vite/` dev server, `/pdr-api` proxies to `http://127.0.0.1:10000` (see `vite.config.ts`).

## Layout

| Path | Role |
|------|------|
| `run.py` | Uvicorn entry |
| `backend/app.py` | HTTP + WebSocket |
| `backend/engine.py` | PDR algorithm |
| `backend/data/corridors.json` | Corridor graph for map-matching (`?pdrMapMatch=1` on video page) |

## Render

Deploy as **`orienta-pdr`**. On the **orienta** Node service set **`PDR_API_ORIGIN`** to the public `https://…` URL of `orienta-pdr` so `/pdr-api` is proxied (see `vite/server.ts`).
