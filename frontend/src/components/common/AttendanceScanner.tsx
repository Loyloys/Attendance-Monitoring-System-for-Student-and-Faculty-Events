import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Info, Loader2, LocateFixed, MapPin, QrCode, RefreshCcw, ShieldCheck, X, XCircle } from 'lucide-react';
import QRScanner from './QRScanner';
import { eventApi } from '../../data/eventApi';
import type { AttendanceConfirmation, AttendanceMethod, AttendanceQrPreview, AttendanceSession, EventRecord } from '../../types/eventAttendance';
import { captureLocation, isEventQr, parseEventQr, runWithValidatedLocation, scanRequiresLocation, type LocationFix, type LocationQualityPolicy } from '../../utils/eventQr';
import { attendanceResultPresentation, attendanceScanFailureMessage, continueScannerAfterLocation, locationAccessPresentation, qrScannerAvailability, shouldShowLocationGate, startTrackingFromRecordedAttendance, submitPreviewedQr } from '../../utils/attendanceScannerFlow';
import { eventStampLabel } from '../../utils/eventTime';

interface Props {
  events: EventRecord[];
  onClose: () => void;
  onRecorded: (confirmation: AttendanceConfirmation) => Promise<void> | void;
  /** GST006: hands the server session to the Portal, which renders the tracker. */
  onSessionStarted?: (session: AttendanceSession) => void;
  /** Optionally preselects an event for RFID/barcode card check-in. */
  initialEventId?: string;
}

