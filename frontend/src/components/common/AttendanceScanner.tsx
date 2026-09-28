import { useCallback, useState } from 'react';
import { CheckCircle2, Info, Loader2, MapPin, QrCode, RefreshCcw, ShieldCheck, X, XCircle } from 'lucide-react';
import QRScanner from './QRScanner';
import { eventApi } from '../../data/eventApi';
import type { AttendanceConfirmation, EventRecord } from '../../types/eventAttendance';
import { captureLocation, isEventQr } from '../../utils/eventQr';

interface Props {
  events: EventRecord[];
  onClose: () => void;
  onRecorded: (confirmation: AttendanceConfirmation) => Promise<void> | void;
}

export default function AttendanceScanner({ events, onClose, onRecorded }: Props) {
  const available = events.filter(event => event.status === 'ongoing' || event.can_check_in);
  const [selectedId, setSelectedId] = useState(available[0]?.id || '');
  const [isScanning, setIsScanning] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [error, setError] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [confirmation, setConfirmation] = useState<AttendanceConfirmation | null>(null);
  const selected = available.find(event => event.id === selectedId);
  // GST004: if any event a person might scan into needs a location fix, ask for
  // one up front so they are not mid-scan when the browser prompt appears.
  const needsLocation = available.some(event => event.location_verification_required);

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
      const result = await eventApi.scan(qr
        ? { token: value, method: 'qr', location }
        : { eventId: selectedId, identifier: value, method: selected?.attendance_method || 'rfid', location });
      setConfirmation(result);
      setIsScanning(false);
      setManualCode('');
      void Promise.resolve(onRecorded(result)).catch(() => undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The event scan could not be recorded.');
      setIsScanning(false);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, needsLocation, onRecorded, selected?.attendance_method, selectedId]);

  /** GST004: check location is reachable before the camera opens. */
  const checkLocation = useCallback(async () => {
    setLocationNote('Checking your location…');
    try {
      const fix = await captureLocation();
      setLocationNote(`Location ready (±${Math.round(fix.accuracy)} m).`);
    } catch (caught) {
      setLocationNote(caught instanceof Error ? caught.message : 'Your location could not be verified.');
    }
  }, []);

  const reset = () => {
    setConfirmation(null);
    setError('');
    setIsScanning(true);
    setManualCode('');
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
        {needsLocation && !confirmation && <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-sky-600" /><div><p className="text-sm font-semibold text-[#10203B]">Location is checked for this event</p><p className="mt-1 text-xs leading-5 text-[#475569]">Attendance is confirmed against the venue check-in zone, so your location is read once at the moment you submit. Turn on your device location and allow this site to use it. This confirms you were at the venue at check-in; it is not a tamper-proof guarantee and does not track you afterwards.</p><button type="button" onClick={() => void checkLocation()} className="mt-3 inline-flex items-center gap-1.5 rounded text-xs font-semibold text-sky-700 underline-offset-4 transition hover:underline focus-visible:ring-2 focus-visible:ring-[#F97316]"><MapPin size={13} /> Check my location now</button></div></div>}
        {confirmation ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-center gap-3 text-emerald-700"><CheckCircle2 size={28} /><div><p className="font-bold">Attendance recorded</p><p className="text-xs">{confirmation.message}</p></div></div><dl className="mt-5 space-y-3 text-sm"><Row label="Event" value={confirmation.eventName} /><Row label="Date and time" value={`${new Date(confirmation.eventDate).toLocaleString()} · ${confirmation.eventTime}`} /><Row label="Status" value={confirmation.status.toUpperCase()} /><Row label="Method" value={confirmation.method.toUpperCase()} />{confirmation.locationVerified && <Row label="Location" value="Verified at venue" />}</dl></div> : <><div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-black"><QRScanner onScan={handleScan} isActive={isScanning && !isProcessing && !error} />{isProcessing && <div className="absolute inset-0 flex items-center justify-center bg-black/60"><Loader2 size={32} className="animate-spin text-blue-300" /></div>}</div><form onSubmit={event => { event.preventDefault(); void handleScan(manualCode); }} className="space-y-2"><label htmlFor="manual-event-code" className="app-label">Manual fallback</label><div className="flex gap-2"><input id="manual-event-code" value={manualCode} onChange={event => setManualCode(event.target.value)} placeholder={selected?.attendance_method === 'qr' ? 'Paste the event QR token' : 'Enter your ID or card value'} className="app-input min-w-0" disabled={isProcessing} /><button type="submit" className="app-button-primary shrink-0" disabled={isProcessing || !manualCode.trim()}>Submit</button></div></form></>}
        {error && <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><XCircle size={19} className="shrink-0" /><div><p className="font-semibold">Attendance was not recorded</p><p className="mt-1 text-xs leading-5">{error}</p></div></div>}
        <div className="flex gap-3">{(confirmation || error) && <button type="button" onClick={reset} className="app-button-secondary flex-1"><RefreshCcw size={16} /> Scan again</button>}<button type="button" onClick={onClose} className="app-button-secondary flex-1">Close</button></div>
      </div>
    </section>
  </div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b border-[#ECEDEA] pb-2"><dt className="text-[#64748B]">{label}</dt><dd className="text-right font-medium text-[#334155]">{value}</dd></div>;
}
