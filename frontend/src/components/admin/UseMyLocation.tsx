import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Crosshair, Loader2, MapPin, RotateCcw } from 'lucide-react';
import {
  captureLocation, evaluateFixQuality, geolocationUnavailableReason,
  type LocationQualityPolicy,
} from '../../utils/eventQr';

/**
 * "Use my current location" for the Administrator's event form.
 *
 * WHAT THIS IS: a convenience for filling in the event's centre point from the
 * administrator's own device. It is NOT a second attendance check and not a new
 * location system - it reuses the application's existing `captureLocation` and
 * applies the SAME published quality policy the server enforces, so a fix
 * accepted here is a fix check-in will accept later.
 *
 * SAFETY RULES BUILT IN, NOT LEFT TO THE CALLER:
 *
 *  - Nothing is requested until the administrator clicks. Opening the form never
 *    prompts, because a permission prompt nobody asked for is how people learn
 *    to dismiss these without reading.
 *  - Nothing is written. Detecting a location touches no field and no database;
 *    only the explicit "Apply this location" copies the numbers into the form,
 *    and only "Schedule event"/"Save" persists the event.
 *  - The radius, the required attendance minutes, the name, the schedule and the
 *    status are never touched. A device cannot know how big a building is, so
 *    the radius stays exactly as the administrator typed it.
 *  - Every failure path leaves the form exactly as it was, and a result that
 *    arrives after a newer request, after cancellation, or after the form closed
 *    is DISCARDED rather than applied late.
 */
type Phase = 'idle' | 'locating' | 'review' | 'error';

export interface DetectedLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}

const EXPLAINER = 'Use this only when you are physically at the event venue. '
  + 'This detects your device\u2019s location, not the venue by name.';

const RADIUS_NOTE = 'Your device can tell you where you are, but not how large the venue is. '
  + 'The check-in radius is left exactly as you set it.';

export default function UseMyLocation({ onApply, policy }: {
  /** Called ONLY on explicit confirmation, and only with a usable fix. */
  onApply: (location: DetectedLocation) => void;
  policy?: LocationQualityPolicy;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [fix, setFix] = useState<DetectedLocation | null>(null);
  const [message, setMessage] = useState('');

  /**
   * Identifies the newest request. Any result carrying an older number belongs
   * to a superseded request and is thrown away, which is what stops a slow
   * reading from overwriting the form after the administrator has already
   * retried, cancelled, or moved on.
   */
  const requestId = useRef(0);
  // Cleared when the form unmounts, so a late callback cannot touch state.
  const alive = useRef(true);
  /**
   * STRICT MODE SAFE, AND THIS IS NOT OPTIONAL.
   *
   * React's StrictMode deliberately mounts, unmounts and remounts every effect
   * in development. An effect that only sets the flag in its cleanup would leave
   * `alive.current === false` for the rest of the component's life, so EVERY
   * reading would be silently discarded as "stale" and the feature would appear
   * to do nothing at all - which is exactly the bug this was found by.
   *
   * The flag is therefore re-armed on every mount, not only cleared on unmount.
   * The request counter still makes an in-flight reading from a previous mount
   * harmless, because the id it captured no longer matches.
   */
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; requestId.current += 1; };
  }, []);

  // NOTE ON RESETTING WHEN A DIFFERENT VENUE IS CHOSEN.
  // This used to watch a `resetKey` prop and clear the state from an effect.
  // That is an error, not a style preference: resetting state in an effect body
  // schedules a cascading render, and eslint's `react-hooks/set-state-in-effect`
  // fails the build on it.
  //
  // The parent remounts this component with `key={venueSelectedId}` instead.
  // A remount is the idiomatic way to discard state wholesale, and it is also
  // STRICTLY SAFER than the effect was: unmounting runs the cleanup above,
  // which bumps the request counter, so a geolocation still in flight resolves
  // as superseded and cannot land on the newly chosen venue. The effect version
  // only cleared the visible state and left the pending request live.

  const detect = useCallback(async () => {
    const blocked = geolocationUnavailableReason();
    if (blocked) {
      setPhase('error');
      setMessage(blocked);
      return;
    }
    const id = requestId.current + 1;
    requestId.current = id;
    setPhase('locating');
    setMessage('');
    setFix(null);
    try {
      // The existing application helper: high accuracy requested, and
      // `maximumAge: 0` so a cached fix is never presented as fresh.
      const reading = await captureLocation();
      if (!alive.current || requestId.current !== id) return;

      const quality = evaluateFixQuality(reading, policy);
      if (!quality.acceptable) {
        setPhase('error');
        setMessage(quality.reason ?? 'That reading could not be used.');
        return;
      }
      setFix({
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracy: reading.accuracy,
        capturedAt: reading.capturedAt,
      });
      setPhase('review');
    } catch (error) {
      if (!alive.current || requestId.current !== id) return;
      // The helper already turns each failure into an actionable sentence.
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'Your location could not be read.');

    }
  }, [policy]);

  const cancel = useCallback(() => {
    // Invalidate any in-flight read so it cannot land after the cancel.
    requestId.current += 1;
    setPhase('idle');
    setFix(null);
    setMessage('');
  }, []);

  const apply = useCallback(() => {
    if (!fix) return;
    onApply(fix);
    cancel();
  }, [fix, onApply, cancel]);

  const accuracy = fix ? Math.round(fix.accuracy) : null;

  return (
    <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-3 sm:col-span-2" data-testid="use-my-location">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="app-button-secondary inline-flex items-center gap-2"
          onClick={() => void detect()}
          disabled={phase === 'locating'}
          data-testid="use-my-location-button"
        >
          {phase === 'locating' ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} />}
          {phase === 'locating' ? 'Finding your location\u2026' : 'Use my current location'}
        </button>
        {(phase === 'review' || phase === 'error') && (
          <button type="button" className="app-button-secondary inline-flex items-center gap-2" onClick={() => void detect()} data-testid="use-my-location-retry">
            <RotateCcw size={15} /> Retry
          </button>
        )}
      </div>

      <p className="mt-2 text-xs leading-5 text-[#64748B]" data-testid="use-my-location-explainer">{EXPLAINER}</p>

      {phase === 'locating' && (
        <p className="mt-2 flex items-center gap-2 text-xs font-medium text-sky-700" role="status" data-testid="use-my-location-loading">
          <Loader2 size={14} className="animate-spin" /> Waiting for your device\u2026
        </p>
      )}

      {phase === 'error' && (
        <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-rose-700" role="alert" data-testid="use-my-location-error">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </p>
      )}

      {phase === 'review' && fix && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3" data-testid="use-my-location-review">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Reading found</p>
          <dl className="mt-2 grid gap-1 text-xs text-[#334155] sm:grid-cols-3">
            <div><dt className="inline font-semibold">Latitude: </dt><dd className="inline" data-testid="detected-latitude">{fix.latitude}</dd></div>
            <div><dt className="inline font-semibold">Longitude: </dt><dd className="inline" data-testid="detected-longitude">{fix.longitude}</dd></div>
            <div><dt className="inline font-semibold">Accuracy: </dt><dd className="inline" data-testid="detected-accuracy">±{accuracy} m</dd></div>
          </dl>
          <p className="mt-2 text-xs leading-5 text-[#64748B]" data-testid="use-my-location-radius-note">{RADIUS_NOTE}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="app-button-primary inline-flex items-center gap-2" onClick={apply} data-testid="apply-detected-location">
              <MapPin size={15} /> Apply this location
            </button>
            <button type="button" className="app-button-secondary" onClick={cancel} data-testid="cancel-detected-location">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

