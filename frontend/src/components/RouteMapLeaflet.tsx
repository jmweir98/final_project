import { useEffect, useRef } from 'react';
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import type { Route } from './routePlannerTypes';
import { circleMarkerIcon } from './routePlannerHelpers';

type ClickToSetPointsProps = {
  start: [number, number] | null;
  end: [number, number] | null;
  setStart: (point: [number, number] | null) => void;
  setEnd: (point: [number, number] | null) => void;
  onPointsChanged: (changed: 'start' | 'end') => void;
};

export function ClickToSetPoints(props: ClickToSetPointsProps) {
  useMapEvents({
    click(event) {
      const point: [number, number] = [event.latlng.lat, event.latlng.lng];

      if (!props.start) {
        props.setStart(point);
        props.onPointsChanged('start');
      } else if (!props.end) {
        props.setEnd(point);
        props.onPointsChanged('end');
      } else {
        props.setStart(point);
        props.setEnd(null);
        props.onPointsChanged('start');
        props.onPointsChanged('end');
      }
    },
  });

  return (
    <>
      {props.start && (
        <Marker position={props.start} icon={circleMarkerIcon('S', '#2563eb')}>
          <Popup>Start</Popup>
        </Marker>
      )}
      {props.end && (
        <Marker position={props.end} icon={circleMarkerIcon('E', '#dc2626')}>
          <Popup>End</Popup>
        </Marker>
      )}
    </>
  );
}

export function FitToRoutes({ routes }: { routes: Route[] }) {
  const map = useMap();

  useEffect(() => {
    if (!routes.length) return;

    const points = routes.flatMap(route => route.geometry);
    if (points.length) map.fitBounds(points as [number, number][], { padding: [30, 30] });
  }, [routes, map]);

  return null;
}

export function FlyToFocusPoint({ point }: { point: [number, number] | null }) {
  const map = useMap();
  const lastPointKey = useRef('');

  useEffect(() => {
    if (!point) return;

    const key = `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
    if (lastPointKey.current === key) return;

    lastPointKey.current = key;
    map.flyTo(point, Math.max(map.getZoom(), 16), { duration: 0.8 });
  }, [point, map]);

  return null;
}
