# Accessible Route Planner

This project is a web-based accessible route comparison prototype. Users select a start and end point on an interactive map, retrieve pedestrian route alternatives, compare accessibility scores, inspect elevation profiles, and automatically enrich routes with OpenStreetMap accessibility-related data.

## Implemented Scope

- Interactive map with start/end point selection.
- Address search for setting start and destination points.
- Pedestrian route retrieval using OpenRouteService.
- Elevation sampling using the Open-Meteo Elevation API.
- Elevation metrics including ascent, descent, maximum slope, and steep-distance thresholds.
- Rule-based accessibility scoring.
- Score explanation showing the contribution of distance, ascent, slope, steps, rough surface, and missing data.
- Automatic OpenStreetMap/Overpass route enrichment for surfaces, steps, kerbs, crossings, tactile paving, and unknown surface ratio.
- Nearby venue lookup using OpenStreetMap/Overpass.
- Venue-level accessibility display for available OSM tags such as wheelchair access, entrance, surface, and tactile paving.
- Community review submission and retrieval.
- Optional image uploads attached to reviews.
- SQLite database persistence for venue reviews.
- Backend tests for elevation metric and scoring logic.

## Not Implemented

The AT2 report proposed a wider system. The following items should be treated as future work unless implemented later:

- User authentication or registration.
- Full account-based moderation or review ownership.

## APIs Used

- OpenRouteService route service for pedestrian route geometry.
- Open-Meteo Elevation API for elevation data.
- OpenStreetMap/Overpass API for route-level accessibility tags.
- SQLite for locally persisted review data.

OpenRouteService requires an API key. Add it to `backend/.env` before starting the project:

```text
ORS_API_KEY=your_openrouteservice_key_here
```

OpenRouteService is required for route comparison. If the key is missing or the service is unavailable, route generation will fail gracefully with an error message.

## Running The Project

From the project root, double-click:

```bat
run_project.bat
```

This starts:

- Backend: `http://127.0.0.1:8000`
- Frontend: `http://localhost:5173`

To stop running servers:

```bat
stop_project.bat
```

## Manual Use

1. Open `http://localhost:5173`.
2. Search for a start and destination address, or click directly on the map.
3. Confirm that both start and end points are set.
4. Press `Find Routes`.
5. Select a route and inspect the route card, elevation chart, score explanation, and surface details.
6. Routes enrich OSM data automatically in the background; use `Retry OSM Enrichment` only if a selected route still shows `OSM data not loaded`.
7. Press `Load Nearby Venues` to retrieve venues around the selected route or map point.
8. Select a venue to view OSM accessibility tags and community reviews.
9. Submit a review with an optional image upload.

## Testing

Backend tests can be run with:

```bat
cd backend
.venv\Scripts\python.exe -m pytest
```

Frontend production build can be checked with:

```bat
cd frontend
npm run build
```

## Known Limitations

- External API availability affects route and enrichment results.
- OpenRouteService may return only one distinct route depending on selected locations.
- OSM accessibility tags are incomplete in many areas, so the application reports missing surface data rather than treating missing data as safe.
- The scoring weights are rule-based and should be justified as a transparent prototype model, not a clinically or professionally certified accessibility assessment.
- Venue data depends on OSM tag coverage and may be incomplete.
- Reviews are stored locally in SQLite and are not tied to authenticated user accounts.
