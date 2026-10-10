import { useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { Download, FileText, Maximize2, QrCode, RefreshCcw, X } from 'lucide-react';
import { eventApi, QR_USABILITY_TEXT, type EventQr, type EventQrUsability } from '../../data/eventApi';
import { eventStampLabel } from '../../utils/eventTime';
import Button from './Button';
import { StatusBadge } from './StatusBadge';

interface Props {
  eventId: string;
  eventName: string;
  /** Administrator route. Faculty on their own event use the faculty fetcher. */
  admin?: boolean;
}

/**
 * GST006 event attendance QR panel.
 *
 * The rule that shapes this component: VIEWING AND EXPORTING NEVER ROTATE THE
 * CODE. `load()` is a GET, so opening the panel, enlarging it, or saving a
 * PNG/PDF all return the credential that is already live. Rotation is its own,
 * separately confirmed POST, because it instantly invalidates a code somebody
 * may already have printed and stuck on a door.
 */
export function EventQrPanel({ eventId, eventName, admin = false }: Props) {
  const [qr, setQr] = useState<EventQr | null>(null);
  const [dataUrl, setDataUrl] = useState('');
  const [status, setStatus] = useState<EventQrUsability>('not_issued');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const render = async (value: EventQr) => {
    setQr(value);
    setStatus(value.usability);
    // Error correction level H: this gets printed and stuck on a wall, and a
    // phone camera is often further away and less head-on than a monitor.
    const url = await QRCode.toDataURL(value.token, {
      width: 360, margin: 2, errorCorrectionLevel: 'H',
      color: { dark: '#10203B', light: '#ffffff' },
    });
    setDataUrl(url);
  };

  const load = async () => {
    setBusy(true); setError('');
    try {
      await render(await (admin ? eventApi.adminEventQr(eventId) : eventApi.eventCheckInCode(eventId)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The event code could not be loaded.');
    } finally { setBusy(false); }
  };

  const regenerate = async () => {
    setBusy(true); setError('');
    try {
      await render(await eventApi.regenerateAdminEventQr(eventId));
      setConfirmRotate(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The event code could not be regenerated.');
    } finally { setBusy(false); }
  };

  const stamp = (value?: string) => (value ? eventStampLabel(value) : '');

  const downloadPng = () => {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `COT-event-${eventId}.png`;
    link.click();
  };

  const downloadPdf = () => {
    if (!dataUrl || !qr) return;
    const pdf = new jsPDF();
    pdf.setFontSize(18); pdf.text('COT Event Attendance', 20, 24);
    pdf.setFontSize(12); pdf.text(eventName, 20, 34);
    pdf.setFontSize(9);
    pdf.text(`Check-in: ${stamp(qr.checkInOpensAt)} to ${stamp(qr.checkInClosesAt)}`, 20, 43);
    pdf.addImage(dataUrl, 'PNG', 45, 55, 120, 120);
    pdf.save(`COT-event-${eventId}.pdf`);
  };

  const tone = status === 'usable_now' ? 'success' : status === 'not_yet_open' ? 'info' : 'warning';

  return (
    <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4" data-testid="event-qr-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-sky-800">
          <QrCode size={17} /> Event check-in code
        </div>
        <div className="flex flex-wrap gap-2">
          {/* GET: retrieves the live code and never rotates it. */}
          <Button variant="secondary" className="min-h-9 px-3 py-2 text-xs" onClick={() => void load()} disabled={busy}>
            {busy ? <RefreshCcw size={14} className="animate-spin" /> : <QrCode size={14} />}
            {qr ? 'Refresh' : 'View'}
          </Button>
          {admin && qr && (confirmRotate ? (
            <>
              <Button className="min-h-9 px-3 py-2 text-xs" onClick={() => void regenerate()} disabled={busy}>Confirm new code</Button>
              <Button variant="secondary" className="min-h-9 px-3 py-2 text-xs" onClick={() => setConfirmRotate(false)}>Keep current</Button>
            </>
          ) : (
            <Button variant="secondary" className="min-h-9 px-3 py-2 text-xs" onClick={() => setConfirmRotate(true)}>
              <RefreshCcw size={14} /> Regenerate
            </Button>
          ))}
        </div>
      </div>

      {/* Usability is the SERVER's verdict, shown before anyone prints anything. */}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-sky-800/80" data-testid="qr-usability">
        <StatusBadge status={tone}>{qr ? QR_USABILITY_TEXT[status] : 'Not generated yet'}</StatusBadge>
        {qr && <span>Valid {stamp(qr.checkInOpensAt)} – {stamp(qr.checkInClosesAt)}</span>}
      </p>

      {confirmRotate && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          Regenerating replaces the current code straight away. Anything already printed with it stops working.
        </p>
      )}

      {qr && dataUrl && (
        <>
          <img
            src={dataUrl}
            alt={`QR attendance code for ${eventName}`}
            data-testid="qr-image"
            className={`mx-auto mt-4 rounded-xl bg-white p-2 ${expanded ? 'h-64 w-64' : 'h-48 w-48'}`}
          />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button variant="secondary" className="min-h-9 px-3 py-2 text-xs" onClick={() => setExpanded(true)} data-testid="qr-fullscreen">
              <Maximize2 size={14} /> Full screen
            </Button>
            <Button className="min-h-9 px-3 py-2 text-xs" onClick={downloadPng} data-testid="qr-png"><Download size={14} /> PNG</Button>
            <Button variant="secondary" className="min-h-9 px-3 py-2 text-xs" onClick={downloadPdf} data-testid="qr-pdf"><FileText size={14} /> PDF</Button>
          </div>
        </>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p>}
      <p className="mt-3 text-[10px] leading-4 text-[#64748B]">
        {admin
          ? 'Administrators can manage any event code; faculty only for events assigned to them. Viewing or exporting never replaces the code.'
          : 'Only assigned faculty can manage this code. Viewing or exporting never replaces the code.'}
      </p>

      {expanded && qr && dataUrl && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/80 p-4" role="dialog" aria-modal="true" aria-label={`${eventName} QR code`}>
          <button type="button" aria-label="Close full screen" className="absolute inset-0" onClick={() => setExpanded(false)} />
          <div className="relative">
            <img src={dataUrl} alt={`Full screen QR attendance code for ${eventName}`} className="h-[min(80vh,40rem)] w-[min(80vh,40rem)] rounded-2xl bg-white p-3" />
            <p className="mt-3 text-center text-sm font-semibold text-white">{eventName}</p>
            <button type="button" aria-label="Close" onClick={() => setExpanded(false)} className="absolute -right-2 -top-2 rounded-full bg-white p-2 text-slate-900"><X size={18} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

export default EventQrPanel;
