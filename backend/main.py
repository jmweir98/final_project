from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import math
from typing import List, Tuple

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlmb/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def downsample(points: List[List[float]], max_points: int = 200) -> List[List[float]]:
    # points are [lat, lon]
    if len(points) <= max_points:
        return points
    step = max(1, len(points) // max_points)
    sampled = points[::step]
    if sampled[-1] != points[-1]:
        sampled.append(points[-1])
    return sampled

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

def build_overpass_poly_query(points: List[List[float]]) -> str:
    """
    Build a polyline-based Overpass query.
    Overpass expects: lat lon lat lon lat lon ...
    """

    # Downsample heavily so query string is not enormous
    sampled = downsample(points, max_points=20)

    coord_string = " ".join(f"{lat} {lon}" for lat, lon in sampled)

    query = f"""
[out:json][timeout:25];
(
  way(poly:"{coord_string}")[highway~"^(footway|path|pedestrian|steps|living_street|residential|service|unclassified)$"];
  node(poly:"{coord_string}")[kerb];
  node(poly:"{coord_string}")[curb];
  node(poly:"{coord_string}")[highway=crossing];
  node(poly:"{coord_string}")[tactile_paving];
);
out tags geom;
"""
    return query.strip()

async def query_overpass_tags(client: httpx.AsyncClient, geometry_latlon: List[List[float]]):

    q = build_overpass_poly_query(geometry_latlon)

    url = "https://overpass-api.de/api/interpreter"

    r = await client.post(
        url,
        content=q,
        headers={"Content-Type": "text/plain"},
    )

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

    def bump(d: dict, key: str):
        if not key:
            return
        d[key] = d.get(key, 0) + 1

    for el in elements:
        tags = el.get("tags", {}) or {}

        if el.get("type") == "node":
            if "kerb" in tags or "curb" in tags:
                kerb_nodes += 1
            if tags.get("highway") == "crossing":
                crossing_nodes += 1
            if "tactile_paving" in tags:
                tactile_nodes += 1
            continue

        if el.get("type") != "way":
            continue

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

    return {
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
        "kerb_nodes_count": kerb_nodes,
        "crossing_nodes_count": crossing_nodes,
        "tactile_paving_nodes_count": tactile_nodes,
    }

def score_route(distance_m: float, elev: dict, osm: dict | None):
    """
    Lower = better (more accessible).
    Returns (score, flags)
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

    # Base score: distance + slope effort
    score = 0.8 * dist_km + 0.12 * ascent + 0.03 * steep8 + 0.15 * maxs

    # Hard penalty: steps
    if steps > 0:
        score += 50  # make this dominate
        flags.append(f"Contains steps ({steps})")

    # Surface penalties (very simple)
    bad_surfaces = {"gravel", "ground", "dirt", "mud", "sand", "unpaved", "cobblestone"}
    found_bad = [s for s in surfaces.keys() if s in bad_surfaces]
    if found_bad:
        score += 5
        flags.append(f"Unpaved/rough surface: {', '.join(found_bad)}")

    # Uncertainty penalty (missing surface tags)
    if unknown_surface >= 0.3:
        score += 2
        flags.append("Surface data incomplete")

    return round(score, 2), flags


@app.post("/routes/compare")
async def compare_routes(payload: CompareRequest):
    start_lonlat = f"{payload.start.lon},{payload.start.lat}"
    end_lonlat = f"{payload.end.lon},{payload.end.lat}"

    routes_out = []
    
    async with httpx.AsyncClient(timeout=25.0, verify=False) as client:
        url = f"https://router.project-osrm.org/route/v1/foot/{start_lonlat};{end_lonlat}"
        params = {
            "alternatives": "true",
            "geometries": "geojson",
            "overview": "full",
            "steps": "false",
        }

        r = await client.get(url, params=params)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"OSRM HTTP {r.status_code}: {r.text}")

        data = r.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            raise HTTPException(status_code=502, detail=f"OSRM returned no routes: {data}")

        for i, rt in enumerate(data["routes"]):
            coords_lonlat = rt["geometry"]["coordinates"]
            geometry_latlon = [[lat, lon] for lon, lat in coords_lonlat]

            geom = downsample(geometry_latlon, max_points=80)
            elev = await get_elevations_open_meteo(client, geom)
            elev_metrics = compute_elevation_metrics(geom, elev)
            elevation_profile = build_elevation_profile(geom, elev)
            osm_summary = None
            score, flags = score_route(rt["distance"], elev_metrics, None)

            routes_out.append({
                "id": f"route-{i+1}",
                "geometry": geometry_latlon,
                "distance_m": rt["distance"],
                "duration_s": rt["duration"],
                "elevation_metrics": elev_metrics,
                "elevation_profile": elevation_profile,
                "osm_summary": osm_summary,
                "accessibility_score": score,
                "flags": flags,
            })

    if not routes_out:
        raise HTTPException(status_code=502, detail="No routes found")

    routes_out.sort(key=lambda r: r["accessibility_score"])

    # Enrich ONLY the best route with OSM tags
    async with httpx.AsyncClient(timeout=25.0, verify=False) as client:
        try:
            best = routes_out[0]
            osm_summary = await query_overpass_tags(client, best["geometry"])
            best["osm_summary"] = osm_summary
            best_score, best_flags = score_route(best["distance_m"], best["elevation_metrics"], osm_summary)
            best["accessibility_score"] = best_score
            best["flags"] = best_flags

            # Compute step warnings
            step_warnings = []
            for sw in osm_summary.get("steps_ways", []):
                g = sw.get("geometry", [])
                if not g:
                    continue
                mid = g[len(g)//2]  # midpoint of the steps polyline [lat, lon]
                dist_along = nearest_profile_distance(best["elevation_profile"], mid[0], mid[1])

                step_warnings.append({
                    "osm_id": sw.get("osm_id"),
                    "lat": mid[0],
                    "lon": mid[1],
                    "dist_m": dist_along
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

    return {"osm_summary": osm_summary}
