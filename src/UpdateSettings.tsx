import { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw } from 'lucide-react';
import type { Settings, UpdateState } from '../shared/types';
export function UpdateSettings({ settings, save, notify }: { settings: Settings; save: (patch: Partial<Settings>) => Promise<void>; notify: (message: string) => void }) {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => { void window.syncit.updateState().then(setState); return window.syncit.onUpdate(setState); }, []);
  async function run(action: () => Promise<unknown>) { try { await action(); } catch (error) { notify(String(error)); } }
  const busy = state?.phase === 'checking' || state?.phase === 'downloading';
  const offered = !!state?.availableVersion && ['available', 'downloading', 'ready', 'error'].includes(state.phase);
  const percent = state?.phase === 'downloading' && state.progress !== undefined ? ` ${Math.round(state.progress * 100)}%` : '';
  return <div className="settings-section update-settings"><h3>App updates</h3><p>Installed {state?.currentVersion || '…'}{state?.availableVersion ? ` · Available ${state.availableVersion}` : ''}</p>
    <label className="toggle-row"><div><strong>Check daily for updates</strong><small>Asks GitHub for the newest release when the internet is available. File sync stays on your local network.</small></div><input type="checkbox" checked={settings.updateChecks ?? false} onChange={event => void save({ updateChecks: event.target.checked })} /></label>
    <label className="toggle-row"><div><strong>Include preview releases</strong><small>Get new features before they are marked stable.</small></div><input type="checkbox" checked={settings.updatePreviews ?? false} onChange={event => void save({ updatePreviews: event.target.checked })} /></label>
    <div className="row"><button disabled={busy || state?.phase === 'ready'} onClick={() => void run(() => window.syncit.checkUpdate())}><RefreshCw size={14} className={state?.phase === 'checking' ? 'spin' : ''} />{state?.phase === 'checking' ? 'Checking…' : 'Check for updates'}</button>
    {offered && <button className="primary" disabled={busy} onClick={() => void run(() => window.syncit.updateNow())}><ArrowDownToLine size={14} />{state!.phase === 'downloading' ? `Downloading…${percent}` : state!.phase === 'ready' ? `Install ${state!.availableVersion}` : `Update to ${state!.availableVersion}`}</button>}</div>
    {state?.phase === 'current' && <p role="status">You have the newest release in this channel.</p>}
    {state?.message && <p role="status" className={state.phase === 'error' ? 'error-text' : ''}>{state.message}</p>}
    <p>Update downloads the release from GitHub, checks it against the published checksums, saves open notes, stops sync and installs. On Windows the installer runs by itself and Satchel comes back when it is done; on a Mac, Satchel replaces itself in Applications and relaunches. Downloads and installation always start from your click.</p><button onClick={() => void run(() => window.syncit.releasePage())}>Open releases in browser</button>
  </div>;
}
