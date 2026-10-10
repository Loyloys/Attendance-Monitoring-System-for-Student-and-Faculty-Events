/** Why tracking is paused, in plain language. Shared by the tracker and monitoring screens. */
export const PAUSE_TEXT: Record<string, string> = {
  outside_venue: 'Outside the event check-in zone. Time is paused until they return.',
  location_stale: 'No recent location update, so time is paused.',
  location_unavailable: 'Their device is not reporting a location.',
  location_inaccurate: 'The location fix is not precise enough to verify.',
  required_duration_met: 'Required duration met.',
  checked_out: 'Checked out.',
  event_ended: 'The event has ended.',
};

/** Formats server-verified seconds as m:ss. The server owns the value. */
export const formatVerified = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A location badge tone, kept separate from the attendance outcome. */
export const locationBadgeTone = (state: string) => {
  if (state === 'inside') return 'border-emerald-300/30 bg-emerald-300/10 text-emerald-700';
  if (state === 'outside') return 'border-amber-300/30 bg-amber-300/10 text-amber-700';
  return 'border-slate-300 bg-slate-100 text-slate-600';
};

export const locationBadgeText = (state: string) => {
  if (state === 'inside') return 'Inside the check-in zone';
  if (state === 'outside') return 'Outside the check-in zone';
  return 'Location unavailable';
};