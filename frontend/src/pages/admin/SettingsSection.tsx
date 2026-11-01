import { useCallback, useEffect, useState } from 'react';
import { eventApi } from '../../data/eventApi';

export default function SettingsSection() {
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [recaptchaEnabled, setRecaptchaEnabled] = useState(false);
  const [recaptchaConfigured, setRecaptchaConfigured] = useState(false);
  const [mapPickerEnabled, setMapPickerEnabled] = useState(false);
  const [calendarConfigured, setCalendarConfigured] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEnabled, setCalendarEnabled] = useState(true);
  const [calendarSettingAvailable, setCalendarSettingAvailable] = useState(false);
  const [calendarMissing, setCalendarMissing] = useState<string[]>([]);

  const [oauthLoading, setOauthLoading] = useState(true);
  const [recaptchaLoading, setRecaptchaLoading] = useState(true);
  const [mapPickerLoading, setMapPickerLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(true);

  const [oauthSaving, setOauthSaving] = useState(false);
  const [recaptchaSaving, setRecaptchaSaving] = useState(false);
  const [mapPickerSaving, setMapPickerSaving] = useState(false);
  const [calendarSaving, setCalendarSaving] = useState(false);

  const [oauthError, setOauthError] = useState('');
  const [recaptchaError, setRecaptchaError] = useState('');
  const [mapPickerError, setMapPickerError] = useState('');
  const [oauthNotice, setOauthNotice] = useState('');
  const [recaptchaNotice, setRecaptchaNotice] = useState('');
  const [mapPickerNotice, setMapPickerNotice] = useState('');
  const [calendarError, setCalendarError] = useState('');
  const [calendarNotice, setCalendarNotice] = useState('');

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
      setOauthConfigured(config.configurationAvailable);
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
      // "configured" = backend secret key available (status.configured) AND
      // frontend public site key is loaded (VITE_RECAPTCHA_SITE_KEY).
      setRecaptchaConfigured(status.configured && Boolean(import.meta.env.VITE_RECAPTCHA_SITE_KEY));
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
  }, [loadOauth, loadRecaptcha, loadMapPicker, loadCalendar]);

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

  const saveOauth = async (value: boolean) => {
    setOauthSaving(true);
    setOauthError('');
    setOauthNotice('');
    try {
      const result = await eventApi.updateGoogleOAuthSettings(value);
      if (!result.available) throw new Error('The setting could not be confirmed. Google sign-in remains disabled.');
      setOauthEnabled(result.enabled);
      setOauthNotice(value && !oauthConfigured
        ? 'Saved. Google sign-in remains unavailable until the backend Google client ID and access policy are configured.'
        : `Google OAuth has been ${value ? 'enabled' : 'disabled'} for sign-in and signup.`);
    } catch (caught) {
      setOauthError(caught instanceof Error ? caught.message : 'The setting could not be saved.');
      await loadOauth();
    } finally {
      setOauthSaving(false);
    }
  };

  const saveRecaptcha = async (value: boolean) => {
    setRecaptchaSaving(true);
    setRecaptchaError('');
    setRecaptchaNotice('');
    try {
      const result = await eventApi.updateRecaptchaSettings(value);
      if (!result.available) throw new Error('The setting could not be confirmed. reCAPTCHA remains disabled.');
      setRecaptchaEnabled(result.enabled);
      if (value) {
        setRecaptchaNotice('reCAPTCHA is now required on password login. Users must complete the checkbox before signing in.');
      } else {
        setRecaptchaNotice('reCAPTCHA is no longer required on password login.');
      }
    } catch (caught) {
      setRecaptchaError(caught instanceof Error ? caught.message : 'The setting could not be saved.');
      await loadRecaptcha();
    } finally {
      setRecaptchaSaving(false);
    }
  };

  const saveMapPicker = async (value: boolean) => {
    setMapPickerSaving(true);
    setMapPickerError('');
    setMapPickerNotice('');
    try {
      const result = await eventApi.updateMapPickerSettings(value);
      if (!result.available) throw new Error('The setting could not be confirmed. Map picker remains disabled.');
      setMapPickerEnabled(result.enabled);
      if (value) {
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
      {oauthError && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{oauthError} <button className="ml-2 font-bold underline" onClick={() => void loadOauth()}>Retry</button></p>}
      {oauthNotice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{oauthNotice}</p>}
    </div>

    <div className="max-w-3xl rounded-2xl border border-[#E2E3DF] bg-white p-5 shadow-sm">
      <h2 className="font-bold text-[#10203B]">Google Calendar</h2>
      <p className="mt-1 text-sm leading-6 text-[#64748B]">Connect this Admin account’s Google Calendar so newly saved and edited events are synchronized without creating duplicates.</p>
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
          <input type="checkbox" checked={recaptchaEnabled} disabled={recaptchaSaving || Boolean(recaptchaError) || !recaptchaConfigured} onChange={event => void saveRecaptcha(event.target.checked)} aria-label="Enable reCAPTCHA on login" />
          <span className="text-sm font-semibold text-[#334155]">{recaptchaEnabled ? 'Enabled' : 'Disabled'}</span>
          {!recaptchaConfigured && <span className="text-xs text-amber-700">Backend reCAPTCHA keys are not configured.</span>}
        </label>}
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
      {mapPickerError && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{mapPickerError} <button className="ml-2 font-bold underline" onClick={() => void loadMapPicker()}>Retry</button></p>}
      {mapPickerNotice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{mapPickerNotice}</p>}
    </div>
  </section>;
}
