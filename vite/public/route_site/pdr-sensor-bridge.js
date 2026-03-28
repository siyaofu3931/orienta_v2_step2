/**
 * Bridges device IMU (DeviceMotion / DeviceOrientation) to PDR_AIRCHINA FastAPI
 * (/api/session + /ws/pdr/{id}) and reports lat/lng trajectory for Orienta route_site.
 * Same wire protocol as PDR_AIRCHINA/index.html (sensor_frame → pose_update).
 */
(function (global) {
  "use strict";

  function toWsUrl(httpBase, path) {
    var url = new URL(path, httpBase.endsWith("/") ? httpBase : httpBase + "/");
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  function OrientaRouteSitePdr(opts) {
    opts = opts || {};
    this.getBackendBase = opts.getBackendBase || function () {
      if (typeof global.PDR_BACKEND_URL === "string" && global.PDR_BACKEND_URL.trim())
        return String(global.PDR_BACKEND_URL).replace(/\/+$/, "");
      return "";
    };
    this.getMapOrigin = opts.getMapOrigin || function () {
      return { lat: 40.077, lng: 116.606 };
    };
    this.mapMatchEnabled = !!opts.mapMatchEnabled;
    this.onStatus = typeof opts.onStatus === "function" ? opts.onStatus : function () {};
    this.onTrajectory = typeof opts.onTrajectory === "function" ? opts.onTrajectory : function () {};

    this.recording = false;
    this.pdrSessionId = null;
    this.socket = null;
    this.socketOpen = false;
    this.reconnectScheduled = false;
    this.lastOrientation = null;
    this.stepCount = 0;
    this.trajectory = { path: [{ x: 0, y: 0 }], x: 0, y: 0, headingDeg: null };
    this.headingFusedDeg = null;
    this.totalDistanceM = 0;

    this._onMotion = this._onMotion.bind(this);
    this._onOrientation = this._onOrientation.bind(this);
  }

  OrientaRouteSitePdr.prototype._backend = function () {
    return this.getBackendBase() || "";
  };

  OrientaRouteSitePdr.prototype._createSession = function () {
    var base = this._backend();
    return fetch(base + "/api/session", { method: "POST" }).then(function (r) {
      if (!r.ok) throw new Error("session " + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || !data.session_id) throw new Error("bad session");
      return data.session_id;
    });
  };

  OrientaRouteSitePdr.prototype._closeSocket = function () {
    if (this.socket) {
      this.socketOpen = false;
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
  };

  OrientaRouteSitePdr.prototype._connectSocket = function (sessionId) {
    var self = this;
    var base = this._backend();
    return new Promise(function (resolve, reject) {
      var wsUrl = toWsUrl(base, "/ws/pdr/" + encodeURIComponent(sessionId));
      var socket = new WebSocket(wsUrl);
      var t = setTimeout(function () {
        try {
          socket.close();
        } catch (e) {}
        reject(new Error("ws timeout"));
      }, 8000);
      socket.onopen = function () {
        self.socket = socket;
        self.socketOpen = true;
        clearTimeout(t);
        resolve();
      };
      socket.onmessage = function (evt) {
        var msg;
        try {
          msg = JSON.parse(evt.data);
        } catch (e) {
          return;
        }
        if (msg.type === "pose_update") self._applyPose(msg);
      };
      socket.onerror = function () {
        reject(new Error("ws error"));
      };
      socket.onclose = function () {
        self.socket = null;
        self.socketOpen = false;
        if (self.recording && self.pdrSessionId && !self.reconnectScheduled) {
          self.reconnectScheduled = true;
          self.onStatus("PDR 连接断开，重连中…", "warn");
          setTimeout(function () {
            self.reconnectScheduled = false;
            if (!self.recording || !self.pdrSessionId) return;
            self._connectSocket(self.pdrSessionId).then(function () {
              self.onStatus("PDR 已重连", "ok");
            }).catch(function () {
              self.onStatus("PDR 重连失败", "err");
            });
          }, 2500);
        }
      };
    });
  };

  OrientaRouteSitePdr.prototype._applyPose = function (pose) {
    if (!pose || pose.type !== "pose_update") return;
    var oldStepCount = this.stepCount;
    this.stepCount = Number(pose.step_count || 0);
    this.totalDistanceM = Number(pose.distance_m || 0);
    this.headingFusedDeg = pose.heading_deg != null ? Number(pose.heading_deg) : null;
    this.trajectory.headingDeg = this.headingFusedDeg;
    if (pose.position && Number.isFinite(Number(pose.position.x)) && Number.isFinite(Number(pose.position.y))) {
      this.trajectory.x = Number(pose.position.x);
      this.trajectory.y = Number(pose.position.y);
    }
    var gained = Math.max(0, this.stepCount - oldStepCount);
    var i;
    for (i = 0; i < gained; i++) {
      this.trajectory.path.push({ x: this.trajectory.x, y: this.trajectory.y });
    }
    this._emitTrajectory();
  };

  OrientaRouteSitePdr.prototype._emitTrajectory = function () {
    var o = this.getMapOrigin();
    var METERS_PER_DEG_LAT = 111320;
    function m2ll(xM, yM) {
      var lat = o.lat + yM / METERS_PER_DEG_LAT;
      var lng = o.lng + xM / (METERS_PER_DEG_LAT * Math.cos((o.lat * Math.PI) / 180));
      return { lat: lat, lng: lng };
    }
    var pts = this.trajectory.path;
    var path = pts.map(function (p) {
      return m2ll(p.x, p.y);
    });
    var cur = m2ll(this.trajectory.x, this.trajectory.y);
    this.onTrajectory({
      position: { lat: cur.lat, lng: cur.lng },
      path: path,
      stepCount: this.stepCount,
      distanceM: this.totalDistanceM,
      headingDeg: this.headingFusedDeg,
    });
  };

  OrientaRouteSitePdr.prototype._onMotion = function (e) {
    if (!this.recording || !this.socket || !this.socketOpen) return;
    var rot = e.rotationRate || {};
    try {
      this.socket.send(
        JSON.stringify({
          type: "sensor_frame",
          t_ms: Date.now(),
          acc_including_g: e.accelerationIncludingGravity || { x: 0, y: 0, z: 0 },
          rotation_rate: rot
            ? { alpha: rot.alpha, beta: rot.beta, gamma: rot.gamma }
            : { alpha: null, beta: null, gamma: null },
          orientation: this.lastOrientation || {},
          map_match_enabled: this.mapMatchEnabled,
        })
      );
    } catch (err) {}
  };

  OrientaRouteSitePdr.prototype._onOrientation = function (e) {
    this.lastOrientation = {
      alpha: e.alpha,
      beta: e.beta,
      gamma: e.gamma,
      absolute: e.absolute,
      webkitCompassHeading: e.webkitCompassHeading,
    };
  };

  OrientaRouteSitePdr.prototype.requestPermission = async function () {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      var pm = await DeviceMotionEvent.requestPermission();
      if (pm !== "granted") return false;
    }
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      var po = await DeviceOrientationEvent.requestPermission();
      if (po !== "granted") return false;
    }
    return true;
  };

  OrientaRouteSitePdr.prototype.start = async function () {
    var base = this._backend();
    if (!base) {
      this.onStatus("未配置 PDR 后端地址 (?pdrBackend=)", "err");
      return false;
    }
    var ok = await this.requestPermission();
    if (!ok) {
      this.onStatus("需要运动与方向传感器权限", "err");
      return false;
    }
    try {
      this.pdrSessionId = await this._createSession();
      await this._connectSocket(this.pdrSessionId);
    } catch (err) {
      this.onStatus("PDR 后端不可用: " + (err && err.message ? err.message : String(err)), "err");
      return false;
    }
    this.trajectory = { path: [{ x: 0, y: 0 }], x: 0, y: 0, headingDeg: null };
    this.stepCount = 0;
    this.headingFusedDeg = null;
    this.totalDistanceM = 0;
    this.recording = true;
    global.addEventListener("devicemotion", this._onMotion, { passive: true });
    global.addEventListener("deviceorientation", this._onOrientation, { passive: true });
    this._emitTrajectory();
    this.onStatus("IMU 定位中", "ok");
    return true;
  };

  OrientaRouteSitePdr.prototype.stop = function () {
    this.recording = false;
    global.removeEventListener("devicemotion", this._onMotion);
    global.removeEventListener("deviceorientation", this._onOrientation);
    this._closeSocket();
    this.pdrSessionId = null;
    this.reconnectScheduled = false;
    this.onStatus("", "");
  };

  OrientaRouteSitePdr.prototype.resetRemote = function () {
    if (this.socket && this.socketOpen) {
      try {
        this.socket.send(JSON.stringify({ type: "reset", t_ms: Date.now() }));
      } catch (e) {}
    }
    this.trajectory = { path: [{ x: 0, y: 0 }], x: 0, y: 0, headingDeg: this.trajectory.headingDeg };
    this.stepCount = 0;
    this.totalDistanceM = 0;
    this._emitTrajectory();
  };

  global.OrientaRouteSitePdr = OrientaRouteSitePdr;
})(typeof window !== "undefined" ? window : globalThis);
