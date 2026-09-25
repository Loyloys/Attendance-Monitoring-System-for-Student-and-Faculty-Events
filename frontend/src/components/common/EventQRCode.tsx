import { useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { Download, FileText, QrCode, RefreshCcw } from 'lucide-react';
import { eventApi } from '../../data/eventApi';

interface Props { eventId: string; eventName: string; }

export default function EventQRCode({ eventId, eventName }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generate = async () => {
    setLoading(true); setError('');
    try {
      const code = await eventApi.createCheckInCode(eventId);
      const url = await QRCode.toDataURL(code.token, { width: 360, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#1e3a8a', light: '#ffffff' } });
      setQrDataUrl(url); setExpiresAt(code.expiresAt);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The event code could not be generated.'); }
    finally { setLoading(false); }
  };
  const downloadPng = () => { if (!qrDataUrl) return; const link = document.createElement('a'); link.href = qrDataUrl; link.download = `COT-event-${eventId}.png`; link.click(); };
  const downloadPdf = () => { if (!qrDataUrl) return; const pdf = new jsPDF(); pdf.setFontSize(18); pdf.text('COT Event Attendance', 20, 24); pdf.setFontSize(12); pdf.text(eventName, 20, 34); pdf.setFontSize(9); pdf.text(`Valid until: ${new Date(expiresAt).toLocaleString()}`, 20, 43); pdf.addImage(qrDataUrl, 'PNG', 45, 55, 120, 120); pdf.save(`COT-event-${eventId}.pdf`); };
  return <div className="mt-5 rounded-2xl border border-blue-300/15 bg-blue-300/[0.05] p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold text-blue-100"><QrCode size={17} /> Event check-in code</div><button type="button" onClick={generate} disabled={loading} className="app-button-secondary min-h-9 px-3 py-2 text-xs">{loading ? <RefreshCcw size={14} className="animate-spin" /> : qrDataUrl ? <RefreshCcw size={14} /> : <QrCode size={14} />}{qrDataUrl ? 'Regenerate' : 'Generate'}</button></div>{qrDataUrl && <><img src={qrDataUrl} alt={`QR attendance code for ${eventName}`} className="mx-auto mt-4 h-48 w-48 rounded-xl bg-white p-2" /><p className="mt-3 text-center text-xs text-blue-100/65">Expires {new Date(expiresAt).toLocaleString()}</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={downloadPng} className="app-button-primary min-h-9 px-3 py-2 text-xs"><Download size={14} /> PNG</button><button type="button" onClick={downloadPdf} className="app-button-secondary min-h-9 px-3 py-2 text-xs"><FileText size={14} /> PDF</button></div></>}{error && <p className="mt-3 text-xs text-rose-200">{error}</p>}<p className="mt-3 text-[10px] leading-4 text-white/35">Only assigned faculty can generate this code. It is a short-lived event check-in token stored as a one-way hash and validated by the server.</p></div>;
}
