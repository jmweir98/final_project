import hashlib
import json
import math


def route_cache_key(points: list[list[float]]) -> str:
    rounded = [[round(lat, 6), round(lon, 6)] for lat, lon in points]
    payload = json.dumps(rounded, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    radius_m = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * radius_m * math.asin(math.sqrt(a))


def downsample(points: list[list[float]], max_points: int = 200) -> list[list[float]]:
    if len(points) <= max_points:
        return points
    if max_points < 2:
        return [points[0]]
    last_index = len(points) - 1
    indexes = [round(i * last_index / (max_points - 1)) for i in range(max_points)]
    return [points[i] for i in indexes]


def route_bbox(points: list[list[float]], margin_m: float = 30.0) -> tuple[float, float, float, float]:
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    avg_lat = sum(lats) / len(lats)
    lat_margin = margin_m / 111_320.0
    lon_margin = margin_m / (111_320.0 * max(0.1, math.cos(math.radians(avg_lat))))
    return (
        min(lats) - lat_margin,
        min(lons) - lon_margin,
        max(lats) + lat_margin,
        max(lons) + lon_margin,
    )


def route_bbox_diagonal_m(points: list[list[float]]) -> float:
    south, west, north, east = route_bbox(points, margin_m=0)
    return haversine_m(south, west, north, east)
