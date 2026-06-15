def score_route(distance_m: float, elev: dict, osm: dict | None):
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

    distance_penalty = 0.8 * dist_km
    ascent_penalty = 0.12 * ascent
    steep_penalty = 0.03 * steep8
    max_slope_penalty = 0.15 * maxs
    steps_penalty = 0.0
    surface_penalty = 0.0
    uncertainty_penalty = 0.0

    score = distance_penalty + ascent_penalty + steep_penalty + max_slope_penalty

    if steps > 0:
        steps_penalty = 50.0
        score += steps_penalty
        flags.append(f"Contains steps ({steps})")

    bad_surfaces = {"gravel", "ground", "dirt", "mud", "sand", "unpaved", "cobblestone"}
    found_bad = [s for s in surfaces.keys() if s in bad_surfaces]
    if found_bad:
        surface_penalty = 5.0
        score += surface_penalty
        flags.append(f"Unpaved/rough surface: {', '.join(found_bad)}")

    if unknown_surface >= 0.3:
        uncertainty_penalty = 2.0
        score += uncertainty_penalty
        flags.append("Surface data incomplete")

    breakdown = {
        "distance_penalty": round(distance_penalty, 2),
        "ascent_penalty": round(ascent_penalty, 2),
        "steep_slope_penalty": round(steep_penalty, 2),
        "max_slope_penalty": round(max_slope_penalty, 2),
        "steps_penalty": round(steps_penalty, 2),
        "surface_penalty": round(surface_penalty, 2),
        "uncertainty_penalty": round(uncertainty_penalty, 2),
        "formula": "Lower is better: distance + ascent + steep slope + max slope + steps + rough surface + data uncertainty penalties.",
    }

    return round(score, 2), flags, breakdown
