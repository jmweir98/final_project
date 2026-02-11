import React, { useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from "react";
import { useMap } from "react-leaflet";


// Define the structure of a route
type Route = {
  id: string;
  geometry: [number, number][];
  distance_m: number;
  duration_s: number;
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

    const res = await fetch("http://127.0.0.1:8000/routes/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { lat: start[0], lon: start[1] },
        end: { lat: end[0], lon: end[1] },
      }),
    });

    const data = await res.json();
    console.log("routes from backend:", data.routes);

    setRoutes(data.routes);
    setSelectedRouteId(data.routes?.[0]?.id ?? null);
  };

  return (
    <div>
      <button onClick={fetchRoutes}>Fetch Routes</button>
      
      <div style={{ marginBottom: 10 }}>
        <div><b>Start:</b> {start ? `${start[0].toFixed(5)}, ${start[1].toFixed(5)}` : "not set"}</div>
        <div><b>End:</b> {end ? `${end[0].toFixed(5)}, ${end[1].toFixed(5)}` : "not set"}</div>
      </div>
      
      <div style={{ marginBottom: 10 }}>
        <h3>Routes</h3>
        {routes.length === 0 && <div>No routes yet</div>}

        {routes.map((r) => (
          <div key={r.id} style={{ marginBottom: 6 }}>
            <button onClick={() => setSelectedRouteId(r.id)}>
              {selectedRouteId === r.id ? "✅ " : ""}
              {r.id} — {(r.distance_m / 1000).toFixed(2)} km — {(r.duration_s / 60).toFixed(1)} min
            </button>
          </div>
        ))}
      </div>
      
      {/* Map centered on a default location */}
      <MapContainer 
        center={[54.6, -5.9]} 
        zoom={13} 
        style={{ height: '500px', width: '100%' }}
      >
        {/* OpenStreetMap tiles */}
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
        
        {/* Draw each route as a polyline */}
        {routes.map((r, index) => {
          const isSelected = r.id === selectedRouteId;

          return (
            <Polyline
              key={r.id}
              positions={r.geometry}
              pathOptions={{
                color: isSelected ? "blue" : "red",
                weight: isSelected ? 6 : 3,
                opacity: isSelected ? 1 : 0.6,
              }}
            />
          );
        })}

      </MapContainer>
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
