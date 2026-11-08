import { describe, expect, it } from 'vitest';
import { createAttendanceReportPdf, createAttendanceReportPdfBlob } from '../src/utils/attendanceReportPdf';

const generatedAt = new Date('2026-11-06T08:00:00.000Z');

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    personId: `STU-${index + 1}`,
    name: `Student ${index + 1}`,
    eventId: `event-${index + 1}`,
    status: index % 3 === 0 ? 'Present' : 'Late',
  }));
}

describe('attendance report PDF layout', () => {
  it('keeps the existing report content and adds header/footer metadata', () => {
    const pdf = createAttendanceReportPdf({
      targetRole: 'Student',
      eventId: 'All filtered events',
      rows: rows(2),
      counts: { present: 1, late: 1, absent: 0 },
      generatedAt,
    });

    const output = pdf.output();
    expect(output).toContain('College of Technologies');
    expect(output).toContain('Student Attendance Report');
    expect(output).toContain('COT Attendance Report');
    expect(output).toContain('Page 1 of 1');
    expect(output).toContain('Generated:');
    expect(output).toContain('STU-1');
    expect(pdf.getNumberOfPages()).toBe(1);
  });

  it('repeats table headings and keeps footer pagination on every page', () => {
    const pdf = createAttendanceReportPdf({
      targetRole: 'Faculty',
      eventId: 'event-report',
      rows: rows(100),
      counts: { present: 50, late: 40, absent: 10 },
      generatedAt,
    });

    const output = pdf.output();
    const pages = pdf.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    for (let page = 1; page <= pages; page += 1) {
      pdf.setPage(page);
      const pageText = pdf.internal.pages[page].join(' ');
      expect(pageText).toContain('Name');
      expect(pageText).toContain(`Page ${page} of ${pages}`);
    }
    expect(output).toContain('Faculty Attendance Report');
    expect(output).toContain('STU-100');
  });

  it('creates a PDF blob for in-app preview without downloading', () => {
    const blob = createAttendanceReportPdfBlob({
      targetRole: 'Student',
      eventId: 'event-preview',
      rows: rows(1),
      counts: { present: 1, late: 0, absent: 0 },
      generatedAt,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });
});
