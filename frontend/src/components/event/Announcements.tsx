import { useCallback, useEffect, useState } from 'react';
import { eventApi, type Announcement as AnnouncementRecord } from '../../data/eventApi';

export default function Announcements() {
  const [items, setItems] = useState<AnnouncementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setItems(await eventApi.announcements()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Announcements could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <section>
    <p className="app-label">Updates</p>
    <h1 className="app-page-title">Announcements</h1>
    <p className="app-page-subtitle">Information shared with your account group.</p>
    {loading ? <p role="status" className="app-card mt-5 p-5 text-sm text-slate-500">Loading announcements…</p>
      : error ? <div role="alert" className="app-card mt-5 p-5"><p className="text-sm text-rose-700">{error}</p><button type="button" onClick={() => void load()} className="app-button-secondary mt-3">Retry</button></div>
        : items.length === 0 ? <p className="app-card mt-5 p-5 text-sm text-slate-500">There are no announcements for you yet.</p>
          : <div className="mt-5 space-y-4">{items.map(item => <article key={item.id} className="app-card p-5"><h2 className="text-lg font-bold text-slate-900">{item.title}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.message}</p><p className="mt-4 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()} · {item.createdByName}</p></article>)}</div>}
  </section>;
}
