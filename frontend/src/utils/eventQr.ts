export const QR_PREFIX = 'COT-EVENT';

export function isEventQr(value: string): boolean {
  return value.trim().startsWith(`${QR_PREFIX}:`);
}

export interface EventQrDetails {
  eventId: string;
  token: string;
}

export function parseEventQr(value: string): EventQrDetails | null {
  const parts = value.trim().split(':');
  if (parts.length !== 3 || parts[0] !== QR_PREFIX || !parts[1] || !parts[2]) return null;
  return { eventId: parts[1], token: parts[2] };
}

export function validateEventQr(value: string): { valid: boolean; reason?: string; details?: EventQrDetails } {
  const details = parseEventQr(value);
  return details
    ? { valid: true, details }
    : { valid: false, reason: 'Invalid event QR code.' };
}
