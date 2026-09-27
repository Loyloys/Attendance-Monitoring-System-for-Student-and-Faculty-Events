import { certificatePdf, eventAttendancePdf, personalAttendancePdf } from '../services/reportService.js';

function sendPdf(response, result) {
  response.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${result.filename}"`,
    'Content-Length': String(result.content.length),
  });
  response.send(result.content);
}

export async function personal(request, response) {
  sendPdf(response, await personalAttendancePdf(request.user));
}

export async function event(request, response) {
  sendPdf(response, await eventAttendancePdf(request.user, request.params.eventId));
}

export async function certificate(request, response) {
  sendPdf(response, await certificatePdf(request.user, Number(request.params.certificateId)));
}
