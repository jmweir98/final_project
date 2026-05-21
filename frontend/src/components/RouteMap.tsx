import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE_URL = 'http://127.0.0.1:8000';
const ROUTE_MAP_STATE_KEY = 'routewise.routeMapState';

// ─── Types ──────────────────────────────────────────────────────────────────

type Route = {
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
  elevation_profile: Array<{
    i: number;
    lat: number;
    lon: number;
    elev_m: number;
    dist_m: number;
  }>;
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

type Venue = {
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

type Review = {
  id: number;
  venue_osm_id: string;
  venue_name: string;
  rating: number;
  comment: string;
  accessibility_notes?: string;
  image_url?: string | null;
  created_at: string;
};

type GeocodeResult = {
  label: string;
  lat: number;
  lon: number;
  type?: string;
  importance?: number;
};

function midpoint(points: [number, number][]): [number, number] | null {
  if (!points.length) return null;
  return points[Math.floor(points.length / 2)];
}

type SavedRouteMapState = {
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

function readSavedRouteMapState(): SavedRouteMapState | null {
  try {
    const raw = window.sessionStorage.getItem(ROUTE_MAP_STATE_KEY);
    return raw ? (JSON.parse(raw) as SavedRouteMapState) : null;
  } catch {
    return null;
  }
}

// ─── Score badge ─────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score <= 30) return '#28a745';
  if (score <= 60) return '#fd7e14';
  return '#dc3545';
}

function penaltyColor(value: number): string {
  if (value >= 5) return '#dc3545';
  if (value >= 2) return '#fd7e14';
  return '#495057';
}

function penaltyBackground(value: number): string {
  if (value >= 5) return '#f8d7da';
  if (value >= 2) return '#fff3cd';
  return 'transparent';
}

function formatScoreContext(route: Route, label: string): string {
  const osm = route.osm_summary;
  if (label === 'Distance') return `${(route.distance_m / 1000).toFixed(2)} km`;
  if (label === 'Ascent') return `${route.elevation_metrics.ascent_m} m ascent`;
  if (label === 'Steep slope distance') {
    return `${Math.round(route.elevation_metrics.steep_distance_m.gt8)} m over 8%`;
  }
  if (label === 'Maximum slope') {
    return `${route.elevation_metrics.max_slope_percent.toFixed(1)}% max gradient`;
  }
  if (label === 'Steps') return `${osm?.steps_count ?? 0} step section${(osm?.steps_count ?? 0) === 1 ? '' : 's'}`;
  if (label === 'Rough surface') {
    const rough = Object.keys(osm?.surfaces ?? {}).filter((surface) =>
      ['gravel', 'ground', 'dirt', 'mud', 'sand', 'unpaved', 'cobblestone'].includes(surface),
    );
    return rough.length ? rough.join(', ') : 'none detected';
  }
  if (label === 'Missing surface data') {
    return `${Math.round((osm?.unknown_surface_ratio ?? 0) * 100)}% unknown`;
  }
  return '';
}

function wheelchairColor(status: string): string {
  if (status === 'yes') return '#28a745';
  if (status === 'limited') return '#fd7e14';
  if (status === 'no') return '#dc3545';
  return '#6c757d';
}

function wheelchairLabel(status: string): string {
  if (status === 'yes') return 'Accessible';
  if (status === 'limited') return 'Limited access';
  if (status === 'no') return 'Not accessible';
  return 'Unknown access';
}

function circleMarkerIcon(label: string, color: string, size = 30): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:50%;
        background:${color};
        color:white;
        border:2px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
        display:flex;
        align-items:center;
        justify-content:center;
        font-weight:800;
        font-size:${Math.max(13, Math.round(size * 0.52))}px;
        line-height:1;
      ">${label}</div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function venueMarkerIcon(status: string, isSelected: boolean): L.DivIcon {
  const color = wheelchairColor(status);
  const markerSymbol = status === 'yes' ? 'A' : status === 'limited' ? 'L' : status === 'no' ? 'N' : '?';
  const markerSize = isSelected ? 34 : 28;
  return circleMarkerIcon(markerSymbol, color, markerSize);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = {
  container: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(480px, 34vw)',
    gridTemplateRows: 'auto minmax(0, 1fr)',
    gap: '12px',
    padding: '12px',
    height: 'calc(100vh - 58px)',
    overflow: 'hidden',
  } as React.CSSProperties,

  topBar: {
    gridColumn: '1 / -1',
    gridRow: 1,
    background: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
    padding: '12px',
    display: 'grid',
    gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr) minmax(220px, 0.85fr) auto',
    gap: '12px',
    alignItems: 'start',
    position: 'relative',
    zIndex: 800,
  } as React.CSSProperties,

  sidebar: {
    display: 'grid',
    gap: '12px',
    gridColumn: 2,
    gridRow: 2,
    overflowY: 'auto' as const,
    alignContent: 'start',
    paddingRight: '6px',
    paddingBottom: '16px',
  },

  card: {
    background: 'white',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
    flexShrink: 0,
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: '15px',
    fontWeight: 700,
    marginBottom: '12px',
    color: '#212529',
    letterSpacing: '-0.1px',
  } as React.CSSProperties,

  btn: (color: string, disabled = false): React.CSSProperties => ({
    background: disabled ? '#adb5bd' : color,
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '11px 18px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: '100%',
    transition: 'background 0.15s',
    opacity: disabled ? 0.7 : 1,
  }),

  routeBtn: (selected: boolean, recommended: boolean): React.CSSProperties => ({
    background: selected ? '#f0f3ff' : recommended ? '#f0fff4' : 'white',
    border: `2px solid ${selected ? '#667eea' : recommended ? '#28a745' : '#e9ecef'}`,
    borderRadius: '10px',
    padding: '12px',
    fontSize: '13px',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    transition: 'all 0.15s',
    marginBottom: '8px',
  }),

  badge: (bg: string, color: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '20px',
    fontSize: '11px',
    fontWeight: 600,
    background: bg,
    color,
    marginLeft: '6px',
    letterSpacing: '0.2px',
  }),

  suggestions: {
    marginTop: '6px',
    border: '1px solid #dee2e6',
    borderRadius: '8px',
    overflow: 'hidden',
    background: '#fff',
    boxShadow: '0 3px 10px rgba(0,0,0,0.08)',
  } as React.CSSProperties,

  suggestionBtn: {
    width: '100%',
    border: 'none',
    borderBottom: '1px solid #f1f3f5',
    background: '#fff',
    textAlign: 'left' as const,
    padding: '9px 10px',
    fontSize: '12px',
    color: '#343a40',
    cursor: 'pointer',
    lineHeight: 1.35,
  } as React.CSSProperties,

  mapWrap: {
    position: 'relative',
    gridColumn: 1,
    gridRow: 2,
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 1px 8px rgba(0,0,0,0.1)',
    height: '100%',
  } as React.CSSProperties,
};

