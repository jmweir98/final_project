from typing import Any

from fastapi import HTTPException
import httpx


geocode_cache: dict[str, list[dict[str, Any]]] = {}


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
