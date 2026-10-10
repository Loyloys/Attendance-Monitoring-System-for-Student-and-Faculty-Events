import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, LocateFixed, MapPin, PauseCircle, Radio, RefreshCcw } from 'lucide-react';
import { eventApi } from '../../data/eventApi';
import type { AttendanceSession } from '../../types/eventAttendance';
import { captureLocation, type LocationFix } from '../../utils/eventQr';
import { PAUSE_TEXT } from '../../utils/attendanceTracking';

/** How often the browser reports while tracking. Mirrors the server policy. */
const REPORT_INTERVAL_MS = 10_000;
/** Matches the server staleness rule: silence this long means "paused". */
const STALE_AFTER_SECONDS = 30;

const clock = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Props {
  session: AttendanceSession;
  onCheckout?: (session: AttendanceSession) => void;
}

/**
 * GST007: live tracking display.
 *
 * The time shown is always the server's `creditedSeconds`, refreshed by
 * `updateAttendanceSession`. There is deliberately NO local accumulation: a
 * smooth local timer would risk displaying time the server never verified.
 */
export default function AttendanceTracker({ session, onCheckout }: Props) {
  const [current, setCurrent] = useState<AttendanceSession>(session);
  const [error, setError] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const lastSentAt = useRef<number>(0);
  const lastSentAt2 = useRef<string | null>(null);
  // Holds the most recent raw observation. The interval below sends THIS value,
  // so each report is the newest fix the browser has produced - an old
  // coordinate is never re-sent and dressed up as a fresh reading.
  const latest = useRef<LocationFix | null>(null);
  const watchId = useRef<number | null>(null);
  const timerId = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setCurrent(session); }, [session]);

  const send = useCallback(async (fix: LocationFix) => {
    // Guard against replaying an observation the server has already accepted.
    if (lastSentAt2.current === fix.capturedAt) return;
    try {
      const next = await eventApi.updateAttendanceSession(current.id, fix);
      setCurrent(next);
      lastSentAt.current = Date.now();
      lastSentAt2.current = fix.capturedAt;
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your location could not be reported.');
    }
  }, [current.id]);