export default function AttendanceScanner({ events, onClose, onRecorded, onSessionStarted, initialEventId }: Props) {
  const available = events.filter(event => event.can_check_in);
  const scannerAvailability = qrScannerAvailability(available.length);
  const [selectedId, setSelectedId] = useState(
    (initialEventId && events.some(event => event.id === initialEventId) ? initialEventId : '')
      || '',
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [error, setError] = useState('');
  const [pendingQr, setPendingQr] = useState<{ token: string; preview: AttendanceQrPreview } | null>(null);
  /**
   * The server-recorded attendance id for the last successful scan.
   *
   * This lets tracking resume without submitting attendance again, or replaying
   * an attendance credential or location reading.
   */
  const [pendingTracking, setPendingTracking] = useState<{
    attendanceId: number; method: AttendanceMethod;
  } | null>(null);
  /** True while a retry is in flight, so the button cannot be double-clicked. */
  const [retryingTracking, setRetryingTracking] = useState(false);
  const trackingAttempt = useRef(0);
  const processingRef = useRef(false);
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
  const selectedContext = events.find(event => event.id === selectedId);
  const selected = selectedContext?.attendance_method !== 'qr' && selectedContext?.can_check_in
    ? selectedContext
    : undefined;
  const resultPresentation = confirmation ? attendanceResultPresentation(confirmation) : null;
  const selectedInitialEventId = initialEventId && events.some(event => event.id === initialEventId)
    ? initialEventId
    : '';
  useEffect(() => {
    if (selectedInitialEventId) setSelectedId(selectedInitialEventId);
  }, [selectedInitialEventId]);
  const initialKnownEvent = events.find(event => event.id === initialEventId);
  const knownEvent = initialKnownEvent || selectedContext;
  const knownEventNeedsLocation = Boolean(knownEvent && (
    knownEvent.attendance_method !== 'qr'
    && (knownEvent.location_verification_required || (knownEvent.required_attendance_minutes ?? 0) > 0)
  ));
  const [locationReadyForEventId, setLocationReadyForEventId] = useState<string | null>(null);
  const locationReadyForKnownEvent = !knownEventNeedsLocation || locationReadyForEventId === knownEvent?.id;
  const [locationStatus, setLocationStatus] = useState<'not-checked' | 'requesting' | 'available' | 'error'>('not-checked');
  const [locationStatusMessage, setLocationStatusMessage] = useState('');
  const [isScanning, setIsScanning] = useState(!knownEventNeedsLocation);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const showLocationGate = shouldShowLocationGate(
    knownEventNeedsLocation,
    locationReadyForKnownEvent,
    Boolean(pendingQr?.preview.locationRequired),
  );
  const locationPresentation = locationAccessPresentation({
    requiresLocation: showLocationGate,
    locationReady: locationReadyForKnownEvent || Boolean(pendingQr && locationStatus === 'available'),
    hasFreshReading: locationStatus === 'available',
    loading: isGettingLocation || isProcessing,
  });
  const requestLocation = useCallback(async () => {
    if (isGettingLocation) return;
    setIsGettingLocation(true);
    setLocationStatus('requesting');
    setLocationStatusMessage('Requesting a fresh location reading…');
    setError('');
    try {
      const health = await eventApi.health();
      if (!health.locationPolicy) {
        throw new Error('The server location-verification policy is unavailable. Retry location before scanning.');
      }
      await continueScannerAfterLocation(captureLocation, health.locationPolicy, fix => {
        const capturedAt = Date.parse(fix.capturedAt);
        setLocationStatus('available');
        setLocationStatusMessage(`Fresh reading received (±${Math.round(fix.accuracy)} m) at ${new Date(capturedAt).toLocaleTimeString()}. A new fix will still be required if the event requires location at check-in.`);
        if (knownEventNeedsLocation && knownEvent) {
          setLocationReadyForEventId(knownEvent.id);
          setIsScanning(true);
        }
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Your location could not be verified. Try again.';
      setLocationStatus('error');
      setLocationStatusMessage(message);
      if (knownEventNeedsLocation) {
        setLocationReadyForEventId(null);
        setIsScanning(false);
      }
    } finally {
      setIsGettingLocation(false);
    }
  }, [isGettingLocation, knownEvent, knownEventNeedsLocation]);

  useEffect(() => {
    setLocationReadyForEventId(null);
    setLocationStatus('not-checked');
    setLocationStatusMessage('');
    setIsScanning(!knownEventNeedsLocation);
  }, [knownEvent?.id, knownEventNeedsLocation]);

  const enableKnownEventLocation = useCallback(async () => {
    if (!knownEvent || !knownEventNeedsLocation || isGettingLocation) return;
    setIsScanning(false);
    await requestLocation();
  }, [isGettingLocation, knownEvent, knownEventNeedsLocation, requestLocation]);

  const completeCheckIn = useCallback((result: AttendanceConfirmation) => {
    setConfirmation(result);
    setIsScanning(false);
    setManualCode('');
    void Promise.resolve(onRecorded(result)).catch(() => undefined);

    const attempt = ++trackingAttempt.current;
    const requiresTracking = (result.requiredAttendanceMinutes ?? 0) > 0;
    setPendingTracking(requiresTracking ? { attendanceId: result.attendanceId, method: result.method } : null);
    if (!requiresTracking) return;

    void startTrackingFromRecordedAttendance(
        result,
        captureLocation,
        values => eventApi.startAttendanceSession(values),
      ).then(session => {
      if (!alive.current || trackingAttempt.current !== attempt) return;
      setTracking(session);
      setTrackingNotice('Live tracking is active. Eligible time and qualification remain server-confirmed.');
      onSessionStarted?.(session);
    }).catch(trackingError => {
      if (!alive.current || trackingAttempt.current !== attempt) return;
      setTracking(null);
      setTrackingNotice(trackingError instanceof Error
        ? trackingError.message
        : 'A fresh valid location is required before attendance tracking can begin.');
    });
  }, [onRecorded, onSessionStarted]);

  const handleScan = useCallback(async (rawValue: string, source: 'camera' | 'manual' = 'camera') => {
    const value = rawValue.trim();
    if (!value || processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    setError('');
    setTrackingNotice('');
    try {
      const qr = isEventQr(value);
      if (qr) {
        if (!parseEventQr(value)) throw new Error('Invalid event QR code. Scan a current event check-in code.');
        const preview = await eventApi.previewAttendance(value);
        if (!preview.eligible) {
          setIsScanning(false);
          setError(preview.reason || 'This event is not currently eligible for check-in.');
          return;
        }
        if (preview.locationRequired) {
          setPendingQr({ token: value, preview });
          setLocationStatus('not-checked');
          setLocationStatusMessage(`Location access is needed to verify you are inside ${preview.eventName}'s event geofence.`);
          setIsScanning(false);
          return;
        }
        const result = await eventApi.scan({ token: value, method: 'qr' });
        completeCheckIn(result);
        return;
      }
      if (source === 'camera') {
        throw new Error('This QR code did not identify a supported event check-in. Scan the current QR code shown by the event organizer.');
      }
      if (selected?.attendance_method === 'qr') {
        throw new Error('Scan the event QR code. A typed ID or card value cannot check in to a QR event.');
      }
      if (!selected) throw new Error('Select an eligible RFID or barcode event before entering your card value.');

      const selectedMethod = selected.attendance_method;
      const eventNeedsLocation = scanRequiresLocation({
        isQrInput: false,
        qrEventKnown: false,
        selectedEventKnown: true,
        selectedEventRequiresLocation: selected.location_verification_required,
        selectedEventRequiresDuration: selected.required_attendance_minutes,
      });
      let policy: LocationQualityPolicy | undefined;
      if (eventNeedsLocation) {
        const health = await eventApi.health();
        if (!health.locationPolicy) {
          throw new Error('The server location-verification policy is unavailable. Retry before checking in.');
        }
        policy = health.locationPolicy;
      }
      let location: LocationFix | null = null;
      try {
        location = await runWithValidatedLocation({
          requiresLocation: eventNeedsLocation,
          requestLocation: captureLocation,
          policy,
          action: fix => fix,
        });
      } catch (locationError) {
        if (!eventNeedsLocation) throw locationError;
        setLocationReadyForEventId(null);
        setIsScanning(false);
        const message = locationError instanceof Error
          ? locationError.message
          : 'Your location could not be verified. Retry before checking in.';
        setLocationStatus('error');
        setLocationStatusMessage(message);
        return;
      }
      const result = await eventApi.scan({
        eventId: selected.id,
        identifier: value,
        method: selectedMethod,
        location: location ?? undefined,
      });
      completeCheckIn(result);
    } catch (caught) {
      setError(attendanceScanFailureMessage(caught));
      setIsScanning(false);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [completeCheckIn, selected]);

  const continueQrWithLocation = useCallback(async () => {
    if (!pendingQr || processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    setError('');
    setIsScanning(false);
    setLocationStatus('requesting');
    setLocationStatusMessage('Requesting a fresh location reading…');
    let submitting = false;
    try {
      const health = await eventApi.health();
      if (!health.locationPolicy) {
        throw new Error('The server location-verification policy is unavailable. Retry location before checking in.');
      }
      const result = await submitPreviewedQr(
        pendingQr.preview,
        captureLocation,
        health.locationPolicy,
        location => {
          setLocationStatus('available');
          setLocationStatusMessage(`Fresh reading received (±${Math.round(location?.accuracy ?? 0)} m). Sending it for server verification.`);
          submitting = true;
          return eventApi.scan({ token: pendingQr.token, method: 'qr', location: location ?? undefined });
        },
      );
      setPendingQr(null);
      completeCheckIn(result);
    } catch (caught) {
      if (submitting) {
        setPendingQr(null);
        setError(attendanceScanFailureMessage(caught));
      } else {
        const message = caught instanceof Error ? caught.message : 'Your location could not be verified. Try again.';
        setLocationStatus('error');
        setLocationStatusMessage(message);
      }
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [completeCheckIn, pendingQr]);

  useEffect(() => {
    if (!pendingQr || locationStatus !== 'not-checked' || processingRef.current) return;
    void continueQrWithLocation();
  }, [continueQrWithLocation, locationStatus, pendingQr]);

  /**
   * Retries TRACKING ONLY, after the attendance check-in already succeeded.
   *
   * WHAT THIS DELIBERATELY DOES NOT DO:
   *   - it does NOT re-submit attendance. `eventApi.scan` is never called here,
   *     so the recorded check-in and its row are untouched and cannot be
   *     duplicated by retrying;
   *   - it does NOT replay an attendance credential. The server-recorded
   *     attendance id is the proof for starting tracking;
   *   - it does NOT reuse the spent reading. A brand new fix is requested;
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
      const session = await startTrackingFromRecordedAttendance(
        pendingTracking,
        captureLocation,
        values => eventApi.startAttendanceSession(values),
      );
      if (!alive.current) return;
      setTracking(session);
      setTrackingNotice('Live tracking is active. Eligible time and qualification remain server-confirmed.');
      setPendingTracking(null);
      onSessionStarted?.(session);
    } catch (caught) {
      if (!alive.current) return;
      setTrackingNotice(caught instanceof Error
        ? caught.message
        : 'Live time tracking could not be started. Your check-in is still recorded.');
    } finally {
      if (alive.current) setRetryingTracking(false);
    }
  }, [alive, onSessionStarted, pendingTracking, retryingTracking]);

  const reset = () => {
    trackingAttempt.current += 1;
    setConfirmation(null);
    setError('');
    setTracking(null);
    setTrackingNotice('');
    setPendingTracking(null);
    setPendingQr(null);
    setManualCode('');
    setLocationStatus('not-checked');
    setLocationStatusMessage('');
    if (knownEventNeedsLocation) setLocationReadyForEventId(null);
    setIsScanning(!knownEventNeedsLocation);
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm">
    <section className="app-card max-h-[92vh] w-full max-w-lg overflow-y-auto" aria-labelledby="scanner-title">
      <header className="flex items-center justify-between border-b border-[#E2E3DF] p-5">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-[#FFF1E6] p-2.5 text-[#C2410C]"><QrCode size={21} /></span><div><h2 id="scanner-title" className="font-bold text-[#10203B]">Scan event attendance</h2><p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#94A3B8]">Server-confirmed check-in</p></div></div>
        <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-lg p-2 text-[#64748B] transition hover:bg-[#FAF9F5] hover:text-[#10203B] focus-visible:ring-2 focus-visible:ring-[#F97316]"><X size={20} /></button>
      </header>
      <div className="space-y-5 p-5">
        {!confirmation && !error && <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4"><Info size={18} className="mt-0.5 shrink-0 text-sky-600" /><div><p className="text-sm font-semibold text-[#10203B]">Scan the event check-in code</p><p className="mt-1 text-xs leading-5 text-[#475569]">QR codes identify the event and do not require you to choose it first. For RFID or barcode events, choose the event and enter or scan your own card value. The server confirms every check-in.</p></div></div>}
        {!scannerAvailability.hasEligibleEvent && !confirmation && <div role="status" className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900"><Info size={18} className="mt-0.5 shrink-0" /><div><p className="text-sm font-semibold">Scanning is available</p><p className="mt-1 text-xs leading-5">Attendance can only be recorded for an event that is open and eligible for your account. Scan its QR code to check with the server.</p></div></div>}
        {events.length > 0 && !confirmation && <div><label htmlFor="scanner-event" className="app-label">Event context (optional)</label><select id="scanner-event" value={selectedId} onChange={event => setSelectedId(event.target.value)} className="app-input"><option value="">Scan any event QR</option>{events.map(event => <option key={event.id} value={event.id}>{event.name} · {event.attendance_method.toUpperCase()}{event.can_check_in ? '' : ' · not open'}</option>)}</select><p className="mt-1 text-xs text-slate-500">Selecting an event lets us check its location requirement before opening the camera. QR codes still identify their own event.</p></div>}
        {locationPresentation.visible && !confirmation && (
          <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-sky-600" />
            <div>
              <p className="text-sm font-semibold text-[#10203B]">
                {locationPresentation.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#475569]">
                {pendingQr
                  ? `${pendingQr.preview.eventName} requires location verification against its event geofence.`
                  : knownEventNeedsLocation
                    ? `${knownEvent?.name} requires location verification to confirm the device is within the event venue/geofence. A fresh reading is required before scanning.`
                    : 'Location access is available whenever you choose to request it. For a QR event, the server determines whether location is required after the QR identifies the event.'}
                {' '}The website cannot turn on GPS or grant permission automatically. Allow location for this site when your browser asks. Check-in still requires a fresh fix whenever the event policy requires one.
              </p>
              {locationStatusMessage && (
                <p
                  role={locationStatus === 'requesting' || isProcessing ? 'status' : locationStatus === 'error' ? 'alert' : 'status'}
                  className={`mt-2 text-xs leading-5 ${locationStatus === 'error' ? 'text-rose-700' : locationStatus === 'available' ? 'text-emerald-700' : 'text-sky-800'}`}
                >
                  {locationStatusMessage}
                </p>
              )}
              <button
                type="button"
                onClick={() => pendingQr ? void continueQrWithLocation() : knownEventNeedsLocation ? void enableKnownEventLocation() : void requestLocation()}
                disabled={isProcessing || isGettingLocation}
                className="app-button-primary mt-3 inline-flex items-center gap-2 rounded-xl bg-[#C2410C] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#9A3412] disabled:opacity-60"
              >
                <MapPin size={16} />
                {locationPresentation.actionLabel}
              </button>
            </div>
          </div>
        )}
        {knownEventNeedsLocation && locationReadyForKnownEvent && !confirmation && <p role="status" className="flex items-center gap-2 text-xs font-medium text-emerald-700"><ShieldCheck size={15} /> Fresh location validated. The camera is ready; attendance still requires server confirmation.</p>}
        {trackingNotice && (
          <div role="status" data-testid="tracking-notice" className={`rounded-xl border p-3 text-xs leading-5 ${tracking ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            <p>{tracking || retryingTracking ? trackingNotice : `Attendance was recorded, but tracking could not begin or resume: ${trackingNotice} Your check-in above is still recorded.`}</p>
            {/* The retry acts on TRACKING ONLY. It never re-submits attendance, so
                the recorded check-in and its row cannot be duplicated by retrying. */}
            {pendingTracking && !tracking && (
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
        {confirmation && resultPresentation ? (
          <div data-testid="attendance-result" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-center gap-3 text-emerald-700">
              <CheckCircle2 size={28} />
              <div>
                <p className="font-bold">{resultPresentation.title}</p>
                <p className="text-xs">{resultPresentation.message}</p>
                {resultPresentation.qualificationNotice && (
                  <p className="mt-1 text-xs">{resultPresentation.qualificationNotice}</p>
                )}
              </div>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <Row label="Event" value={resultPresentation.eventName} />
              <Row label="Date and time" value={`${eventStampLabel(resultPresentation.eventDate)} · ${resultPresentation.eventTime}`} />
              <Row label="Status" value={resultPresentation.status} />
              {resultPresentation.requiredAttendanceMinutes !== null && <Row label="Required attendance" value={`${resultPresentation.requiredAttendanceMinutes} min`} />}
              <Row label="Method" value={resultPresentation.method} />
              {resultPresentation.location && <Row label="Location" value={resultPresentation.location} />}
            </dl>
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-black">
              <QRScanner
                onScan={value => void handleScan(value, 'camera')}
                isActive={scannerAvailability.canOpen && isScanning && locationReadyForKnownEvent && !isGettingLocation && !isProcessing && !error && !pendingQr}
                pauseReason={isProcessing ? 'processing' : 'manual'}
                canResume={scannerAvailability.canOpen && locationReadyForKnownEvent && !isGettingLocation && !isProcessing && !pendingQr}
                onPause={() => {
                  setIsScanning(false);
                  if (knownEventNeedsLocation) {
                    setLocationReadyForEventId(null);
                    setLocationStatus('not-checked');
                    setLocationStatusMessage('Refresh your location before resuming scanning.');
                  }
                }}
                onResume={() => {
                  setError('');
                  if (knownEventNeedsLocation) {
                    setLocationReadyForEventId(null);
                    setLocationStatus('not-checked');
                    setLocationStatusMessage('Allow location and continue to take a fresh reading before scanning.');
                    setIsScanning(false);
                    return;
                  }
                  setIsScanning(true);
                }}
              />
              {isProcessing && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white"><Loader2 size={32} className="animate-spin text-blue-300" /><span>QR detected · verifying with server…</span></div>}
            </div>
            <form onSubmit={event => { event.preventDefault(); void handleScan(manualCode, 'manual'); }} className="space-y-2">
              <label htmlFor="manual-event-code" className="app-label">Manual fallback</label>
              <div className="flex gap-2">
                <input id="manual-event-code" value={manualCode} onChange={event => setManualCode(event.target.value)} placeholder="Paste the event QR token or enter your card value" className="app-input min-w-0" disabled={isProcessing || Boolean(pendingQr)} />
                <button type="submit" className="app-button-primary shrink-0" disabled={isProcessing || Boolean(pendingQr) || !manualCode.trim() || (!selected && !isEventQr(manualCode))}>Submit</button>
              </div>
            </form>
          </>
        )}
        {error && <div role="alert" data-testid="scan-error" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><XCircle size={19} className="shrink-0" /><div><p className="font-semibold">Attendance was not recorded</p><p className="mt-1 text-xs leading-5">{error}</p></div></div>}
        <div className="flex gap-3">{(confirmation || error) && <button type="button" onClick={reset} className="app-button-secondary flex-1"><RefreshCcw size={16} /> Scan again</button>}<button type="button" onClick={onClose} className="app-button-secondary flex-1">Close</button></div>
      </div>
    </section>
  </div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b border-[#ECEDEA] pb-2"><dt className="text-[#64748B]">{label}</dt><dd className="text-right font-medium text-[#334155]">{value}</dd></div>;
}
