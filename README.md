# Orienta · T3E International-to-International Transfer Control

**PoC: 30 I→I transfer passengers at Beijing Capital Airport T3E**

---

## Quick Start

```bash
cd vite
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

- Admin Dashboard: `http://localhost:5174/`
- Passenger Client: `http://<LAN-IP>:5174/pax?pid=TX1`

### Production (Render)

```bash
cd vite
npm run serve   # build + start
```

Deploy to [Render](https://render.com): connect repo, use `render.yaml` or set:
- **Build**: `cd vite && npm ci && npm run build`
- **Start**: `cd vite && npm run start`

**Mobile test (SIYAO FU / TX1)**:
- Admin (computer): `https://<your-app>.onrender.com/` → login admin/admin → select **PEK** or **SFO** → Map tab → select TX1
- Pax (phone):
  - **PEK T3E**: `https://<your-app>.onrender.com/pax?pid=TX1&direct=1` (default tenant=airchina)
  - **SFO**: `https://<your-app>.onrender.com/pax?pid=TX1&direct=1&tenant=airchina_sfo`

**Environment variables (Render)**:

| Variable | Purpose |
|----------|---------|
| `FLIGHTAWARE_API_KEY` | Flight lookup (UA889, etc.) on pax-flight page |
| `APPLE_TEAM_ID` | MapKit JS — Apple Maps (Team ID) |
| `APPLE_KEY_ID` | MapKit JS — Key ID |
| `APPLE_MAPS_ID` | MapKit JS — Maps Identifier |
| `APPLE_PRIVATE_KEY` | MapKit JS — Full PEM content of .p8 key (use `\n` for newlines) |

**MapKit 调试**：部署后访问 `https://你的应用.onrender.com/api/debug` 或 `/api/mapkit/debug` 可查看 origin、凭证是否就绪，以及是否需在 Apple Developer 添加 Allowed Origins。

---

## Four-Device Test Setup

| Device | URL | Passenger |
|--------|-----|-----------|
| 📱 Phone | `/pax?pid=TX1` | **TX1** · Premium · Urgent → London LHR |
| 📱 iPad 1 | `/pax?pid=TX2` | **TX2** · Premium · Tight → Frankfurt FRA |
| 📱 iPad 2 | `/pax?pid=P8` | **P8** · Free · **Location Lost** |
| 💻 Laptop | `/pax?pid=P6` | **P6** · Free · **Missed** Flight |

Admin Dashboard: `http://localhost:5174/` (login: admin/admin)

---

## 30 Passengers — I→I Design

### Premium (8 passengers — can transfer to human operator)
- **TX1** · James Wilson (GB) · Red/Urgent · CA901→CA837 LHR · Shopping (tight!)
- **TX2** · Sophie Chen (HK) · Yellow · CA856→CA783 FRA · Moving to gate
- **P3** · Anna Müller (DE) · Green · ♿ Wheelchair · Moving with assistance
- **P7** · Emily Johnson (US) · Green · At gate waiting to board
- **P11** · Isabella Romano (IT) · **Lost** · ♿ Location signal lost in south wing
- **P15** · Lena Novak (CZ) · Yellow · Dining — Final Call flight
- **P21** · Henrik Larsen (DK) · Green · Moving to gate
- **P27** · David Park (US) · **Offline** · No network

### Free (22 passengers — AI agent only)
- **P4** · Raj Patel (IN) · Green · Moving
- **P5** · Yuki Tanaka (JP) · Yellow · Shopping
- **P6** · Omar Al-Said (AE) · **Missed** · CA861→SIN already closed
- **P8** · Ivan Petrov (RU) · **Lost** · Last seen south corridor
- **P9**, **P10**, **P12**, **P17**, **P19**, **P23**, **P25**, **P29** · **Offline** (foreign SIMs/no data)
- **P14** · Carlos García (ES) · **Missed** · CA741→MNL already closed
- **P16** · Fatima Al-Rashid (SA) · Green · ♿ At gate with assistance
- **P18** · Aisha Okonkwo (NG) · Red · Dining during Final Call
- **P24** · Claudia Weber (DE) · **Lost** · North wing
- **P26** · Nadia Rousseau (FR) · **Lost** · Duty free area
- **P28** · Mei Lin (CN) · Green · Already **Boarded**
- **P30** · Anya Ivanova (UA) · **Missed** · Flight departed

### Risk Summary (Fixed Scenario)
| Status | Count |
|--------|-------|
| ✅ On Track | 7 |
| ⚠️ Tight | 3 |
| ⛔ At Risk | 2 |
| ❌ Missed | 3 |
| 📵 Offline | 9 |
| 📍 Lost | 4 |

---

## Real I→I Flights (PEK T3E)

**Inbound flights** (already arrived from international):
- CA836 ← London LHR
- CA856 ← Frankfurt FRA
- CA901 ← Tokyo NRT
- CA902 ← Seoul ICN
- CA921 ← Sydney SYD
- CA931 ← Los Angeles LAX
- CA841 ← Paris CDG
- CA861 ← Amsterdam AMS

**Outbound flights** (connecting international departures):
- CA783 → Frankfurt FRA (Gate E15, 55 min)
- CA837 → London LHR (Gate E19, 40 min — Boarding)
- CA781 → Paris CDG (Gate E22, 25 min — **Final Call**)
- CA831 → Amsterdam AMS (Gate E26, 70 min)
- CA903 → Tokyo NRT (Gate E12, 50 min)
- CA935 → Los Angeles LAX (Gate E08, 90 min)
- CA911 → Sydney SYD (Gate E05, 35 min)
- CA921 → Seoul ICN (Gate E30, 45 min)
- CA741 → Manila MNL (Gate E33 — **Closed/Missed**)
- CA861 → Singapore SIN (Gate E36 — **Closed/Missed**)

---

## WebSocket Protocol (v2)

### New message types

| Type | Direction | Description |
|------|-----------|-------------|
| `chat_send` | Admin↔Pax | Bidirectional chat message |
| `chat_fetch` | Both | Request history (returns `chat_history`) |
| `chat_history` | Server→Client | Last 20 messages |
| `loc_request` | Admin→Pax | Request passenger location report |

### Passenger reply kinds
- `kind=text` — normal message
- `kind=location` + `gateRef=E21` — location report

### Premium vs Free
- Free: server auto-appends AI agent reply
- Premium: no auto-reply; human operator types in Dashboard

---

## Dashboard Layout

### FIDS Panels (Flight Information Display)
- **Left**: International departures from PEK T3E (or SFO)
- **Right**: International arrivals at PEK T3E (or SFO)
- Dark blue airport-board style, 1-hour refresh to save API traffic
- **Data source**: Mock data by default. For real data, set `VITE_AVIATIONSTACK_KEY` in `.env` (free tier: 100 req/month at [aviationstack.com](https://aviationstack.com/signup/free))

### Tab 1: Transfer Control Dashboard
- **Risk aggregation**: Green / Yellow / Red / Missed / Offline / Lost
- **Priority list**: Lost / Urgent / Missed (auto-sorted)
- **All passengers table** with filters
- **Actions**: 💬 Chat, 📍 Request Location, 📨 Notify

### Tab 2: Map T3E
- All 30 passengers on T3E map
- Lost/Offline shown with grey/? marker
- Click passenger → right sidebar with PassengerCard
- Priority list in sidebar

---

## Passenger Frontend (/pax)
- **Flight card**: inbound/outbound flight, gate, ETA, urgency
- **Navigation**: 3-step I→I route (Security → Level 2 → Gate)
- **Live Map**: OSM map with route polyline and position marker
- **Chat**: bidirectional (Premium = operator; Free = AI agent)
- **Location reporting**: reply to operator's location request
- **Notification modal**: forced ack for push messages

---

## Apple MapKit (optional)

Set in `vite/.env.local`:
```
VITE_MAPKIT_TEAM_ID=...
VITE_MAPKIT_KEY_ID=...
VITE_MAPKIT_MAPS_ID=...
VITE_MAPKIT_ORIGIN=http://localhost:5174
VITE_MAPKIT_PRIVATE_KEY_PATH=./AuthKey_XXXXXX.p8
```
Without this, OSM/Leaflet is used automatically.
