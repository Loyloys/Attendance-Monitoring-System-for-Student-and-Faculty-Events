import { jsPDF } from 'jspdf';

export type AttendanceReportPdfRow = {
  personId: string;
  name: string;
  eventId: string;
  status: string;
};

type AttendanceReportPdfOptions = {
  targetRole: 'Student' | 'Faculty';
  eventId: string;
  rows: AttendanceReportPdfRow[];
  counts: { present: number; late: number; absent: number };
  generatedAt?: Date;
};

const MARGIN = 14;
const HEADER_BOTTOM = 48;
const FOOTER_HEIGHT = 18;
const ROW_HEIGHT = 7;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;

function safeText(value: string, maxLength: number): string {
  return String(value || '').slice(0, maxLength);
}

function drawHeader(pdf: jsPDF, options: AttendanceReportPdfOptions) {
  pdf.setTextColor(16, 32, 59);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text('College of Technologies', MARGIN, 16);
  pdf.setFontSize(9);
  pdf.setTextColor(100, 116, 139);
  pdf.setFont('helvetica', 'normal');
  pdf.text('COT Event Attendance System', MARGIN, 22);
  pdf.setFontSize(13);
  pdf.setTextColor(37, 99, 235);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`${options.targetRole} Attendance Report`, MARGIN, 33);
  pdf.setFontSize(8);
  pdf.setTextColor(71, 85, 105);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Scope: ${safeText(options.eventId || 'All filtered events', 80)}`, MARGIN, 40);
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.35);
  pdf.line(MARGIN, HEADER_BOTTOM, PAGE_WIDTH - MARGIN, HEADER_BOTTOM);
}

function drawTableHeader(pdf: jsPDF, y: number) {
  pdf.setFillColor(241, 245, 249);
  pdf.rect(MARGIN, y - 5, PAGE_WIDTH - MARGIN * 2, ROW_HEIGHT + 2, 'F');
  pdf.setTextColor(51, 65, 85);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text('ID', MARGIN + 2, y);
  pdf.text('Name', 42, y);
  pdf.text('Event', 100, y);
  pdf.text('Status', 168, y);
}

function drawFooter(pdf: jsPDF, page: number, totalPages: number, generatedAt: Date) {
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.3);
  pdf.line(MARGIN, PAGE_HEIGHT - FOOTER_HEIGHT, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - FOOTER_HEIGHT);
  pdf.setTextColor(100, 116, 139);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text(`Generated: ${generatedAt.toLocaleString()}`, MARGIN, PAGE_HEIGHT - 10);
  pdf.text(`COT Attendance Report  |  Page ${page} of ${totalPages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 10, { align: 'right' });
}

export function createAttendanceReportPdf(options: AttendanceReportPdfOptions): jsPDF {
  const generatedAt = options.generatedAt || new Date();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = HEADER_BOTTOM + 10;

  drawHeader(pdf, options);
  pdf.setTextColor(51, 65, 85);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text(
    `Present: ${options.counts.present}   Late: ${options.counts.late}   Absent: ${options.counts.absent}   Total: ${options.rows.length}`,
    MARGIN,
    y,
  );
  y += 10;
  drawTableHeader(pdf, y);
  y += ROW_HEIGHT + 2;

  for (const row of options.rows) {
    if (y + ROW_HEIGHT > PAGE_HEIGHT - FOOTER_HEIGHT - 4) {
      pdf.addPage();
      drawHeader(pdf, options);
      y = HEADER_BOTTOM + 10;
      drawTableHeader(pdf, y);
      y += ROW_HEIGHT + 2;
    }

    pdf.setTextColor(51, 65, 85);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(safeText(row.personId, 24), MARGIN + 2, y);
    pdf.text(safeText(row.name, 28), 42, y);
    pdf.text(safeText(row.eventId, 30), 100, y);
    pdf.text(safeText(row.status, 16), 168, y);
    y += ROW_HEIGHT;
  }

  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    pdf.setPage(page);
    drawFooter(pdf, page, totalPages, generatedAt);
  }
  return pdf;
}

export function createAttendanceReportPdfBlob(options: AttendanceReportPdfOptions): Blob {
  return createAttendanceReportPdf(options).output('blob');
}
