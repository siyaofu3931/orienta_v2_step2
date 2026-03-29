#!/usr/bin/env python3
"""
Build backend/data/corridors.json from OSM indoor ways (semi-automatic).

Example:
  python backend/tools/build_corridors_from_osm.py \
    --bbox 37.595,-122.405,37.635,-122.365 \
    --level 1 \
    --origin-lat 37.6164 \
    --origin-lon -122.3860 \
    --out backend/data/corridors.json \
    --raw-out backend/data/sfo_osm_raw.json
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


OVERPASS_URLS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)


@dataclass
class OSMWay:
    osm_id: int
    tags: Dict[str, str]
    points_latlon: List[Tuple[float, float]]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Extract OSM indoor corridors into local XY graph.")
    p.add_argument("--bbox", required=True, help="min_lat,min_lon,max_lat,max_lon")
    p.add_argument("--level", default="1", help="Indoor level to extract, e.g. 1 or 2")
    p.add_argument("--origin-lat", type=float, required=True, help="Local frame origin latitude")
    p.add_argument("--origin-lon", type=float, required=True, help="Local frame origin longitude")
    p.add_argument("--out", default="backend/data/corridors.json", help="Output corridors file")
    p.add_argument("--raw-out", default="", help="Optional raw OSM dump JSON path")
    p.add_argument("--min-edge-length-m", type=float, default=4.0, help="Drop edges shorter than this")
    p.add_argument("--min-point-spacing-m", type=float, default=1.0, help="Drop near-duplicate points")
    return p.parse_args()


def split_levels(level_str: str) -> List[str]:
    return [s.strip() for s in level_str.split(";") if s.strip()]


def has_level_match(tags: Dict[str, str], target_level: str) -> bool:
    lvl = tags.get("level")
    if not lvl:
        return False
    return target_level in split_levels(lvl)


def make_overpass_query(bbox: str) -> str:
    return f"""
[out:json][timeout:180];
(
  way["indoor"="corridor"]({bbox});
  way["highway"="footway"]["indoor"]({bbox});
  way["highway"="steps"]["indoor"]({bbox});
);
out tags geom;
"""


def fetch_overpass(query: str) -> Dict:
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    headers = {"User-Agent": "pdr-corridor-builder/1.0"}
    last_err: Optional[Exception] = None
    for url in OVERPASS_URLS:
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=220) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last_err = e
    if last_err is None:
        raise RuntimeError("No Overpass endpoint attempted")
    raise RuntimeError(f"Overpass query failed: {last_err}") from last_err


def extract_ways(payload: Dict, target_level: str) -> List[OSMWay]:
    ways: List[OSMWay] = []
    for e in payload.get("elements", []):
        if e.get("type") != "way":
            continue
        tags = e.get("tags") or {}
        if not has_level_match(tags, target_level):
            continue
        indoor = tags.get("indoor")
        highway = tags.get("highway")
        allowed = (
            indoor == "corridor"
            or (highway in {"footway", "steps"} and indoor in {"yes", "corridor", "area", "highway"})
        )
        if not allowed:
            continue
        geom = e.get("geometry") or []
        if len(geom) < 2:
            continue
        pts = [(float(g["lat"]), float(g["lon"])) for g in geom]
        ways.append(OSMWay(osm_id=int(e["id"]), tags=tags, points_latlon=pts))
    return ways


def latlon_to_xy(lat: float, lon: float, origin_lat: float, origin_lon: float) -> Tuple[float, float]:
    meters_per_deg_lat = 111320.0
    meters_per_deg_lon = 111320.0 * math.cos(math.radians(origin_lat))
    x = (lon - origin_lon) * meters_per_deg_lon
    y = (lat - origin_lat) * meters_per_deg_lat
    return x, y


def polyline_length(points_xy: Sequence[Tuple[float, float]]) -> float:
    total = 0.0
    for i in range(1, len(points_xy)):
        dx = points_xy[i][0] - points_xy[i - 1][0]
        dy = points_xy[i][1] - points_xy[i - 1][1]
        total += math.hypot(dx, dy)
    return total


def decimate_points(points_xy: Sequence[Tuple[float, float]], min_spacing_m: float) -> List[Tuple[float, float]]:
    if len(points_xy) <= 2:
        return list(points_xy)
    out = [points_xy[0]]
    for p in points_xy[1:-1]:
        dx = p[0] - out[-1][0]
        dy = p[1] - out[-1][1]
        if math.hypot(dx, dy) >= min_spacing_m:
            out.append(p)
    out.append(points_xy[-1])
    return out


def build_corridors(
    ways: Iterable[OSMWay],
    origin_lat: float,
    origin_lon: float,
    min_edge_len_m: float,
    min_point_spacing_m: float,
) -> Dict:
    edges = []
    for w in ways:
        pts_xy = [latlon_to_xy(lat, lon, origin_lat, origin_lon) for lat, lon in w.points_latlon]
        pts_xy = decimate_points(pts_xy, min_point_spacing_m)
        length_m = polyline_length(pts_xy)
        if length_m < min_edge_len_m:
            continue
        edge_id = f"osm_way_{w.osm_id}"
        edges.append(
            {
                "id": edge_id,
                "points": [[round(x, 3), round(y, 3)] for x, y in pts_xy],
                "meta": {
                    "source": "osm",
                    "osm_way_id": w.osm_id,
                    "level": w.tags.get("level"),
                    "highway": w.tags.get("highway"),
                    "indoor": w.tags.get("indoor"),
                    "length_m": round(length_m, 2),
                },
            }
        )
    return {"edges": edges}


def main() -> None:
    args = parse_args()
    query = make_overpass_query(args.bbox)
    payload = fetch_overpass(query)
    ways = extract_ways(payload, target_level=args.level)
    corridors = build_corridors(
        ways=ways,
        origin_lat=args.origin_lat,
        origin_lon=args.origin_lon,
        min_edge_len_m=args.min_edge_length_m,
        min_point_spacing_m=args.min_point_spacing_m,
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(corridors, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.raw_out:
        raw_path = Path(args.raw_out)
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    print(f"Ways selected: {len(ways)}")
    print(f"Edges exported: {len(corridors['edges'])}")
    print(f"Wrote: {out_path}")
    if args.raw_out:
        print(f"Wrote raw OSM: {args.raw_out}")


if __name__ == "__main__":
    main()
