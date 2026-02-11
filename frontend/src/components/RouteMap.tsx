import React, { useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '20px',
    backgroundColor: '#f8f9fa',
  },
  header: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '30px',
    borderRadius: '12px',
    marginBottom: '20px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
  },
  title: {
    margin: '0 0 10px 0',
    fontSize: '32px',
    fontWeight: '600',
  },
  subtitle: {
    margin: 0,
    fontSize: '16px',
    opacity: 0.9,
  },
  mainContent: {
    display: 'grid',
    gridTemplateColumns: '400px 1fr',
    gap: '20px',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '15px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  },
  button: {
    backgroundColor: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: '500',
    cursor: 'pointer',
    width: '100%',
    transition: 'all 0.2s',
  },
  locationInfo: {
    fontSize: '14px',
    color: '#495057',
    lineHeight: '1.8',
  },
  routeButton: {
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '14px',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left' as const,
    transition: 'all 0.2s',
    marginBottom: '8px',
  },
  routeButtonSelected: {
    borderColor: '#667eea',
    backgroundColor: '#f0f3ff',
  },
  routeButtonRecommended: {
    borderColor: '#28a745',
    backgroundColor: '#f0fff4',
  },
  badge: {
    display: 'inline-block',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '500',
    marginLeft: '8px',
  },
  badgeWarning: {
    backgroundColor: '#fff3cd',
    color: '#856404',
  },
  badgeSuccess: {
    backgroundColor: '#d4edda',
    color: '#155724',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '15px',
    color: '#212529',
  },
  detailsGrid: {
    display: 'grid',
    gap: '8px',
    fontSize: '14px',
    color: '#495057',
  },
  mapContainer: {
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    height: '600px',
  },
};


// Define the structure of a route
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
    surfaces: Record<string, number>;
    smoothness: Record<string, number>;
    highway_types: Record<string, number>;
    kerb_nodes_count: number;
    unknown_surface_ratio: number;
    sample_points_used: number;
  };
  accessibility_score: number;
  flags: string[];
};


