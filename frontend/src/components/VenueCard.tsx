import { MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Venue } from './routePlannerTypes';
import { wheelchairLabel } from './routePlannerHelpers';

type VenueCardProps = {
  venue: Venue;
  isSelected: boolean;
  reviewCount: number;
  isLoadingReviews: boolean;
  onSelect: () => void;
  onOpenReviews: () => void;
};

export function VenueCard({
  venue,
  isSelected,
  reviewCount,
  isLoadingReviews,
  onSelect,
  onOpenReviews,
}: VenueCardProps) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left border rounded-xl p-3 transition-all',
        isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/40',
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <p className="font-semibold text-base text-foreground truncate">{venue.name}</p>
          <p className="text-sm text-muted-foreground">{venue.category}</p>
        </div>
        <Badge
          className={cn(
            'text-xs px-2 shrink-0 border',
            venue.wheelchair === 'yes' && 'bg-success/10 text-success border-success/30',
            venue.wheelchair === 'limited' && 'bg-warning/10 text-warning border-warning/30',
            venue.wheelchair === 'no' && 'bg-danger/10 text-danger border-danger/30',
            !['yes', 'limited', 'no'].includes(venue.wheelchair) && 'bg-muted text-muted-foreground border-border',
          )}
        >
          {wheelchairLabel(venue.wheelchair)}
        </Badge>
      </div>

      <div className="flex items-center justify-between mt-2">
        <span className="text-sm text-muted-foreground flex items-center gap-1">
          <MessageSquare className="h-3.5 w-3.5" />
          {isLoadingReviews ? 'Loading...' : `${reviewCount} review${reviewCount !== 1 ? 's' : ''}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-3 text-sm text-primary hover:text-primary"
          onClick={event => {
            event.stopPropagation();
            onOpenReviews();
          }}
        >
          Reviews &rarr;
        </Button>
      </div>
    </button>
  );
}
