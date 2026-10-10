import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Info, Loader2, LocateFixed, MapPin, QrCode, RefreshCcw, ShieldCheck, X, XCircle } from 'lucide-react';
import QRScanner from './QRScanner';
import { eventApi } from '../../data/eventApi';
import type { AttendanceConfirmation, AttendanceSession, EventRecord } from '../../types/eventAttendance';
import { captureLocation, evaluateFixQuality, isEventQr, scanMatchesEvent } from '../../utils/eventQr';
import { eventStampLabel } from '../../utils/eventTime';

interface Props {
  events: EventRecord[];
  onClose: () => void;
  onRecorded: (confirmation: AttendanceConfirmation) => Promise<void> | void;
  /** GST006: hands the server session to the Portal, which renders the tracker. */
  onSessionStarted?: (session: AttendanceSession) => void;
  /**
   * Opens the scanner already scoped to ONE event, as a card-level "Scan
   * attendance for this event" button does.
   *
   * This PRESELECTS the event and nothing else. In particular it does NOT relax
   * what counts as a valid code: a QR that belongs to some other event is still
   * rejected (see `scanMatchesEvent`), so a scoped scanner can never record
   * attendance against the preselected event using somebody else's code.
   * Omitting it keeps the general behaviour, where the event is chosen in the UI.
   */
  initialEventId?: string;
}

