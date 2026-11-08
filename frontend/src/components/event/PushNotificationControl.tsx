import { useCallback, useEffect, useState } from 'react';
import { eventApi } from '../../data/eventApi';
import { deletePushToken, getPushToken, listenForPushMessages, pushNotificationsSupported } from '../../data/pushNotifications';

type PushState = 'checking' | 'unsupported' | 'unconfigured' | 'disabled' | 'off' | 'enabled' | 'working' | 'error';

export default function PushNotificationControl() {
  const [state, setState] = useState<PushState>('checking');
  const [message, setMessage] = useState('');

  const enable = useCallback(async () => {
    setState('working');
    setMessage('');
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('off');
        setMessage(permission === 'denied'
          ? 'Notifications are blocked in your browser settings. Allow them for this site, then try again.'
          : 'Notification permission was not granted.');
        return;
      }
      const token = await getPushToken();
      if (!token) throw new Error('Firebase did not return a browser push token.');
      await eventApi.registerPushDevice(token);
      setState('enabled');
      setMessage('Push notifications are enabled for announcements on this browser.');
    } catch (caught) {
      setState('error');
      setMessage(caught instanceof Error ? caught.message : 'Push notifications could not be enabled.');
    }
  }, []);

  const disable = useCallback(async () => {
    setState('working');
    setMessage('');
    try {
      const token = await getPushToken();
      if (token) await eventApi.unregisterPushDevice(token);
      await deletePushToken();
      setState('off');
      setMessage('Push notifications were disabled for this browser.');
    } catch (caught) {
      setState('error');
      setMessage(caught instanceof Error ? caught.message : 'Push notifications could not be disabled.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const [supported, status] = await Promise.all([
          pushNotificationsSupported(),
          eventApi.pushNotificationStatus(),
        ]);
        if (!active) return;
        if (!supported) {
          setState('unsupported');
          return;
        }
        if (!status.available) throw new Error('Push notification settings could not be loaded. Please try again later.');
        if (!status.enabled) {
          setState('disabled');
          return;
        }
        if (!status.configured) {
          setState('unconfigured');
          return;
        }
        if (Notification.permission !== 'granted') {
          setState('off');
          return;
        }
        const token = await getPushToken();
        if (!token) {
          setState('off');
          return;
        }
        await eventApi.registerPushDevice(token);
        if (active) setState('enabled');
      } catch (caught) {
        if (!active) return;
        setState('error');
        setMessage(caught instanceof Error ? caught.message : 'Push notification status could not be loaded.');
      }
    };
    void initialize();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (state !== 'enabled') return undefined;
    return listenForPushMessages(payload => {
      if (Notification.permission !== 'granted') return;
      const notification = new Notification(payload.notification?.title || 'University Attendance', {
        body: payload.notification?.body || 'You have a new announcement.',
        icon: '/favicon.ico',
      });
      notification.onclick = () => {
        window.focus();
        window.location.assign(payload.data?.url || '/portal?view=announcements');
      };
    });
  }, [state]);

  if (state === 'checking') {
    return <p role="status" className="app-card mt-5 p-4 text-sm text-slate-500">Checking browser notifications…</p>;
  }
  if (state === 'unsupported') {
    return <p className="app-card mt-5 p-4 text-sm text-slate-600">Push notifications are not supported by this browser or connection.</p>;
  }
  if (state === 'unconfigured') {
    return <p className="app-card mt-5 p-4 text-sm text-slate-600">Push notifications are not configured on this server yet.</p>;
  }
  if (state === 'disabled') {
    return <p className="app-card mt-5 p-4 text-sm text-slate-600">Push notifications have been disabled by an administrator.</p>;
  }

  return <div className="app-card mt-5 flex flex-wrap items-center justify-between gap-3 p-4">
    <p className="text-sm text-slate-700">Get browser alerts when new announcements are published.</p>
    <button
      type="button"
      className="app-button-secondary"
      disabled={state === 'working'}
      onClick={() => void (state === 'enabled' ? disable() : enable())}
    >
      {state === 'working' ? 'Updating…' : state === 'enabled' ? 'Turn off notifications' : 'Enable notifications'}
    </button>
    {message && <p role={state === 'error' ? 'alert' : 'status'} className={`w-full text-sm ${state === 'error' ? 'text-rose-700' : 'text-slate-600'}`}>{message}</p>}
  </div>;
}
