import { useEffect, useState } from 'react';
import { eventApi } from '../../data/eventApi';

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { setEntries(await eventApi.adminAuditLog(100)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load activity log.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Activity Log</h1>
        <button onClick={() => void load()} disabled={loading}>Refresh</button>
      </div>
      {loading && <p>Loading…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && entries.length === 0 && <p>No activity recorded.</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.actor}</strong> — {entry.detail} for {entry.targetAccountId} at {entry.at}
          </li>
        ))}
      </ul>
    </section>
  );
}