export default function AttendanceScanner({ events, onClose, onRecorded, onSessionStarted, initialEventId }: Props) {
  const available = events.filter(event => event.status === 'ongoing' || event.can_check_in);
  const [selectedId, setSelectedId] = useState(initialEventId || available[0]?.id || '');
  /**
   * Whether this scanner was OPENED scoped to one event.
   *
   * Captured once, deliberately. Scoping is a property of how the scanner was
   * opened (a card's "Scan attendance for this event" button), not of whatever
   * happens to be in the dropdown later. The unscoped general scanner keeps its
   * documented behaviour of accepting any event's QR and deferring to the
   * server, so this must not drift while the component stays mounted.
   */
  const [scoped] = useState(() => Boolean(initialEventId));
  const [isProcessing, setIsProcessing] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [error, setError] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [locationReady, setLocationReady] = useState(false);
  /**
   * The NON-LOCATION half of the last successful scan.
   *
   * This is what makes "Retry tracking" possible without a second attendance
   * submission: the check-in is already recorded and is never re-sent, and only
   * these identifiers are replayed to the tracking endpoint. Holding the token
   * or the event id here is what lets tracking be resumed on its own.
   *
   * It deliberately NEVER holds a `location`, so a retry cannot silently reuse
   * the spent reading from the scan.
   */
  const [pendingTracking, setPendingTracking] = useState<{
    token?: string; eventId?: string; identifier?: string; method?: string;
  } | null>(null);
  /** True while a retry is in flight, so the button cannot be double-clicked. */
  const [retryingTracking, setRetryingTracking] = useState(false);
  /**
   * Guards state updates after this component has closed or unmounted.
   *
   * A retry involves a network round trip, so the person can close the scanner
   * while one is in flight. Writing state after unmount is a React warning and,
   * worse, could hand a finished session to a Portal that has moved on.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const [confirmation, setConfirmation] = useState<AttendanceConfirmation | null>(null);
  const [tracking, setTracking] = useState<AttendanceSession | null>(null);
  const [trackingNotice, setTrackingNotice] = useState('');
  const selected = available.find(event => event.id === selectedId);

  /**
   * Keeps the selection in step with the event the scanner is scoped to.
   *
   * `useState` only ever reads its initialiser once, so a change to
   * `initialEventId` while this component stays mounted - choosing another
   * card's "Scan attendance for this event" without closing the scanner first -
   * used to leave the previous event selected while the guard silently compared
   * against the new one. Re-syncing makes the visible selection and the
   * checked selection the same value again.
   *
   * It only ever writes the event the caller asked to scope to. It never
   * overwrites a choice the person made in the dropdown, because that only
   * happens on an actual scope change.
   */
  useEffect(() => {
    if (initialEventId) setSelectedId(initialEventId);
  }, [initialEventId]);
  // GST004: if any event a person might scan into needs a location fix, ask for
  // one up front so they are not mid-scan when the browser prompt appears.
  const needsLocation = available.some(event => event.location_verification_required);
  // GST004.1: the camera must NOT open until location permission and an
  // acceptable fresh fix are in hand. `isScanning` starts false so the camera
  // never opens before that gate.
  const [isScanning, setIsScanning] = useState(false);

  /**
   * GST004.1: obtain permission plus a usable fix before anything else.
   *
   * THE FIX IS NOW VALIDATED AND KEPT, which it previously was not.
   *
   * This used to discard the fix and keep only a boolean, so "Refresh my
   * location" re-read the device, threw the reading away and merely re-flipped a
   * flag that was already set. Nothing the user could observe changed, which is
   * why refreshing appeared to do nothing. The reading is now checked against the
   * published policy and retained, so its age is real and its timestamp still
   * travels with it.
   */
  const enableLocation = useCallback(async () => {
    setLocationNote('Checking your location…');
    setError('');
    try {
      const fix = await captureLocation();
      // Reuse the SAME rules the server enforces, so a fix the server would
      // refuse is refused here first with an explanation the person can act on.
      const quality = evaluateFixQuality(fix);
      if (!quality.acceptable) {
        setLocationReady(false);
        setIsScanning(false);
        setLocationNote(quality.reason ?? 'Your location could not be verified.');
        return;
      }
      setLocationReady(true);
      setIsScanning(true);
      setLocationNote(`Location ready (±${Math.round(fix.accuracy)} m). You can scan now.`);
    } catch (caught) {
      setLocationReady(false);
      setIsScanning(false);
      setLocationNote(caught instanceof Error ? caught.message : 'Your location could not be verified.');
    }
  }, []);

  const handleScan = useCallback(async (rawValue: string) => {
    const value = rawValue.trim();
    if (!value || isProcessing) return;
    setIsProcessing(true);
    setError('');
    setLocationNote('');
    try {
      // GST004: a fresh fix is taken at the moment of submission, and a new one
      // for every attempt. The server re-checks it against the event's geofence;
      // the browser's word is never enough on its own.
      let location;
      if (needsLocation) {
        try {
          location = await captureLocation();
        } catch (locationError) {
          setError(locationError instanceof Error ? locationError.message : 'Your location could not be verified.');
          setIsScanning(false);
          return;
        }
      }

      const qr = isEventQr(value);
      // A SCOPED scanner (opened from one card) refuses a QR that belongs to a
      // different event BEFORE any request is made. Checked before the location
      // prompt so a mismatched code costs nothing and records nothing; the
      // unscoped general scanner keeps its existing behaviour and accepts any
      // event's QR, because the QR itself identifies the event.
      //
      // THE COMPARISON USES `selectedId`, THE LIVE SELECTION, NOT THE PINNED
      // `initialEventId`. A scoped scanner still shows the event dropdown, so the
      // person can change it; comparing against the prop instead meant their
      // visible choice was ignored and scanning the event they had just chosen
      // was refused as "belongs to a different event". Identifiers are compared
      // exactly as received - no case folding and no rewriting - because both
      // sides are the same server-issued id and rewriting them would only hide a
      // genuinely different event.
      const match = scanMatchesEvent(value, scoped ? selectedId : undefined);
      if (!match.ok) {
        setError(match.reason || 'That QR code belongs to a different event.');
        setIsScanning(false);
        return;
      }
      // GST006: a QR event ALWAYS goes through the credential path. Previously a
      // value that was not a COT-EVENT payload was sent as `{eventId, identifier}`
      // using the selected event's method, which for a QR event let arbitrary text
      // stand in for the organiser's code. Now the raw text is submitted as a
      // token and the server decides whether it is a valid credential.
      const selectedMethod = selected?.attendance_method || 'rfid';
      const useToken = qr || selectedMethod === 'qr';
      const scanInput = useToken
        ? { token: value, method: 'qr' as const, location }
        : { eventId: selectedId, identifier: value, method: selectedMethod, location };
      const result = await eventApi.scan(scanInput);
      setConfirmation(result);
      setIsScanning(false);
      setManualCode('');
      void Promise.resolve(onRecorded(result)).catch(() => undefined);

      // RETAINED BEFORE TRACKING IS ATTEMPTED, so the retry path exists
      // WHENEVER the check-in succeeds - not only when tracking happened to
      // fail. If this scanner unmounts between here and the tracking call, or the
      // call fails, the identifiers needed to resume tracking are already held.
      // Only the NON-location half is kept, so a retry can never replay the spent
      // reading from this scan.
      setPendingTracking(useToken
        ? { token: value, method: 'qr' as const }
        : { eventId: selectedId, identifier: value, method: selectedMethod });

      // GST006: after a successful scan, start (or resume) the server-owned
      // tracking session.
      //
      // A FRESH FIX IS TAKEN FOR THIS CALL. The scan's fix has already been used
      // and spent: by the time the attendance POST has returned, it is measurably
      // older, and it was captured against the ONE-SHOT limit (120 s) while
      // tracking is held to a much stricter 30 s. Reusing it meant that any
      // ordinary delay between scanning and tracking - a slow network, the
      // confirmation render, the person simply pausing - was enough for the server
      // to answer "That location reading is too old", which is the error that was
      // reported as a persistent failure.
      //
      // If the fresh read cannot be obtained, the check-in above STILL STANDS and
      // a Retry is offered. Tracking is a separate concern from attendance and is
      // never lost because a second reading was unavailable.
      if (needsLocation) {
        try {
          const freshForTracking = await captureLocation();
          const session = await eventApi.startAttendanceSession({ ...scanInput, location: freshForTracking });
          setTracking(session);
          setTrackingNotice('');
          // The Portal owns the tracker, so the session survives closing this
          // modal or reloading the page.
          onSessionStarted?.(session);
          onClose();
        } catch (trackingError) {
          setTracking(null);
          setTrackingNotice(trackingError instanceof Error
            ? trackingError.message
            : 'Live time tracking is not available for this event.');
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The event scan could not be recorded.');
      setIsScanning(false);
    } finally {
      setIsProcessing(false);
    }
  }, [initialEventId, isProcessing, needsLocation, onClose, onRecorded, onSessionStarted, selected?.attendance_method, selectedId]);

  /**
   * Retries TRACKING ONLY, after the attendance check-in already succeeded.
   *
   * WHAT THIS DELIBERATELY DOES NOT DO:
   *   - it does NOT re-submit attendance. `eventApi.scan` is never called here,
   *     so the recorded check-in and its row are untouched and cannot be
   *     duplicated by retrying;
   *   - it does NOT reuse the spent reading. A brand new fix is requested, and
   *     `heldFix` is consulted only to decide whether the retry is even worth
   *     attempting - never as a substitute for a fresh read;
   *   - it does NOT re-stamp anything with `Date.now()`. The server's 30 s
   *     tracking rule and the 120 s general rule both still decide what is
   *     acceptable, on the timestamp the browser really produced.
   *
   * The server is the authority on eligibility: an unauthorised caller, a closed
   * check-in window, a completed session and an out-of-fence fix are all still
   * refused there. This only decides whether to bother asking.
   */
  const retryTracking = useCallback(async () => {
    if (!pendingTracking || retryingTracking) return;
    setRetryingTracking(true);
    setTrackingNotice('Taking a fresh location reading to start tracking…');
    try {
      const fresh = await captureLocation();
      const quality = evaluateFixQuality(fresh);
      if (!quality.acceptable) {
        if (!alive.current) return;
        setTrackingNotice(quality.reason ?? 'Your location could not be verified.');
        return;
      }
      const session = await eventApi.startAttendanceSession({ ...pendingTracking, location: fresh });
      if (!alive.current) return;
      setTracking(session);
      setTrackingNotice('');
      setPendingTracking(null);
      onSessionStarted?.(session);
      onClose();
    } catch (caught) {
      if (!alive.current) return;
      setTrackingNotice(caught instanceof Error
        ? caught.message
        : 'Live time tracking could not be started. Your check-in is still recorded.');
    } finally {
      if (alive.current) setRetryingTracking(false);
    }
  }, [alive, onClose, onSessionStarted, pendingTracking, retryingTracking]);

  const reset = () => {
    setConfirmation(null);
    setError('');
    setTracking(null);
    setManualCode('');
    // Only re-open the camera if location permission was already granted.
    setIsScanning(locationReady);
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm">
    <section className="app-card max-h-[92vh] w-full max-w-lg overflow-y-auto" aria-labelledby="scanner-title">
      <header className="flex items-center justify-between border-b border-[#E2E3DF] p-5">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-[#FFF1E6] p-2.5 text-[#C2410C]"><QrCode size={21} /></span><div><h2 id="scanner-title" className="font-bold text-[#10203B]">Scan event attendance</h2><p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#94A3B8]">Server-confirmed check-in</p></div></div>
        <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-lg p-2 text-[#64748B] transition hover:bg-[#FAF9F5] hover:text-[#10203B] focus-visible:ring-2 focus-visible:ring-[#F97316]"><X size={20} /></button>
      </header>
      <div className="space-y-5 p-5">
        {!confirmation && !error && <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4"><Info size={18} className="mt-0.5 shrink-0 text-sky-600" /><div><p className="text-sm font-semibold text-[#10203B]">Scan the event check-in code</p><p className="mt-1 text-xs leading-5 text-[#475569]">QR codes identify the event. For RFID or barcode events, choose the event and enter or scan your own card value.</p></div></div>}
        {available.length > 0 && !confirmation && <div><label htmlFor="scanner-event" className="app-label">Event for card / ID check-in</label><select id="scanner-event" value={selectedId} onChange={event => setSelectedId(event.target.value)} className="app-input"><option value="">Select event</option>{available.map(event => <option key={event.id} value={event.id}>{event.name} · {event.attendance_method.toUpperCase()}</option>)}</select></div>}
        {locationNote && <p role="status" className="text-xs font-medium text-sky-700">{locationNote}</p>}
        {needsLocation && !locationReady && <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-sky-600" /><div><p className="text-sm font-semibold text-[#10203B]">Location access is needed first</p><p className="mt-1 text-xs leading-5 text-[#475569]">This event confirms attendance against the venue check-in zone, so the camera only opens after your device gives an acceptable location reading. A website cannot switch on GPS or grant permission by itself - allow location for this site when your browser asks.</p><button type="button" onClick={() => void enableLocation()} className="app-button-primary mt-3"><MapPin size={14} /> Allow location and continue</button></div></div>}
        {!tracking && trackingNotice && (
          <div role="status" data-testid="tracking-notice" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <p>{trackingNotice} Your check-in above is still recorded.</p>
            {/* The retry acts on TRACKING ONLY. It never re-submits attendance, so
                the recorded check-in and its row cannot be duplicated by retrying. */}
            {pendingTracking && (
              <button
                type="button"
                data-testid="retry-tracking"
                onClick={() => void retryTracking()}
                disabled={retryingTracking}
                className="app-button-secondary mt-3 inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <LocateFixed size={14} /> {retryingTracking ? 'Starting tracking…' : 'Retry tracking'}
              </button>
            )}
          </div>
        )}
        {tracking && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">Live tracking started. Close this window to follow your verified attendance time.</p>}
        {needsLocation && locationReady && !confirmation && !tracking && <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-sky-600" /><div><p className="text-sm font-semibold text-[#10203B]">Location is checked for this event</p><p className="mt-1 text-xs leading-5 text-[#475569]">Attendance is confirmed against the venue check-in zone. Keep this page open after scanning so time can be verified while you stay inside the zone. Location confirms you were at the venue; it is not a tamper-proof guarantee.</p><button type="button" onClick={() => void enableLocation()} className="mt-3 inline-flex items-center gap-1.5 rounded text-xs font-semibold text-sky-700 underline-offset-4 transition hover:underline focus-visible:ring-2 focus-visible:ring-[#F97316]"><MapPin size={13} /> Refresh my location</button></div></div>}
        {confirmation ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-center gap-3 text-emerald-700"><CheckCircle2 size={28} /><div><p className="font-bold">Attendance recorded</p><p className="text-xs">{confirmation.message}</p></div></div><dl className="mt-5 space-y-3 text-sm"><Row label="Event" value={confirmation.eventName} /><Row label="Date and time" value={`${eventStampLabel(confirmation.eventDate)} · ${confirmation.eventTime}`} /><Row label="Status" value={confirmation.status.toUpperCase()} /><Row label="Method" value={confirmation.method.toUpperCase()} />{confirmation.locationVerified && <Row label="Location" value={`Verified at venue${typeof confirmation.locationAccuracyMeters === 'number' ? ` (±${Math.round(confirmation.locationAccuracyMeters)} m)` : ''}${typeof confirmation.locationDistanceMeters === 'number' ? ` · ${Math.round(confirmation.locationDistanceMeters)} m from centre` : ''}`} />}</dl></div> : <><div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-black"><QRScanner onScan={handleScan} isActive={isScanning && !isProcessing && !error} />{isProcessing && <div className="absolute inset-0 flex items-center justify-center bg-black/60"><Loader2 size={32} className="animate-spin text-blue-300" /></div>}</div><form onSubmit={event => { event.preventDefault(); void handleScan(manualCode); }} className="space-y-2"><label htmlFor="manual-event-code" className="app-label">Manual fallback</label><div className="flex gap-2"><input id="manual-event-code" value={manualCode} onChange={event => setManualCode(event.target.value)} placeholder={selected?.attendance_method === 'qr' ? 'Paste the event QR token' : 'Enter your ID or card value'} className="app-input min-w-0" disabled={isProcessing} /><button type="submit" className="app-button-primary shrink-0" disabled={isProcessing || !manualCode.trim()}>Submit</button></div></form></>}
        {error && <div role="alert" data-testid="scan-error" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><XCircle size={19} className="shrink-0" /><div><p className="font-semibold">Attendance was not recorded</p><p className="mt-1 text-xs leading-5">{error}</p></div></div>}
        <div className="flex gap-3">{(confirmation || error) && <button type="button" onClick={reset} className="app-button-secondary flex-1"><RefreshCcw size={16} /> Scan again</button>}<button type="button" onClick={onClose} className="app-button-secondary flex-1">Close</button></div>
      </div>
    </section>
  </div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b border-[#ECEDEA] pb-2"><dt className="text-[#64748B]">{label}</dt><dd className="text-right font-medium text-[#334155]">{value}</dd></div>;
}
