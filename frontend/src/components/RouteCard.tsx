import { AlertTriangle, Check, Clock, Loader2, MapPin, Route as RouteIcon, TrendingDown, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Route } from './routePlannerTypes';
import { scoreBadgeClass, scoreBadgeLabel, scoreLevel } from './routePlannerHelpers';

type RouteCardProps = {
  route: Route;
  isSelected: boolean;
  isBest: boolean;
  isEnriching: boolean;
  onPreview: () => void;
  onSelect: () => void;
};

export function RouteCard({ route, isSelected, isBest, isEnriching, onPreview, onSelect }: RouteCardProps) {
  const level = scoreLevel(route.accessibility_score);

  return (
    <div
      className={cn(
        'border rounded-xl p-3 transition-all cursor-pointer',
        isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/40',
      )}
      onClick={onPreview}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-base text-foreground">{route.id}</span>
            {isBest && (
              <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-primary/10 text-primary border-0">
                Best
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {(route.distance_m / 1000).toFixed(2)} km
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {(route.duration_s / 60).toFixed(0)} min
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-foreground">{route.accessibility_score}</div>
          <div className="text-xs text-muted-foreground">score</div>
        </div>
      </div>

      <Badge className={cn('text-xs px-2.5 py-1 mb-3 border', scoreBadgeClass(level))}>
        {scoreBadgeLabel(level)}
      </Badge>

      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-sm mt-2">
        <span className="flex items-center gap-1 text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5 text-success" />+{route.elevation_metrics.ascent_m}m
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <TrendingDown className="h-3.5 w-3.5 text-danger" />-{route.elevation_metrics.descent_m}m
        </span>
        <span className="text-muted-foreground">{route.elevation_metrics.max_slope_percent.toFixed(1)}% max</span>
        {route.osm_summary ? (
          <>
            <span className={cn('flex items-center gap-1', route.osm_summary.steps_count > 0 ? 'text-warning' : 'text-muted-foreground')}>
              {route.osm_summary.steps_count > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
              {route.osm_summary.steps_count} steps
            </span>
            <span className="text-muted-foreground col-span-2">
              {Math.round(route.osm_summary.unknown_surface_ratio * 100)}% unknown surface
            </span>
          </>
        ) : (
          <span className="col-span-3 text-xs text-muted-foreground/60 flex items-center gap-1">
            {isEnriching ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading OSM data...
              </>
            ) : (
              'OSM data not yet loaded'
            )}
          </span>
        )}
      </div>

      {route.flags?.length > 0 && (
        <p className="text-xs text-warning mt-2">{route.flags.join(' · ')}</p>
      )}

      <Button
        variant={isSelected ? 'default' : 'outline'}
        size="sm"
        className="w-full h-9 text-sm mt-3"
        onClick={event => {
          event.stopPropagation();
          onSelect();
        }}
      >
        {isSelected ? (
          <>
            <Check className="h-3 w-3" />Selected
          </>
        ) : (
          <>
            <RouteIcon className="h-3 w-3" />Select
          </>
        )}
      </Button>
    </div>
  );
}
