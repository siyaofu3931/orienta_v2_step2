import math
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple


def clamp(x: float, a: float, b: float) -> float:
    return max(a, min(b, x))


def wrap_deg(d: float) -> float:
    d = d % 360.0
    return d + 360.0 if d < 0 else d


def wrap_rad(r: float) -> float:
    while r <= -math.pi:
        r += 2 * math.pi
    while r > math.pi:
        r -= 2 * math.pi
    return r


@dataclass
class PdrConfig:
    min_period_ms: float = 250.0
    max_period_ms: float = 2000.0
    gravity_alpha: float = 0.92
    sig_smooth_alpha: float = 0.84
    dyn_win: int = 30
    thr_k: float = 1.6
    thr_min: float = 0.10
    k_weinberg: float = 0.45
    gyro_alpha_sign: float = -1.0
    map_match_max_snap_m: float = 7.0
    map_match_smooth_alpha: float = 0.35
    corridor_relpath: str = "data/corridors.json"


@dataclass
class PdrState:
    step_count: int = 0
    distance_m: float = 0.0
    heading_fused_deg: float = 0.0
    heading_gyro_rad: float = 0.0
    heading_mag_deg: Optional[float] = None
    mag_source_weight: float = 0.0
    mag_trust: float = 0.0
    x: float = 0.0
    y: float = 0.0
    step_length_m: float = 0.7
    last_motion_ms: Optional[float] = None
    last_step_time_ms: float = 0.0
    step_intervals: list = field(default_factory=list)
    gravity: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    lin: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    step_sig: float = 0.0
    sig_hist: list = field(default_factory=list)
    last_sig: float = 0.0
    rising: bool = False
    cur_step_max: float = -1e9
    cur_step_min: float = 1e9
    last_step_feature: float = 0.0
    recording_start_ms: float = 0.0
    turn_mode: bool = False
    turn_mode_until_ms: float = 0.0
    matched_x: float = 0.0
    matched_y: float = 0.0
    matched_confidence: float = 0.0
    current_edge_id: Optional[str] = None
    map_match_enabled: bool = False
    map_match_ready: bool = False


@dataclass
class CorridorEdge:
    edge_id: str
    points: List[Tuple[float, float]]


class CorridorMatcher:
    def __init__(self, corridor_file: Path, max_snap_m: float, smooth_alpha: float):
        self.max_snap_m = max_snap_m
        self.smooth_alpha = clamp(smooth_alpha, 0.0, 1.0)
        self.edges: List[CorridorEdge] = []
        self._load(corridor_file)

    @property
    def ready(self) -> bool:
        return len(self.edges) > 0

    def _load(self, corridor_file: Path) -> None:
        if not corridor_file.exists():
            return
        try:
            payload = json.loads(corridor_file.read_text(encoding="utf-8"))
            edges = payload.get("edges") or []
            for idx, e in enumerate(edges):
                pts_raw = e.get("points") or []
                pts: List[Tuple[float, float]] = []
                for p in pts_raw:
                    if isinstance(p, list) and len(p) >= 2:
                        x = float(p[0])
                        y = float(p[1])
                        if math.isfinite(x) and math.isfinite(y):
                            pts.append((x, y))
                if len(pts) >= 2:
                    edge_id = str(e.get("id") or f"edge_{idx}")
                    self.edges.append(CorridorEdge(edge_id=edge_id, points=pts))
        except Exception:
            self.edges = []

    def _project_point_to_segment(
        self, px: float, py: float, ax: float, ay: float, bx: float, by: float
    ) -> Tuple[float, float, float]:
        vx = bx - ax
        vy = by - ay
        vv = vx * vx + vy * vy
        if vv <= 1e-9:
            dx = px - ax
            dy = py - ay
            return ax, ay, math.sqrt(dx * dx + dy * dy)
        t = ((px - ax) * vx + (py - ay) * vy) / vv
        t = clamp(t, 0.0, 1.0)
        qx = ax + t * vx
        qy = ay + t * vy
        dx = px - qx
        dy = py - qy
        return qx, qy, math.sqrt(dx * dx + dy * dy)

    def snap(
        self, x: float, y: float, heading_deg: float, prev_edge_id: Optional[str]
    ) -> Tuple[float, float, float, Optional[str]]:
        if not self.ready:
            return x, y, 0.0, None

        best = None
        for edge in self.edges:
            pts = edge.points
            for i in range(1, len(pts)):
                ax, ay = pts[i - 1]
                bx, by = pts[i]
                qx, qy, dist = self._project_point_to_segment(x, y, ax, ay, bx, by)
                heading_seg = wrap_deg(math.degrees(math.atan2(bx - ax, by - ay)))
                heading_err = abs(wrap_deg(heading_deg - heading_seg))
                heading_err = min(heading_err, 360.0 - heading_err)
                score = dist + 0.02 * heading_err
                if prev_edge_id is not None and edge.edge_id != prev_edge_id:
                    score += 0.8
                if best is None or score < best[0]:
                    best = (score, dist, qx, qy, edge.edge_id)

        if best is None:
            return x, y, 0.0, None

        _, dist, qx, qy, edge_id = best
        if dist > self.max_snap_m:
            return x, y, 0.0, None
        confidence = clamp(1.0 - dist / max(self.max_snap_m, 1e-6), 0.0, 1.0)
        return qx, qy, confidence, edge_id


