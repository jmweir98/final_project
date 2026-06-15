import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Navigation, MapPin, Route as RouteIcon, Loader2, AlertTriangle, TrendingUp, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { RouteCard } from './RouteCard';
import { VenueCard } from './VenueCard';
import { ClickToSetPoints, FitToRoutes, FlyToFocusPoint } from './RouteMapLeaflet';
import type { GeocodeResult, Review, Route, SavedState, Venue } from './routePlannerTypes';
import {
  circleMarkerIcon,
  formatScoreContext,
  midpoint,
  penaltyClass,
  readSaved,
  scoreBadgeClass,
  scoreLevel,
  wheelchairColor,
  wheelchairLabel,
} from './routePlannerHelpers';

const API_BASE_URL = 'http://127.0.0.1:8000';
const ROUTE_MAP_STATE_KEY = 'routewise.routeMapState';




const RouteMap: React.FC = () => {
  const navigate = useNavigate();
  const saved = useRef<SavedState | null>(readSaved(ROUTE_MAP_STATE_KEY));

  const [routes, setRoutes] = useState<Route[]>(() => saved.current?.routes ?? []);
  const [start, setStart] = useState<[number, number] | null>(() => saved.current?.start ?? null);
  const [end, setEnd] = useState<[number, number] | null>(() => saved.current?.end ?? null);
  const [mapFocusPoint, setMapFocusPoint] = useState<[number, number] | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(() => saved.current?.selectedRouteId ?? null);
  const [enrichingRouteIds, setEnrichingRouteIds] = useState<Set<string>>(new Set());
  const [venues, setVenues] = useState<Venue[]>(() => saved.current?.venues ?? []);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(() => saved.current?.selectedVenue ?? null);
  const [venueReviews, setVenueReviews] = useState<Record<string, Review[]>>(() => saved.current?.venueReviews ?? {});
  const [loadingReviewVenueIds, setLoadingReviewVenueIds] = useState<Set<string>>(new Set());
  const [isLoadingVenues, setIsLoadingVenues] = useState(false);
  const [isFindingRoutes, setIsFindingRoutes] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [startAddress, setStartAddress] = useState(() => saved.current?.startAddress ?? '');
  const [endAddress, setEndAddress] = useState(() => saved.current?.endAddress ?? '');
  const [startSuggestions, setStartSuggestions] = useState<GeocodeResult[]>([]);
  const [endSuggestions, setEndSuggestions] = useState<GeocodeResult[]>([]);
  const [isLoadingStartSugg, setIsLoadingStartSugg] = useState(false);
  const [isLoadingEndSugg, setIsLoadingEndSugg] = useState(false);
  const [startLabel, setStartLabel] = useState(() => saved.current?.startLabel ?? '');
  const [endLabel, setEndLabel] = useState(() => saved.current?.endLabel ?? '');
  const [activeTab, setActiveTab] = useState('routes');
  const [isSearchingStart, setIsSearchingStart] = useState(false);
  const [isSearchingEnd, setIsSearchingEnd] = useState(false);
  const routeVersionRef = useRef(0);
  const routesRef = useRef<Route[]>([]);
  const autoEnrichedRouteIdsRef = useRef<Set<string>>(new Set());
  const enrichmentQueueRunningRef = useRef(false);
  const venuePanelRef = useRef<HTMLDivElement | null>(null);

  const selectedRoute = routes.find(r => r.id === selectedRouteId);
  const bestRouteId = routes.reduce<string | null>((b, r) => {
    if (!b) return r.id;
    const best = routes.find(c => c.id === b);
    return best && best.accessibility_score <= r.accessibility_score ? b : r.id;
  }, null);
  const selectedVenueReviews = selectedVenue ? venueReviews[selectedVenue.osm_id] ?? [] : [];
  const isVenueReviewsLoading = Boolean(selectedVenue && loadingReviewVenueIds.has(selectedVenue.osm_id));
  const canEnrich = Boolean(selectedRoute && !selectedRoute.osm_summary && !enrichingRouteIds.has(selectedRoute.id));
  const showEnrichBtn = Boolean(selectedRoute && (!selectedRoute.osm_summary || enrichingRouteIds.has(selectedRoute.id)));

  // Persist state
  useEffect(() => {
    routesRef.current = routes;
    window.sessionStorage.setItem(ROUTE_MAP_STATE_KEY, JSON.stringify({
      routes, start, end, selectedRouteId, venues, selectedVenue,
      venueReviews, startAddress, endAddress, startLabel, endLabel,
    }));
  }, [routes, start, end, selectedRouteId, venues, selectedVenue, venueReviews, startAddress, endAddress, startLabel, endLabel]);

  const getCurrentRoutes = (): Route[] => {
    if (routesRef.current.length) return routesRef.current;
    try {
      const raw = window.sessionStorage.getItem(ROUTE_MAP_STATE_KEY);
      const parsed = raw ? JSON.parse(raw) as SavedState : null;
      return Array.isArray(parsed?.routes) ? parsed.routes : [];
    } catch {
      return [];
    }
  };

  useEffect(() => {
    if (!selectedVenue) return;
    window.setTimeout(() => venuePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [selectedVenue?.osm_id]);

  // Autocomplete for start
  useEffect(() => {
    const q = startAddress.trim();
    if (q.length < 3 || q === startLabel) { setStartSuggestions([]); return; }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setIsLoadingStartSugg(true);
      try {
        const res = await fetch(`${API_BASE_URL}/geocode/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) { const d = await res.json(); setStartSuggestions(Array.isArray(d?.results) ? d.results.slice(0, 5) : []); }
      } catch { if (!ctrl.signal.aborted) setStartSuggestions([]); }
      finally { if (!ctrl.signal.aborted) setIsLoadingStartSugg(false); }
    }, 350);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [startAddress, startLabel]);

  // Autocomplete for end
  useEffect(() => {
    const q = endAddress.trim();
    if (q.length < 3 || q === endLabel) { setEndSuggestions([]); return; }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setIsLoadingEndSugg(true);
      try {
        const res = await fetch(`${API_BASE_URL}/geocode/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) { const d = await res.json(); setEndSuggestions(Array.isArray(d?.results) ? d.results.slice(0, 5) : []); }
      } catch { if (!ctrl.signal.aborted) setEndSuggestions([]); }
      finally { if (!ctrl.signal.aborted) setIsLoadingEndSugg(false); }
    }, 350);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [endAddress, endLabel]);

  const clearDerived = () => {
    routeVersionRef.current += 1;
    autoEnrichedRouteIdsRef.current = new Set();
    enrichmentQueueRunningRef.current = false;
    setRoutes([]); setSelectedRouteId(null); setVenues([]); setSelectedVenue(null);
    setVenueReviews({}); setLoadingReviewVenueIds(new Set()); setEnrichingRouteIds(new Set());
  };

  const applyGeocode = (kind: 'start' | 'end', result: GeocodeResult) => {
    const pt: [number, number] = [result.lat, result.lon];
    setMapFocusPoint(pt);
    if (kind === 'start') { setStart(pt); setStartAddress(result.label); setStartLabel(result.label); setStartSuggestions([]); }
    else { setEnd(pt); setEndAddress(result.label); setEndLabel(result.label); setEndSuggestions([]); }
    clearDerived();
  };

  const searchAddress = async (kind: 'start' | 'end') => {
    const q = kind === 'start' ? startAddress : endAddress;
    if (q.trim().length < 3) { setErrorMessage('Enter at least 3 characters.'); return; }
    const setLoading = kind === 'start' ? setIsSearchingStart : setIsSearchingEnd;
    setLoading(true); setErrorMessage('');
    try {
      const res = await fetch(`${API_BASE_URL}/geocode/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) { setErrorMessage(`Search failed (${res.status})`); return; }
      const d = await res.json();
      const results: GeocodeResult[] = Array.isArray(d?.results) ? d.results : [];
      if (!results.length) { setErrorMessage(`No address found for "${q}"`); return; }
      applyGeocode(kind, results[0]);
    } catch { setErrorMessage('Address search failed — backend unreachable.'); }
    finally { setLoading(false); }
  };

  const handleAddressEnter = (kind: 'start' | 'end') => {
    const q = kind === 'start' ? startAddress.trim() : endAddress.trim();
    const lbl = kind === 'start' ? startLabel : endLabel;
    if (start && end && (!q || q === lbl)) { void fetchRoutes(); return; }
    void searchAddress(kind);
  };

  const loadVenueReviews = async (venueId: string) => {
    if (venueReviews[venueId] || loadingReviewVenueIds.has(venueId)) return;
    setLoadingReviewVenueIds(p => new Set(p).add(venueId));
    try {
      const res = await fetch(`${API_BASE_URL}/venues/${encodeURIComponent(venueId)}/reviews`);
      if (res.ok) { const d = await res.json(); setVenueReviews(p => ({ ...p, [venueId]: d?.reviews ?? [] })); }
    } catch { /* silent */ }
    finally { setLoadingReviewVenueIds(p => { const n = new Set(p); n.delete(venueId); return n; }); }
  };

  const selectVenue = (v: Venue) => { setSelectedVenue(v); void loadVenueReviews(v.osm_id); };

  const enrichRoute = async (route: Route, showErr = false, ver = routeVersionRef.current, attempts = 1) => {
    if (route.osm_summary || ver !== routeVersionRef.current) return;
    setEnrichingRouteIds(p => new Set(p).add(route.id));
    try {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const res = await fetch(`${API_BASE_URL}/route/enrich`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geometry: route.geometry, distance_m: route.distance_m, elevation_metrics: route.elevation_metrics }),
        });
        if (res.ok) {
          const d = await res.json();
          if (ver !== routeVersionRef.current) return;
          setRoutes(p => p.map(x => x.id === route.id ? { ...x, osm_summary: d.osm_summary ?? x.osm_summary, accessibility_score: d.accessibility_score ?? x.accessibility_score, score_breakdown: d.score_breakdown ?? x.score_breakdown, flags: d.flags ?? x.flags } : x).sort((a, b) => a.accessibility_score - b.accessibility_score));
          return;
        }
        if (attempt === attempts) {
          if (showErr) setErrorMessage(`Enrich failed: ${await res.text()}`);
          return;
        }
        await new Promise(resolve => window.setTimeout(resolve, 1500 * attempt));
        if (ver !== routeVersionRef.current) return;
      }
    } catch { if (showErr) setErrorMessage('Enrich failed — backend unreachable.'); }
    finally {
      if (ver !== routeVersionRef.current) return;
      setEnrichingRouteIds(p => { const n = new Set(p); n.delete(route.id); return n; });
    }
  };

  const fetchRoutes = async () => {
    if (!start || !end) { setErrorMessage('Set start and end points first.'); return; }
    setErrorMessage(''); setIsFindingRoutes(true);
    const ver = routeVersionRef.current + 1; routeVersionRef.current = ver;
    autoEnrichedRouteIdsRef.current = new Set();
    setEnrichingRouteIds(new Set());
    try {
      const res = await fetch(`${API_BASE_URL}/routes/compare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: { lat: start[0], lon: start[1] }, end: { lat: end[0], lon: end[1] } }),
      });
      if (!res.ok) { const e = await res.json().catch(() => null); setErrorMessage(`Could not find routes: ${e?.detail ?? `HTTP ${res.status}`}`); return; }
      const d = await res.json();
      const sorted = (Array.isArray(d?.routes) ? d.routes as Route[] : []).sort((a, b) => a.accessibility_score - b.accessibility_score);
      setRoutes(sorted); setSelectedRouteId(sorted[0]?.id ?? null);
      setVenues([]); setSelectedVenue(null); setVenueReviews({}); setLoadingReviewVenueIds(new Set());
      setActiveTab('routes');
    } catch { setErrorMessage('Could not reach the backend — make sure it is running on port 8000.'); }
    finally { setIsFindingRoutes(false); }
  };

  const enrichSelectedRoute = async () => {
    if (!selectedRoute || selectedRoute.osm_summary) return;
    setIsEnriching(true);
    try { await enrichRoute(selectedRoute, true); } finally { setIsEnriching(false); }
  };

  const loadNearbyVenues = async () => {
    const pt = selectedRoute?.geometry?.length ? selectedRoute.geometry[Math.floor(selectedRoute.geometry.length / 2)] : end ?? start;
    if (!pt) { setErrorMessage('Select a route first.'); return; }
    setIsLoadingVenues(true); setErrorMessage('');
    try {
      const res = await fetch(`${API_BASE_URL}/venues/nearby?lat=${pt[0]}&lon=${pt[1]}&radius_m=350`);
      if (!res.ok) { setErrorMessage(`Venue lookup failed (${res.status})`); return; }
      const d = await res.json();
      const loaded: Venue[] = Array.isArray(d?.venues) ? d.venues : [];
      setVenueReviews({}); setLoadingReviewVenueIds(new Set()); setVenues(loaded);
      if (loaded.length > 0) selectVenue(loaded[0]);
      loaded.forEach((v, i) => window.setTimeout(() => void loadVenueReviews(v.osm_id), i * 100));
      setActiveTab('venues');
    } catch { setErrorMessage('Venue lookup failed — backend unreachable.'); }
    finally { setIsLoadingVenues(false); }
  };

  useEffect(() => {
    if (!routes.length || isFindingRoutes || enrichmentQueueRunningRef.current) return;
    const ver = routeVersionRef.current;
    enrichmentQueueRunningRef.current = true;

    const runQueue = async () => {
      await new Promise(resolve => window.setTimeout(resolve, 400));
      while (ver === routeVersionRef.current) {
        const currentRoutes = getCurrentRoutes()
          .slice()
          .sort((a, b) => a.accessibility_score - b.accessibility_score);
        const next = currentRoutes.find(route => {
          const key = `${ver}:${route.id}`;
          return !route.osm_summary && !autoEnrichedRouteIdsRef.current.has(key);
        });
        if (!next) break;
        autoEnrichedRouteIdsRef.current.add(`${ver}:${next.id}`);
        await enrichRoute(next, false, ver, 3);
        await new Promise(resolve => window.setTimeout(resolve, 800));
      }
      if (ver === routeVersionRef.current) enrichmentQueueRunningRef.current = false;
    };

    void runQueue();
    return () => { if (ver === routeVersionRef.current) enrichmentQueueRunningRef.current = false; };
  }, [routes.length, isFindingRoutes]);

  // Enter key shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (!start || !end || isFindingRoutes) return;
      const target = e.target as HTMLElement;
      if (target.tagName.toLowerCase() === 'textarea' || target.tagName.toLowerCase() === 'button') return;
      if (target instanceof HTMLInputElement) {
        const q = target.value.trim();
        const lbl = target.dataset.addressKind === 'start' ? startLabel : endLabel;
        if (q && q !== lbl) return;
      }
      e.preventDefault(); void fetchRoutes();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [start, end, startLabel, endLabel, isFindingRoutes]);

  // ─── Panels ───────────────────────────────────────────────────────────────

  const routesPanel = (
    <div className="p-3 space-y-2">
      {routes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <RouteIcon className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No routes yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Set start &amp; end, then click Find Routes</p>
        </div>
      ) : (
        routes.map(route => (
          <RouteCard
            key={route.id}
            route={route}
            isSelected={route.id === selectedRouteId}
            isBest={route.id === bestRouteId}
            isEnriching={enrichingRouteIds.has(route.id)}
            onPreview={() => setSelectedRouteId(route.id)}
            onSelect={() => { setSelectedRouteId(route.id); setActiveTab('details'); }}
          />
        ))
      )}
    </div>
  );

  const detailsPanel = selectedRoute ? (
    <div className="p-3 space-y-3">
      {/* Elevation */}
      {selectedRoute.elevation_profile?.length > 0 && (
        <div className="border border-border rounded-xl p-3 bg-card">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />Elevation Profile
          </h4>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={selectedRoute.elevation_profile}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.922 0 0)" />
              <XAxis dataKey="dist_m" tick={{ fontSize: 10 }} />
              <YAxis dataKey="elev_m" tick={{ fontSize: 10 }} width={32} />
              <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} formatter={(v: unknown) => [`${(v as number).toFixed(1)}m`, 'Elev']} labelFormatter={v => `${v}m along`} />
              <Line type="monotone" dataKey="elev_m" stroke="oklch(0.205 0 0)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Score breakdown */}
      {selectedRoute.score_breakdown && (
        <div className="border border-border rounded-xl p-3 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Score Breakdown</h4>
            <span className={cn('text-base font-bold px-2.5 py-1 rounded-md border', scoreBadgeClass(scoreLevel(selectedRoute.accessibility_score)))}>
              {selectedRoute.accessibility_score} total
            </span>
          </div>
          <div className="space-y-1">
            {([
              ['Distance', selectedRoute.score_breakdown.distance_penalty],
              ['Ascent', selectedRoute.score_breakdown.ascent_penalty],
              ['Steep slope', selectedRoute.score_breakdown.steep_slope_penalty],
              ['Max slope', selectedRoute.score_breakdown.max_slope_penalty],
              ['Steps', selectedRoute.score_breakdown.steps_penalty],
              ['Rough surface', selectedRoute.score_breakdown.surface_penalty],
              ['Missing data', selectedRoute.score_breakdown.uncertainty_penalty],
            ] as [string, number][]).map(([label, val]) => (
              <div key={label} className="flex items-center justify-between text-sm py-1">
                <span className="text-foreground">{label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground text-xs">{formatScoreContext(selectedRoute, label)}</span>
                  <span className={cn('w-8 text-right', penaltyClass(val))}>+{val}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Lower is better. Amber/red = highest penalty factors.</p>
        </div>
      )}

      {/* Surface details */}
      {selectedRoute.osm_summary && (
        <div className="border border-border rounded-xl p-3 bg-card">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Surface Details</h4>
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <div><span className="text-foreground font-medium">Kerb tags:</span> {selectedRoute.osm_summary.kerb_nodes_count}</div>
            {Object.keys(selectedRoute.osm_summary.surfaces).length > 0 && (
              <div><span className="text-foreground font-medium">Surfaces:</span> {Object.entries(selectedRoute.osm_summary.surfaces).map(([k, v]) => `${k} (${v})`).join(', ')}</div>
            )}
            <div>
              <span className="text-foreground font-medium">Unknown surface: </span>
              <span className={selectedRoute.osm_summary.unknown_surface_ratio > 0.5 ? 'text-danger font-semibold' : ''}>
                {Math.round(selectedRoute.osm_summary.unknown_surface_ratio * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {(selectedRoute.flags?.length > 0 || (selectedRoute.osm_summary?.steps_count ?? 0) > 0) && (
        <div className="border border-warning/30 bg-warning/5 rounded-xl p-3">
          <h4 className="text-sm font-semibold text-warning uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />Warnings
          </h4>
          <ul className="space-y-1">
            {(selectedRoute.osm_summary?.steps_count ?? 0) > 0 && (
              <li className="text-sm text-warning flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 rounded-full bg-warning shrink-0" />
                {selectedRoute.osm_summary!.steps_count} step section(s) on this route
              </li>
            )}
            {selectedRoute.flags?.map((f, i) => (
              <li key={i} className="text-sm text-warning flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 rounded-full bg-warning shrink-0" />{f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2">
        {showEnrichBtn && (
          <Button variant="outline" size="sm" className="w-full" onClick={enrichSelectedRoute} disabled={!canEnrich}>
            {isEnriching || enrichingRouteIds.has(selectedRoute.id)
              ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Loading OSM...</>
              : <><RefreshCw className="h-3.5 w-3.5" />Retry OSM Enrichment</>}
          </Button>
        )}
        <Button variant="outline" size="sm" className="w-full" onClick={loadNearbyVenues} disabled={isLoadingVenues}>
          {isLoadingVenues ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading Venues...</> : <><MapPin className="h-3.5 w-3.5" />Load Nearby Venues</>}
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
      Select a route to see details
    </div>
  );

  const venuesPanel = (
    <div className="p-3 space-y-2">
      {venues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
          <MapPin className="h-8 w-8 opacity-20 mb-2" />
          <p className="text-sm">No venues loaded</p>
          <p className="text-xs opacity-70 mt-1">Go to Details and click Load Nearby Venues</p>
        </div>
      ) : (
        venues.slice(0, 8).map(venue => (
          <VenueCard
            key={venue.osm_id}
            venue={venue}
            isSelected={venue.osm_id === selectedVenue?.osm_id}
            reviewCount={(venueReviews[venue.osm_id] ?? []).length}
            isLoadingReviews={loadingReviewVenueIds.has(venue.osm_id)}
            onSelect={() => selectVenue(venue)}
            onOpenReviews={() => navigate(`/review?venue_id=${encodeURIComponent(venue.osm_id)}&venue_name=${encodeURIComponent(venue.name)}`)}
          />
        ))
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search bar */}
      <div className="bg-card border-b border-border px-4 py-3 shrink-0 z-[800] relative">
        <div className="flex flex-col sm:flex-row gap-2">
          {/* From */}
          <div className="flex-1 relative">
            <div className="relative">
              <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary pointer-events-none" />
              <Input
                data-address-kind="start"
                value={startAddress}
                onChange={e => { setStartAddress(e.target.value); setStartLabel(''); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddressEnter('start'); } }}
                placeholder="From — e.g. Belfast City Hall"
                className="pl-9 h-11 text-sm"
              />
            </div>
            {(isLoadingStartSugg || startSuggestions.length > 0) && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-[900]">
                {isLoadingStartSugg && startSuggestions.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>}
                {startSuggestions.map(r => (
                  <button key={`${r.lat},${r.lon}`} type="button" onClick={() => applyGeocode('start', r)}
                    className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent border-b border-border/50 last:border-0">
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* To */}
          <div className="flex-1 relative">
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-destructive pointer-events-none" />
              <Input
                data-address-kind="end"
                value={endAddress}
                onChange={e => { setEndAddress(e.target.value); setEndLabel(''); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddressEnter('end'); } }}
                placeholder="To — e.g. St Anne's Cathedral"
                className="pl-9 h-11 text-sm"
              />
            </div>
            {(isLoadingEndSugg || endSuggestions.length > 0) && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-[900]">
                {isLoadingEndSugg && endSuggestions.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>}
                {endSuggestions.map(r => (
                  <button key={`${r.lat},${r.lon}`} type="button" onClick={() => applyGeocode('end', r)}
                    className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent border-b border-border/50 last:border-0">
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-2 shrink-0">
            <Button onClick={fetchRoutes} disabled={isFindingRoutes} size="sm" className="h-11 px-5">
              {isFindingRoutes ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Finding...</> : <><RouteIcon className="h-3.5 w-3.5" />Find Routes</>}
            </Button>
            {(startAddress || endAddress) && (
              <Button variant="outline" size="sm" className="h-11 px-3" onClick={() => {
                setStart(null); setEnd(null); setStartAddress(''); setEndAddress(''); setStartLabel(''); setEndLabel(''); clearDerived(); setErrorMessage('');
              }}>✕</Button>
            )}
          </div>
        </div>

        {/* Status row */}
        {(start || end || errorMessage) && (
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            {start && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary inline-block" />From: {startLabel || `${start[0].toFixed(4)}, ${start[1].toFixed(4)}`}</span>}
            {end && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive inline-block" />To: {endLabel || `${end[0].toFixed(4)}, ${end[1].toFixed(4)}`}</span>}
            {errorMessage && <span className="text-warning font-medium">{errorMessage}</span>}
          </div>
        )}
      </div>

      {/* Map + Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          {/* Venue popup */}
          {selectedVenue && (
            <div className="absolute left-4 bottom-4 z-[650] w-[min(400px,calc(100%-32px))] max-h-[55%] bg-card/96 border border-border rounded-xl shadow-xl overflow-hidden flex flex-col">
              <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
                <div>
                  <p className="font-semibold text-sm text-foreground">{selectedVenue.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{selectedVenue.category} · {wheelchairLabel(selectedVenue.wheelchair)}</p>
                </div>
                <button onClick={() => setSelectedVenue(null)} className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:bg-muted/80 shrink-0 text-xs">✕</button>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <p className="text-xs font-semibold text-foreground mb-2">
                  {isVenueReviewsLoading ? 'Loading reviews...' : `${selectedVenueReviews.length} Review${selectedVenueReviews.length !== 1 ? 's' : ''}`}
                </p>
                {!isVenueReviewsLoading && selectedVenueReviews.length === 0 && <p className="text-xs text-muted-foreground">No reviews yet.</p>}
                <div className="space-y-2">
                  {selectedVenueReviews.map(rv => (
                    <div key={rv.id} className="border border-border rounded-lg p-2.5 text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="font-semibold text-foreground">Rating {rv.rating}/5</span>
                        <span className="text-muted-foreground">{new Date(rv.created_at).toLocaleDateString('en-GB')}</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{rv.comment}</p>
                      {rv.accessibility_notes && <p className="mt-1 text-primary">{rv.accessibility_notes}</p>}
                      {rv.image_url && <img src={`${API_BASE_URL}${rv.image_url}`} alt="" className="mt-2 w-full max-h-28 object-cover rounded" />}
                    </div>
                  ))}
                </div>
                <Button size="sm" className="w-full mt-3" onClick={() => navigate(`/review?venue_id=${encodeURIComponent(selectedVenue.osm_id)}&venue_name=${encodeURIComponent(selectedVenue.name)}`)}>
                  View &amp; Write Reviews
                </Button>
              </div>
            </div>
          )}

          {/* Map legend */}
          {venues.length > 0 && (
            <div className="absolute top-3 right-3 z-[500] bg-card/95 border border-border rounded-xl p-3 shadow-sm text-xs space-y-1.5">
              {[['#2563eb','S','Start'],['#dc2626','E','End'],['#dc2626','!','Steps'],['#16a34a','A','Accessible'],['#d97706','L','Limited'],['#dc2626','N','Not accessible'],['#6b7280','?','Unknown']].map(([c,l,t]) => (
                <div key={t} className="flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: c, fontSize: '9px', fontWeight: 800 }}>{l}</span>
                  <span className="text-muted-foreground">{t}</span>
                </div>
              ))}
            </div>
          )}

          <MapContainer center={[54.6, -5.9]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            <FitToRoutes routes={routes} />
            <FlyToFocusPoint point={mapFocusPoint} />
            <ClickToSetPoints start={start} end={end} setStart={setStart} setEnd={setEnd}
              onPointsChanged={changed => {
                if (changed === 'start') { setStartLabel(''); setStartAddress(''); }
                if (changed === 'end') { setEndLabel(''); setEndAddress(''); }
                clearDerived();
              }}
            />
            {venues.map(v => (
              <Marker key={v.osm_id} position={[v.lat, v.lon]}
                icon={circleMarkerIcon(v.wheelchair === 'yes' ? 'A' : v.wheelchair === 'limited' ? 'L' : v.wheelchair === 'no' ? 'N' : '?', wheelchairColor(v.wheelchair), v.osm_id === selectedVenue?.osm_id ? 34 : 28)}
                eventHandlers={{ click: () => selectVenue(v) }}>
                <Popup><div className="text-sm"><strong>{v.name}</strong><br />{v.category}<br /><span style={{ color: wheelchairColor(v.wheelchair), fontWeight: 700 }}>{wheelchairLabel(v.wheelchair)}</span></div></Popup>
              </Marker>
            ))}
            {routes.map(r => (
              <Polyline key={r.id} positions={r.geometry}
                pathOptions={{ color: r.id === selectedRouteId ? '#2563eb' : '#94a3b8', weight: r.id === selectedRouteId ? 6 : 3, opacity: r.id === selectedRouteId ? 1 : 0.5 }} />
            ))}
            {selectedRoute?.osm_summary?.steps_ways?.map((sw, i) => {
              const wp = midpoint(sw.geometry);
              return (
                <React.Fragment key={`sw-${sw.osm_id ?? i}`}>
                  <Polyline positions={sw.geometry} pathOptions={{ color: 'red', weight: 8, opacity: 1 }}><Popup>Steps on this section.</Popup></Polyline>
                  {wp && <Marker position={wp} icon={circleMarkerIcon('!', '#dc2626', 24)}><Popup>Steps here.</Popup></Marker>}
                </React.Fragment>
              );
            })}
            {selectedRoute?.step_warnings?.map((w, i) => (
              <Marker key={`warn-${w.osm_id ?? i}`} position={[w.lat, w.lon]} icon={circleMarkerIcon('!', '#dc2626', 24)}>
                <Popup>Steps at ~{Math.round(w.dist_m)}m along route</Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Right sidebar */}
        <aside className="hidden md:flex w-[560px] border-l border-border flex-col bg-background overflow-hidden shrink-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <div className="px-3 pt-2 pb-0 shrink-0">
              <TabsList className="w-full">
                <TabsTrigger value="routes" className="flex-1 text-sm">Routes {routes.length > 0 && `(${routes.length})`}</TabsTrigger>
                <TabsTrigger value="details" className="flex-1 text-sm" disabled={!selectedRouteId}>Details</TabsTrigger>
                <TabsTrigger value="venues" className="flex-1 text-sm">Venues {venues.length > 0 && `(${venues.length})`}</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="routes" className="flex-1 overflow-hidden m-0">
              <ScrollArea className="h-full">{routesPanel}</ScrollArea>
            </TabsContent>
            <TabsContent value="details" className="flex-1 overflow-hidden m-0">
              <ScrollArea className="h-full">{detailsPanel}</ScrollArea>
            </TabsContent>
            <TabsContent value="venues" className="flex-1 overflow-hidden m-0">
              <ScrollArea className="h-full">{venuesPanel}</ScrollArea>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
};

export default RouteMap;

