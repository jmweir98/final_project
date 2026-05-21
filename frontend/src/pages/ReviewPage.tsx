import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

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

const RATING_COLORS = ['#dc3545', '#fd7e14', '#ffc107', '#20c997', '#28a745'];

const StarRating: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => {
  const [hover, setHover] = useState(0);
  const active = hover || value;

  return (
    <div>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(star)}
            style={{
              fontSize: '36px',
              color: star <= active ? '#f59e0b' : '#d1d5db',
              background: 'none',
              border: 'none',
              padding: '0 2px',
              cursor: 'pointer',
              lineHeight: 1,
              transition: 'color 0.1s, transform 0.1s',
              transform: star <= active ? 'scale(1.1)' : 'scale(1)',
            }}
            aria-label={`Rate ${star} star${star !== 1 ? 's' : ''}`}
          >
            ★
          </button>
        ))}
      </div>
      {active > 0 && (
        <span style={{
          fontSize: '13px',
          fontWeight: 500,
          color: RATING_COLORS[active - 1],
          background: `${RATING_COLORS[active - 1]}18`,
          padding: '2px 10px',
          borderRadius: '20px',
        }}>
          {RATING_LABELS[active - 1]}
        </span>
      )}
    </div>
  );
};

const StarDisplay: React.FC<{ rating: number }> = ({ rating }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
    <span style={{ color: '#f59e0b', fontSize: '16px', letterSpacing: '1px' }}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
    <span style={{
      fontSize: '12px',
      fontWeight: 500,
      color: RATING_COLORS[rating - 1],
      background: `${RATING_COLORS[rating - 1]}18`,
      padding: '1px 8px',
      borderRadius: '20px',
    }}>
      {RATING_LABELS[rating - 1]}
    </span>
  </div>
);

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1.5px solid #dee2e6',
  fontSize: '14px',
  color: '#212529',
  background: '#fff',
  outline: 'none',
  transition: 'border-color 0.15s',
  marginTop: '6px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: '#495057',
  marginBottom: '0',
  letterSpacing: '0.2px',
};

const ReviewPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const venueId = searchParams.get('venue_id') ?? '';
  const venueName = searchParams.get('venue_name') ?? 'Unknown Venue';

  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rating, setRating] = useState(5);
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
    } catch {
      // silently fail — reviews list just stays empty
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReviews();
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, [venueId]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImage(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
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

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const res = await fetch(`${API_BASE_URL}/reviews`, { method: 'POST', body: formData });
      if (res.ok) {
        setRating(5);
        setComment('');
        setNotes('');
        setImage(null);
        setImagePreview(null);
        setSuccessMessage('Review submitted — thank you!');
        successTimer.current = setTimeout(() => setSuccessMessage(''), 5000);
        await loadReviews();
      } else {
        const err = await res.text();
        setErrorMessage(`Submission failed: ${err}`);
      }
    } catch {
      setErrorMessage('Could not reach the server. Check the backend is running.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: 'white',
    borderRadius: '10px',
    padding: '24px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
    marginBottom: '20px',
  };

  const goBackToPlanner = () => navigate('/');

  if (!venueId) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>?</div>
        <h2 style={{ margin: '0 0 8px' }}>No venue selected</h2>
        <p style={{ color: '#6c757d', marginBottom: '24px' }}>
          Go back to the route planner and select a nearby venue first.
        </p>
        <button
          onClick={goBackToPlanner}
          style={{
            background: '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 24px',
            fontSize: '15px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Back to Route Planner
        </button>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: '1180px', margin: '0 auto', padding: '28px 24px 60px' }}>
      <button
        onClick={goBackToPlanner}
        style={{
          position: 'sticky',
          top: '72px',
          zIndex: 20,
          background: '#667eea',
          border: 'none',
          borderRadius: '8px',
          padding: '10px 16px',
          fontSize: '14px',
          color: 'white',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '20px',
          fontWeight: 700,
          transition: 'all 0.15s',
          boxShadow: '0 3px 10px rgba(0,0,0,0.18)',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = '#5568d3';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = '#667eea';
        }}
      >
        Back to loaded route
      </button>

      <div style={{ marginBottom: '28px' }}>
        <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600, color: '#667eea', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          Community Reviews
        </p>
        <h1 style={{ margin: '0', fontSize: '28px', fontWeight: 700, color: '#212529' }}>
          {venueName}
        </h1>
      </div>

      <div
        style={{
          display: 'grid',
          gap: '24px',
        }}
      >
      {/* Review submission form */}
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 20px', fontSize: '18px', fontWeight: 600, color: '#212529' }}>
          Write a Review
        </h2>

        {successMessage && (
          <div style={{
            background: '#d4edda',
            color: '#155724',
            border: '1px solid #c3e6cb',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '14px',
            fontWeight: 500,
          }}>
            {successMessage}
          </div>
        )}

        {errorMessage && (
          <div style={{
            background: '#f8d7da',
            color: '#721c24',
            border: '1px solid #f5c6cb',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '14px',
          }}>
            {errorMessage}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 0.9fr) minmax(360px, 1.1fr)',
            gap: '20px 24px',
            alignItems: 'start',
          }}
        >
          <div>
            <label style={labelStyle}>Accessibility Rating</label>
            <div style={{ marginTop: '10px' }}>
              <StarRating value={rating} onChange={setRating} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              Your Review <span style={{ color: '#dc3545' }}>*</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              required
              placeholder="Describe the accessibility of this venue — entrance, ramps, internal layout, staff helpfulness..."
              style={{ ...inputStyle, resize: 'vertical' }}
              onFocus={(e) => (e.target.style.borderColor = '#667eea')}
              onBlur={(e) => (e.target.style.borderColor = '#dee2e6')}
            />
          </div>

          <div>
            <label style={labelStyle}>Accessibility Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. step at entrance, wide doorways, accessible toilet on ground floor..."
              style={{ ...inputStyle, resize: 'vertical' }}
              onFocus={(e) => (e.target.style.borderColor = '#667eea')}
              onBlur={(e) => (e.target.style.borderColor = '#dee2e6')}
            />
          </div>

          <div>
            <label style={labelStyle}>Photo (optional)</label>
            <div style={{
              marginTop: '8px',
              border: '2px dashed #dee2e6',
              borderRadius: '10px',
              padding: '16px',
              textAlign: 'center',
              cursor: 'pointer',
              background: '#f8f9fa',
              transition: 'border-color 0.15s',
            }}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleImageChange}
                style={{ display: 'block', width: '100%', cursor: 'pointer' }}
                id="review-image"
              />
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#6c757d' }}>
                JPG, PNG or WebP — max 3 MB
              </p>
            </div>

            {imagePreview && (
              <div style={{ marginTop: '12px', position: 'relative', display: 'inline-block' }}>
                <img
                  src={imagePreview}
                  alt="Upload preview"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '240px',
                    borderRadius: '10px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    display: 'block',
                  }}
                />
                <button
                  type="button"
                  onClick={() => { setImage(null); setImagePreview(null); }}
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    background: 'rgba(0,0,0,0.55)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50%',
                    width: '26px',
                    height: '26px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    lineHeight: '26px',
                    textAlign: 'center',
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !comment.trim()}
            style={{
              gridColumn: '1 / -1',
              background: isSubmitting || !comment.trim() ? '#adb5bd' : '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              padding: '14px 28px',
              fontSize: '15px',
              fontWeight: 600,
              cursor: isSubmitting || !comment.trim() ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
              letterSpacing: '0.2px',
            }}
            onMouseOver={(e) => {
              if (!isSubmitting && comment.trim()) e.currentTarget.style.background = '#5568d3';
            }}
            onMouseOut={(e) => {
              if (!isSubmitting && comment.trim()) e.currentTarget.style.background = '#667eea';
            }}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Review'}
          </button>
        </form>
      </div>

      {/* Existing reviews */}
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 600, color: '#212529' }}>
          {isLoading ? 'Loading reviews...' : `${reviews.length} Community Review${reviews.length !== 1 ? 's' : ''}`}
        </h2>

        {!isLoading && reviews.length === 0 && (
          <div style={{
            ...cardStyle,
            textAlign: 'center',
            color: '#6c757d',
            padding: '48px 28px',
          }}>
            <p style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 500 }}>No reviews yet</p>
            <p style={{ margin: 0, fontSize: '14px' }}>Be the first to share your experience!</p>
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: '20px',
            alignItems: 'start',
          }}
        >
        {reviews.map((review) => (
          <div key={review.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <StarDisplay rating={review.rating} />
              <span style={{ fontSize: '12px', color: '#adb5bd', flexShrink: 0, marginLeft: '12px' }}>
                {new Date(review.created_at).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>

            <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#212529', lineHeight: 1.65 }}>
              {review.comment}
            </p>

            {review.accessibility_notes && (
              <div style={{
                background: '#f8f9fa',
                borderLeft: '3px solid #667eea',
                borderRadius: '0 6px 6px 0',
                padding: '8px 12px',
                fontSize: '13px',
                color: '#495057',
                marginTop: '8px',
              }}>
                <strong>Accessibility notes:</strong> {review.accessibility_notes}
              </div>
            )}

            {review.image_url && (
              <img
                src={`${API_BASE_URL}${review.image_url}`}
                alt="Review photo"
                style={{
                  width: '100%',
                  maxHeight: '320px',
                  objectFit: 'cover',
                  borderRadius: '10px',
                  marginTop: '14px',
                }}
              />
            )}
          </div>
        ))}
        </div>
      </div>
      </div>
    </div>
  );
};

export default ReviewPage;
