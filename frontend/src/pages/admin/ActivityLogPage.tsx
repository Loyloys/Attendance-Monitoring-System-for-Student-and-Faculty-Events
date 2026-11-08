import { useCallback, useEffect, useState } from 'react';
import { eventApi, type AdminAuditEntry } from '../../data/eventApi';

type ActivityEntry = AdminAuditEntry;

const actionLabels: Record<string, string> = {
  login_succeeded: 'Signed in',
  profile_updated: 'Updated profile',
  event_registered: 'Registered for event',
  event_registration_cancelled: 'Cancelled registration',
  attendance_checked_in: 'Checked in',
  attendance_status_changed: 'Changed attendance status',
  account_created: 'Created account',
  account_updated: 'Updated account',
  account_approved: 'Approved account',
  account_rejected: 'Rejected signup',
  role_changed: 'Changed role',
  account_archived: 'Archived account',
  account_restored: 'Restored account',
  account_deleted: 'Deleted account',
  event_created: 'Created event',
  event_updated: 'Updated event',
  event_cancelled: 'Cancelled event',
  event_archived: 'Archived event',
  event_restored: 'Restored event',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [actorRole, setActorRole] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await eventApi.adminAuditLog({ limit: 200, search, action, actorRole }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load activity log.');
    } finally {
      setLoading(false);
    }
  }, [action, actorRole, search]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-5">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#C2410C]">Read-only administrator view</p>
          <h1 className="mt-2 text-3xl font-black text-[#10203B]">Activity Log</h1>
          <p className="mt-1 text-sm text-[#64748B]">Successful account, event, registration, and attendance actions.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-[#E2E3DF] px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#FAF9F5] disabled:opacity-60">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      <div className="grid gap-3 rounded-2xl border border-[#E2E3DF] bg-white p-4 md:grid-cols-[1fr_220px_180px]">
        <input aria-label="Search activity" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(); }} placeholder="Search actor, account, event, or detail" className="rounded-xl border border-[#E2E3DF] px-3 py-2 text-sm outline-none focus:border-[#F97316]" />
        <select aria-label="Filter by action" value={action} onChange={event => setAction(event.target.value)} className="rounded-xl border border-[#E2E3DF] px-3 py-2 text-sm outline-none focus:border-[#F97316]">
          <option value="">All actions</option>
          {Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Filter by actor role" value={actorRole} onChange={event => setActorRole(event.target.value)} className="rounded-xl border border-[#E2E3DF] px-3 py-2 text-sm outline-none focus:border-[#F97316]">
          <option value="">All actor roles</option>
          <option value="student">Student</option>
          <option value="faculty">Faculty</option>
          <option value="admin">Admin</option>
        </select>
        <button type="button" onClick={() => void load()} className="w-fit rounded-lg bg-[#FFF1E6] px-3 py-2 text-xs font-bold text-[#9A3412]">Apply search</button>
      </div>

      {loading && <div className="rounded-2xl border border-[#E2E3DF] bg-white p-8 text-center text-sm text-[#64748B]">Loading activity…</div>}
      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
      {!loading && !error && entries.length === 0 && <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white p-10 text-center"><p className="font-semibold text-[#10203B]">No activity found</p><p className="mt-1 text-sm text-[#64748B]">Try clearing the filters or check back after a successful action.</p></div>}
      {!loading && !error && entries.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[#E2E3DF] bg-white">
          <ul className="divide-y divide-[#E2E3DF]">
            {entries.map(entry => (
              <li key={entry.id} className="p-4 sm:p-5">
                <div className="flex flex-col justify-between gap-2 sm:flex-row">
                  <div className="min-w-0">
                    <p className="font-bold text-[#10203B]">{actionLabels[entry.action] || entry.action}</p>
                    <p className="mt-1 text-sm text-[#475569]"><span className="font-semibold">{entry.actor || 'Unknown actor'}</span>{entry.actorRole ? ` · ${entry.actorRole}` : ''}{entry.targetName || entry.targetAccountId ? ` → ${entry.targetName || entry.targetAccountId}` : ''}{entry.eventName ? ` · ${entry.eventName}` : ''}</p>
                    {entry.detail && <p className="mt-2 text-sm text-[#64748B]">{entry.detail}</p>}
                  </div>
                  <time dateTime={entry.at} className="shrink-0 text-xs font-medium text-[#94A3B8]">{formatDate(entry.at)}</time>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
