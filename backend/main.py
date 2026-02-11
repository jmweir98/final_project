from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

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


@app.post("/routes/compare")
async def compare_routes(payload: CompareRequest):
    start_lonlat = f"{payload.start.lon},{payload.start.lat}"
    end_lonlat = f"{payload.end.lon},{payload.end.lat}"

    routes_out = []
    
    # Get main route with alternatives
    url = f"https://router.project-osrm.org/route/v1/foot/{start_lonlat};{end_lonlat}"
    params = {
        "alternatives": "true",
        "geometries": "geojson",
        "overview": "full",
        "steps": "false",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0, verify=False) as client:
            r = await client.get(url, params=params)
            if r.status_code == 200:
                data = r.json()
                if data.get("code") == "Ok":
                    for i, rt in enumerate(data["routes"]):
                        coords_lonlat = rt["geometry"]["coordinates"]
                        geometry_latlon = [[lat, lon] for lon, lat in coords_lonlat]
                        routes_out.append({
                            "id": f"route-{i+1}",
                            "geometry": geometry_latlon,
                            "distance_m": rt["distance"],
                            "duration_s": rt["duration"],
                        })
    except Exception:
        pass

    # Generate offset waypoints to force different routes
    mid_lat = (payload.start.lat + payload.end.lat) / 2
    mid_lon = (payload.start.lon + payload.end.lon) / 2
    
    # Create 4 waypoints around the midpoint (N, S, E, W)
    offsets = [
        (0.002, 0),      # North
        (-0.002, 0),     # South
        (0, 0.002),      # East
        (0, -0.002),     # West
    ]
    
    for idx, (lat_off, lon_off) in enumerate(offsets):
        waypoint = f"{mid_lon + lon_off},{mid_lat + lat_off}"
        url = f"https://router.project-osrm.org/route/v1/foot/{start_lonlat};{waypoint};{end_lonlat}"
        
        try:
            async with httpx.AsyncClient(timeout=20.0, verify=False) as client:
                r = await client.get(url, params={"geometries": "geojson", "overview": "full"})
                if r.status_code == 200:
                    data = r.json()
                    if data.get("code") == "Ok" and data.get("routes"):
                        rt = data["routes"][0]
                        coords_lonlat = rt["geometry"]["coordinates"]
                        geometry_latlon = [[lat, lon] for lon, lat in coords_lonlat]
                        routes_out.append({
                            "id": f"via-{idx+1}",
                            "geometry": geometry_latlon,
                            "distance_m": rt["distance"],
                            "duration_s": rt["duration"],
                        })
        except Exception:
            continue

    if not routes_out:
        raise HTTPException(status_code=502, detail="No routes found")

    return {"routes": routes_out}
