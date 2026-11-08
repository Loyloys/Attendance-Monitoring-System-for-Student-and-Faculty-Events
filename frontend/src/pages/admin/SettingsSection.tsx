import { useCallback, useEffect, useState } from 'react';
import { eventApi, type FirebaseWebConfig } from '../../data/eventApi';
import { parseFirebaseWebConfig, serializeFirebaseWebConfig } from '../../data/firebaseWebConfig';

const defaultFirebaseWebConfig: FirebaseWebConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || '',
};
export default function SettingsSection() {
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [oauthClientId, setOauthClientId] = useState('');
  const [calendarClientId, setCalendarClientId] = useState('');
  const [recaptchaEnabled, setRecaptchaEnabled] = useState(false);
  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState('');
  const [recaptchaConfigured, setRecaptchaConfigured] = useState(false);
  const [mapPickerEnabled, setMapPickerEnabled] = useState(false);
  const [tileProviderApiKey, setTileProviderApiKey] = useState('');
  const [tileProviderKeyConfigured, setTileProviderKeyConfigured] = useState(false);
  const [calendarConfigured, setCalendarConfigured] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEnabled, setCalendarEnabled] = useState(true);
  const [calendarSettingAvailable, setCalendarSettingAvailable] = useState(false);
  const [calendarMissing, setCalendarMissing] = useState<string[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushConfigured, setPushConfigured] = useState(false);
  const [pushSettingAvailable, setPushSettingAvailable] = useState(false);
  const [firebaseWebConfigInput, setFirebaseWebConfigInput] = useState(() => serializeFirebaseWebConfig(defaultFirebaseWebConfig));
  const [firebaseWebConfigConfigured, setFirebaseWebConfigConfigured] = useState(false);

  const [oauthLoading, setOauthLoading] = useState(true);
  const [recaptchaLoading, setRecaptchaLoading] = useState(true);
  const [mapPickerLoading, setMapPickerLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [pushLoading, setPushLoading] = useState(true);

  const [oauthSaving, setOauthSaving] = useState(false);
  const [recaptchaSaving, setRecaptchaSaving] = useState(false);
  const [mapPickerSaving, setMapPickerSaving] = useState(false);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const [firebaseWebConfigSaving, setFirebaseWebConfigSaving] = useState(false);

  const [oauthError, setOauthError] = useState('');
  const [recaptchaError, setRecaptchaError] = useState('');
  const [mapPickerError, setMapPickerError] = useState('');
  const [oauthNotice, setOauthNotice] = useState('');
  const [recaptchaNotice, setRecaptchaNotice] = useState('');
  const [mapPickerNotice, setMapPickerNotice] = useState('');
  const [calendarError, setCalendarError] = useState('');
  const [calendarNotice, setCalendarNotice] = useState('');
  const [pushError, setPushError] = useState('');
  const [pushNotice, setPushNotice] = useState('');
  const [firebaseWebConfigErrorMessage, setFirebaseWebConfigErrorMessage] = useState('');
  const [firebaseWebConfigNotice, setFirebaseWebConfigNotice] = useState('');

  const firebaseWebConfigReady = (() => {
    try {
      parseFirebaseWebConfig(firebaseWebConfigInput);
      return true;
    } catch {
      return false;
    }
  })();

  const loadPushNotifications = useCallback(async () => {
    setPushLoading(true);
    setPushError('');
    try {
      const status = await eventApi.pushNotificationSettings();
      if (!status.available) throw new Error('The persistent setting is unavailable. Push notifications remain disabled.');
      setPushEnabled(status.enabled);
      setPushConfigured(status.configured);
      setPushSettingAvailable(status.available);
      setFirebaseWebConfigInput(serializeFirebaseWebConfig({ ...defaultFirebaseWebConfig, ...status.firebaseWebConfig }));
      setFirebaseWebConfigConfigured(status.firebaseWebConfigConfigured);
    } catch (caught) {
      setPushError(caught instanceof Error ? caught.message : 'Push notification settings could not be loaded.');
    } finally {
      setPushLoading(false);
    }
  }, []);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    setCalendarError('');
    try {
      const status = await eventApi.googleCalendarStatus();
      setCalendarConfigured(status.configured);
      setCalendarConnected(status.connected);
      setCalendarEnabled(status.enabled);
      setCalendarSettingAvailable(status.settingAvailable);
      setCalendarMissing(status.missing);
    } catch (caught) {
      setCalendarError(caught instanceof Error ? caught.message : 'Google Calendar status could not be loaded.');
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  const loadOauth = useCallback(async () => {
    setOauthLoading(true);
    setOauthError('');
    try {
      const [setting, config] = await Promise.all([eventApi.googleOAuthSettings(), eventApi.googleConfig()]);
      if (!setting.available) throw new Error('The persistent setting is unavailable. Google sign-in remains disabled.');
      setOauthEnabled(setting.enabled);
      setOauthClientId(setting.clientId);
      setCalendarClientId(setting.clientId);
      setOauthConfigured(config.configurationAvailable);
      return config.configurationAvailable;
    } catch (caught) {
      setOauthError(caught instanceof Error ? caught.message : 'Settings could not be loaded.');
    } finally {
      setOauthLoading(false);
    }
  }, []);

  const loadRecaptcha = useCallback(async () => {
    setRecaptchaLoading(true);
    setRecaptchaError('');
    try {
      const status = await eventApi.recaptchaSettings();
      if (!status.available) throw new Error('The persistent setting is unavailable. reCAPTCHA remains disabled.');
      setRecaptchaEnabled(status.enabled);
      const siteKey = status.siteKey?.trim() || import.meta.env.VITE_RECAPTCHA_SITE_KEY || '';
      setRecaptchaSiteKey(siteKey);
      setRecaptchaConfigured(status.configured && Boolean(siteKey));
    } catch (caught) {
      setRecaptchaError(caught instanceof Error ? caught.message : 'Settings could not be loaded.');
    } finally {
      setRecaptchaLoading(false);
    }
  }, []);

  const loadMapPicker = useCallback(async () => {
    setMapPickerLoading(true);
    setMapPickerError('');
    try {
      const status = await eventApi.mapPickerSettings();
      if (!status.available) throw new Error('The persistent setting is unavailable. Map picker remains disabled.');
      setMapPickerEnabled(status.enabled);
      setTileProviderKeyConfigured(status.tileProviderKeyConfigured);
    } catch (caught) {
      setMapPickerError(caught instanceof Error ? caught.message : 'Settings could not be loaded.');
    } finally {
      setMapPickerLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOauth();
    void loadRecaptcha();
    void loadMapPicker();
    void loadCalendar();
    void loadPushNotifications();
  }, [loadOauth, loadRecaptcha, loadMapPicker, loadCalendar, loadPushNotifications]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('googleCalendar');
    if (!result) return;
    setCalendarNotice(result === 'connected'
      ? 'Google Calendar connected successfully. New and edited events will sync to this Admin calendar.'
      : 'Google Calendar authorization could not be completed. Check the Google OAuth configuration and try again.');
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('googleCalendar');
    window.history.replaceState({}, '', cleanUrl);
    void loadCalendar();
  }, [loadCalendar]);

  const saveOauth = async (value: boolean, clientId = oauthClientId, reset = false) => {
    setOauthSaving(true);
    setOauthError('');
    setOauthNotice('');
    try {
      const result = await eventApi.updateGoogleOAuthSettings(value, clientId);
      if (!result.available) throw new Error('The setting could not be confirmed. Google sign-in remains disabled.');
      setOauthEnabled(result.enabled);
      const configured = await loadOauth();
      setOauthNotice(reset
        ? 'Google OAuth was reset to defaults. Sign-in is disabled and the client ID falls back to server configuration.'
        : value && !configured
          ? 'Saved. Google sign-in remains unavailable until a client ID and access policy are configured.'
          : `Google OAuth has been ${value ? 'enabled' : 'disabled'} for sign-in and signup.`);
    } catch (caught) {
      setOauthError(caught instanceof Error ? caught.message : 'The setting could not be saved.');
      await loadOauth();
    } finally {
      setOauthSaving(false);
    }
  };

  const saveRecaptcha = async (value: boolean, siteKey = recaptchaSiteKey, reset = false) => {
    setRecaptchaSaving(true);
    setRecaptchaError('');
    setRecaptchaNotice('');
    try {
      const result = await eventApi.updateRecaptchaSettings(value, siteKey);
      if (!result.available) throw new Error('The setting could not be confirmed. reCAPTCHA remains disabled.');
      setRecaptchaEnabled(result.enabled);
      const status = await eventApi.recaptchaSettings();
      if (!status.available) throw new Error('The saved reCAPTCHA setting could not be confirmed.');
      const effectiveSiteKey = status.siteKey?.trim() || import.meta.env.VITE_RECAPTCHA_SITE_KEY || '';
      setRecaptchaSiteKey(effectiveSiteKey);
      setRecaptchaConfigured(status.configured && Boolean(effectiveSiteKey));
      if (reset) {
        setRecaptchaNotice('reCAPTCHA was reset to defaults. Login verification is disabled and the site key falls back to frontend configuration.');
      } else if (value !== recaptchaEnabled) {
        setRecaptchaNotice(value
          ? 'reCAPTCHA is now required on password login. Users must complete the checkbox before signing in.'
          : 'reCAPTCHA is no longer required on password login.');
      } else {
        setRecaptchaNotice('reCAPTCHA site key saved.');
      }
    } catch (caught) {
      setRecaptchaError(caught instanceof Error ? caught.message : 'The setting could not be saved.');
      await loadRecaptcha();
    } finally {
      setRecaptchaSaving(false);
    }
  };

  const saveMapPicker = async (value: boolean, reset = false) => {
    setMapPickerSaving(true);
    setMapPickerError('');
    setMapPickerNotice('');
    try {
      const result = await eventApi.updateMapPickerSettings(value);
      if (!result.available) throw new Error('The setting could not be confirmed. Map picker remains disabled.');
      setMapPickerEnabled(result.enabled);
      if (reset) {
        setMapPickerNotice('Venue map picker was reset to its default hidden state.');
      } else if (value) {
        setMapPickerNotice('Venue map picker is now shown in the event form.');
      } else {
        setMapPickerNotice('Venue map picker is hidden. Saved venues and manual entry remain available.');
      }
    } catch (caught) {
      setMapPickerError(caught instanceof Error ? caught.message : 'The setting could not be saved.');
      await loadMapPicker();
    } finally {
      setMapPickerSaving(false);
    }
  };

  const saveTileProviderApiKey = async (apiKey = tileProviderApiKey) => {
    setMapPickerSaving(true);
    setMapPickerError('');
    setMapPickerNotice('');
    try {
      const result = await eventApi.updateMapPickerSettings(mapPickerEnabled, apiKey);
      if (!result.available) throw new Error('The key setting could not be confirmed.');
      setTileProviderKeyConfigured(result.tileProviderKeyConfigured);
      setTileProviderApiKey('');
      setMapPickerNotice(result.tileProviderKeyConfigured
        ? 'Tile provider API key saved securely. OpenStreetMap tiles do not use it.'
        : 'Tile provider API key cleared. OpenStreetMap tiles remain unchanged.');
    } catch (caught) {
      setMapPickerError(caught instanceof Error ? caught.message : 'The tile provider API key could not be saved.');
    } finally {
      setMapPickerSaving(false);
    }
  };

  const saveCalendar = async (value: boolean) => {
    setCalendarSaving(true);
    setCalendarError('');
    setCalendarNotice('');
    try {
      const result = await eventApi.updateGoogleCalendarSettings(value);
      if (!result.available) throw new Error('The setting could not be confirmed. Google Calendar synchronization remains disabled.');
      setCalendarEnabled(result.enabled);
      setCalendarNotice(value
        ? 'Google Calendar is enabled. Existing Admin authorization and event synchronization remain available.'
        : 'Google Calendar is disabled. Existing authorization, tokens, and Calendar events were preserved.');
    } catch (caught) {
      setCalendarError(caught instanceof Error ? caught.message : 'The Google Calendar setting could not be saved.');
      await loadCalendar();
    } finally {
      setCalendarSaving(false);
    }
  };

  const savePushNotifications = async (value: boolean, reset = false) => {
    setPushSaving(true);
    setPushError('');
    setPushNotice('');
    try {
      const result = await eventApi.updatePushNotificationSettings(value);
      if (!result.available) throw new Error('The setting could not be confirmed. Push notifications remain disabled.');
      setPushEnabled(result.enabled);
      setPushConfigured(result.configured);
      setPushSettingAvailable(result.available);
      setPushNotice(reset
        ? 'Push notifications were reset to the default disabled state.'
        : value
          ? 'The announcement push-delivery setting is enabled. Actual Firebase delivery is confirmed when an announcement reports successful sends.'
          : 'Push notifications have been disabled for announcements.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The push notification setting could not be saved.';
      await loadPushNotifications();
      setPushError(message);
    } finally {
      setPushSaving(false);
    }
  };

  const saveFirebaseWebConfig = async () => {
    let config: FirebaseWebConfig;
    try {
      config = parseFirebaseWebConfig(firebaseWebConfigInput);
    } catch (caught) {
      setFirebaseWebConfigErrorMessage(caught instanceof Error ? caught.message : 'The Firebase web configuration is invalid.');
      setFirebaseWebConfigNotice('');
      return;
    }
    setFirebaseWebConfigSaving(true);
    setFirebaseWebConfigErrorMessage('');
    setFirebaseWebConfigNotice('');
    try {
      const result = await eventApi.saveFirebaseWebConfig(config);
      if (!result.available || !result.firebaseWebConfigAvailable || !result.firebaseWebConfigConfigured) {
        throw new Error('The Firebase web configuration could not be confirmed as saved.');
      }
      setFirebaseWebConfigInput(serializeFirebaseWebConfig(result.firebaseWebConfig || config));
      setFirebaseWebConfigConfigured(true);
      setFirebaseWebConfigNotice('Firebase web configuration saved. Push notification clients will use these values.');
    } catch (caught) {
      setFirebaseWebConfigErrorMessage(caught instanceof Error ? caught.message : 'Firebase web configuration could not be saved.');
    } finally {
      setFirebaseWebConfigSaving(false);
    }
  };

  const resetFirebaseWebConfig = async () => {
    setFirebaseWebConfigSaving(true);
    setFirebaseWebConfigErrorMessage('');
    setFirebaseWebConfigNotice('');
    try {
      const result = await eventApi.resetFirebaseWebConfig();
      if (!result.available || !result.firebaseWebConfigAvailable || result.firebaseWebConfigConfigured) {
        throw new Error('The Firebase web configuration could not be confirmed as reset.');
      }
      setFirebaseWebConfigInput(serializeFirebaseWebConfig(defaultFirebaseWebConfig));
      setFirebaseWebConfigConfigured(false);
      setFirebaseWebConfigNotice('Firebase web configuration reset. The frontend environment defaults will be used.');
    } catch (caught) {
      setFirebaseWebConfigErrorMessage(caught instanceof Error ? caught.message : 'Firebase web configuration could not be reset.');
    } finally {
      setFirebaseWebConfigSaving(false);
    }
  };

  const saveCalendarClientId = async () => {
    setCalendarSaving(true);
    setCalendarError('');
    setCalendarNotice('');
    try {
      const result = await eventApi.updateGoogleOAuthSettings(oauthEnabled, calendarClientId);
      if (!result.available) throw new Error('The Google client ID could not be confirmed.');
      await Promise.all([loadOauth(), loadCalendar()]);
      setCalendarNotice('Google Calendar client ID saved. This shared Google client ID is also used for Google sign-in; Calendar still requires the matching server client secret.');
    } catch (caught) {
      setCalendarError(caught instanceof Error ? caught.message : 'The Google Calendar client ID could not be saved.');
      await loadCalendar();
    } finally {
      setCalendarSaving(false);
    }
  };

  const resetCalendar = async () => {
    setCalendarSaving(true);
    setCalendarError('');
    setCalendarNotice('');
    try {
      const clientIdResult = await eventApi.updateGoogleOAuthSettings(oauthEnabled, '');
      if (!clientIdResult.available) throw new Error('The shared Google client ID could not be reset.');
      const calendarResult = await eventApi.updateGoogleCalendarSettings(true);
      if (!calendarResult.available) throw new Error('Google Calendar could not be restored to its default enabled state.');
      await Promise.all([loadOauth(), loadCalendar()]);
      setCalendarNotice('Google Calendar was reset to defaults and enabled. Its shared client ID now falls back to server configuration; existing authorization was preserved.');
    } catch (caught) {
      setCalendarError(caught instanceof Error ? caught.message : 'Google Calendar could not be reset.');
      await Promise.all([loadOauth(), loadCalendar()]);
    } finally {
      setCalendarSaving(false);
    }
  };

  return <section className="mt-6 space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#94A3B8]">Administrator settings</p><h1 className="mt-1 text-2xl font-black text-[#10203B]">Settings</h1><p className="mt-2 text-sm text-[#64748B]">Persistent controls supported by the application. Google OAuth and reCAPTCHA are enforced by the backend.</p></header>

    <div className="max-w-3xl rounded-2xl border border-[#E2E3DF] bg-white p-5 shadow-sm">
      <h2 className="font-bold text-[#10203B]">Google OAuth</h2>
      <p className="mt-1 text-sm leading-6 text-[#64748B]">Turning this off blocks Google identity flows. Password sign-in for Students, Faculty, and Admins remains available.</p>
      {oauthLoading ? <p role="status" className="mt-4 text-sm text-[#64748B]">Loading settings…</p>
        : <label className="mt-5 flex items-center gap-3">
          <input type="checkbox" checked={oauthEnabled} disabled={oauthSaving || Boolean(oauthError)} onChange={event => void saveOauth(event.target.checked)} aria-label="Enable Google OAuth" />
          <span className="text-sm font-semibold text-[#334155]">{oauthEnabled ? 'Enabled' : 'Disabled'}</span>
          {!oauthConfigured && <span className="text-xs text-amber-700">Backend Google OAuth configuration is unavailable.</span>}
        </label>}
      {!oauthLoading && <>
        <label className="mt-5 block text-sm font-semibold text-[#334155]" htmlFor="google-oauth-client-id">Google OAuth client ID</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="google-oauth-client-id"
            className="min-w-0 flex-1 rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm text-[#10203B] outline-none focus:border-[#315A8A] focus:ring-2 focus:ring-[#315A8A]/20"
            type="password"
            value={oauthClientId}
            onChange={event => setOauthClientId(event.target.value)}
            placeholder="1234567890-abc.apps.googleusercontent.com"
            autoComplete="new-password"
            spellCheck={false}
            disabled={oauthSaving || Boolean(oauthError)}
          />
          <button
            type="button"
            className="rounded-lg bg-[#10203B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E3A5F] disabled:opacity-50"
            onClick={() => void saveOauth(oauthEnabled)}
            disabled={oauthSaving || Boolean(oauthError)}
          >
            Save client ID
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-[#64748B]">This public web client ID is saved for Google sign-in. The backend still requires a valid GOOGLE_ACCESS_POLICY.</p>
        <button
          type="button"
          className="mt-4 rounded-lg border border-[#CBD5E1] px-4 py-2 text-sm font-semibold text-[#334155] hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void saveOauth(false, '', true)}
          disabled={oauthSaving || Boolean(oauthError)}
        >
          Reset Google OAuth to default
        </button>
      </>}
      {oauthError && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{oauthError} <button className="ml-2 font-bold underline" onClick={() => void loadOauth()}>Retry</button></p>}
      {oauthNotice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{oauthNotice}</p>}
    </div>

    <div className="max-w-3xl rounded-2xl border border-[#E2E3DF] bg-white p-5 shadow-sm">
      <h2 className="font-bold text-[#10203B]">Google Calendar</h2>
      <p className="mt-1 text-sm leading-6 text-[#64748B]">Connect this Admin account’s Google Calendar so newly saved and edited events are synchronized without creating duplicates.</p>
      {!oauthLoading && <div className="mt-5">
        <label className="block text-sm font-semibold text-[#334155]" htmlFor="google-calendar-client-id">Google Calendar client ID</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="google-calendar-client-id"
            className="min-w-0 flex-1 rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm text-[#10203B] outline-none focus:border-[#315A8A] focus:ring-2 focus:ring-[#315A8A]/20"
            type="password"
            value={calendarClientId}
            onChange={event => setCalendarClientId(event.target.value)}
            placeholder="1234567890-abc.apps.googleusercontent.com"
            autoComplete="new-password"
            spellCheck={false}
            disabled={calendarLoading || calendarSaving || oauthLoading || oauthSaving || Boolean(oauthError)}
          />
          <button
            type="button"
            className="rounded-lg bg-[#10203B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E3A5F] disabled:opacity-50"
            onClick={() => void saveCalendarClientId()}
            disabled={calendarSaving || oauthSaving || Boolean(oauthError)}
          >
            Save client ID
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-[#64748B]">This is the shared Google client ID. Calendar also requires its matching server-side client secret.</p>
        <button
          type="button"
          className="mt-4 rounded-lg border border-[#CBD5E1] px-4 py-2 text-sm font-semibold text-[#334155] hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void resetCalendar()}
          disabled={calendarLoading || calendarSaving || oauthLoading || oauthSaving || Boolean(oauthError)}
        >
          Reset Google Calendar to default
        </button>
      </div>}
      {calendarLoading ? <p role="status" className="mt-4 text-sm text-[#64748B]">Checking Calendar connection…</p>
        : <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={calendarEnabled} disabled={calendarSaving || !calendarSettingAvailable} onChange={event => void saveCalendar(event.target.checked)} aria-label="Enable Google Calendar" />
            <span className="text-sm font-semibold text-[#334155]">{calendarEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
          <span className={`text-sm font-semibold ${calendarConnected ? 'text-emerald-700' : 'text-[#334155]'}`}>
            {calendarConnected ? 'Connected' : 'Not connected'}
          </span>
          {!calendarConfigured && <span className="text-xs text-amber-700">
            Backend Calendar OAuth configuration is unavailable{calendarMissing.length ? ` (${calendarMissing.join(', ')})` : '.'}
          </span>}
          {!calendarConnected && calendarConfigured && <a
            className="rounded-lg bg-[#10203B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E3A5F]"
            href={eventApi.googleCalendarAuthorizeUrl()}
          >
            Connect Google Calendar
          </a>}
        </div>}
      {calendarError && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{calendarError} <button className="ml-2 font-bold underline" onClick={() => void loadCalendar()}>Retry</button></p>}
      {calendarNotice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{calendarNotice}</p>}
    </div>

    <div className="max-w-3xl rounded-2xl border border-[#E2E3DF] bg-white p-5 shadow-sm">
      <h2 className="font-bold text-[#10203B]">reCAPTCHA on login</h2>
      <p className="mt-1 text-sm leading-6 text-[#64748B]">When enabled, the reCAPTCHA checkbox is shown and required before password sign-in. When disabled, the checkbox is hidden and verification is skipped.</p>
      {recaptchaLoading ? <p role="status" className="mt-4 text-sm text-[#64748B]">Loading settings…</p>
        : <label className="mt-5 flex items-center gap-3">
          <input type="checkbox" checked={recaptchaEnabled} disabled={recaptchaSaving || Boolean(recaptchaError) || ((!recaptchaConfigured || !recaptchaSiteKey.trim()) && !recaptchaEnabled)} onChange={event => void saveRecaptcha(event.target.checked)} aria-label="Enable reCAPTCHA on login" />
          <span className="text-sm font-semibold text-[#334155]">{recaptchaEnabled ? 'Enabled' : 'Disabled'}</span>
          {!recaptchaConfigured && <span className="text-xs text-amber-700">A site key or backend secret is missing.</span>}
        </label>}
      {!recaptchaLoading && <div className="mt-5">
        <label className="block text-sm font-semibold text-[#334155]" htmlFor="recaptcha-site-key">reCAPTCHA site key</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="recaptcha-site-key"
            className="min-w-0 flex-1 rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm text-[#10203B] outline-none focus:border-[#315A8A] focus:ring-2 focus:ring-[#315A8A]/20"
            type="password"
            value={recaptchaSiteKey}
            onChange={event => setRecaptchaSiteKey(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            disabled={recaptchaSaving || Boolean(recaptchaError) || (recaptchaEnabled && !recaptchaSiteKey.trim())}
          />
          <button
            type="button"
            className="rounded-lg bg-[#10203B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E3A5F] disabled:opacity-50"
            onClick={() => void saveRecaptcha(recaptchaEnabled)}
            disabled={recaptchaSaving || Boolean(recaptchaError)}
          >
            Save site key
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-[#64748B]">The public site key is safe to expose to browsers. The matching secret must still be configured on the backend.</p>
        <button
          type="button"
          className="mt-4 rounded-lg border border-[#CBD5E1] px-4 py-2 text-sm font-semibold text-[#334155] hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void saveRecaptcha(false, '', true)}
          disabled={recaptchaSaving || Boolean(recaptchaError)}
        >
          Reset reCAPTCHA to default
        </button>
      </div>}
      {recaptchaError && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{recaptchaError} <button className="ml-2 font-bold underline" onClick={() => void loadRecaptcha()}>Retry</button></p>}
      {recaptchaNotice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{recaptchaNotice}</p>}
    </div>

    <div className="max-w-3xl rounded-2xl border border-[#E2E3DF] bg-white p-5 shadow-sm">
      <h2 className="font-bold text-[#10203B]">Leaflet venue map picker</h2>
      <p className="mt-1 text-sm leading-6 text-[#64748B]">When enabled, the map picker is shown in the event form for choosing venue coordinates. When disabled, the map picker is hidden; saved-venue selection and manual venue name/coordinate entry keep working.</p>
      {mapPickerLoading ? <p role="status" className="mt-4 text-sm text-[#64748B]">Loading settings…</p>
        : <label className="mt-5 flex items-center gap-3">
          <input type="checkbox" checked={mapPickerEnabled} disabled={mapPickerSaving || Boolean(mapPickerError)} onChange={event => void saveMapPicker(event.target.checked)} aria-label="Enable venue map picker" />
          <span className="text-sm font-semibold text-[#334155]">{mapPickerEnabled ? 'Enabled' : 'Disabled'}</span>
        </label>}
      {!mapPickerLoading && <div className="mt-5">
        <label className="block text-sm font-semibold text-[#334155]" htmlFor="tile-provider-api-key">Tile provider API key</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="tile-provider-api-key"
            className="min-w-0 flex-1 rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm text-[#10203B] outline-none focus:border-[#315A8A] focus:ring-2 focus:ring-[#315A8A]/20"
            type="password"
            value={tileProviderApiKey}
            onChange={event => setTileProviderApiKey(event.target.value)}
            placeholder={tileProviderKeyConfigured ? 'A key is saved; enter a new key to replace it' : 'Enter a key only if your tile provider requires one'}
            autoComplete="new-password"
            spellCheck={false}
            disabled={mapPickerSaving || Boolean(mapPickerError)}
          />
          <button
            type="button"
            className="rounded-lg bg-[#10203B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E3A5F] disabled:opacity-50"
            onClick={() => void saveTileProviderApiKey()}
            disabled={mapPickerSaving || Boolean(mapPickerError) || !tileProviderApiKey.trim()}
          >
            Save tile provider key
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-[#64748B]">The current OpenStreetMap tiles need no API key. Any key entered is encrypted on the server and is not sent to OpenStreetMap.</p>
        {tileProviderKeyConfigured && <p className="mt-2 text-xs font-semibold text-emerald-700">A tile provider API key is saved.</p>}
        {tileProviderKeyConfigured && <button
          type="button"
          className="mt-3 rounded-lg border border-[#CBD5E1] px-4 py-2 text-sm font-semibold text-[#334155] hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void saveTileProviderApiKey('')}
          disabled={mapPickerSaving || Boolean(mapPickerError)}
        >
          Clear tile provider key
        </button>}
      </div>}
      {!mapPickerLoading && <button
        type="button"
        className="mt-4 rounded-lg border border-[#CBD5E1] px-4 py-2 text-sm font-semibold text-[#334155] hover:bg-slate-50 disabled:opacity-50"
        onClick={() => void saveMapPicker(false, true)}
        disabled={mapPickerSaving || Boolean(mapPickerError)}
      >
        Reset venue map picker to default
      </button>}
      {mapPickerError && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{mapPickerError} <button className="ml-2 font-bold underline" onClick={() => void loadMapPicker()}>Retry</button></p>}
      {mapPickerNotice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{mapPickerNotice}</p>}
    </div>

    <div className="max-w-3xl rounded-2xl border border-[#E2E3DF] bg-white p-5 shadow-sm">
      <h2 className="font-bold text-[#10203B]">Firebase Cloud Messaging</h2>
      <p className="mt-1 text-sm leading-6 text-[#64748B]">When enabled, Firebase sends browser push notifications for announcements to opted-in Students and Faculty. Disabling delivery preserves their registrations.</p>
      {pushLoading ? <p role="status" className="mt-4 text-sm text-[#64748B]">Loading settings…</p>
        : <label className="mt-5 flex items-center gap-3">
          <input type="checkbox" checked={pushEnabled} disabled={pushSaving || !pushSettingAvailable || ((!pushConfigured || !firebaseWebConfigReady) && !pushEnabled)} onChange={event => void savePushNotifications(event.target.checked)} aria-label="Enable Firebase Cloud Messaging" />
          <span className="text-sm font-semibold text-[#334155]">{pushEnabled ? 'Enabled' : 'Disabled'}</span>
          {!pushConfigured && <span className="text-xs text-amber-700">Firebase service-account credentials or token encryption key are missing from the backend environment.</span>}
          {!firebaseWebConfigReady && <span className="text-xs text-amber-700">Firebase web config or VAPID public key is missing or invalid.</span>}
        </label>}
      {!pushLoading && pushEnabled && pushConfigured && firebaseWebConfigReady && <p role="status" className="mt-3 text-xs text-[#64748B]">Delivery is enabled and configuration is present. Successful delivery is verified per announcement in its delivery result; this page does not send a test notification.</p>}
      {!pushLoading && <div className="mt-5 border-t border-[#E2E3DF] pt-5">
        <label className="block text-sm font-semibold text-[#334155]" htmlFor="firebase-web-configuration">Firebase Web Configuration</label>
        <p className="mt-1 text-xs leading-5 text-[#64748B]">Paste the Firebase web config object from Project settings → General, and add its VAPID public key as a <code>vapidKey</code> property. Required public values include the API key, project ID, sender ID, app ID, and VAPID key. Auth domain and storage bucket are optional.</p>
        <input
          id="firebase-web-configuration"
          className="mt-2 block w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm font-normal text-[#10203B] outline-none focus:border-[#315A8A] focus:ring-2 focus:ring-[#315A8A]/20"
          type="password"
          value={firebaseWebConfigInput}
          onChange={event => setFirebaseWebConfigInput(event.target.value)}
          placeholder={'{"apiKey":"...","projectId":"...","messagingSenderId":"...","appId":"...","vapidKey":"..."}'}
          autoComplete="new-password"
          spellCheck={false}
          disabled={firebaseWebConfigSaving || Boolean(pushError)}
        />
        <p className="mt-2 text-xs leading-5 text-[#64748B]">Only public browser configuration is accepted. Never paste Firebase service-account JSON, private keys, or the backend token-encryption key.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-[#10203B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E3A5F] disabled:opacity-50"
            onClick={() => void saveFirebaseWebConfig()}
            disabled={firebaseWebConfigSaving || Boolean(pushError)}
          >
            Save Firebase web configuration
          </button>
          <button
            type="button"
            className="rounded-lg border border-[#CBD5E1] px-4 py-2 text-sm font-semibold text-[#334155] hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void resetFirebaseWebConfig()}
            disabled={firebaseWebConfigSaving || Boolean(pushError)}
          >
            Reset Firebase web configuration to default
          </button>
        </div>
        {firebaseWebConfigConfigured
          ? <p className="mt-2 text-xs font-semibold text-emerald-700">Firebase web configuration is saved in Admin Settings.</p>
          : firebaseWebConfigReady
            ? <p className="mt-2 text-xs font-semibold text-slate-600">Using complete frontend environment defaults until a value is saved here.</p>
            : <p className="mt-2 text-xs font-semibold text-amber-700">Frontend environment defaults are incomplete; provide a complete config above to enable push notifications.</p>}
      </div>}
      {!pushLoading && <button
        type="button"
        className="mt-4 rounded-lg border border-[#CBD5E1] px-4 py-2 text-sm font-semibold text-[#334155] hover:bg-slate-50 disabled:opacity-50"
        onClick={() => void savePushNotifications(false, true)}
        disabled={pushSaving || !pushSettingAvailable || Boolean(pushError) || !pushEnabled}
      >
        Reset Firebase Cloud Messaging to default
      </button>}
      {firebaseWebConfigErrorMessage && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{firebaseWebConfigErrorMessage}</p>}
      {firebaseWebConfigNotice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{firebaseWebConfigNotice}</p>}
      {pushError && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{pushError} <button className="ml-2 font-bold underline" onClick={() => void loadPushNotifications()}>Retry</button></p>}
      {pushNotice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{pushNotice}</p>}
    </div>
  </section>;
}
