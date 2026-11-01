import { ExternalLink } from 'lucide-react';

export default function GoogleCalendarLink({
  url,
  reason = 'not_synced',
  authorizeUrl,
  loading = false,
}: {
  url: string | null | undefined;
  reason?: 'not_synced' | 'permission_unavailable' | 'calendar_disabled' | null;
  authorizeUrl?: string;
  loading?: boolean;
}) {
  if (loading) {
    return <span className="text-xs text-[#94A3B8]" role="status">Checking Google Calendar…</span>;
  }
  if (!url) {
    if (authorizeUrl) {
      return (
        <a
          href={authorizeUrl}
          className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2"
          aria-label="Connect Google Calendar"
        >
          Connect Google Calendar
        </a>
      );
    }
    const message = reason === 'calendar_disabled'
      ? 'Google Calendar has been disabled by an Admin.'
      : reason === 'permission_unavailable'
      ? 'Google Calendar unavailable for this account. Check Calendar permissions.'
      : 'This event has not been synced to Google Calendar.';
    return <span className="text-xs text-[#94A3B8]" title={message}>Google Calendar unavailable</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2"
      aria-label="Open Google Calendar"
    >
      <ExternalLink size={14} /> Open Google Calendar
    </a>
  );
}
