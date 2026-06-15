import L from 'leaflet';
import type { Route } from './routePlannerTypes';

export function readSaved(stateKey: string) {
  try {
    const raw = window.sessionStorage.getItem(stateKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function midpoint(pts: [number, number][]): [number, number] | null {
  return pts.length ? pts[Math.floor(pts.length / 2)] : null;
}

export function wheelchairColor(value: string) {
  if (value === 'yes') return '#16a34a';
  if (value === 'limited') return '#d97706';
  if (value === 'no') return '#dc2626';
  return '#6b7280';
}

export function wheelchairLabel(value: string) {
  if (value === 'yes') return 'Accessible';
  if (value === 'limited') return 'Limited access';
  if (value === 'no') return 'Not accessible';
  return 'Unknown';
}

export function circleMarkerIcon(label: string, color: string, size = 30): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.max(11, Math.round(size * 0.45))}px">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

export function scoreLevel(score: number): 'low' | 'moderate' | 'high' {
  if (score <= 30) return 'low';
  if (score <= 60) return 'moderate';
  return 'high';
}

export function scoreBadgeClass(level: 'low' | 'moderate' | 'high') {
  if (level === 'low') return 'bg-success/10 text-success border-success/30';
  if (level === 'moderate') return 'bg-warning/10 text-warning border-warning/30';
  return 'bg-danger/10 text-danger border-danger/30';
}

export function scoreBadgeLabel(level: 'low' | 'moderate' | 'high') {
  if (level === 'low') return 'Low Barrier';
  if (level === 'moderate') return 'Moderate Barrier';
  return 'High Barrier';
}

export function penaltyClass(value: number) {
  if (value >= 5) return 'text-danger font-semibold';
  if (value >= 2) return 'text-warning font-medium';
  return 'text-muted-foreground';
}

export function formatScoreContext(route: Route, label: string): string {
  const osm = route.osm_summary;

  if (label === 'Distance') return `${(route.distance_m / 1000).toFixed(2)} km`;
  if (label === 'Ascent') return `${route.elevation_metrics.ascent_m} m`;
  if (label === 'Steep slope') return `${Math.round(route.elevation_metrics.steep_distance_m.gt8)} m >8%`;
  if (label === 'Max slope') return `${route.elevation_metrics.max_slope_percent.toFixed(1)}% peak`;
  if (label === 'Steps') return `${osm?.steps_count ?? 0} section(s)`;
  if (label === 'Rough surface') {
    const rough = Object.keys(osm?.surfaces ?? {}).filter(surface =>
      ['gravel', 'ground', 'dirt', 'mud', 'sand', 'unpaved', 'cobblestone'].includes(surface),
    );
    return rough.length ? rough.join(', ') : 'none';
  }
  if (label === 'Missing data') return `${Math.round((osm?.unknown_surface_ratio ?? 0) * 100)}% unknown`;

  return '';
}
