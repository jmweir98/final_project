import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Star, Upload, X, Loader2, Accessibility } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const API_BASE_URL = 'http://127.0.0.1:8000';

type Review = {
  id: number;
  venue_osm_id: string;
  venue_name: string;
  rating: number;
  comment: string;
  accessibility_notes: string;
  image_url: string | null;
  created_at: string;
};

const RATING_LABELS = ['Not accessible', 'Difficult access', 'Mixed accessibility', 'Mostly accessible', 'Very accessible'];

const ReviewPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const venueId = searchParams.get('venue_id') ?? '';
  const venueName = searchParams.get('venue_name') ?? 'Unknown Venue';

  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rating, setRating] = useState(5);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState('');
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadReviews = async () => {
    if (!venueId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/venues/${encodeURIComponent(venueId)}/reviews`);
      if (res.ok) {
        const data = await res.json();
        setReviews(Array.isArray(data?.reviews) ? data.reviews : []);
      }
    } catch { /* silent */ }
    finally { setIsLoading(false); }
  };

  useEffect(() => {
    loadReviews();
    return () => { if (successTimer.current) clearTimeout(successTimer.current); };
  }, [venueId]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImage(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else { setImagePreview(null); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    const formData = new FormData();
    formData.append('venue_osm_id', venueId);
    formData.append('venue_name', venueName);
    formData.append('rating', String(rating));
    formData.append('comment', comment);
    formData.append('accessibility_notes', notes);
    if (image) formData.append('image', image);

    setIsSubmitting(true); setErrorMessage('');
    try {
      const res = await fetch(`${API_BASE_URL}/reviews`, { method: 'POST', body: formData });
      if (res.ok) {
        setRating(5); setComment(''); setNotes(''); setImage(null); setImagePreview(null);
        setSuccessMessage('Review submitted — thank you!');
        successTimer.current = setTimeout(() => setSuccessMessage(''), 5000);
        await loadReviews();
      } else { setErrorMessage(`Submission failed: ${await res.text()}`); }
    } catch { setErrorMessage('Could not reach the server.'); }
    finally { setIsSubmitting(false); }
  };

  if (!venueId) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-center p-8">
        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Accessibility className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">No venue selected</h2>
        <p className="text-sm text-muted-foreground mb-6">Go back to the route planner and select a venue first.</p>
        <Button onClick={() => navigate('/')}>Back to Route Planner</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Page header */}
      <div className="bg-card border-b border-border px-4 py-3 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Back" className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-primary uppercase tracking-wider">Community Reviews</p>
          <h1 className="text-base font-semibold text-foreground truncate">{venueName}</h1>
        </div>
        <Badge variant="secondary">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</Badge>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">

          {/* Submission form */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">Write a Review</h2>

            {successMessage && (
              <div className="mb-4 px-4 py-3 rounded-lg border border-success/30 bg-success/5 text-success text-sm font-medium">
                {successMessage}
              </div>
            )}
            {errorMessage && (
              <div className="mb-4 px-4 py-3 rounded-lg border border-danger/30 bg-danger/5 text-danger text-sm">
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Stars */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Accessibility Rating</Label>
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5].map(v => (
                    <button key={v} type="button"
                      onClick={() => setRating(v)}
                      onMouseEnter={() => setHoveredRating(v)}
                      onMouseLeave={() => setHoveredRating(0)}
                      className="p-0.5 focus:outline-none rounded"
                      aria-label={`Rate ${v} stars`}
                    >
                      <Star className={cn('h-7 w-7 transition-colors', (hoveredRating || rating) >= v ? 'fill-warning text-warning' : 'text-muted-foreground/30')} />
                    </button>
                  ))}
                  {rating > 0 && <span className="ml-2 text-sm text-muted-foreground">{RATING_LABELS[rating - 1]}</span>}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="comment" className="text-xs text-muted-foreground mb-1.5 block">
                    Your Review <span className="text-danger">*</span>
                  </Label>
                  <Textarea id="comment" value={comment} onChange={e => setComment(e.target.value)}
                    rows={4} required placeholder="Describe accessibility — entrance, ramps, layout, staff helpfulness..."
                    className="resize-none text-sm" />
                </div>
                <div>
                  <Label htmlFor="notes" className="text-xs text-muted-foreground mb-1.5 block">Accessibility Notes (optional)</Label>
                  <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)}
                    rows={4} placeholder="e.g. step at entrance, wide doorways, accessible toilet on ground floor..."
                    className="resize-none text-sm" />
                </div>
              </div>

              {/* Photo upload */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Photo (optional)</Label>
                {imagePreview ? (
                  <div className="relative inline-block">
                    <img src={imagePreview} alt="Preview" className="w-28 h-28 object-cover rounded-lg border border-border" />
                    <button type="button" onClick={() => { setImage(null); setImagePreview(null); }}
                      className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-foreground text-background flex items-center justify-center"
                      aria-label="Remove image">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center w-28 h-28 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20">
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} className="sr-only" />
                    <div className="text-center">
                      <Upload className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
                      <span className="text-[10px] text-muted-foreground">Upload</span>
                    </div>
                  </label>
                )}
              </div>

              <Button type="submit" disabled={isSubmitting || !comment.trim()} className="w-full">
                {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting...</> : 'Submit Review'}
              </Button>
            </form>
          </div>

          {/* Existing reviews */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">
              {isLoading ? 'Loading reviews...' : `${reviews.length} Community Review${reviews.length !== 1 ? 's' : ''}`}
            </h2>

            {!isLoading && reviews.length === 0 && (
              <div className="bg-card border border-border rounded-xl p-10 text-center">
                <Accessibility className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm font-medium text-foreground">No reviews yet</p>
                <p className="text-xs text-muted-foreground mt-1">Be the first to share your experience!</p>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              {reviews.map(review => (
                <div key={review.id} className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-0.5 mb-1">
                        {[1,2,3,4,5].map(v => (
                          <Star key={v} className={cn('h-4 w-4', review.rating >= v ? 'fill-warning text-warning' : 'text-muted-foreground/20')} />
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">{RATING_LABELS[review.rating - 1]}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 ml-3">
                      {new Date(review.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed mb-2">{review.comment}</p>
                  {review.accessibility_notes && (
                    <div className="bg-muted/50 border-l-2 border-primary rounded-r-lg px-3 py-2 text-xs text-muted-foreground mb-2">
                      <span className="font-medium text-foreground">Accessibility notes:</span> {review.accessibility_notes}
                    </div>
                  )}
                  {review.image_url && (
                    <img src={`${API_BASE_URL}${review.image_url}`} alt="Review photo"
                      className="w-full max-h-48 object-cover rounded-lg mt-2 border border-border" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReviewPage;
