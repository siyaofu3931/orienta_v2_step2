/**
 * Video page: phone IMU → PDR Python backend → map trajectory (OpenLayers / MapKit / Tencent).
 * Same-origin: /pdr-api (proxied to PDR_API_ORIGIN in production, or :10000 in Vite dev).
 * Override: ?pdrBackend=https://your-pdr-host.example.com
 * Optional: ?pdrMapMatch=1 — enable backend corridor map-matching (needs aligned corridors.json).
 */
(function () {
  var R_EARTH = 6378137;

  function apiRoot() {
    try {
      var b = new URLSearchParams(location.search).get("pdrBackend");
      if (b && String(b).trim()) return String(b).trim().replace(/\/$/, "");
    } catch (e) {}
    return "/pdr-api";
  }

  function wsBaseUrl() {
    var root = apiRoot();
    if (root.indexOf("http://") === 0) return "ws://" + root.slice("http://".length);
    if (root.indexOf("https://") === 0) return "wss://" + root.slice("https://".length);
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + root;
  }

  function metersToLngLat(anchor, x, y) {
    var lng0 = anchor[0];
    var lat0 = anchor[1];
    var lat1 = (lat0 * Math.PI) / 180;
    var dLat = (y / R_EARTH) * (180 / Math.PI);
    var dLng = (x / (R_EARTH * Math.cos(lat1))) * (180 / Math.PI);
    return [lng0 + dLng, lat0 + dLat];
  }

  function nearestPathIndex(path, lng, lat) {
    var bestI = 0;
    var bestD = Infinity;
    for (var i = 0; i < path.length; i++) {
      var dx = path[i][0] - lng;
      var dy = path[i][1] - lat;
      var d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    return bestI;
  }

  var st = {
    active: false,
    stopping: false,
    status: "",
    sessionId: null,
    socket: null,
    lastTrailMs: 0,
    lastOrientation: {},
    anchorLngLat: null,
    markerLngLat: null,
    trail: [],
    headingRad: null,
    rafId: null,
    mapMatch: false,
    motionHandler: null,
    orientHandler: null,
  };

  function setStatus(msg) {
    st.status = msg || "";
    var el = document.getElementById("pdrImuStatus");
    if (el) el.textContent = st.status;
  }

  function postTrajectoryToParent(lng, lat) {
    if (!window.parent || window.parent === window) return;
    var pid = "";
    try {
      pid = window.ROUTE_SITE_PASSENGER_ID || "";
    } catch (e) {}
    if (!pid) return;
    try {
      var pathPayload =
        st.trail.length >= 2
          ? st.trail.map(function (c) {
              return { lat: c[1], lng: c[0] };
            })
          : [{ lat: lat, lng: lng }];
      window.parent.postMessage(
        {
          type: "orienta-pax-trajectory",
          position: { lat: lat, lng: lng },
          path: pathPayload,
        },
        window.location.origin
      );
    } catch (e) {}
  }

  function buildMapSplit() {
    if (!st.active || !st.markerLngLat) return null;
    var path = window.PATH_LONLAT;
    if (!path || path.length < 2) return null;
    var coord = st.markerLngLat;
    var past = st.trail.length >= 2 ? st.trail.slice() : [[coord[0], coord[1]]];
    var last = past[past.length - 1];
    if (last[0] !== coord[0] || last[1] !== coord[1]) past.push(coord.slice());
    var bestI = nearestPathIndex(path, coord[0], coord[1]);
    var future = path.slice(bestI);
    if (future.length < 2) future = path.slice(Math.max(0, path.length - 2));
    var cNext = future.length >= 2 ? future[1] : coord;
    return {
      coord: coord,
      pastCoords: past,
      futureCoords: future,
      si: bestI,
      tt: 0,
      b: cNext,
      n: path.length,
      _pdrHeadingRad: st.headingRad,
    };
  }

  window.__ORIENTA_PDR__ = {
    active: false,
    buildMapSplit: buildMapSplit,
    getState: function () {
      return st;
    },
  };

  async function requestSensorPermissions() {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      var a = await DeviceMotionEvent.requestPermission();
      if (a !== "granted") return false;
    }
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      var b = await DeviceOrientationEvent.requestPermission();
      if (b !== "granted") return false;
    }
    return true;
  }

  function onOrientation(e) {
    st.lastOrientation = {
      alpha: e.alpha,
      beta: e.beta,
      gamma: e.gamma,
      absolute: e.absolute,
      webkitCompassHeading: e.webkitCompassHeading,
    };
  }

  function onMotion(e) {
    if (!st.socket || st.socket.readyState !== WebSocket.OPEN) return;
    var rot = e.rotationRate;
    try {
      st.socket.send(
        JSON.stringify({
          type: "sensor_frame",
          t_ms: Date.now(),
          acc_including_g: e.accelerationIncludingGravity || { x: 0, y: 0, z: 0 },
          rotation_rate: rot
            ? { alpha: rot.alpha, beta: rot.beta, gamma: rot.gamma }
            : { alpha: null, beta: null, gamma: null },
          orientation: st.lastOrientation || {},
          map_match_enabled: st.mapMatch,
        })
      );
    } catch (err) {}
  }

  function onSocketMessage(ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg.type !== "pose_update") return;
      if (!st.anchorLngLat) return;
      var pos = msg.position || {};
      var x = Number(pos.x);
      var y = Number(pos.y);
      if (!isFinite(x) || !isFinite(y)) return;
      var ll = metersToLngLat(st.anchorLngLat, x, y);
      st.markerLngLat = ll;
      var h = Number(msg.heading_deg);
      // Align with OpenLayers arrow (same convention as atan2(-dy,dx) on lon/lat path)
      if (isFinite(h)) st.headingRad = Math.PI / 2 - (h * Math.PI) / 180;
      var now = Date.now();
      if (st.trail.length === 0 || now - st.lastTrailMs > 250) {
        st.trail.push(ll.slice());
        st.lastTrailMs = now;
        if (st.trail.length > 800) st.trail.shift();
      }
      postTrajectoryToParent(ll[0], ll[1]);
    } catch (e) {}
  }

  async function startPdr() {
    if (st.active) return;
    var path = window.PATH_LONLAT;
    if (!path || path.length < 2) {
      setStatus("无 PATH_LONLAT，无法对齐地图");
      return;
    }
    try {
      var sp = new URLSearchParams(location.search);
      st.mapMatch = sp.get("pdrMapMatch") === "1" || sp.get("pdrMapMatch") === "true";
    } catch (e) {
      st.mapMatch = false;
    }

    var ok = await requestSensorPermissions();
    if (!ok) {
      setStatus("传感器权限被拒绝");
      return;
    }

    var root = apiRoot();
    var sessionUrl = root + "/api/session";
    setStatus("连接 PDR…");
    var res = await fetch(sessionUrl, { method: "POST", headers: { Accept: "application/json" } });
    if (!res.ok) {
      setStatus("创建会话失败 " + res.status);
      return;
    }
    var data = await res.json();
    var sid = data.session_id;
    if (!sid) {
      setStatus("无 session_id");
      return;
    }
    st.sessionId = sid;
    st.anchorLngLat = [path[0][0], path[0][1]];
    st.trail = [];
    st.lastTrailMs = 0;
    st.markerLngLat = st.anchorLngLat.slice();
    st.headingRad = null;

    var wsUrl = wsBaseUrl() + "/ws/pdr/" + encodeURIComponent(sid);
    var ws = new WebSocket(wsUrl);
    st.socket = ws;
    ws.onopen = function () {
      st.active = true;
      window.__ORIENTA_PDR__.active = true;
      setStatus("PDR 运行中 · 持手机行走");
      st.motionHandler = onMotion;
      st.orientHandler = onOrientation;
      window.addEventListener("devicemotion", onMotion, { passive: true });
      window.addEventListener("deviceorientation", onOrientation, { passive: true });
    };
    ws.onmessage = onSocketMessage;
    ws.onerror = function () {
      setStatus("WebSocket 错误");
    };
    ws.onclose = function () {
      st.active = false;
      window.__ORIENTA_PDR__.active = false;
      if (st.motionHandler) window.removeEventListener("devicemotion", st.motionHandler);
      if (st.orientHandler) window.removeEventListener("deviceorientation", st.orientHandler);
      st.motionHandler = null;
      st.orientHandler = null;
      if (!st.stopping) setStatus("PDR 已断开");
      st.stopping = false;
    };
  }

  function stopPdr() {
    st.stopping = true;
    if (st.socket) {
      try {
        st.socket.close();
      } catch (e) {}
    }
    st.socket = null;
    st.sessionId = null;
    st.active = false;
    window.__ORIENTA_PDR__.active = false;
    st.trail = [];
    st.markerLngLat = null;
    setStatus("");
  }

  function togglePdr() {
    if (st.active) stopPdr();
    else startPdr().catch(function (e) {
      setStatus("启动失败: " + (e && e.message ? e.message : String(e)));
    });
  }

  function bindUi() {
    var btn = document.getElementById("btnPdrImu");
    if (btn) btn.addEventListener("click", togglePdr);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUi);
  else bindUi();
})();