const RouteMap: React.FC = () => {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [start, setStart] = useState<[number, number] | null>(null);
  const [end, setEnd] = useState<[number, number] | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // Fetch routes from the API
  const fetchRoutes = async () => {
    if (!start || !end) {
      alert("Click once to set START, then click again to set END.");
      return;
    }

    try {
      const res = await fetch("http://127.0.0.1:8000/routes/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { lat: start[0], lon: start[1] },
          end: { lat: end[0], lon: end[1] },
        }),
      });

      // If backend returns 4xx/5xx, don't try to use routes
      if (!res.ok) {
        const errText = await res.text(); // might not be JSON
        console.error("Backend error:", res.status, errText);
        alert(`Backend error ${res.status}. Check console.`);
        setRoutes([]);
        setSelectedRouteId(null);
        return;
      }

      const data = await res.json();
      const routesFromBackend = Array.isArray(data?.routes) ? data.routes : [];

      console.log("routes from backend:", routesFromBackend);

      setRoutes(routesFromBackend);
      setSelectedRouteId(routesFromBackend[0]?.id ?? null);
    } catch (err) {
      console.error("Network/parse error:", err);
      alert("Could not fetch routes (backend down or network error).");
      setRoutes([]);
      setSelectedRouteId(null);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>♿ Accessible Route Planner</h1>
        <p style={styles.subtitle}>Find wheelchair-friendly routes with elevation and surface analysis</p>
      </div>

      <div style={styles.mainContent}>
        <div style={styles.sidebar}>
          <div style={styles.card}>
            <button 
              onClick={fetchRoutes} 
              style={styles.button}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#5568d3'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#667eea'}
            >
              🗺️ Find Routes
            </button>
          </div>

          <div style={styles.card}>
            <div style={styles.sectionTitle}>📍 Locations</div>
            <div style={styles.locationInfo}>
              <div><strong>Start:</strong> {start ? `${start[0].toFixed(5)}, ${start[1].toFixed(5)}` : "Click on map"}</div>
              <div><strong>End:</strong> {end ? `${end[0].toFixed(5)}, ${end[1].toFixed(5)}` : "Click on map"}</div>
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.sectionTitle}>🛣️ Available Routes</div>
            {routes.length === 0 && <div style={{ color: '#6c757d', fontSize: '14px' }}>No routes yet. Click two points on the map.</div>}

            {routes.map((r, index) => {
              const isRecommended = index === 0;
              const hasSteps = (r.osm_summary?.steps_count ?? 0) > 0;
              const isSelected = r.id === selectedRouteId;
              
              return (
                <div key={r.id}>
                  <button 
                    onClick={() => setSelectedRouteId(r.id)} 
                    style={{
                      ...styles.routeButton,
                      ...(isSelected ? styles.routeButtonSelected : {}),
                      ...(isRecommended && !isSelected ? styles.routeButtonRecommended : {}),
                    }}
                  >
                    <div style={{ marginBottom: '6px' }}>
                      {isSelected && "✅ "}
                      {isRecommended && "⭐ "}
                      <strong>{r.id}</strong>
                      {hasSteps && <span style={styles.badgeWarning}>⚠️ Steps</span>}
                      {isRecommended && <span style={styles.badgeSuccess}>Recommended</span>}
                    </div>
                    <div style={{ fontSize: '13px', color: '#6c757d' }}>
                      {(r.distance_m / 1000).toFixed(2)} km • {(r.duration_s / 60).toFixed(0)} min • Score: {r.accessibility_score}
                    </div>
                    <div style={{ fontSize: '13px', color: '#6c757d' }}>
                      ↗️ {r.elevation_metrics?.ascent_m || 0}m ascent • Steps: {r.osm_summary ? r.osm_summary.steps_count : "—"}
                    </div>
                  </button>
                  {r.flags && r.flags.length > 0 && (
                    <div style={{ fontSize: '12px', color: '#856404', marginLeft: 12, marginBottom: 8, marginTop: -4 }}>
                      ⚠️ {r.flags.join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {selectedRouteId && routes.find(r => r.id === selectedRouteId)?.elevation_profile && (
            <div style={styles.card}>
              <div style={styles.sectionTitle}>📊 Elevation Profile</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={routes.find(r => r.id === selectedRouteId)?.elevation_profile}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="dist_m" 
                    label={{ value: 'Distance (m)', position: 'insideBottom', offset: -5 }} 
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    dataKey="elev_m" 
                    label={{ value: 'Elevation (m)', angle: -90, position: 'insideLeft' }} 
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip />
                  <Line type="monotone" dataKey="elev_m" stroke="#667eea" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {selectedRouteId && routes.find(r => r.id === selectedRouteId)?.osm_summary && (
            <div style={styles.card}>
              <div style={styles.sectionTitle}>🛤️ Surface Details</div>
              {(() => {
                const selected = routes.find(r => r.id === selectedRouteId);
                const osm = selected?.osm_summary;
                if (!osm) return null;
                
                return (
                  <div style={styles.detailsGrid}>
                    <div>🚧 <strong>Kerbs:</strong> {osm.kerb_nodes_count}</div>
                    {Object.keys(osm.surfaces).length > 0 && (
                      <div>🏞️ <strong>Surfaces:</strong> {Object.entries(osm.surfaces).map(([k, v]) => `${k} (${v})`).join(', ')}</div>
                    )}
                    {Object.keys(osm.smoothness).length > 0 && (
                      <div>✨ <strong>Smoothness:</strong> {Object.entries(osm.smoothness).map(([k, v]) => `${k} (${v})`).join(', ')}</div>
                    )}
                    <div>❓ <strong>Unknown surface:</strong> {(osm.unknown_surface_ratio * 100).toFixed(0)}%</div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <div style={styles.mapContainer}>
          <MapContainer 
            center={[54.6, -5.9]} 
            zoom={13} 
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
            
            <FitToRoutes routes={routes} />
            
            <ClickToSetPoints
              start={start}
              end={end}
              setStart={setStart}
              setEnd={setEnd}
            />
            
            {routes.map((r) => {
              const isSelected = r.id === selectedRouteId;

              return (
                <Polyline
                  key={r.id}
                  positions={r.geometry}
                  pathOptions={{
                    color: isSelected ? "#667eea" : "#dc3545",
                    weight: isSelected ? 6 : 3,
                    opacity: isSelected ? 1 : 0.6,
                  }}
                />
              );
            })}
          </MapContainer>
        </div>
      </div>
    </div>
  );
};

export default RouteMap;

function ClickToSetPoints(props: {
  start: [number, number] | null;
  end: [number, number] | null;
  setStart: (p: [number, number] | null) => void;
  setEnd: (p: [number, number] | null) => void;
}) {
  useMapEvents({
    click(e) {
      const p: [number, number] = [e.latlng.lat, e.latlng.lng];

      // 1st click = start, 2nd click = end, 3rd click = reset start
      if (!props.start) {
        props.setStart(p);
      } else if (!props.end) {
        props.setEnd(p);
      } else {
        props.setStart(p);
        props.setEnd(null);
      }
    },
  });

  return (
    <>
      {props.start && <Marker position={props.start} />}
      {props.end && <Marker position={props.end} />}
    </>
  );
}

function FitToRoutes({ routes }: { routes: Route[] }) {
  const map = useMap();

  useEffect(() => {
    if (!routes.length) return;

    const allPoints = routes.flatMap(r => r.geometry);
    if (allPoints.length) {
      map.fitBounds(allPoints as any, { padding: [30, 30] });
    }
  }, [routes, map]);

  return null;
}
