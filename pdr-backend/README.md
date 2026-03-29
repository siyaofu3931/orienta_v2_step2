# Orienta PDR backend

Pedestrian dead reckoning API used by the passenger **video page** (`/route_site/…`) via `pdr-sensor-bridge.js`: browser sends `sensor_frame` over WebSocket, this service returns `pose_update`.

## Why here instead of only in PDR_AIRCHINA?

The algorithm is the same as in `PDR_AIRCHINA/backend`; hosting it next to **orienta_v2_step2** means one checkout runs the Vite app and the PDR API together (e.g. `pdrBackend=local` → `/pdr-api` proxy). The standalone **PDR_AIRCHINA** app can still point its `PDR_BACKEND_URL` at this service if you run only one Python process.

## Run

```bash
cd orienta_v2_step2/pdr-backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

Default port **10000** (override with `PORT`). Matches Vite’s `PDR_API_PORT` / proxy default.

## Map matching

Optional corridor graph: `data/corridors.json` (see `tools/build_corridors_from_osm.py`). If missing or empty, PDR still runs; `map_match_ready` stays false until valid edges exist.
