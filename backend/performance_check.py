import time
from typing import Any

import httpx


API_BASE_URL = "http://127.0.0.1:8000"

START = {"lat": 54.5942, "lon": -5.9296}
END = {"lat": 54.5922, "lon": -5.9261}


def timed(label: str, fn):
    start = time.perf_counter()
    try:
        result = fn()
        elapsed = time.perf_counter() - start
        cache_note = " (likely cached)" if elapsed < 0.1 else ""
        print(f"{label}: {elapsed:.2f}s{cache_note}")
        return result
    except Exception as exc:
        elapsed = time.perf_counter() - start
        print(f"{label}: FAILED after {elapsed:.2f}s - {exc}")
        return None


def require_ok(response: httpx.Response) -> dict[str, Any]:
    response.raise_for_status()
    return response.json()


def main():
    print("Accessible Route Planner performance check")
    print(f"Backend: {API_BASE_URL}")
    print()

    with httpx.Client(timeout=90.0) as client:
        timed("Health check", lambda: require_ok(client.get(f"{API_BASE_URL}/health")))

        route_data = timed(
            "Find routes",
            lambda: require_ok(
                client.post(
                    f"{API_BASE_URL}/routes/compare",
                    json={"start": START, "end": END},
                )
            ),
        )

        routes = route_data.get("routes", []) if route_data else []
        print(f"Routes returned: {len(routes)}")

        if routes:
            timed(
                "OSM enrichment for returned routes",
                lambda: [
                    require_ok(
                        client.post(
                            f"{API_BASE_URL}/route/enrich",
                            json={
                                "geometry": route["geometry"],
                                "distance_m": route["distance_m"],
                                "elevation_metrics": route["elevation_metrics"],
                            },
                        )
                    )
                    for route in routes
                ],
            )

        timed(
            "Load nearby venues",
            lambda: require_ok(
                client.get(
                    f"{API_BASE_URL}/venues/nearby",
                    params={"lat": START["lat"], "lon": START["lon"], "radius_m": 350},
                )
            ),
        )

    print()
    print("Note: OSM enrichment and venue lookup use public Overpass services, so timings can vary.")
    print("Restart the backend before running this script if you want cold, uncached timings.")


if __name__ == "__main__":
    main()
