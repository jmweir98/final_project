from fastapi.testclient import TestClient
import pytest

import main
from main import app, compute_elevation_metrics, downsample, score_route


client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    db_path = tmp_path / "test_routewise.db"
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(main, "DB_PATH", db_path)
    monkeypatch.setattr(main, "UPLOAD_DIR", upload_dir)
    main.init_db()
    yield


def test_compute_elevation_metrics_counts_ascent_descent_and_steep_distance():
    points = [
        [54.6000, -5.9300],
        [54.6005, -5.9300],
        [54.6010, -5.9300],
    ]
    elevations = [10.0, 20.0, 15.0]

    metrics = compute_elevation_metrics(points, elevations)

    assert metrics["ascent_m"] == 10.0
    assert metrics["descent_m"] == 5.0
    assert metrics["max_slope_percent"] > 0
    assert "gt5" in metrics["steep_distance_m"]
    assert "gt8" in metrics["steep_distance_m"]


def test_downsample_never_exceeds_requested_limit_and_keeps_endpoints():
    points = [[float(i), float(-i)] for i in range(150)]

    sampled = downsample(points, max_points=80)

    assert len(sampled) == 80
    assert sampled[0] == points[0]
    assert sampled[-1] == points[-1]


def test_score_route_penalises_steps_and_missing_surface_data():
    elevation_metrics = {
        "ascent_m": 10.0,
        "descent_m": 0.0,
        "max_slope_percent": 3.0,
        "steep_distance_m": {"gt5": 20.0, "gt8": 0.0},
    }
    osm_summary = {
        "steps_count": 1,
        "unknown_surface_ratio": 0.5,
        "surfaces": {},
    }

    score, flags, breakdown = score_route(1000.0, elevation_metrics, osm_summary)

    assert score > 50
    assert "Contains steps (1)" in flags
    assert "Surface data incomplete" in flags
    assert breakdown["steps_penalty"] == 50.0
    assert breakdown["uncertainty_penalty"] == 2.0


def test_score_route_penalises_rough_surfaces():
    elevation_metrics = {
        "ascent_m": 0.0,
        "descent_m": 0.0,
        "max_slope_percent": 0.0,
        "steep_distance_m": {"gt5": 0.0, "gt8": 0.0},
    }
    osm_summary = {
        "steps_count": 0,
        "unknown_surface_ratio": 0.0,
        "surfaces": {"gravel": 2},
    }

    _, flags, breakdown = score_route(1000.0, elevation_metrics, osm_summary)

    assert "Unpaved/rough surface: gravel" in flags
    assert breakdown["surface_penalty"] == 5.0


def test_review_submission_is_persisted_and_retrievable():
    venue_id = "test-venue-001"

    create_response = client.post(
        "/reviews",
        data={
            "venue_osm_id": venue_id,
            "venue_name": "Test Venue",
            "rating": "4",
            "comment": "Step-free entrance was available.",
            "accessibility_notes": "Ramp near the main door.",
        },
    )

    assert create_response.status_code == 200
    created = create_response.json()["review"]
    assert created["venue_osm_id"] == venue_id
    assert created["rating"] == 4

    list_response = client.get(f"/venues/{venue_id}/reviews")

    assert list_response.status_code == 200
    reviews = list_response.json()["reviews"]
    assert any(review["id"] == created["id"] for review in reviews)


def test_review_retrieval_supports_osm_ids_with_slashes():
    venue_id = "node/12345"

    create_response = client.post(
        "/reviews",
        data={
            "venue_osm_id": venue_id,
            "venue_name": "Slash ID Venue",
            "rating": "5",
            "comment": "Accessible entrance.",
            "accessibility_notes": "",
        },
    )

    assert create_response.status_code == 200

    list_response = client.get("/venues/node%2F12345/reviews")

    assert list_response.status_code == 200
    reviews = list_response.json()["reviews"]
    assert len(reviews) == 1
    assert reviews[0]["venue_osm_id"] == venue_id


def test_review_submission_rejects_invalid_rating():
    response = client.post(
        "/reviews",
        data={
            "venue_osm_id": "test-venue-002",
            "venue_name": "Test Venue",
            "rating": "6",
            "comment": "Invalid rating.",
            "accessibility_notes": "",
        },
    )

    assert response.status_code == 400
    assert "rating must be between 1 and 5" in response.text


def test_review_submission_accepts_supported_image_upload():
    response = client.post(
        "/reviews",
        data={
            "venue_osm_id": "test-venue-003",
            "venue_name": "Image Venue",
            "rating": "5",
            "comment": "Ramp is clearly visible.",
            "accessibility_notes": "Photo shows the entrance ramp.",
        },
        files={"image": ("ramp.png", b"fake image bytes", "image/png")},
    )

    assert response.status_code == 200
    review = response.json()["review"]
    assert review["image_url"] is not None
    image_name = review["image_url"].split("/")[-1]
    assert (main.UPLOAD_DIR / image_name).exists()


def test_review_submission_rejects_unsupported_image_upload():
    response = client.post(
        "/reviews",
        data={
            "venue_osm_id": "test-venue-004",
            "venue_name": "Image Venue",
            "rating": "5",
            "comment": "Bad upload.",
            "accessibility_notes": "",
        },
        files={"image": ("notes.txt", b"not an image", "text/plain")},
    )

    assert response.status_code == 400
    assert "image must be a JPG, PNG, or WebP file" in response.text


def test_route_enrich_recalculates_score_when_metrics_are_provided(monkeypatch):
    async def fake_query_overpass_tags(_client, _geometry):
        return {
            "steps_count": 1,
            "unknown_surface_ratio": 0.5,
            "surfaces": {},
        }

    monkeypatch.setattr(main, "query_overpass_tags", fake_query_overpass_tags)

    response = client.post(
        "/route/enrich",
        json={
            "geometry": [[54.6, -5.9], [54.601, -5.901]],
            "distance_m": 1000.0,
            "elevation_metrics": {
                "ascent_m": 5.0,
                "descent_m": 0.0,
                "max_slope_percent": 3.0,
                "steep_distance_m": {"gt5": 10.0, "gt8": 0.0},
            },
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["osm_summary"]["steps_count"] == 1
    assert data["accessibility_score"] > 50
    assert data["score_breakdown"]["steps_penalty"] == 50.0
    assert "Contains steps (1)" in data["flags"]


def test_geocode_search_returns_results(monkeypatch):
    async def fake_geocode_address(_client, query):
        assert query == "Belfast City Hall"
        return [{
            "label": "Belfast City Hall, Donegall Square, Belfast",
            "lat": 54.5964,
            "lon": -5.9301,
            "type": "city_hall",
            "importance": 0.8,
        }]

    monkeypatch.setattr(main, "geocode_address", fake_geocode_address)

    response = client.get("/geocode/search?q=Belfast%20City%20Hall")

    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 1
    assert results[0]["label"].startswith("Belfast City Hall")
    assert results[0]["lat"] == 54.5964
