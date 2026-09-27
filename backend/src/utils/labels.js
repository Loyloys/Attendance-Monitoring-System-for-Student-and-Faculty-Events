export function methodLabel(method) {
  return { qr: 'QR code', barcode: 'Barcode', rfid: 'RFID or ID card' }[method] || method;
}

export function statusLabel(status) {
  return { present: 'Present', late: 'Late', absent: 'Absent' }[status] || status;
}
