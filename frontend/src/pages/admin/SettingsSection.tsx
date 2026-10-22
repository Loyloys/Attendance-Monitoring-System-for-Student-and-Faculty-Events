import { useCallback, useEffect, useState } from 'react';
import { eventApi } from '../../data/eventApi';

export default function SettingsSection() {
  const [enabled, setEnabled] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [setting, config] = await Promise.all([eventApi.googleOAuthSettings(), eventApi.googleConfig()]);
      if (!setting.available) throw new Error('The persistent setting is unavailable. Google sign-in remains disabled.');
      setEnabled(setting.enabled);
      setOauthConfigured(config.configurationAvailable);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (value: boolean) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await eventApi.updateGoogleOAuthSettings(value);
      if (!result.available) throw new Error('The setting could not be confirmed. Google sign-in remains disabled.');
      setEnabled(result.enabled);
      setNotice(value && !oauthConfigured
        ? 'Saved. Google sign-in remains unavailable until the backend Google client ID and access policy are configured.'
        : `Google OAuth has been ${value ? 'enabled' : 'disabled'} for sign-in and signup.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The setting could not be saved.');
      await load();
    } finally {
      setSaving(false);
    }
  };

  return <section className="mt-6 space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#94A3B8]">Administrator settings</p><h1 className="mt-1 text-2xl font-black text-[#10203B]">Settings</h1><p className="mt-2 text-sm text-[#64748B]">Persistent controls supported by the application. Google OAuth is enforced by the backend for both sign-in and signup.</p></header>
    <div className="max-w-3xl rounded-2xl border border-[#E2E3DF] bg-white p-5 shadow-sm">
      <h2 className="font-bold text-[#10203B]">Google OAuth</h2>
      <p className="mt-1 text-sm leading-6 text-[#64748B]">Turning this off blocks Google identity flows. Password sign-in for Students, Faculty, and Admins remains available.</p>
      {loading ? <p role="status" className="mt-4 text-sm text-[#64748B]">Loading settings…</p>
        : <label className="mt-5 flex items-center gap-3">
          <input type="checkbox" checked={enabled} disabled={saving || Boolean(error)} onChange={event => void save(event.target.checked)} aria-label="Enable Google OAuth" />
          <span className="text-sm font-semibold text-[#334155]">{enabled ? 'Enabled' : 'Disabled'}</span>
          {!oauthConfigured && <span className="text-xs text-amber-700">Backend Google OAuth configuration is unavailable.</span>}
        </label>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error} <button className="ml-2 font-bold underline" onClick={() => void load()}>Retry</button></p>}
      {notice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    </div>
  </section>;
}
