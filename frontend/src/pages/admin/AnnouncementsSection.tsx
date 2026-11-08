import { useCallback, useEffect, useState } from 'react';
import { eventApi, type Announcement } from '../../data/eventApi';

export default function AnnouncementsSection() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<Announcement['audience']>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setItems(await eventApi.adminAnnouncements()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Announcements could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const created = await eventApi.createAdminAnnouncement({ title, message, audience });
      setItems(current => [created, ...current]);
      setTitle('');
      setMessage('');
      const delivery = created.notificationDelivery;
      if (!delivery || delivery.status === 'not_configured') {
        setNotice('Announcement was saved for its selected recipients. Push delivery is not configured on the server yet.');
      } else if (delivery.status === 'sent') {
        setNotice(`Announcement was saved and push notifications were sent to ${delivery.sent} browser${delivery.sent === 1 ? '' : 's'}.`);
      } else if (delivery.status === 'partial') {
        setNotice(`Announcement was saved. Push reached ${delivery.sent} browser${delivery.sent === 1 ? '' : 's'}; ${delivery.failed} push delivery attempt${delivery.failed === 1 ? '' : 's'} failed.`);
      } else if (delivery.status === 'failed') {
        setNotice('Announcement was saved, but push delivery failed. Recipients can still read it in Announcements.');
      } else {
        setNotice('Announcement was saved and is available in the app. No subscribed browsers were available for push delivery.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Announcement could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="mt-6 space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#94A3B8]">Communication</p><h1 className="mt-1 text-2xl font-black text-[#10203B]">Announcements</h1><p className="mt-2 text-sm text-[#64748B]">Publish announcements to Students, Faculty, or both.</p></header>
    <form onSubmit={event => void submit(event)} className="max-w-3xl space-y-4 rounded-2xl border border-[#E2E3DF] bg-white p-5 shadow-sm">
      <label className="block text-sm font-semibold text-[#334155]">Title<input required maxLength={180} value={title} onChange={event => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-[#E2E3DF] px-3 py-2.5 font-normal" /></label>
      <label className="block text-sm font-semibold text-[#334155]">Message<textarea required maxLength={10000} rows={5} value={message} onChange={event => setMessage(event.target.value)} className="mt-1 w-full rounded-xl border border-[#E2E3DF] px-3 py-2.5 font-normal" /></label>
      <label className="block text-sm font-semibold text-[#334155]">Recipients<select value={audience} onChange={event => setAudience(event.target.value as Announcement['audience'])} className="mt-1 w-full rounded-xl border border-[#E2E3DF] px-3 py-2.5 font-normal"><option value="all">Students and Faculty</option><option value="student">Students</option><option value="faculty">Faculty</option></select></label>
      <button disabled={saving} className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Publishing…' : 'Publish announcement'}</button>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    </form>
    <div className="max-w-3xl space-y-3">
      <h2 className="font-bold text-[#10203B]">Published</h2>
      {loading ? <p role="status" className="text-sm text-[#64748B]">Loading announcements…</p>
        : items.length === 0 ? <p className="rounded-xl border border-dashed border-[#CBD5E1] p-5 text-sm text-[#64748B]">No announcements yet.</p>
          : items.map(item => <article key={item.id} className="rounded-xl border border-[#E2E3DF] bg-white p-4"><div className="flex justify-between gap-3"><h3 className="font-bold text-[#10203B]">{item.title}</h3><span className="text-xs text-[#64748B]">{item.audience === 'all' ? 'Students and Faculty' : item.audience}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-[#475569]">{item.message}</p><p className="mt-3 text-xs text-[#94A3B8]">{new Date(item.createdAt).toLocaleString()} · {item.createdByName}</p></article>)}
    </div>
  </section>;
}
