import asyncio

from fastapi import HTTPException
import httpx

import config
from geo_utils import downsample, haversine_m, route_bbox, route_bbox_diagonal_m, route_cache_key


enrich_cache: dict[str, dict] = {}


def build_overpass_poly_query(points: list[list[float]]) -> str:
    """Build a corridor query around a route for OSM accessibility tags."""
    sampled = downsample(points, max_points=8)
    radius_m = 50
    highway_filter = '["highway"~"^(footway|path|pedestrian|steps|living_street|residential|service|unclassified|primary|secondary|tertiary)$"]'

    clauses = []
    if route_bbox_diagonal_m(points) <= 2_000:
        south, west, north, east = route_bbox(points, margin_m=50)
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

    return f"""
[out:json][timeout:10];
(
{chr(10).join(clauses)}
);
out tags geom;
""".strip()


async def post_overpass(client: httpx.AsyncClient, query: str, label: str) -> dict:
    """Try public Overpass endpoints with one retry for temporary failures."""
    errors = []
    for url in config.OVERPASS_ENDPOINTS:
        for attempt in range(2):
            try:
                r = await client.post(
                    url,
                    data={"data": query.strip()},
                    headers={"User-Agent": "accessible-route-planner/1.0"},
                )
            except httpx.RequestError as exc:
                errors.append(f"{url}: {type(exc).__name__} {exc}")
                break

            if r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    errors.append(f"{url}: HTTP 200 but response was not JSON {r.text[:160]}")
                    break

            errors.append(f"{url}: HTTP {r.status_code} {r.text[:160]}")
            if r.status_code in {429, 502, 503, 504} and attempt == 0:
                await asyncio.sleep(1.5)
                continue
            break

    raise HTTPException(status_code=502, detail=f"{label} failed via all Overpass endpoints: {'; '.join(errors)}")


async def query_overpass_tags(client: httpx.AsyncClient, geometry_latlon: list[list[float]]):
    """Summarise OSM route features such as steps, surfaces, crossings and kerbs."""
    cache_key = route_cache_key(geometry_latlon)
    if cache_key in enrich_cache:
        return enrich_cache[cache_key]

    data = await post_overpass(client, build_overpass_poly_query(geometry_latlon), "Overpass route enrichment")
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
        if key:
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
            geom = el.get("geometry") or []
            if geom:
                steps_ways.append({
                    "osm_id": el.get("id"),
                    "geometry": [[p["lat"], p["lon"]] for p in geom if "lat" in p and "lon" in p],
                })

        surface = tags.get("surface")
        if surface:
            bump(surfaces, surface)
            known_surface_way_count += 1
        bump(smoothness, tags.get("smoothness"))
        bump(sidewalk, tags.get("sidewalk"))
        bump(wheelchair, tags.get("wheelchair"))
        bump(inclines, tags.get("incline"))

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
    """Find named nearby venues and expose useful accessibility-related tags."""
    radius_m = max(50, min(radius_m, 1000))
    query = f"""
[out:json][timeout:10];
(
  node(around:{radius_m},{lat},{lon})[name][~"^(amenity|shop|tourism|leisure|public_transport)$"~"."];
  way(around:{radius_m},{lat},{lon})[name][~"^(amenity|shop|tourism|leisure|public_transport)$"~"."];
  relation(around:{radius_m},{lat},{lon})[name][~"^(amenity|shop|tourism|leisure|public_transport)$"~"."];
);
out center tags 40;
"""
    data = await post_overpass(client, query, "Venue lookup")
    venues = []
    seen = set()
    for el in data.get("elements", []):
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
