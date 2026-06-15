export type Route = {
  id: string;
  geometry: [number, number][];
  distance_m: number;
  duration_s: number;
  elevation_metrics: {
    ascent_m: number;
    descent_m: number;
    max_slope_percent: number;
    steep_distance_m: { gt5: number; gt8: number };
  };
  elevation_profile: Array<{ i: number; lat: number; lon: number; elev_m: number; dist_m: number }>;
  osm_summary: {
    steps_count: number;
    steps_ways?: { osm_id?: number; geometry: [number, number][] }[];
    surfaces: Record<string, number>;
    smoothness: Record<string, number>;
    highway_types: Record<string, number>;
    kerb_nodes_count: number;
    unknown_surface_ratio: number;
    sample_points_used: number;
  } | null;
  step_warnings?: { osm_id?: number; lat: number; lon: number; dist_m: number }[];
  accessibility_score: number;
  score_breakdown?: {
    distance_penalty: number;
    ascent_penalty: number;
    steep_slope_penalty: number;
    max_slope_penalty: number;
    steps_penalty: number;
    surface_penalty: number;
    uncertainty_penalty: number;
    formula: string;
  };
  flags: string[];
};

export type Venue = {
  osm_id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  wheelchair: string;
  entrance?: string;
  tactile_paving?: string;
  surface?: string;
  tags: Record<string, string>;
};

export type Review = {
  id: number;
  venue_osm_id: string;
  venue_name: string;
  rating: number;
  comment: string;
  accessibility_notes?: string;
  image_url?: string | null;
  created_at: string;
};

export type GeocodeResult = { label: string; lat: number; lon: number };

export type SavedState = {
  routes: Route[];
  start: [number, number] | null;
  end: [number, number] | null;
  selectedRouteId: string | null;
  venues: Venue[];
  selectedVenue: Venue | null;
  venueReviews: Record<string, Review[]>;
  startAddress: string;
  endAddress: string;
  startLabel: string;
  endLabel: string;
};