class PdrEngine:
    def __init__(self, config: Optional[PdrConfig] = None):
        self.cfg = config or PdrConfig()
        self.state = PdrState()
        corridor_file = Path(__file__).resolve().parents[1] / self.cfg.corridor_relpath
        self.matcher = CorridorMatcher(
            corridor_file=corridor_file,
            max_snap_m=self.cfg.map_match_max_snap_m,
            smooth_alpha=self.cfg.map_match_smooth_alpha,
        )

    def reset(self, t_ms: float) -> None:
        self.state = PdrState(recording_start_ms=t_ms)
        self.state.map_match_ready = self.matcher.ready

    def _dyn_stats(self, values: list) -> Tuple[float, float]:
        if not values:
            return 0.0, 0.0
        mean = sum(values) / len(values)
        if len(values) < 2:
            return mean, 0.0
        var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
        return mean, math.sqrt(var)

    def _cadence_hz(self) -> float:
        if len(self.state.step_intervals) < 2:
            return float("nan")
        avg = sum(self.state.step_intervals) / len(self.state.step_intervals)
        return 1000.0 / avg if avg > 1e-6 else float("nan")

    def _update_heading_mag(self, orientation: Dict) -> None:
        webkit = orientation.get("webkitCompassHeading")
        alpha = orientation.get("alpha")
        absolute = orientation.get("absolute")
        if isinstance(webkit, (int, float)) and math.isfinite(webkit):
            self.state.heading_mag_deg = float(webkit)
            self.state.mag_source_weight = 1.0
        elif absolute is True and isinstance(alpha, (int, float)) and math.isfinite(alpha):
            self.state.heading_mag_deg = float(alpha)
            self.state.mag_source_weight = 0.85
        elif isinstance(alpha, (int, float)) and math.isfinite(alpha):
            self.state.heading_mag_deg = float(alpha)
            self.state.mag_source_weight = 0.45

    def _update_turn_mode(self, yaw_rate_deg_s: float, t_ms: float) -> None:
        abs_rate = abs(yaw_rate_deg_s)
        if abs_rate >= 55.0:
            self.state.turn_mode = True
            self.state.turn_mode_until_ms = t_ms + 450.0
        elif self.state.turn_mode and abs_rate <= 30.0 and t_ms > self.state.turn_mode_until_ms:
            self.state.turn_mode = False

    def _update_heading(self, rot: Dict, t_ms: float) -> None:
        alpha = rot.get("alpha")
        if not isinstance(alpha, (int, float)) or not math.isfinite(alpha):
            return
        if self.state.last_motion_ms is None:
            self.state.last_motion_ms = t_ms
            if self.state.heading_mag_deg is not None:
                self.state.heading_gyro_rad = math.radians(wrap_deg(self.state.heading_mag_deg))
                self.state.heading_fused_deg = wrap_deg(self.state.heading_mag_deg)
            return
        dt = (t_ms - self.state.last_motion_ms) / 1000.0
        self.state.last_motion_ms = t_ms
        if dt <= 0.0 or dt > 0.2:
            return
        yaw_rate = self.cfg.gyro_alpha_sign * float(alpha)
        self._update_turn_mode(yaw_rate, t_ms)
        self.state.heading_gyro_rad = wrap_rad(self.state.heading_gyro_rad + math.radians(yaw_rate * dt))
        if self.state.heading_mag_deg is not None:
            mag_rad = math.radians(wrap_deg(self.state.heading_mag_deg))
            innov = wrap_rad(mag_rad - self.state.heading_gyro_rad)
            trust_raw = (1.0 - abs(innov) / math.radians(120.0)) * self.state.mag_source_weight
            self.state.mag_trust = clamp(
                trust_raw, 0.2 * self.state.mag_source_weight, self.state.mag_source_weight
            )
            base_gain = 0.14 if self.state.mag_source_weight >= 0.95 else 0.10
            turn_boost = 1.9 if self.state.turn_mode else 1.0
            self.state.heading_gyro_rad = wrap_rad(self.state.heading_gyro_rad + base_gain * turn_boost * innov)
        self.state.heading_fused_deg = wrap_deg(math.degrees(self.state.heading_gyro_rad))

    def _step_detect(self, acc_g: Dict, t_ms: float) -> bool:
        ax = float(acc_g.get("x", 0.0))
        ay = float(acc_g.get("y", 0.0))
        az = float(acc_g.get("z", 0.0))
        gx, gy, gz = self.state.gravity
        a = self.cfg.gravity_alpha
        gx = a * gx + (1 - a) * ax
        gy = a * gy + (1 - a) * ay
        gz = a * gz + (1 - a) * az
        self.state.gravity = (gx, gy, gz)
        norm = math.sqrt(gx * gx + gy * gy + gz * gz) or 1.0
        ux, uy, uz = gx / norm, gy / norm, gz / norm
        lx, ly, lz = ax - gx, ay - gy, az - gz
        self.state.lin = (lx, ly, lz)

        vertical = -(lx * ux + ly * uy + lz * uz)
        sig_raw = abs(vertical)
        s = self.cfg.sig_smooth_alpha
        self.state.step_sig = s * self.state.step_sig + (1 - s) * sig_raw
        self.state.cur_step_max = max(self.state.cur_step_max, self.state.step_sig)
        self.state.cur_step_min = min(self.state.cur_step_min, self.state.step_sig)

        self.state.sig_hist.append(self.state.step_sig)
        if len(self.state.sig_hist) > self.cfg.dyn_win:
            self.state.sig_hist.pop(0)
        mean, std = self._dyn_stats(self.state.sig_hist)
        warmup = (t_ms - self.state.recording_start_ms) < 2500.0
        thr_k = self.cfg.thr_k * 0.8 if warmup else self.cfg.thr_k
        min_period = max(180.0, self.cfg.min_period_ms - 40.0) if warmup else self.cfg.min_period_ms
        threshold = max(self.cfg.thr_min, mean + thr_k * std)
        is_peak = self.state.rising and (self.state.last_sig > self.state.step_sig) and (self.state.last_sig > threshold)
        dt = t_ms - self.state.last_step_time_ms
        is_first = self.state.last_step_time_ms == 0.0
        valid_interval = is_first or (min_period <= dt <= self.cfg.max_period_ms)

        self.state.rising = self.state.step_sig > self.state.last_sig
        self.state.last_sig = self.state.step_sig
        if not (is_peak and valid_interval):
            return False

        if not is_first:
            self.state.step_intervals.append(dt)
            if len(self.state.step_intervals) > 8:
                self.state.step_intervals.pop(0)
        self.state.last_step_time_ms = t_ms
        delta = max(0.0, self.state.cur_step_max - self.state.cur_step_min)
        self.state.last_step_feature = pow(max(delta, 1e-6), 0.25)
        cadence = self._cadence_hz()
        cadence_factor = 1.0 if math.isnan(cadence) else clamp(0.85 + 0.18 * (cadence - 1.6), 0.75, 1.15)
        raw_step_len = self.cfg.k_weinberg * self.state.last_step_feature * cadence_factor + 0.25
        self.state.step_length_m = clamp(raw_step_len, 0.35, 1.2) if math.isfinite(raw_step_len) else 0.7
        self.state.cur_step_max = -1e9
        self.state.cur_step_min = 1e9
        return True

    def process_frame(self, frame: Dict) -> Dict:
        t_ms = float(frame.get("t_ms") or 0.0)
        if t_ms <= 0:
            t_ms = 0.0
        self.state.map_match_enabled = bool(frame.get("map_match_enabled"))
        orientation = frame.get("orientation") or {}
        self._update_heading_mag(orientation)
        self._update_heading(frame.get("rotation_rate") or {}, t_ms)
        stepped = self._step_detect(frame.get("acc_including_g") or {}, t_ms)
        if stepped:
            h = math.radians(self.state.heading_fused_deg)
            self.state.x += self.state.step_length_m * math.sin(h)
            self.state.y += self.state.step_length_m * math.cos(h)
            self.state.distance_m += self.state.step_length_m
            self.state.step_count += 1

        self.state.map_match_ready = self.matcher.ready
        if self.state.map_match_enabled and self.matcher.ready:
            sx, sy, conf, edge_id = self.matcher.snap(
                x=self.state.x,
                y=self.state.y,
                heading_deg=self.state.heading_fused_deg,
                prev_edge_id=self.state.current_edge_id,
            )
            if self.state.matched_confidence <= 1e-6:
                self.state.matched_x = sx
                self.state.matched_y = sy
            else:
                a = self.cfg.map_match_smooth_alpha
                self.state.matched_x = (1.0 - a) * self.state.matched_x + a * sx
                self.state.matched_y = (1.0 - a) * self.state.matched_y + a * sy
            self.state.matched_confidence = conf
            self.state.current_edge_id = edge_id
        else:
            self.state.matched_x = self.state.x
            self.state.matched_y = self.state.y
            self.state.matched_confidence = 0.0
            self.state.current_edge_id = None

        display_x = self.state.x
        display_y = self.state.y
        if self.state.map_match_enabled and self.state.matched_confidence > 0.0:
            display_x = self.state.matched_x
            display_y = self.state.matched_y

        return {
            "type": "pose_update",
            "t_ms": t_ms,
            "step_count": self.state.step_count,
            "distance_m": self.state.distance_m,
            "heading_deg": self.state.heading_fused_deg,
            "position": {"x": display_x, "y": display_y},
            "raw_position": {"x": self.state.x, "y": self.state.y},
            "matched_position": {"x": self.state.matched_x, "y": self.state.matched_y},
            "map_match_enabled": self.state.map_match_enabled,
            "map_match_ready": self.state.map_match_ready,
            "map_match_confidence": self.state.matched_confidence,
            "map_match_edge_id": self.state.current_edge_id,
            "turn_mode": self.state.turn_mode,
            "step_signal": self.state.step_sig,
            "step_length_m": self.state.step_length_m,
            "stepped": stepped,
        }
