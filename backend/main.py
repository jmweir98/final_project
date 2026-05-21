from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx
import math
import hashlib
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any, List

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "routewise.db"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}


class LatLon(BaseModel):
    lat: float
    lon: float


class CompareRequest(BaseModel):
    start: LatLon
    end: LatLon


class EnrichRequest(BaseModel):
    geometry: List[List[float]]  # [[lat, lon], ...]
    distance_m: float | None = None
    elevation_metrics: dict[str, Any] | None = None


enrich_cache: dict[str, dict] = {}
geocode_cache: dict[str, list[dict[str, Any]]] = {}


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                venue_osm_id TEXT NOT NULL,
                venue_name TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                comment TEXT NOT NULL,
                accessibility_notes TEXT DEFAULT '',
                image_path TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()


init_db()


def route_cache_key(points: List[List[float]]) -> str:
    rounded = [[round(lat, 6), round(lon, 6)] for lat, lon in points]
    payload = json.dumps(rounded, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def review_row_to_dict(row):
    return {
        "id": row[0],
        "venue_osm_id": row[1],
        "venue_name": row[2],
        "rating": row[3],
        "comment": row[4],
        "accessibility_notes": row[5],
        "image_url": f"/uploads/{row[6]}" if row[6] else None,
        "created_at": row[7],
    }


def safe_upload_name(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"
    return f"{uuid.uuid4().hex}{suffix}"


async def geocode_address(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    cleaned_query = query.strip()
    if len(cleaned_query) < 3:
        raise HTTPException(status_code=400, detail="Search query must be at least 3 characters")

    cache_key = cleaned_query.lower()
    if cache_key in geocode_cache:
        return geocode_cache[cache_key]

    try:
        r = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": cleaned_query,
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": 5,
                "countrycodes": "gb,ie",
            },
            headers={"User-Agent": "accessible-route-planner/1.0"},
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Address search failed: {exc}") from exc

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Address search HTTP {r.status_code}: {r.text}")

    results = []
    for item in r.json():
        lat = item.get("lat")
        lon = item.get("lon")
        label = item.get("display_name")
        if lat is None or lon is None or not label:
            continue
        results.append({
            "label": label,
            "lat": float(lat),
            "lon": float(lon),
            "type": item.get("type"),
            "importance": item.get("importance"),
        })

    geocode_cache[cache_key] = results
    return results


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlmb/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def downsample(points: List[List[float]], max_points: int = 200) -> List[List[float]]:
    # points are [lat, lon]; always return at most max_points.
    if len(points) <= max_points:
        return points
    if max_points < 2:
        return [points[0]]
    last_index = len(points) - 1
    indexes = [
        round(i * last_index / (max_points - 1))
        for i in range(max_points)
    ]
    return [points[i] for i in indexes]

def build_elevation_profile(points: List[List[float]], elevations: List[float]):
    """
    points: [ [lat, lon], ... ] (downsampled)
    elevations: [ ... ] meters (same length)
    Returns a profile with cumulative distance so you can plot it.
    """
    profile = []
    cum = 0.0

    for i in range(len(points)):
        lat, lon = points[i]
        ele = float(elevations[i])

        if i > 0:
            lat0, lon0 = points[i-1]
            cum += haversine_m(lat0, lon0, lat, lon)

        profile.append({
            "i": i,
            "lat": lat,
            "lon": lon,
            "elev_m": round(ele, 1),
            "dist_m": round(cum, 1),
        })

    return profile

def nearest_profile_distance(profile: List[dict], lat: float, lon: float) -> float:
    best_d = 1e18
    best_dist = 0.0
    for pt in profile:
        d = haversine_m(lat, lon, pt["lat"], pt["lon"])
        if d < best_d:
            best_d = d
            best_dist = pt["dist_m"]
    return round(best_dist, 1)

async def get_elevations_open_meteo(client: httpx.AsyncClient, pts: List[List[float]]) -> List[float]:
    """
    pts: list of [lat, lon]
    returns: list of elevations (meters), same length
    """
    lats = ",".join(str(p[0]) for p in pts)
    lons = ",".join(str(p[1]) for p in pts)

    url = "https://api.open-meteo.com/v1/elevation"
    r = await client.get(url, params={"latitude": lats, "longitude": lons})
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Elevation API HTTP {r.status_code}: {r.text}")
    data = r.json()
    # Open-Meteo returns {"elevation":[...], ...}
    elev = data.get("elevation")
    if not isinstance(elev, list) or len(elev) != len(pts):
        raise HTTPException(status_code=502, detail=f"Unexpected elevation response: {data}")
    return elev

def compute_elevation_metrics(pts: List[List[float]], elev: List[float]):
    total_ascent = 0.0
    total_descent = 0.0
    max_slope_pct = 0.0

    steep_m_gt5 = 0.0
    steep_m_gt8 = 0.0

    for i in range(1, len(pts)):
        lat1, lon1 = pts[i-1]
        lat2, lon2 = pts[i]
        d = haversine_m(lat1, lon1, lat2, lon2)
        if d <= 5:  # ignore tiny segments
            continue

        dz = elev[i] - elev[i-1]  # meters
        if dz > 0:
            total_ascent += dz
        else:
            total_descent += abs(dz)

        slope_pct = abs(dz) / d * 100.0
        if slope_pct > max_slope_pct:
            max_slope_pct = slope_pct

        if slope_pct > 5:
            steep_m_gt5 += d
        if slope_pct > 8:
            steep_m_gt8 += d

    return {
        "ascent_m": round(total_ascent, 1),
        "descent_m": round(total_descent, 1),
        "max_slope_percent": round(max_slope_pct, 2),
        "steep_distance_m": {
            "gt5": round(steep_m_gt5, 1),
            "gt8": round(steep_m_gt8, 1),
        }
    }

def downsample_for_overpass(points: List[List[float]], max_points: int = 40) -> List[List[float]]:
    # More aggressive than elevation downsample to avoid Overpass overload
    return downsample(points, max_points=max_points)

def route_bbox(points: List[List[float]], margin_m: float = 30.0) -> tuple[float, float, float, float]:
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

def route_bbox_diagonal_m(points: List[List[float]]) -> float:
    south, west, north, east = route_bbox(points, margin_m=0)
    return haversine_m(south, west, north, east)


def perpendicular_waypoints(
    lat1: float, lon1: float,
    lat2: float, lon2: float,
    offset_m: float = 350,
) -> tuple[tuple[float, float], tuple[float, float]]:
    """
    Return two waypoints offset perpendicular to the A→B midpoint,
    one to each side, to force OSRM down different streets.
    """
    mid_lat = (lat1 + lat2) / 2
    mid_lon = (lon1 + lon2) / 2

    dlat = lat2 - lat1
    dlon = lon2 - lon1
    mag = math.sqrt(dlat ** 2 + dlon ** 2)
    if mag < 1e-10:
        return (mid_lat, mid_lon), (mid_lat, mid_lon)

    dlat /= mag
    dlon /= mag

    # Perpendicular direction (rotate 90°)
    plat = -dlon
    plon = dlat

    lat_m = 1 / 111_320.0
    lon_m = 1 / (111_320.0 * max(0.01, math.cos(math.radians(mid_lat))))

    left  = (mid_lat + plat * offset_m * lat_m,  mid_lon + plon * offset_m * lon_m)
    right = (mid_lat - plat * offset_m * lat_m,  mid_lon - plon * offset_m * lon_m)
    return left, right


async def osrm_route(
    client: httpx.AsyncClient,
    start_lonlat: str,
    end_lonlat: str,
    via_lonlat: str | None = None,
    silent: bool = False,
) -> list[dict]:
    """
    Return raw OSRM route dicts.
    If silent=True (used for optional via-waypoint calls), return [] on any failure.
    If silent=False (primary call), raise HTTPException with the real reason.
    """
    coord_str = (
        f"{start_lonlat};{via_lonlat};{end_lonlat}"
        if via_lonlat else
        f"{start_lonlat};{end_lonlat}"
    )
    url = f"https://router.project-osrm.org/route/v1/foot/{coord_str}"
    params: dict = {
        "geometries": "geojson",
        "overview": "full",
        "steps": "false",
    }
    if via_lonlat is None:
        params["alternatives"] = "true"

    try:
        r = await client.get(url, params=params)
    except httpx.RequestError as exc:
        if silent:
            return []
        raise HTTPException(status_code=502, detail=f"Could not reach routing server (OSRM): {exc}")

    if r.status_code != 200:
        if silent:
            return []
        raise HTTPException(status_code=502, detail=f"Routing server error {r.status_code}: {r.text[:300]}")

    data = r.json()
    if data.get("code") != "Ok":
        if silent:
            return []
        raise HTTPException(
            status_code=502,
            detail=f"OSRM returned code '{data.get('code')}': {data.get('message', 'no message')}",
        )

    return data.get("routes", [])

def build_overpass_poly_query(points: List[List[float]]) -> str:
    """
    Build a small corridor query around sampled route points.
    This is much faster than asking Overpass to evaluate the full route shape.
    """

    sampled = downsample(points, max_points=8)
    radius_m = 25
    highway_filter = '["highway"~"^(footway|path|pedestrian|steps|living_street|residential|service|unclassified)$"]'

    clauses = []
    if route_bbox_diagonal_m(points) <= 2_000:
        south, west, north, east = route_bbox(points)
        bbox = f"({south},{west},{north},{east})"
        clauses.extend([
            f"  way{bbox}{highway_filter};",
            f"  node{bbox}[kerb];",
            f"  node{bbox}[curb];",
            f"  node{bbox}[highway=crossing];",
            f"  node{bbox}[tactile_paving];",
        ])
    else:
        for lat, lon in sampled:
            around = f"(around:{radius_m},{lat},{lon})"
            clauses.extend([
                f"  way{around}{highway_filter};",
                f"  node{around}[kerb];",
                f"  node{around}[curb];",
                f"  node{around}[highway=crossing];",
                f"  node{around}[tactile_paving];",
            ])

    query = f"""
[out:json][timeout:10];
(
{chr(10).join(clauses)}
);
out tags geom;
"""
    return query.strip()

async def query_overpass_tags(client: httpx.AsyncClient, geometry_latlon: List[List[float]]):
    cache_key = route_cache_key(geometry_latlon)
    if cache_key in enrich_cache:
        return enrich_cache[cache_key]

    q = build_overpass_poly_query(geometry_latlon)

    url = "https://overpass-api.de/api/interpreter"

    try:
        r = await client.post(
            url,
            data={"data": q},
            headers={"User-Agent": "accessible-route-planner/1.0"},
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Overpass request failed: {exc}") from exc

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Overpass HTTP {r.status_code}: {r.text}")

    data = r.json()
    elements = data.get("elements", [])

    surfaces = {}
    smoothness = {}
    highway_types = {}
    sidewalk = {}
    wheelchair = {}
    inclines = {}
    steps_count = 0
    steps_ways = []

    kerb_nodes = 0
    crossing_nodes = 0
    tactile_nodes = 0

    total_way_count = 0
    known_surface_way_count = 0
    seen_nodes = set()
    seen_ways = set()

    def bump(d: dict, key: str):
        if not key:
            return
        d[key] = d.get(key, 0) + 1

    for el in elements:
        tags = el.get("tags", {}) or {}
        el_key = (el.get("type"), el.get("id"))
        if el_key in seen_nodes or el_key in seen_ways:
            continue

        if el.get("type") == "node":
            seen_nodes.add(el_key)
            if "kerb" in tags or "curb" in tags:
                kerb_nodes += 1
            if tags.get("highway") == "crossing":
                crossing_nodes += 1
            if "tactile_paving" in tags:
                tactile_nodes += 1
            continue

        if el.get("type") != "way":
            continue
        seen_ways.add(el_key)

        hw = tags.get("highway")
        if not hw:
            continue

        total_way_count += 1
        bump(highway_types, hw)

        if hw == "steps":
            steps_count += 1

            # Overpass returns geometry as [{"lat":..,"lon":..}, ...]
            geom = el.get("geometry") or []
            if geom:
                steps_ways.append({
                    "osm_id": el.get("id"),
                    "geometry": [[p["lat"], p["lon"]] for p in geom if "lat" in p and "lon" in p]
                })

        s = tags.get("surface")
        if s:
            bump(surfaces, s)
            known_surface_way_count += 1

        sm = tags.get("smoothness")
        if sm:
            bump(smoothness, sm)

        sw = tags.get("sidewalk")
        if sw:
            bump(sidewalk, sw)

        wc = tags.get("wheelchair")
        if wc:
            bump(wheelchair, wc)

        inc = tags.get("incline")
        if inc:
            bump(inclines, inc)

    unknown_surface_ratio = 0.0
    if total_way_count > 0:
        unknown_surface_ratio = round(1.0 - (known_surface_way_count / total_way_count), 2)

    summary = {
        "steps_count": steps_count,
        "steps_ways": steps_ways,
        "surfaces": surfaces,
        "smoothness": smoothness,
        "sidewalk": sidewalk,
        "highway_types": highway_types,
        "wheelchair_tags": wheelchair,
        "inclines": inclines,
        "unknown_surface_ratio": unknown_surface_ratio,
        "way_count_sampled": total_way_count,
        "sample_points_used": len(downsample(geometry_latlon, max_points=8)),
        "kerb_nodes_count": kerb_nodes,
        "crossing_nodes_count": crossing_nodes,
        "tactile_paving_nodes_count": tactile_nodes,
    }
    enrich_cache[cache_key] = summary
    return summary


async def query_nearby_venues(client: httpx.AsyncClient, lat: float, lon: float, radius_m: int = 300):
    radius_m = max(50, min(radius_m, 1000))
    query = f"""
[out:json][timeout:10];
(
  node(around:{radius_m},{lat},{lon})[name][~"^(amenity|shop|tourism|leisure|public_transport)$"~"."];
  way(around:{radius_m},{lat},{lon})[name][~"^(amenity|shop|tourism|leisure|public_transport)$"~"."];
);
out center tags 40;
"""
    try:
        r = await client.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": query.strip()},
            headers={"User-Agent": "accessible-route-planner/1.0"},
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Venue lookup failed: {exc}") from exc

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Overpass venue HTTP {r.status_code}: {r.text}")

    venues = []
    seen = set()
    for el in r.json().get("elements", []):
        tags = el.get("tags", {}) or {}
        center = el.get("center") or {}
        venue_lat = el.get("lat", center.get("lat"))
        venue_lon = el.get("lon", center.get("lon"))
        name = tags.get("name")
        if not name or venue_lat is None or venue_lon is None:
            continue

        osm_id = f"{el.get('type')}/{el.get('id')}"
        if osm_id in seen:
            continue
        seen.add(osm_id)

        category = (
            tags.get("amenity")
            or tags.get("shop")
            or tags.get("tourism")
            or tags.get("leisure")
            or tags.get("public_transport")
            or "venue"
        )

        venues.append({
            "osm_id": osm_id,
            "name": name,
            "lat": venue_lat,
            "lon": venue_lon,
            "category": category,
            "wheelchair": tags.get("wheelchair", "unknown"),
            "entrance": tags.get("entrance"),
            "tactile_paving": tags.get("tactile_paving"),
            "surface": tags.get("surface"),
            "tags": {
                key: value for key, value in tags.items()
                if key in {"wheelchair", "entrance", "tactile_paving", "surface", "addr:street", "addr:housenumber"}
            },
        })

    venues.sort(key=lambda venue: haversine_m(lat, lon, venue["lat"], venue["lon"]))
    return venues[:25]

def score_route(distance_m: float, elev: dict, osm: dict | None):
    """
    Lower = better (more accessible).
    Returns (score, flags, breakdown)
    """
    flags = []

    if osm is None:
        flags.append("OSM data not fetched (performance mode)")
        osm = {}
    elif len(osm) == 0:
        flags.append("OSM data fetched but no tags found")

    dist_km = distance_m / 1000.0
    ascent = elev["ascent_m"]
    steep8 = elev["steep_distance_m"]["gt8"]
    maxs = elev["max_slope_percent"]

    steps = osm.get("steps_count", 0)
    unknown_surface = osm.get("unknown_surface_ratio", 0.0)
    surfaces = osm.get("surfaces", {})

    distance_penalty = 0.8 * dist_km
    ascent_penalty = 0.12 * ascent
    steep_penalty = 0.03 * steep8
    max_slope_penalty = 0.15 * maxs
    steps_penalty = 0.0
    surface_penalty = 0.0
    uncertainty_penalty = 0.0

    score = distance_penalty + ascent_penalty + steep_penalty + max_slope_penalty

    # Hard penalty: steps
    if steps > 0:
        steps_penalty = 50.0
        score += steps_penalty
        flags.append(f"Contains steps ({steps})")

    # Surface penalties (very simple)
    bad_surfaces = {"gravel", "ground", "dirt", "mud", "sand", "unpaved", "cobblestone"}
    found_bad = [s for s in surfaces.keys() if s in bad_surfaces]
    if found_bad:
        surface_penalty = 5.0
        score += surface_penalty
        flags.append(f"Unpaved/rough surface: {', '.join(found_bad)}")

    # Uncertainty penalty (missing surface tags)
    if unknown_surface >= 0.3:
        uncertainty_penalty = 2.0
        score += uncertainty_penalty
        flags.append("Surface data incomplete")

    breakdown = {
        "distance_penalty": round(distance_penalty, 2),
        "ascent_penalty": round(ascent_penalty, 2),
        "steep_slope_penalty": round(steep_penalty, 2),
        "max_slope_penalty": round(max_slope_penalty, 2),
        "steps_penalty": round(steps_penalty, 2),
        "surface_penalty": round(surface_penalty, 2),
        "uncertainty_penalty": round(uncertainty_penalty, 2),
        "formula": "Lower is better: distance + ascent + steep slope + max slope + steps + rough surface + data uncertainty penalties.",
    }

    return round(score, 2), flags, breakdown


def _geometry_midpoint(geometry_latlon: List[List[float]]) -> tuple[float, float]:
    mid = geometry_latlon[len(geometry_latlon) // 2]
    return mid[0], mid[1]


def _is_duplicate(a: List[List[float]], b: List[List[float]], threshold_m: float = 80) -> bool:
    """True if the two routes are too similar to show as separate options."""
    ma = _geometry_midpoint(a)
    mb = _geometry_midpoint(b)
    return haversine_m(ma[0], ma[1], mb[0], mb[1]) < threshold_m


@app.post("/routes/compare")
async def compare_routes(payload: CompareRequest):
    start_lonlat = f"{payload.start.lon},{payload.start.lat}"
    end_lonlat   = f"{payload.end.lon},{payload.end.lat}"

    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:

        # ── 1. Primary OSRM request (asks for alternatives) ──────────────────
        raw_routes = await osrm_route(client, start_lonlat, end_lonlat)
        if not raw_routes:
            raise HTTPException(status_code=502, detail="OSRM returned no routes")

        # ── 2. If OSRM gave only one route, synthesise via-waypoint alternatives
        if len(raw_routes) < 2:
            lat1, lon1 = payload.start.lat, payload.start.lon
            lat2, lon2 = payload.end.lat,   payload.end.lon
            dist_direct = haversine_m(lat1, lon1, lat2, lon2)
            offset_m = max(200, min(dist_direct * 0.25, 600))

            left, right = perpendicular_waypoints(lat1, lon1, lat2, lon2, offset_m)
            for via_lat, via_lon in (left, right):
                via_lonlat = f"{via_lon},{via_lat}"
                extra = await osrm_route(client, start_lonlat, end_lonlat, via_lonlat, silent=True)
                if extra:
                    raw_routes.append(extra[0])

        # ── 3. Deduplicate ────────────────────────────────────────────────────
        unique_raw: list[dict] = []
        unique_geoms: list[List[List[float]]] = []
        for rt in raw_routes:
            coords = rt["geometry"]["coordinates"]
            geom = [[lat, lon] for lon, lat in coords]
            if any(_is_duplicate(geom, prev) for prev in unique_geoms):
                continue
            unique_raw.append(rt)
            unique_geoms.append(geom)

        # ── 4. Compute elevation & score for every unique route ───────────────
        routes_out = []
        for i, (rt, geometry_latlon) in enumerate(zip(unique_raw, unique_geoms)):
            geom = downsample(geometry_latlon, max_points=80)
            elev = await get_elevations_open_meteo(client, geom)
            elev_metrics = compute_elevation_metrics(geom, elev)
            elevation_profile = build_elevation_profile(geom, elev)
            score, flags, score_breakdown = score_route(rt["distance"], elev_metrics, None)

            routes_out.append({
                "id": f"route-{i + 1}",
                "geometry": geometry_latlon,
                "distance_m": rt["distance"],
                "duration_s": rt["duration"],
                "elevation_metrics": elev_metrics,
                "elevation_profile": elevation_profile,
                "osm_summary": None,
                "accessibility_score": score,
                "score_breakdown": score_breakdown,
                "flags": flags,
            })

    if not routes_out:
        raise HTTPException(status_code=502, detail="No routes found")

    routes_out.sort(key=lambda r: r["accessibility_score"])

    # ── 5. Enrich the best route with OSM tags ────────────────────────────────
    async with httpx.AsyncClient(timeout=25.0, verify=False) as client:
        try:
            best = routes_out[0]
            osm_summary = await query_overpass_tags(client, best["geometry"])
            best["osm_summary"] = osm_summary
            best_score, best_flags, best_breakdown = score_route(
                best["distance_m"], best["elevation_metrics"], osm_summary
            )
            best["accessibility_score"] = best_score
            best["score_breakdown"] = best_breakdown
            best["flags"] = best_flags

            step_warnings = []
            for sw in osm_summary.get("steps_ways", []):
                g = sw.get("geometry", [])
                if not g:
                    continue
                mid = g[len(g) // 2]
                dist_along = nearest_profile_distance(best["elevation_profile"], mid[0], mid[1])
                step_warnings.append({
                    "osm_id": sw.get("osm_id"),
                    "lat": mid[0],
                    "lon": mid[1],
                    "dist_m": dist_along,
                })
            best["step_warnings"] = step_warnings
            routes_out.sort(key=lambda r: r["accessibility_score"])
        except Exception:
            pass

    return {"routes": routes_out}


@app.post("/route/enrich")
async def enrich_route(payload: EnrichRequest):
    if not payload.geometry or len(payload.geometry) < 2:
        raise HTTPException(status_code=400, detail="geometry must have 2+ points")

    async with httpx.AsyncClient(timeout=25.0, verify=False) as client:
        osm_summary = await query_overpass_tags(client, payload.geometry)

    response = {"osm_summary": osm_summary}
    if payload.distance_m is not None and payload.elevation_metrics is not None:
        score, flags, score_breakdown = score_route(
            payload.distance_m,
            payload.elevation_metrics,
            osm_summary,
        )
        response.update({
            "accessibility_score": score,
            "score_breakdown": score_breakdown,
            "flags": flags,
        })

    return response


@app.get("/venues/nearby")
async def nearby_venues(lat: float, lon: float, radius_m: int = 300):
    async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
        venues = await query_nearby_venues(client, lat, lon, radius_m)
    return {"venues": venues}


@app.get("/geocode/search")
async def search_address(q: str):
    async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
        results = await geocode_address(client, q)
    return {"results": results}


@app.get("/venues/{venue_osm_id:path}/reviews")
def get_reviews(venue_osm_id: str):
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT id, venue_osm_id, venue_name, rating, comment, accessibility_notes, image_path, created_at
            FROM reviews
            WHERE venue_osm_id = ?
            ORDER BY datetime(created_at) DESC
            """,
            (venue_osm_id,),
        ).fetchall()
    return {"reviews": [review_row_to_dict(row) for row in rows]}


@app.post("/reviews")
async def create_review(
    venue_osm_id: str = Form(...),
    venue_name: str = Form(...),
    rating: int = Form(...),
    comment: str = Form(...),
    accessibility_notes: str = Form(""),
    image: UploadFile | None = File(None),
):
    if rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="rating must be between 1 and 5")
    if not comment.strip():
        raise HTTPException(status_code=400, detail="comment is required")

    image_name = None
    if image and image.filename:
        suffix = Path(image.filename).suffix.lower()
        if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
            raise HTTPException(status_code=400, detail="image must be a JPG, PNG, or WebP file")
        content = await image.read()
        if len(content) > 3_000_000:
            raise HTTPException(status_code=400, detail="image must be smaller than 3MB")
        image_name = safe_upload_name(image.filename)
        (UPLOAD_DIR / image_name).write_bytes(content)

    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            INSERT INTO reviews (venue_osm_id, venue_name, rating, comment, accessibility_notes, image_path)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                venue_osm_id,
                venue_name.strip(),
                rating,
                comment.strip(),
                accessibility_notes.strip(),
                image_name,
            ),
        )
        conn.commit()
        row = conn.execute(
            """
            SELECT id, venue_osm_id, venue_name, rating, comment, accessibility_notes, image_path, created_at
            FROM reviews
            WHERE id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()

    return {"review": review_row_to_dict(row)}