// ─── Main component ───────────────────────────────────────────────────────────

const RouteMap: React.FC = () => {
  const navigate = useNavigate();
  const savedStateRef = useRef<SavedRouteMapState | null>(readSavedRouteMapState());
  const [routes, setRoutes] = useState<Route[]>(() => savedStateRef.current?.routes ?? []);
  const [start, setStart] = useState<[number, number] | null>(() => savedStateRef.current?.start ?? null);
  const [end, setEnd] = useState<[number, number] | null>(() => savedStateRef.current?.end ?? null);
  const [mapFocusPoint, setMapFocusPoint] = useState<[number, number] | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(() => savedStateRef.current?.selectedRouteId ?? null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichingRouteIds, setEnrichingRouteIds] = useState<Set<string>>(new Set());
  const [venues, setVenues] = useState<Venue[]>(() => savedStateRef.current?.venues ?? []);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(() => savedStateRef.current?.selectedVenue ?? null);
  const [venueReviews, setVenueReviews] = useState<Record<string, Review[]>>(() => savedStateRef.current?.venueReviews ?? {});
  const [loadingReviewVenueIds, setLoadingReviewVenueIds] = useState<Set<string>>(new Set());
  const [isLoadingVenues, setIsLoadingVenues] = useState(false);
  const [isFindingRoutes, setIsFindingRoutes] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [startAddress, setStartAddress] = useState(() => savedStateRef.current?.startAddress ?? '');
  const [endAddress, setEndAddress] = useState(() => savedStateRef.current?.endAddress ?? '');
  const [startSuggestions, setStartSuggestions] = useState<GeocodeResult[]>([]);
  const [endSuggestions, setEndSuggestions] = useState<GeocodeResult[]>([]);
  const [isLoadingStartSuggestions, setIsLoadingStartSuggestions] = useState(false);
  const [isLoadingEndSuggestions, setIsLoadingEndSuggestions] = useState(false);
  const [startLabel, setStartLabel] = useState(() => savedStateRef.current?.startLabel ?? '');
  const [endLabel, setEndLabel] = useState(() => savedStateRef.current?.endLabel ?? '');
  const routeSearchVersionRef = useRef(0);
  const selectedVenuePanelRef = useRef<HTMLDivElement | null>(null);
  const [isSearchingStart, setIsSearchingStart] = useState(false);
  const [isSearchingEnd, setIsSearchingEnd] = useState(false);

  const selectedRoute = routes.find((r) => r.id === selectedRouteId);
  const isSelectedRouteEnriching = Boolean(
    selectedRoute && enrichingRouteIds.has(selectedRoute.id),
  );
  const showEnrichButton = Boolean(
    selectedRoute && (!selectedRoute.osm_summary || isSelectedRouteEnriching),
  );
  const canEnrich = Boolean(
    selectedRoute && !selectedRoute.osm_summary && !isSelectedRouteEnriching,
  );
  const selectedVenueReviews = selectedVenue ? venueReviews[selectedVenue.osm_id] ?? [] : [];
  const isSelectedVenueReviewsLoading = Boolean(
    selectedVenue && loadingReviewVenueIds.has(selectedVenue.osm_id),
  );
  const bestRouteId = routes.reduce<string | null>((bestId, route) => {
    if (!bestId) return route.id;
    const bestRoute = routes.find((candidate) => candidate.id === bestId);
    return bestRoute && bestRoute.accessibility_score <= route.accessibility_score ? bestId : route.id;
  }, null);

  useEffect(() => {
    if (!selectedVenue) return;
    window.setTimeout(() => {
      selectedVenuePanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 50);
  }, [selectedVenue?.osm_id]);

  useEffect(() => {
    const state: SavedRouteMapState = {
      routes,
      start,
      end,
      selectedRouteId,
      venues,
      selectedVenue,
      venueReviews,
      startAddress,
      endAddress,
      startLabel,
      endLabel,
    };
    window.sessionStorage.setItem(ROUTE_MAP_STATE_KEY, JSON.stringify(state));
  }, [
    routes,
    start,
    end,
    selectedRouteId,
    venues,
    selectedVenue,
    venueReviews,
    startAddress,
    endAddress,
    startLabel,
    endLabel,
  ]);

  useEffect(() => {
    const query = startAddress.trim();
    if (query.length < 3 || query === startLabel) {
      setStartSuggestions([]);
      setIsLoadingStartSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoadingStartSuggestions(true);
      try {
        const res = await fetch(`${API_BASE_URL}/geocode/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        setStartSuggestions(Array.isArray(data?.results) ? data.results.slice(0, 5) : []);
      } catch {
        if (!controller.signal.aborted) setStartSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setIsLoadingStartSuggestions(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [startAddress, startLabel]);

  useEffect(() => {
    const query = endAddress.trim();
    if (query.length < 3 || query === endLabel) {
      setEndSuggestions([]);
      setIsLoadingEndSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoadingEndSuggestions(true);
      try {
        const res = await fetch(`${API_BASE_URL}/geocode/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        setEndSuggestions(Array.isArray(data?.results) ? data.results.slice(0, 5) : []);
      } catch {
        if (!controller.signal.aborted) setEndSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setIsLoadingEndSuggestions(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [endAddress, endLabel]);

  const getVenueSearchPoint = (): [number, number] | null => {
    if (selectedRoute?.geometry?.length) {
      return selectedRoute.geometry[Math.floor(selectedRoute.geometry.length / 2)];
    }
    return end ?? start;
  };

  const loadVenueReviews = async (venueId: string) => {
    if (venueReviews[venueId] || loadingReviewVenueIds.has(venueId)) return;

    setLoadingReviewVenueIds((prev) => new Set(prev).add(venueId));
    try {
      const res = await fetch(`${API_BASE_URL}/venues/${encodeURIComponent(venueId)}/reviews`);
      if (!res.ok) return;
      const data = await res.json();
      const reviews: Review[] = Array.isArray(data?.reviews) ? data.reviews : [];
      setVenueReviews((prev) => ({ ...prev, [venueId]: reviews }));
    } catch {
      // Reviews are supporting data, so the map remains usable if this lookup fails.
    } finally {
      setLoadingReviewVenueIds((prev) => {
        const next = new Set(prev);
        next.delete(venueId);
        return next;
      });
    }
  };

  const loadReviewsForVenues = (venuesToLoad: Venue[]) => {
    venuesToLoad.forEach((venue, index) => {
      window.setTimeout(() => {
        void loadVenueReviews(venue.osm_id);
      }, index * 100);
    });
  };

  const selectVenue = (venue: Venue) => {
    setSelectedVenue(venue);
    void loadVenueReviews(venue.osm_id);
  };

  const clearRouteDerivedState = () => {
    routeSearchVersionRef.current += 1;
    setRoutes([]);
    setSelectedRouteId(null);
    setVenues([]);
    setSelectedVenue(null);
    setVenueReviews({});
    setLoadingReviewVenueIds(new Set());
    setEnrichingRouteIds(new Set());
  };

  const enrichRoute = async (
    route: Route,
    showErrors = false,
    routeSearchVersion = routeSearchVersionRef.current,
  ) => {
    if (route.osm_summary) return;
    if (routeSearchVersion !== routeSearchVersionRef.current) return;

    setEnrichingRouteIds((prev) => new Set(prev).add(route.id));
    try {
      const res = await fetch(`${API_BASE_URL}/route/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: route.geometry,
          distance_m: route.distance_m,
          elevation_metrics: route.elevation_metrics,
        }),
      });
      if (!res.ok) {
        if (showErrors) setErrorMessage(`Enrich failed: ${await res.text()}`);
        return;
      }
      const data = await res.json();
      if (routeSearchVersion !== routeSearchVersionRef.current) return;
      setRoutes((prev) =>
        prev
          .map((x) =>
            x.id === route.id
              ? {
                  ...x,
                  osm_summary: data.osm_summary ?? x.osm_summary,
                  accessibility_score: data.accessibility_score ?? x.accessibility_score,
                  score_breakdown: data.score_breakdown ?? x.score_breakdown,
                  flags: data.flags ?? x.flags,
                }
              : x,
          )
          .sort((a, b) => a.accessibility_score - b.accessibility_score),
      );
    } catch {
      if (showErrors) setErrorMessage('Enrich failed - backend unreachable.');
    } finally {
      if (routeSearchVersion !== routeSearchVersionRef.current) return;
      setEnrichingRouteIds((prev) => {
        const next = new Set(prev);
        next.delete(route.id);
        return next;
      });
    }
  };

  const enrichRoutesInBackground = (routesToEnrich: Route[], routeSearchVersion: number) => {
    routesToEnrich.forEach((route, index) => {
      window.setTimeout(() => {
        void enrichRoute(route, false, routeSearchVersion);
      }, index * 300);
    });
  };

  const applyAddressResult = (kind: 'start' | 'end', result: GeocodeResult) => {
    const point: [number, number] = [result.lat, result.lon];
    setMapFocusPoint(point);
    if (kind === 'start') {
      setStart(point);
      setStartAddress(result.label);
      setStartLabel(result.label);
      setStartSuggestions([]);
    } else {
      setEnd(point);
      setEndAddress(result.label);
      setEndLabel(result.label);
      setEndSuggestions([]);
    }
    clearRouteDerivedState();
  };

  const searchAddress = async (kind: 'start' | 'end') => {
    const query = kind === 'start' ? startAddress : endAddress;
    if (query.trim().length < 3) {
      setErrorMessage('Enter at least 3 characters to search for an address.');
      return;
    }

    const setLoading = kind === 'start' ? setIsSearchingStart : setIsSearchingEnd;
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`${API_BASE_URL}/geocode/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        const detail = errData?.detail ?? `HTTP ${res.status}`;
        setErrorMessage(`Address search failed: ${detail}`);
        return;
      }

      const data = await res.json();
      const results: GeocodeResult[] = Array.isArray(data?.results) ? data.results : [];
      if (results.length === 0) {
        setErrorMessage(`No address found for "${query}". Try a more specific search.`);
        return;
      }

      applyAddressResult(kind, results[0]);
    } catch {
      setErrorMessage('Address search failed - backend unreachable.');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoutes = async () => {
    if (!start || !end) {
      setErrorMessage('Click the map to set a start point, then click again to set an end point.');
      return;
    }
    setErrorMessage('');
    setIsFindingRoutes(true);
    const routeSearchVersion = routeSearchVersionRef.current + 1;
    routeSearchVersionRef.current = routeSearchVersion;
    setEnrichingRouteIds(new Set());
    try {
      const res = await fetch(`${API_BASE_URL}/routes/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: { lat: start[0], lon: start[1] },
          end: { lat: end[0], lon: end[1] },
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        const detail = errData?.detail ?? `HTTP ${res.status}`;
        setErrorMessage(`Could not find routes: ${detail}`);
        return;
      }
      const data = await res.json();
      const loaded: Route[] = Array.isArray(data?.routes) ? data.routes : [];
      const sorted = [...loaded].sort((a, b) => a.accessibility_score - b.accessibility_score);
      setRoutes(sorted);
      setSelectedRouteId(sorted[0]?.id ?? null);
      setVenues([]);
      setSelectedVenue(null);
      setVenueReviews({});
      setLoadingReviewVenueIds(new Set());
      enrichRoutesInBackground(
        sorted.filter((route) => !route.osm_summary),
        routeSearchVersion,
      );
    } catch {
      setErrorMessage('Could not reach the backend — make sure it is running on port 8000.');
    } finally {
      setIsFindingRoutes(false);
    }
  };

  const enrichSelectedRoute = async () => {
    if (!selectedRouteId) return;
    const r = routes.find((x) => x.id === selectedRouteId);
    if (!r || r.osm_summary) return;

    setIsEnriching(true);
    try {
      await enrichRoute(r, true);
    } finally {
      setIsEnriching(false);
    }
  };

  const loadNearbyVenues = async () => {
    const point = getVenueSearchPoint();
    if (!point) {
      setErrorMessage('Select a route or click the map first.');
      return;
    }
    setIsLoadingVenues(true);
    setErrorMessage('');
    try {
      const res = await fetch(
        `${API_BASE_URL}/venues/nearby?lat=${point[0]}&lon=${point[1]}&radius_m=350`,
      );
      if (!res.ok) {
        setErrorMessage(`Venue lookup failed (${res.status}).`);
        return;
      }
      const data = await res.json();
      const loaded: Venue[] = Array.isArray(data?.venues) ? data.venues : [];
      setVenueReviews({});
      setLoadingReviewVenueIds(new Set());
      setVenues(loaded);
      if (loaded.length > 0) selectVenue(loaded[0]);
      loadReviewsForVenues(loaded);
    } catch {
      setErrorMessage('Venue lookup failed — backend unreachable.');
    } finally {
      setIsLoadingVenues(false);
    }
  };

  const pointsSet = Boolean(start && end);
  const step = !start ? 1 : !end ? 2 : 3;

  const handleAddressEnter = (kind: 'start' | 'end') => {
    const query = kind === 'start' ? startAddress.trim() : endAddress.trim();
    const selectedLabel = kind === 'start' ? startLabel : endLabel;

    if (pointsSet && (!query || query === selectedLabel)) {
      void fetchRoutes();
      return;
    }

    void searchAddress(kind);
  };

  const addressSearchPanel = (
    <>
      <label style={{ fontSize: '13px', color: '#495057', fontWeight: 700 }}>
        From
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px', gap: '8px', marginTop: '5px' }}>
          <input
            data-address-kind="start"
            value={startAddress}
            onChange={(e) => {
              setStartAddress(e.target.value);
              setStartLabel('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddressEnter('start');
              }
            }}
            placeholder="e.g. Belfast City Hall"
            style={{ padding: '10px', border: '1px solid #ced4da', borderRadius: '8px', fontSize: '13px' }}
          />
          <button
            onClick={() => searchAddress('start')}
            disabled={isSearchingStart}
            style={s.btn('#198754', isSearchingStart)}
          >
            {isSearchingStart ? '...' : 'Set'}
          </button>
        </div>
        {(isLoadingStartSuggestions || startSuggestions.length > 0) && (
          <div style={s.suggestions}>
            {isLoadingStartSuggestions && startSuggestions.length === 0 && (
              <div style={{ padding: '9px 10px', fontSize: '12px', color: '#6c757d' }}>
                Searching...
              </div>
            )}
            {startSuggestions.map((result) => (
              <button
                key={`${result.lat},${result.lon},${result.label}`}
                type="button"
                onClick={() => applyAddressResult('start', result)}
                style={s.suggestionBtn}
                onMouseOver={(e) => (e.currentTarget.style.background = '#f8f9fa')}
                onMouseOut={(e) => (e.currentTarget.style.background = '#fff')}
              >
                {result.label}
              </button>
            ))}
          </div>
        )}
      </label>

      <label style={{ fontSize: '13px', color: '#495057', fontWeight: 700 }}>
        To
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px', gap: '8px', marginTop: '5px' }}>
          <input
            data-address-kind="end"
            value={endAddress}
            onChange={(e) => {
              setEndAddress(e.target.value);
              setEndLabel('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddressEnter('end');
              }
            }}
            placeholder="e.g. St Anne's Cathedral"
            style={{ padding: '10px', border: '1px solid #ced4da', borderRadius: '8px', fontSize: '13px' }}
          />
          <button
            onClick={() => searchAddress('end')}
            disabled={isSearchingEnd}
            style={s.btn('#dc3545', isSearchingEnd)}
          >
            {isSearchingEnd ? '...' : 'Set'}
          </button>
        </div>
        {(isLoadingEndSuggestions || endSuggestions.length > 0) && (
          <div style={s.suggestions}>
            {isLoadingEndSuggestions && endSuggestions.length === 0 && (
              <div style={{ padding: '9px 10px', fontSize: '12px', color: '#6c757d' }}>
                Searching...
              </div>
            )}
            {endSuggestions.map((result) => (
              <button
                key={`${result.lat},${result.lon},${result.label}`}
                type="button"
                onClick={() => applyAddressResult('end', result)}
                style={s.suggestionBtn}
                onMouseOver={(e) => (e.currentTarget.style.background = '#f8f9fa')}
                onMouseOut={(e) => (e.currentTarget.style.background = '#fff')}
              >
                {result.label}
              </button>
            ))}
          </div>
        )}
      </label>
    </>
  );

  const pointSummaryPanel = (
    <div style={{ fontSize: '12px', color: '#495057', lineHeight: 1.45 }}>
      <div style={{ fontWeight: 800, color: '#212529', marginBottom: '4px' }}>Selected Points</div>
      <div>
        <strong>Start:</strong>{' '}
        {start ? startLabel || `${start[0].toFixed(5)}, ${start[1].toFixed(5)}` : <em style={{ color: '#adb5bd' }}>not set</em>}
      </div>
      <div>
        <strong>End:</strong>{' '}
        {end ? endLabel || `${end[0].toFixed(5)}, ${end[1].toFixed(5)}` : <em style={{ color: '#adb5bd' }}>not set</em>}
      </div>
      {errorMessage && (
        <div style={{ color: '#856404', marginTop: '4px', fontWeight: 600 }}>
          {errorMessage}
        </div>
      )}
    </div>
  );

  const actionPanel = (
    <div style={{ display: 'grid', gap: '8px', minWidth: '170px' }}>
      <button
        onClick={fetchRoutes}
        disabled={isFindingRoutes}
        style={s.btn('#667eea', isFindingRoutes)}
        onMouseOver={(e) => { if (!isFindingRoutes) e.currentTarget.style.background = '#5568d3'; }}
        onMouseOut={(e) => { if (!isFindingRoutes) e.currentTarget.style.background = '#667eea'; }}
      >
        {isFindingRoutes ? 'Finding...' : 'Find Routes'}
      </button>
      {showEnrichButton && (
        <button
          onClick={enrichSelectedRoute}
          disabled={!canEnrich}
          style={s.btn('#28a745', !canEnrich)}
          onMouseOver={(e) => { if (canEnrich) e.currentTarget.style.background = '#218838'; }}
          onMouseOut={(e) => { if (canEnrich) e.currentTarget.style.background = '#28a745'; }}
        >
          {isEnriching || isSelectedRouteEnriching ? 'Loading OSM...' : 'Retry OSM'}
        </button>
      )}
      <button
        onClick={loadNearbyVenues}
        disabled={isLoadingVenues || (!selectedRoute && !start && !end)}
        style={s.btn('#0d6efd', isLoadingVenues || (!selectedRoute && !start && !end))}
        onMouseOver={(e) => { if (!isLoadingVenues) e.currentTarget.style.background = '#0b5ed7'; }}
        onMouseOut={(e) => { if (!isLoadingVenues) e.currentTarget.style.background = '#0d6efd'; }}
      >
        {isLoadingVenues ? 'Loading Venues...' : 'Load Venues'}
      </button>
    </div>
  );

  useEffect(() => {
    const handleEnterToFindRoutes = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !start ||
        !end ||
        isFindingRoutes
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      if (tagName === 'textarea' || tagName === 'button') return;

      if (target instanceof HTMLInputElement) {
        const query = target.value.trim();
        const addressKind = target.dataset.addressKind;
        const selectedLabel = addressKind === 'start' ? startLabel : addressKind === 'end' ? endLabel : '';
        if (query && query !== selectedLabel) return;
      }

      event.preventDefault();
      void fetchRoutes();
    };

    window.addEventListener('keydown', handleEnterToFindRoutes);
    return () => window.removeEventListener('keydown', handleEnterToFindRoutes);
  }, [start, end, startLabel, endLabel, isFindingRoutes]);

  return (
    <div style={s.container}>
      <div style={s.topBar}>
        {addressSearchPanel}
        {pointSummaryPanel}
        {actionPanel}
      </div>
      {/* ── Sidebar ── */}
      <div style={s.sidebar}>

        {/* Route list */}
        <div style={s.card}>
          <div style={s.sectionTitle}>Available Routes</div>
          {routes.length === 0 ? (
            <div style={{ color: '#adb5bd', fontSize: '13px' }}>
              No routes yet — set your points and click Find Routes.
            </div>
          ) : (
            routes.map((r) => {
              const isSelected = r.id === selectedRouteId;
              const isRecommended = r.id === bestRouteId;
              const hasSteps = (r.osm_summary?.steps_count ?? 0) > 0;
              const sc = r.accessibility_score;

              return (
                <div key={r.id}>
                  <button
                    onClick={() => setSelectedRouteId(r.id)}
                    style={s.routeBtn(isSelected, isRecommended && !isSelected)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <strong style={{ fontSize: '14px' }}>{r.id}</strong>
                      <div>
                        {isRecommended && (
                          <span style={s.badge('#d4edda', '#155724')}>Best</span>
                        )}
                        {hasSteps && (
                          <span style={s.badge('#fff3cd', '#856404')}>Steps</span>
                        )}
                        <span style={s.badge(`${scoreColor(sc)}22`, scoreColor(sc))}>
                          Score {sc}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', color: '#6c757d', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' }}>
                      <span>{(r.distance_m / 1000).toFixed(2)} km</span>
                      <span>{(r.duration_s / 60).toFixed(0)} min</span>
                      <span>{r.elevation_metrics?.ascent_m || 0}m ascent</span>
                      <span>Steps: {r.osm_summary ? r.osm_summary.steps_count : '—'}</span>
                    </div>
                    {!r.osm_summary && (
                      <div style={{ fontSize: '11px', color: '#adb5bd', marginTop: '4px' }}>
                        {enrichingRouteIds.has(r.id) ? 'Loading OSM data...' : 'OSM data not loaded'}
                      </div>
                    )}
                  </button>
                  {r.flags && r.flags.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#856404', marginLeft: '12px', marginBottom: '8px', marginTop: '-4px' }}>
                      {r.flags.join(', ')}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Elevation profile */}
        {selectedRoute?.elevation_profile && (
          <div style={s.card}>
            <div style={s.sectionTitle}>Elevation Profile</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={selectedRoute.elevation_profile}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="dist_m"
                  label={{ value: 'Distance (m)', position: 'insideBottom', offset: -4, fontSize: 11 }}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  dataKey="elev_m"
                  label={{ value: 'Elev (m)', angle: -90, position: 'insideLeft', fontSize: 11 }}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e9ecef' }}
                  formatter={(v: unknown) => [`${(v as number).toFixed(1)} m`, 'Elevation']}
                  labelFormatter={(v: unknown) => `${v} m along route`}
                />
                <Line type="monotone" dataKey="elev_m" stroke="#667eea" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Score breakdown */}
        {selectedRoute?.score_breakdown && (
          <div style={s.card}>
            <div style={s.sectionTitle}>Score Breakdown</div>
            <div style={{ fontSize: '13px', color: '#495057', display: 'grid', gap: '6px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: `${scoreColor(selectedRoute.accessibility_score)}18`,
                borderRadius: '8px',
                fontWeight: 700,
                color: scoreColor(selectedRoute.accessibility_score),
                marginBottom: '4px',
              }}>
                <span>Total score</span>
                <span>{selectedRoute.accessibility_score} (lower = better)</span>
              </div>
              {[
                ['Distance', selectedRoute.score_breakdown.distance_penalty],
                ['Ascent', selectedRoute.score_breakdown.ascent_penalty],
                ['Steep slope distance', selectedRoute.score_breakdown.steep_slope_penalty],
                ['Maximum slope', selectedRoute.score_breakdown.max_slope_penalty],
                ['Steps', selectedRoute.score_breakdown.steps_penalty],
                ['Rough surface', selectedRoute.score_breakdown.surface_penalty],
                ['Missing surface data', selectedRoute.score_breakdown.uncertainty_penalty],
              ].map(([label, val]) => (
                <div
                  key={label as string}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    background: penaltyBackground(Number(val)),
                  }}
                >
                  <span>
                    {label}
                    <span style={{ color: '#6c757d', fontSize: '11px', marginLeft: '8px' }}>
                      {formatScoreContext(selectedRoute, label as string)}
                    </span>
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      color: penaltyColor(Number(val)),
                    }}
                  >
                    +{val}
                  </span>
                </div>
              ))}
              <div style={{ color: '#adb5bd', fontSize: '11px', marginTop: '4px', lineHeight: 1.5 }}>
                Scores are weighted accessibility penalty points, not physical units. Lower is better.
                Amber/red rows show the factors that most increase the route score.
              </div>
            </div>
          </div>
        )}

        {/* Surface details */}
        {selectedRoute?.osm_summary && (() => {
          const osm = selectedRoute.osm_summary!;
          return (
            <div style={s.card}>
              <div style={s.sectionTitle}>Surface Details</div>
              <div style={{ fontSize: '13px', color: '#495057', display: 'grid', gap: '6px' }}>
                <div><strong>Kerb drop tag count:</strong> {osm.kerb_nodes_count}</div>
                {Object.keys(osm.surfaces).length > 0 && (
                  <div>
                    <strong>Surface tag counts:</strong>{' '}
                    {Object.entries(osm.surfaces).map(([k, v]) => `${k} (${v})`).join(', ')}
                  </div>
                )}
                {Object.keys(osm.smoothness).length > 0 && (
                  <div>
                    <strong>Smoothness tag counts:</strong>{' '}
                    {Object.entries(osm.smoothness).map(([k, v]) => `${k} (${v})`).join(', ')}
                  </div>
                )}
                <div>
                  <strong>Unknown surface coverage:</strong>{' '}
                  <span style={{
                    color: osm.unknown_surface_ratio > 0.5 ? '#dc3545' : '#495057',
                    fontWeight: osm.unknown_surface_ratio > 0.5 ? 600 : 400,
                  }}>
                    {(osm.unknown_surface_ratio * 100).toFixed(0)}%
                  </span>
                </div>
                <div style={{ color: '#868e96', fontSize: '11px', lineHeight: 1.5 }}>
                  Numbers in brackets are counts of nearby OpenStreetMap tags found during enrichment, not metres.
                </div>
              </div>
            </div>
          );
        })()}

        {/* Nearby venues */}
        {(routes.length > 0 || venues.length > 0) && (
          <div style={s.card}>
            <div style={s.sectionTitle}>Nearby Venues</div>
            <div style={{ display: 'grid', gap: '8px' }}>
              {venues.slice(0, 8).map((venue) => {
                const isSelected = venue.osm_id === selectedVenue?.osm_id;
                const wColor = wheelchairColor(venue.wheelchair);
                const reviews = venueReviews[venue.osm_id] ?? [];
                const isLoadingReviews = loadingReviewVenueIds.has(venue.osm_id);
                return (
                  <button
                    key={venue.osm_id}
                    onClick={() => selectVenue(venue)}
                    style={{
                      background: isSelected ? '#f0f3ff' : 'white',
                      border: `2px solid ${isSelected ? '#667eea' : '#e9ecef'}`,
                      borderRadius: '10px',
                      padding: '10px 12px',
                      fontSize: '13px',
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: '2px' }}>{venue.name}</div>
                    <div style={{ fontSize: '12px', color: '#6c757d', display: 'flex', gap: '8px' }}>
                      <span>{venue.category}</span>
                      <span style={{ color: wColor, fontWeight: 500 }}>
                        Wheelchair: {venue.wheelchair}
                      </span>
                      <span>
                        {isLoadingReviews
                          ? 'Reviews loading...'
                          : `${reviews.length} review${reviews.length !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected venue */}
        {selectedVenue && (
          <div ref={selectedVenuePanelRef} style={s.card}>
            <div style={s.sectionTitle}>Venue Accessibility</div>
            <div style={{ fontSize: '13px', color: '#495057', display: 'grid', gap: '6px', marginBottom: '16px' }}>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#212529' }}>{selectedVenue.name}</div>
              <div><strong>Category:</strong> {selectedVenue.category}</div>
              <div>
                <strong>Wheelchair access:</strong>{' '}
                <span style={{
                  color: wheelchairColor(selectedVenue.wheelchair),
                  fontWeight: 600,
                  background: `${wheelchairColor(selectedVenue.wheelchair)}18`,
                  padding: '1px 8px',
                  borderRadius: '20px',
                }}>
                  {selectedVenue.wheelchair}
                </span>
              </div>
              {selectedVenue.entrance && <div><strong>Entrance:</strong> {selectedVenue.entrance}</div>}
              {selectedVenue.surface && <div><strong>Surface:</strong> {selectedVenue.surface}</div>}
              {selectedVenue.tactile_paving && (
                <div><strong>Tactile paving:</strong> {selectedVenue.tactile_paving}</div>
              )}
            </div>

            <div
              style={{
                border: '1px solid #e9ecef',
                borderRadius: '8px',
                padding: '10px',
                marginBottom: '12px',
                background: '#fbfcfd',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#212529', marginBottom: '8px' }}>
                {isSelectedVenueReviewsLoading
                  ? 'Loading reviews...'
                  : `${selectedVenueReviews.length} Review${selectedVenueReviews.length !== 1 ? 's' : ''}`}
              </div>
              <div style={{ fontSize: '12px', color: '#6c757d', lineHeight: 1.45 }}>
                Review details open on the map when this venue is selected.
              </div>
            </div>

            <button
              onClick={() =>
                navigate(
                  `/review?venue_id=${encodeURIComponent(selectedVenue.osm_id)}&venue_name=${encodeURIComponent(selectedVenue.name)}`,
                )
              }
              style={{
                ...s.btn('#667eea'),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = '#5568d3')}
              onMouseOut={(e) => (e.currentTarget.style.background = '#667eea')}
            >
              View & Write Reviews
            </button>
          </div>
        )}
      </div>

      {/* ── Map ── */}
      <div style={s.mapWrap}>
        {venues.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              zIndex: 500,
              background: 'rgba(255,255,255,0.94)',
              border: '1px solid #dee2e6',
              borderRadius: '8px',
              padding: '8px 10px',
              display: 'grid',
              gap: '5px',
              fontSize: '12px',
              color: '#343a40',
              boxShadow: '0 3px 10px rgba(0,0,0,0.12)',
            }}
          >
            {[
              ['#0d6efd', 'S', 'Start'],
              ['#dc3545', 'E', 'End'],
              ['#dc3545', '!', 'Steps'],
            ].map(([color, label, text]) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: color,
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    fontWeight: 800,
                  }}
                >
                  {label}
                </span>
                <span>{text}</span>
              </div>
            ))}
            {venues.length > 0 && [
              ['yes', 'A', 'Accessible venue'],
              ['limited', 'L', 'Limited venue'],
              ['no', 'N', 'Not accessible venue'],
              ['unknown', '?', 'Unknown venue'],
            ].map(([status, label, text]) => (
              <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: wheelchairColor(status),
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    fontWeight: 800,
                  }}
                >
                  {label}
                </span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        )}

        {selectedVenue && (
          <div
            style={{
              position: 'absolute',
              left: '16px',
              bottom: '16px',
              zIndex: 650,
              width: 'min(440px, calc(100% - 32px))',
              maxHeight: '58%',
              background: 'rgba(255,255,255,0.96)',
              border: '1px solid #dee2e6',
              borderRadius: '8px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid #e9ecef',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#212529' }}>
                  {selectedVenue.name}
                </div>
                <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '2px' }}>
                  {selectedVenue.category} · Wheelchair: {selectedVenue.wheelchair}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedVenue(null)}
                style={{
                  border: 'none',
                  background: '#f1f3f5',
                  borderRadius: '50%',
                  width: '26px',
                  height: '26px',
                  cursor: 'pointer',
                  fontWeight: 800,
                  color: '#495057',
                }}
                aria-label="Close venue reviews"
              >
                x
              </button>
            </div>

            <div style={{ padding: '12px 14px', maxHeight: '330px', overflowY: 'auto' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, marginBottom: '10px', color: '#212529' }}>
                {isSelectedVenueReviewsLoading
                  ? 'Loading reviews...'
                  : `${selectedVenueReviews.length} Review${selectedVenueReviews.length !== 1 ? 's' : ''}`}
              </div>

              {!isSelectedVenueReviewsLoading && selectedVenueReviews.length === 0 && (
                <div style={{ fontSize: '13px', color: '#6c757d', marginBottom: '12px' }}>
                  No reviews yet.
                </div>
              )}

              {selectedVenueReviews.length > 0 && (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {selectedVenueReviews.map((review) => (
                    <div
                      key={review.id}
                      style={{
                        border: '1px solid #edf0f2',
                        borderRadius: '8px',
                        padding: '10px',
                        background: '#fff',
                        fontSize: '12px',
                        color: '#495057',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                        <strong style={{ color: '#212529' }}>Rating {review.rating}/5</strong>
                        <span style={{ color: '#868e96' }}>
                          {new Date(review.created_at).toLocaleDateString('en-GB')}
                        </span>
                      </div>
                      <div style={{ lineHeight: 1.45 }}>{review.comment}</div>
                      {review.accessibility_notes && (
                        <div style={{ marginTop: '5px', color: '#667eea', lineHeight: 1.4 }}>
                          {review.accessibility_notes}
                        </div>
                      )}
                      {review.image_url && (
                        <img
                          src={`${API_BASE_URL}${review.image_url}`}
                          alt="Review upload"
                          style={{
                            width: '100%',
                            maxHeight: '150px',
                            objectFit: 'cover',
                            borderRadius: '6px',
                            marginTop: '8px',
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() =>
                  navigate(
                    `/review?venue_id=${encodeURIComponent(selectedVenue.osm_id)}&venue_name=${encodeURIComponent(selectedVenue.name)}`,
                  )
                }
                style={{ ...s.btn('#667eea'), marginTop: '12px' }}
                onMouseOver={(e) => (e.currentTarget.style.background = '#5568d3')}
                onMouseOut={(e) => (e.currentTarget.style.background = '#667eea')}
              >
                View & Write Reviews
              </button>
            </div>
          </div>
        )}

        <MapContainer
          center={[54.6, -5.9]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />

          <FitToRoutes routes={routes} />
          <FlyToFocusPoint point={mapFocusPoint} />

          <ClickToSetPoints
            start={start}
            end={end}
            setStart={setStart}
            setEnd={setEnd}
            onPointsChanged={(changed) => {
              if (changed === 'start') {
                setStartLabel('');
                setStartAddress('');
              }
              if (changed === 'end') {
                setEndLabel('');
                setEndAddress('');
              }
              clearRouteDerivedState();
            }}
          />

          {venues.map((venue) => {
            const isSelected = venue.osm_id === selectedVenue?.osm_id;
            const reviews = venueReviews[venue.osm_id] ?? [];
            const isLoadingReviews = loadingReviewVenueIds.has(venue.osm_id);

            return (
              <Marker
                key={venue.osm_id}
                position={[venue.lat, venue.lon]}
                icon={venueMarkerIcon(venue.wheelchair, isSelected)}
                title={`${venue.name}: ${wheelchairLabel(venue.wheelchair)}`}
                eventHandlers={{
                  click: () => selectVenue(venue),
                }}
              >
                <Popup>
                  <div style={{ fontSize: '13px' }}>
                    <strong>{venue.name}</strong>
                    <br />
                    {venue.category}
                    <br />
                    <span style={{ color: wheelchairColor(venue.wheelchair), fontWeight: 700 }}>
                      {wheelchairLabel(venue.wheelchair)}
                    </span>
                    <br />
                    Wheelchair tag: {venue.wheelchair}
                    <br />
                    {isLoadingReviews
                      ? 'Loading reviews...'
                      : `${reviews.length} review${reviews.length !== 1 ? 's' : ''}`}
                    {reviews.length > 0 && (
                      <div
                        style={{
                          maxHeight: '130px',
                          overflowY: 'auto',
                          borderTop: '1px solid #e9ecef',
                          marginTop: '6px',
                          paddingTop: '6px',
                          minWidth: '220px',
                        }}
                      >
                        {reviews.map((review) => (
                          <div key={review.id} style={{ marginBottom: '8px' }}>
                            <strong>Rating {review.rating}/5</strong>
                            <div style={{ lineHeight: 1.35 }}>{review.comment}</div>
                            {review.accessibility_notes && (
                              <div style={{ color: '#667eea', lineHeight: 1.35 }}>
                                {review.accessibility_notes}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <button
                        onClick={() =>
                          navigate(
                            `/review?venue_id=${encodeURIComponent(venue.osm_id)}&venue_name=${encodeURIComponent(venue.name)}`,
                          )
                        }
                        style={{ cursor: 'pointer' }}
                      >
                        View reviews
                      </button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {routes.map((r) => (
            <Polyline
              key={r.id}
              positions={r.geometry}
              pathOptions={{
                color: r.id === selectedRouteId ? '#667eea' : '#dc3545',
                weight: r.id === selectedRouteId ? 6 : 3,
                opacity: r.id === selectedRouteId ? 1 : 0.5,
              }}
            />
          ))}

          {selectedRoute?.osm_summary?.steps_ways?.map((sw, i) => {
            const warningPoint = midpoint(sw.geometry);

            return (
              <React.Fragment key={`steps-${sw.osm_id ?? i}`}>
                <Polyline
                  positions={sw.geometry}
                  pathOptions={{ color: 'red', weight: 8, opacity: 1 }}
                >
                  <Popup>
                    Steps found on this section of the selected route.
                  </Popup>
                </Polyline>
                {warningPoint && (
                  <Marker
                    position={warningPoint}
                    icon={circleMarkerIcon('!', '#dc3545', 24)}
                    title="Step warning"
                  >
                    <Popup>
                      Steps found on this section of the selected route.
                    </Popup>
                  </Marker>
                )}
              </React.Fragment>
            );
          })}

          {selectedRoute?.step_warnings?.map((w, i) => (
            <Marker
              key={`warn-${w.osm_id ?? i}`}
              position={[w.lat, w.lon]}
              icon={circleMarkerIcon('!', '#dc3545', 24)}
              title="Step warning"
            >
              <Popup>Steps at ~{Math.round(w.dist_m)}m along route</Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
};

export default RouteMap;

// ─── Map utilities ────────────────────────────────────────────────────────────

function ClickToSetPoints(props: {
  start: [number, number] | null;
  end: [number, number] | null;
  setStart: (p: [number, number] | null) => void;
  setEnd: (p: [number, number] | null) => void;
  onPointsChanged: (changed: 'start' | 'end') => void;
}) {
  useMapEvents({
    click(e) {
      const p: [number, number] = [e.latlng.lat, e.latlng.lng];
      if (!props.start) {
        props.setStart(p);
        props.onPointsChanged('start');
      } else if (!props.end) {
        props.setEnd(p);
        props.onPointsChanged('end');
      } else {
        props.setStart(p);
        props.setEnd(null);
        props.onPointsChanged('start');
        props.onPointsChanged('end');
      }
    },
  });

  return (
    <>
      {props.start && (
        <Marker position={props.start} icon={circleMarkerIcon('S', '#0d6efd')} title="Start point">
          <Popup>Start point</Popup>
        </Marker>
      )}
      {props.end && (
        <Marker position={props.end} icon={circleMarkerIcon('E', '#dc3545')} title="End point">
          <Popup>End point</Popup>
        </Marker>
      )}
    </>
  );
}

function FitToRoutes({ routes }: { routes: Route[] }) {
  const map = useMap();

  useEffect(() => {
    if (!routes.length) return;
    const allPoints = routes.flatMap((r) => r.geometry);
    if (allPoints.length) {
      map.fitBounds(allPoints as [number, number][], { padding: [30, 30] });
    }
  }, [routes, map]);

  return null;
}

function FlyToFocusPoint({ point }: { point: [number, number] | null }) {
  const map = useMap();
  const lastPointRef = useRef<string>('');

  useEffect(() => {
    if (!point) return;

    const key = `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
    if (lastPointRef.current === key) return;
    lastPointRef.current = key;

    map.flyTo(point, Math.max(map.getZoom(), 16), {
      duration: 0.8,
    });
  }, [point, map]);

  return null;
}