useEffect(() => {
    if (current.state === 'completed') return undefined;
    // Watch while this page is open. A mobile browser may throttle or suspend
    // this when the tab is hidden or the phone locks - which is exactly why the
    // server treats silence as "paused" instead of assuming the user stayed.
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return undefined;
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        // Only STORE here. Reporting happens on the interval below so every
        // request carries the newest fix, never a replay of an older one.
        latest.current = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        };
      },
      () => setError('Location updates stopped. Turn on location for this site and refresh to resume.'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    // A fixed 10s reporting cadence, as the policy requires.
    timerId.current = setInterval(() => {
      const fix = latest.current;
      if (!fix) return;
      // GST006: a STATIONARY user still receives fresh fixes from the device, but
      // if the browser stops producing any new observation, the stored fix ages.
      // Re-sending it would present an old coordinate as if it were a fresh GPS
      // reading, so instead it is sent with its ORIGINAL capturedAt and the
      // server rejects it as stale - which pauses crediting rather than inventing
      // verified time.
      const ageSeconds = (Date.now() - new Date(fix.capturedAt).getTime()) / 1000;
      if (ageSeconds > STALE_AFTER_SECONDS) {
        latest.current = null;
        setError(
          'No fresh location reading. Tracking is paused so unverified time is not credited - move the device or wait for a new reading, then resume.',
        );
        return;
      }
      void send(fix);
    }, REPORT_INTERVAL_MS);
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      if (timerId.current !== null) clearInterval(timerId.current);
    };
  }, [current.state, send]);

  const resume = async () => {
    setError('');
    try { await send(await captureLocation()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Your location could not be verified.'); }
  };

  const checkout = async () => {
    setCheckingOut(true);
    try {
      const done = await eventApi.checkoutAttendanceSession(current.id);
      setCurrent(done);
      onCheckout?.(done);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Checkout could not be recorded.');
    } finally { setCheckingOut(false); }
  };

  const required = current.requiredMinutes;
  const percent = required ? Math.min(100, Math.round((current.creditedSeconds / (required * 60)) * 100)) : 0;
  const silentSeconds = current.lastVerifiedAt
    ? Math.round((Date.now() - new Date(current.lastVerifiedAt).getTime()) / 1000) : null;

  const locationBadge = current.locationState === 'inside'
    ? { text: 'Inside the check-in zone', tone: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-700' }
    : current.locationState === 'outside'
      ? { text: 'Outside the check-in zone', tone: 'border-amber-300/30 bg-amber-300/10 text-amber-700' }
      : { text: 'Location unavailable', tone: 'border-slate-300 bg-slate-100 text-slate-600' };

  const StateIcon = current.state === 'tracking' ? Radio : current.state === 'completed' ? CheckCircle2 : PauseCircle;
  const stateTone = current.state === 'tracking'
    ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-700'
    : current.state === 'completed'
      ? 'border-slate-300 bg-slate-100 text-slate-600'
      : 'border-amber-300/30 bg-amber-300/10 text-amber-700';
  const stateText = current.state === 'tracking' ? 'Tracking' : current.state === 'completed' ? 'Completed' : 'Paused';
return <section className="app-card p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="app-label">Live attendance tracking</p>
        <h2 className="app-section-title">{current.eventName}</h2>
      </div>
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${stateTone}`}>
        <StateIcon size={14} aria-hidden="true" /> {stateText}
      </span>
    </div>

    <span className={`mt-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${locationBadge.tone}`}>
      <MapPin size={13} aria-hidden="true" /> {locationBadge.text}
    </span>

    {/* Server-verified time. Deliberately not a locally running timer. */}
    <div className="mt-5 rounded-2xl border border-[#E2E3DF] bg-[#FAF9F5] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#64748B]">Verified attendance time</p>
      <p className="mt-2 font-mono text-4xl font-bold text-[#10203B]">{clock(current.creditedSeconds)}</p>
      {required !== null && <>
        <p className="mt-1 text-xs text-[#64748B]">Required {required} min · Remaining {clock(current.remainingSeconds ?? 0)}</p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#E2E3DF]">
          <div className="h-full rounded-full bg-[#C2410C] transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-xs font-semibold text-[#C2410C]">
          {current.durationOutcome === 'met' ? 'Required duration met' : `${percent}% of the required duration`}
        </p>
      </>}
      <p className="mt-3 text-xs text-[#64748B]">
        Arrival: <strong>{current.arrival === 'late' ? 'Late' : 'On time'}</strong>
        {' · '}Last verified{' '}
        {current.lastVerifiedAt
          ? `${new Date(current.lastVerifiedAt).toLocaleTimeString()}${silentSeconds !== null && silentSeconds > 30 ? ' (stale)' : ''}`
          : 'never'}
      </p>
      {/* The precision of the fix the SERVER accepted. Shown because "inside the
          zone" is only as trustworthy as the accuracy behind it: a ±90 m fix
          accepted at a 150 m fence says much less than a ±5 m one, and an
          attendee deserves to see which they got. */}
      <p className="mt-1 text-xs text-[#64748B]">
        {current.lastAccuracyMeters !== null && current.lastAccuracyMeters !== undefined
          ? `Reported accuracy ±${Math.round(current.lastAccuracyMeters)} m`
          : 'Reported accuracy unknown'}
        {current.lastDistanceMeters !== null && current.lastDistanceMeters !== undefined
          ? ` · ${Math.round(current.lastDistanceMeters)} m from the venue centre`
          : ''}
      </p>
    </div>

    {current.pauseReason && (
      <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        {PAUSE_TEXT[current.pauseReason] ?? 'Tracking is paused.'}
      </p>
    )}

    {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold leading-5 text-rose-700">{error}</p>}

    <div className="mt-5 flex flex-wrap gap-3">
      {current.state === 'paused' && current.pauseReason !== 'required_duration_met' && (
        <button type="button" onClick={() => void resume()} className="app-button-primary"><LocateFixed size={16} /> Try again</button>
      )}
      {current.state !== 'completed' && (
        <button type="button" onClick={() => void checkout()} disabled={checkingOut} className="app-button-secondary">
          <RefreshCcw size={16} /> {checkingOut ? 'Checking out…' : 'Check out'}
        </button>
      )}
    </div>

    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
      <p className="font-semibold text-slate-700">Keep this page open</p>
      <p>Tracking runs while this page is open with location permission. If you lock your phone, switch apps, or your browser is suspended, updates pause and the server stops crediting time after 30 seconds of silence. Reopen this page to resume the same session - your verified time is kept.</p>
      <p className="mt-2">Browser-reported location cannot guarantee you are physically present, and crossing times are approximate because position is sampled rather than continuous.</p>
    </div>
  </section>;
}