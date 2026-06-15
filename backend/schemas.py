from typing import Any

from pydantic import BaseModel


class LatLon(BaseModel):
    lat: float
    lon: float


class CompareRequest(BaseModel):
    start: LatLon
    end: LatLon


class EnrichRequest(BaseModel):
    geometry: list[list[float]]
    distance_m: float | None = None
    elevation_metrics: dict[str, Any] | None = None
