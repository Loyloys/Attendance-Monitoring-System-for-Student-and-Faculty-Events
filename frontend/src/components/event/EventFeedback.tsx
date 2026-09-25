import { useState, type FormEvent } from 'react';
import { CheckCircle2, MessageSquare, Send, Star } from 'lucide-react';
import type { EventRecord } from '../../types/eventAttendance';

interface Props {
  events: EventRecord[];
  onSubmit: (eventId: string, rating: number, comments: string) => Promise<void>;
}

export default function EventFeedback({ events, onSubmit }: Props) {
  const attended = events.filter(event => event.attendance_status === 'present' || event.attendance_status === 'late');
  const [eventId, setEventId] = useState(attended.find(event => !event.feedback_submitted)?.id || '');
  const [rating, setRating] = useState(5);
  const [comments, setComments] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const selected = attended.find(event => event.id === eventId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!eventId) return setError('Choose an event you attended.');
    setSaving(true); setError(''); setMessage('');
    try { await onSubmit(eventId, rating, comments); setMessage('Thank you. Your event feedback was submitted.'); setComments(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Feedback could not be submitted.'); }
    finally { setSaving(false); }
  };

  return <div className="space-y-6"><div><p className="app-label">After attendance</p><h1 className="app-page-title">Event feedback</h1><p className="app-page-subtitle">Feedback is available for events where your attendance was recorded.</p></div><section className="app-card max-w-3xl p-6"><form onSubmit={submit} className="space-y-6"><div><label htmlFor="feedback-event" className="app-label">Attended event</label><select id="feedback-event" value={eventId} onChange={event => setEventId(event.target.value)} className="app-input"><option value="">Select an attended event</option>{attended.map(event => <option key={event.id} value={event.id} disabled={event.feedback_submitted}>{event.name}{event.feedback_submitted ? ' · already submitted' : ''}</option>)}</select></div><div><p className="app-label">Rating</p><div className="flex gap-2">{[1, 2, 3, 4, 5].map(value => <button key={value} type="button" aria-label={`${value} star${value > 1 ? 's' : ''}`} onClick={() => setRating(value)} className={`rounded-xl border p-3 transition ${rating >= value ? 'border-amber-300/40 bg-amber-300/10 text-amber-200' : 'border-white/10 text-white/35 hover:text-white'}`}><Star size={20} fill="currentColor" /></button>)}</div></div><div><label htmlFor="feedback-comments" className="app-label">Comments</label><textarea id="feedback-comments" rows={5} value={comments} onChange={event => setComments(event.target.value)} placeholder="Tell the organizer what worked well or could improve." className="app-input resize-y" /></div>{error && <p className="text-sm text-rose-200">{error}</p>}{message && <p className="flex items-center gap-2 text-sm text-emerald-200"><CheckCircle2 size={16} />{message}</p>}<button type="submit" disabled={saving || !eventId || selected?.feedback_submitted} className="app-button-primary"><Send size={16} />{saving ? 'Submitting…' : 'Submit event feedback'}</button></form></section>{!attended.length && <div className="app-card app-empty-state"><MessageSquare size={30} className="text-white/20" /><p className="mt-3 text-sm text-white/45">Record event attendance first. Feedback will appear here afterward.</p></div>}</div>;
}

