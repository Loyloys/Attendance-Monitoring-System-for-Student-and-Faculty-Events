export interface EventQrDetails {
  eventId: string;
  token: string;
  expiresAt: string;
}

const EVENT_QR_PREFIX = 'cot-event';

function createToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createEventQr(eventId: string, expiresAt: string): EventQrDetails & { value: string } {
  const token = createToken();
  return {
    eventId,
    token,
    expiresAt,
    value: `${EVENT_QR_PREFIX}:${eventId}:${token}:${expiresAt}`,
  };
}

export function parseEventQr(value: string): EventQrDetails | null {
  const parts = value.trim().split(':');
  if (parts.length !== 4 || parts[0] !== EVENT_QR_PREFIX) return null;

  const [, eventId, token, expiresAt] = parts;
  if (!eventId || !token || !expiresAt || Number.isNaN(Date.parse(expiresAt))) return null;
  return { eventId, token, expiresAt };
}

export function validateEventQr(value: string, expectedEventId?: string): { valid: boolean; reason?: string; details?: EventQrDetails } {
  const details = parseEventQr(value);
  if (!details) return { valid: false, reason: 'Invalid event QR code.' };
  if (expectedEventId && details.eventId !== expectedEventId) return { valid: false, reason: 'This QR code belongs to a different event.' };
  if (Date.parse(details.expiresAt) <= Date.now()) return { valid: false, reason: 'This event QR code has expired.' };
  return { valid: true, details };
}

export function isEventQr(value: string): boolean {
  return value.trim().startsWith(`${EVENT_QR_PREFIX}:`);
}
