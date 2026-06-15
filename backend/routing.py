import math
from typing import Any

from fastapi import HTTPException
import httpx

import config
from geo_utils import haversine_m


def perpendicular_waypoints(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
    offset_m: float = 350,
) -> tuple[tuple[float, float], tuple[float, float]]:
    """Return two points offset to either side of the start/end line."""
    mid_lat = (lat1 + lat2) / 2
    mid_lon = (lon1 + lon2) / 2

    dlat = lat2 - lat1
    dlon = lon2 - lon1
    mag = math.sqrt(dlat ** 2 + dlon ** 2)
    if mag < 1e-10:
        return (mid_lat, mid_lon), (mid_lat, mid_lon)

    dlat /= mag
    dlon /= mag

    plat = -dlon
    plon = dlat
    lat_m = 1 / 111_320.0
    lon_m = 1 / (111_320.0 * max(0.01, math.cos(math.radians(mid_lat))))

    left = (mid_lat + plat * offset_m * lat_m, mid_lon + plon * offset_m * lon_m)
    right = (mid_lat - plat * offset_m * lat_m, mid_lon - plon * offset_m * lon_m)
    return left, right


def via_waypoint_candidates(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> list[tuple[float, float]]:
    """Generate possible via-points used to request extra route alternatives."""
    direct_m = haversine_m(lat1, lon1, lat2, lon2)
    offsets = [
        max(80, min(direct_m * 0.20, 180)),
        max(140, min(direct_m * 0.35, 320)),
        max(220, min(direct_m * 0.55, 520)),
    ]

    candidates: list[tuple[float, float]] = []
    seen: set[tuple[float, float]] = set()
    for offset_m in offsets:
        for lat, lon in perpendicular_waypoints(lat1, lon1, lat2, lon2, offset_m):
            key = (round(lat, 6), round(lon, 6))
            if key not in seen:
                seen.add(key)
                candidates.append((lat, lon))
    return candidates


async def ors_route(
    client: httpx.AsyncClient,
    start_lonlat: str,
    end_lonlat: str,
    via_lonlat: str | None = None,
    silent: bool = False,
) -> list[dict]:
    """Call OpenRouteService and normalize its GeoJSON response."""
    if not config.ORS_API_KEY:
        if silent:
            return []
        raise HTTPException(status_code=503, detail="OpenRouteService API key is not configured")

    def parse_lonlat(value: str) -> list[float]:
        lon, lat = value.split(",", 1)
        return [float(lon), float(lat)]

    coordinates = [parse_lonlat(start_lonlat)]
    if via_lonlat:
        coordinates.append(parse_lonlat(via_lonlat))
    coordinates.append(parse_lonlat(end_lonlat))

    body: dict[str, Any] = {
        "coordinates": coordinates,
        "instructions": False,
        "preference": "recommended",
    }
    if via_lonlat is None:
        body["alternative_routes"] = {
            "target_count": 2,
            "weight_factor": 1.6,
            "share_factor": 0.6,
        }

    try:
        r = await client.post(
            "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
            json=body,
            headers={
                "Authorization": config.ORS_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json, application/geo+json",
            },
        )
    except httpx.RequestError as exc:
        if silent:
            return []
        raise HTTPException(status_code=502, detail=f"Could not reach routing server (OpenRouteService): {exc}")

    if r.status_code != 200:
        if silent:
            return []
        raise HTTPException(status_code=502, detail=f"OpenRouteService error {r.status_code}: {r.text[:300]}")

    routes = []
    for feature in r.json().get("features", []):
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        summary = properties.get("summary") or {}
        coordinates = geometry.get("coordinates")
        distance = summary.get("distance")
        duration = summary.get("duration")
        if geometry.get("type") != "LineString" or not coordinates or distance is None or duration is None:
            continue
        routes.append({
            "geometry": {"coordinates": coordinates},
            "distance": float(distance),
            "duration": float(duration),
            "provider": "openrouteservice",
        })

    return routes


async def routing_routes(
    client: httpx.AsyncClient,
    start_lonlat: str,
    end_lonlat: str,
    via_lonlat: str | None = None,
    silent: bool = False,
) -> list[dict]:
    """Routing provider wrapper kept separate so the API layer stays simple."""
    return await ors_route(client, start_lonlat, end_lonlat, via_lonlat, silent=silent)
