from fastapi import HTTPException
import httpx

from geo_utils import downsample, haversine_m


def build_elevation_profile(points: list[list[float]], elevations: list[float]):
    profile = []
    cumulative_m = 0.0

    for i, point in enumerate(points):
        lat, lon = point
        if i > 0:
            lat0, lon0 = points[i - 1]
            cumulative_m += haversine_m(lat0, lon0, lat, lon)

        profile.append({
            "i": i,
            "lat": lat,
            "lon": lon,
            "elev_m": round(float(elevations[i]), 1),
            "dist_m": round(cumulative_m, 1),
        })

    return profile


def nearest_profile_distance(profile: list[dict], lat: float, lon: float) -> float:
    best_d = 1e18
    best_dist = 0.0
    for pt in profile:
        d = haversine_m(lat, lon, pt["lat"], pt["lon"])
        if d < best_d:
            best_d = d
            best_dist = pt["dist_m"]
    return round(best_dist, 1)


async def get_elevations_open_meteo(client: httpx.AsyncClient, pts: list[list[float]]) -> list[float]:
    lats = ",".join(str(p[0]) for p in pts)
    lons = ",".join(str(p[1]) for p in pts)

    r = await client.get(
        "https://api.open-meteo.com/v1/elevation",
        params={"latitude": lats, "longitude": lons},
    )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Elevation API HTTP {r.status_code}: {r.text}")

    data = r.json()
    elev = data.get("elevation")
    if not isinstance(elev, list) or len(elev) != len(pts):
        raise HTTPException(status_code=502, detail=f"Unexpected elevation response: {data}")
    return elev


def compute_elevation_metrics(pts: list[list[float]], elev: list[float]):
    total_ascent = 0.0
    total_descent = 0.0
    max_slope_pct = 0.0
    steep_m_gt5 = 0.0
    steep_m_gt8 = 0.0

    for i in range(1, len(pts)):
        lat1, lon1 = pts[i - 1]
        lat2, lon2 = pts[i]
        d = haversine_m(lat1, lon1, lat2, lon2)
        if d <= 5:
            continue

        dz = elev[i] - elev[i - 1]
        if dz > 0:
            total_ascent += dz
        else:
            total_descent += abs(dz)

        slope_pct = abs(dz) / d * 100.0
        max_slope_pct = max(max_slope_pct, slope_pct)
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
        },
    }


def downsample_for_elevation(points: list[list[float]], max_points: int = 80) -> list[list[float]]:
    return downsample(points, max_points=max_points)
