import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { Download, FileText, QrCode } from 'lucide-react';
import { createEventQr } from '../../utils/eventQr';

interface EventQRCodeProps {
  eventId: string;
  eventName: string;
  expiresAt?: string;
}

export default function EventQRCode({ eventId, eventName, expiresAt }: EventQRCodeProps) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrValue, setQrValue] = useState('');

  useEffect(() => {
    const eventQr = createEventQr(eventId, expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString());
    setQrValue(eventQr.value);
    QRCode.toDataURL(eventQr.value, {
      width: 420,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#EA580C', light: '#ffffff' },
    }).then(setQrDataUrl).catch(() => setQrDataUrl(''));
  }, [eventId, expiresAt]);

  const downloadPng = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.download = `COT-Attendance-${eventId}.png`;
    link.href = qrDataUrl;
    link.click();
  };

  const downloadPdf = () => {
    if (!qrDataUrl) return;
    const pdf = new jsPDF();
    pdf.setTextColor(194, 65, 12);
    pdf.setFontSize(18);
    pdf.text('COT Attendance Web', 20, 25, { maxWidth: 170 });
    pdf.setFontSize(13);
    pdf.text(eventName, 20, 37);
    pdf.setFontSize(10);
    pdf.text(`Event ID: ${eventId}`, 20, 46);
    pdf.text(`Valid until: ${new Date(expiresAt || Date.now()).toLocaleString()}`, 20, 54);
    pdf.addImage(qrDataUrl, 'PNG', 45, 65, 120, 120);
    pdf.setFontSize(9);
    pdf.text('Scan this code to check in or check out. Location is verified separately on the device.', 20, 198);
    pdf.save(`COT-Attendance-${eventId}.pdf`);
  };

  return (
    <div className="mt-5 rounded-2xl border border-orange-100 bg-orange-50 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-orange-950">
        <QrCode size={17} /> Event QR code
      </div>
      {qrDataUrl ? <img src={qrDataUrl} alt={`Attendance QR code for ${eventName}`} className="mx-auto h-44 w-44 rounded-xl bg-white p-2" /> : <div className="h-44" />}
      <p className="mt-3 text-center text-xs text-orange-800">Unique to this event. Expires {new Date(expiresAt || Date.now()).toLocaleString()}.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={downloadPng} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-xs font-bold text-white"><Download size={14} /> PNG</button>
        <button type="button" onClick={downloadPdf} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-orange-700 ring-1 ring-orange-900/10"><FileText size={14} /> PDF</button>
      </div>
      <details className="mt-3 text-[10px] text-orange-800">
        <summary className="cursor-pointer font-bold">Show QR token</summary>
        <p className="mt-1 break-all">{qrValue}</p>
      </details>
    </div>
  );
}
