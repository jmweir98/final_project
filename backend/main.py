import sqlite3
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import httpx

import config
from elevation import (
    build_elevation_profile,
    compute_elevation_metrics,
    downsample_for_elevation,
    get_elevations_open_meteo,
)
from geo_utils import downsample, haversine_m
from geocoding import geocode_address
from osm import query_nearby_venues, query_overpass_tags
from routing import routing_routes, via_waypoint_candidates
from schemas import CompareRequest, EnrichRequest, LatLon
from scoring import score_route


app = FastAPI()

DB_PATH = config.DB_PATH
UPLOAD_DIR = config.UPLOAD_DIR

# Static review images are served back to the frontend from /uploads/<filename>.
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


def init_db():
    """Create the local SQLite reviews table if it does not already exist."""
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


def _geometry_midpoint(geometry_latlon: list[list[float]]) -> tuple[float, float]:
    mid = geometry_latlon[len(geometry_latlon) // 2]
    return mid[0], mid[1]


def _is_duplicate(a: list[list[float]], b: list[list[float]], threshold_m: float = 80) -> bool:
    ma = _geometry_midpoint(a)
    mb = _geometry_midpoint(b)
    return haversine_m(ma[0], ma[1], mb[0], mb[1]) < threshold_m


async def build_route_response(payload: CompareRequest) -> list[dict]:
    """Build the initial route comparison response used by Find Routes.

    This stays fast by using OpenRouteService + elevation data only.
    OSM/Overpass enrichment is handled separately by /route/enrich.
    """
    start_lonlat = f"{payload.start.lon},{payload.start.lat}"
    end_lonlat = f"{payload.end.lon},{payload.end.lat}"

    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        # 1. Ask OpenRouteService for the main route alternatives.
        raw_routes = await routing_routes(client, start_lonlat, end_lonlat)
        if not raw_routes:
            raise HTTPException(status_code=502, detail="Routing provider returned no routes")

        # 2. Add via-point requests to encourage extra alternatives on short urban routes.
        for via_lat, via_lon in via_waypoint_candidates(
            payload.start.lat,
            payload.start.lon,
            payload.end.lat,
            payload.end.lon,
        ):
            via_lonlat = f"{via_lon},{via_lat}"
            extra_routes = await routing_routes(client, start_lonlat, end_lonlat, via_lonlat, silent=True)
            for extra in extra_routes[:2]:
                raw_routes.append(extra)
                if len(raw_routes) >= 10:
                    break
            if len(raw_routes) >= 10:
                break

        # 3. Remove routes that are too visually similar to be useful.
        unique_raw: list[dict] = []
        unique_geoms: list[list[list[float]]] = []
        direct_m = haversine_m(payload.start.lat, payload.start.lon, payload.end.lat, payload.end.lon)
        duplicate_threshold_m = max(20, min(80, direct_m * 0.12))
        for rt in raw_routes:
            coords = rt["geometry"]["coordinates"]
            geom = [[lat, lon] for lon, lat in coords]
            if any(_is_duplicate(geom, prev, threshold_m=duplicate_threshold_m) for prev in unique_geoms):
                continue
            unique_raw.append(rt)
            unique_geoms.append(geom)

        # 4. Add elevation metrics and the preliminary accessibility score.
        routes_out = []
        for i, (rt, geometry_latlon) in enumerate(zip(unique_raw, unique_geoms), start=1):
            geom = downsample_for_elevation(geometry_latlon)
            elev = await get_elevations_open_meteo(client, geom)
            elev_metrics = compute_elevation_metrics(geom, elev)
            elevation_profile = build_elevation_profile(geom, elev)
            score, flags, score_breakdown = score_route(rt["distance"], elev_metrics, None)

            routes_out.append({
                "id": f"route-{i}",
                "geometry": geometry_latlon,
                "distance_m": rt["distance"],
                "duration_s": rt["duration"],
                "routing_provider": rt.get("provider", "unknown"),
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

    # Keep the UI and background OSM enrichment manageable for a prototype.
    routes_out = routes_out[:3]

    # Renumber after sorting/capping so the UI always shows route-1, route-2, route-3.
    for idx, route in enumerate(routes_out, start=1):
        route["id"] = f"route-{idx}"
    return routes_out


@app.post("/routes/compare")
async def compare_routes(payload: CompareRequest):
    return {"routes": await build_route_response(payload)}


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
