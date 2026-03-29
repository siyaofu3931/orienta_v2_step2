/**
 * Video page: phone IMU → PDR Python backend → map trajectory.
 * Does not use PATH_LONLAT. Anchor is required via URL (boarding gate / start WGS84):
 *   ?pdrOriginLat=…&pdrOriginLng=…   (aliases: ?pdrLat= & ?pdrLng=)
 * Same-origin: /pdr-api (proxied). Override: ?pdrBackend=https://…
 * Optional: ?pdrMapMatch=1 — backend corridor map-matching.
 */
(function () {
  var R_EARTH = 6378137;

  /** WGS84 [lng, lat] from query, or null */
  function pdrOriginFromQuery() {
    try {
      var sp = new URLSearchParams(location.search);
      var lat = parseFloat(sp.get("pdrOriginLat") || sp.get("pdrLat") || "");
      var lng = parseFloat(sp.get("pdrOriginLng") || sp.get("pdrLng") || "");
      if (isFinite(lat) && isFinite(lng)) return [lng, lat];
    } catch (e) {}
    return null;
  }

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
    mapMatch: false,
    motionHandler: null,
    orientHandler: null,
    motionEvents: 0,
    motionWarnTimer: null,
  };

  function clearMotionWarnTimer() {
    if (st.motionWarnTimer != null) {
      clearTimeout(st.motionWarnTimer);
      st.motionWarnTimer = null;
    }
  }

  /** off | connected (WS OK) | imu (devicemotion firing) */
  function setPdrButtonState(phase) {
    var btn = document.getElementById("btnPdrImu");
    if (!btn) return;
    btn.classList.remove("orienta-pdr-connected", "orienta-pdr-imu-live");
    if (phase === "connected" || phase === "imu") btn.classList.add("orienta-pdr-connected");
    if (phase === "imu") btn.classList.add("orienta-pdr-imu-live");
  }

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

  /** Map overlay: only PDR trail + marker (no planned polyline). */
  function buildMapSplit() {
    if (!st.active || !st.markerLngLat) return null;
    var coord = st.markerLngLat;
    var past = st.trail.length >= 2 ? st.trail.slice() : [[coord[0], coord[1]]];
    var last = past[past.length - 1];
    if (last[0] !== coord[0] || last[1] !== coord[1]) past.push(coord.slice());
    return {
      coord: coord,
      pastCoords: past,
      futureCoords: [coord, coord],
      si: 0,
      tt: 0,
      b: coord,
      n: 1,
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
    st.motionEvents++;
    if (st.motionEvents === 1) {
      clearMotionWarnTimer();
      setPdrButtonState("imu");
      setStatus("IMU 正常 · 传感器数据已进入");
    }
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
    var anchor = pdrOriginFromQuery();
    if (!anchor) {
      setStatus("请加 ?pdrOriginLat & ?pdrOriginLng（起点 WGS84）");
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
    setStatus("传感器权限已允许 · 连接服务器…");
    setPdrButtonState("off");

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
    st.anchorLngLat = anchor.slice();
    st.trail = [];
    st.lastTrailMs = 0;
    st.markerLngLat = st.anchorLngLat.slice();
    st.headingRad = null;
    st.motionEvents = 0;
    clearMotionWarnTimer();

    var wsUrl = wsBaseUrl() + "/ws/pdr/" + encodeURIComponent(sid);
    var ws = new WebSocket(wsUrl);
    st.socket = ws;
    ws.onopen = function () {
      st.active = true;
      window.__ORIENTA_PDR__.active = true;
      setPdrButtonState("connected");
      setStatus("已连接 · 等待运动数据（请稍晃手机）");
      st.motionHandler = onMotion;
      st.orientHandler = onOrientation;
      window.addEventListener("devicemotion", onMotion, { passive: true });
      window.addEventListener("deviceorientation", onOrientation, { passive: true });
      clearMotionWarnTimer();
      st.motionWarnTimer = setTimeout(function () {
        st.motionWarnTimer = null;
        if (st.active && st.motionEvents === 0) {
          setStatus("未收到 IMU · 请晃动手机或检查系统隐私设置");
        }
      }, 4000);
    };
    ws.onmessage = onSocketMessage;
    ws.onerror = function () {
      setStatus("WebSocket 错误");
      setPdrButtonState("off");
    };
    ws.onclose = function () {
      clearMotionWarnTimer();
      st.active = false;
      window.__ORIENTA_PDR__.active = false;
      st.motionEvents = 0;
      if (st.motionHandler) window.removeEventListener("devicemotion", st.motionHandler);
      if (st.orientHandler) window.removeEventListener("deviceorientation", st.orientHandler);
      st.motionHandler = null;
      st.orientHandler = null;
      setPdrButtonState("off");
      if (!st.stopping) setStatus("PDR 已断开");
      st.stopping = false;
    };
  }

  function stopPdr() {
    st.stopping = true;
    clearMotionWarnTimer();
    st.motionEvents = 0;
    setPdrButtonState("off");
    if (st.socket) {
      try {
        st.socket.close();
      } catch (e) {}
    }
    st.socket = null;
    st.sessionId = null;
    st.active = false;
    window.__ORIENTA_PDR__.active = false;
    if (st.motionHandler) window.removeEventListener("devicemotion", st.motionHandler);
    if (st.orientHandler) window.removeEventListener("deviceorientation", st.orientHandler);
    st.motionHandler = null;
    st.orientHandler = null;
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
