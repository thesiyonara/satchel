import { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw } from 'lucide-react';
import type { Settings, UpdateState } from '../shared/types';
export function UpdateSettings({ settings, save, notify }: { settings: Settings; save: (patch: Partial<Settings>) => Promise<void>; notify: (message: string) => void }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { void window.syncit.updateState().then(setState); return window.syncit.onUpdate(setState); }, []);
  async function run(action: () => Promise<unknown>) { try { await action(); } catch (error) { notify(String(error)); } }
  const busy = state?.phase === 'checking' || state?.phase === 'downloading';
  return <div className="settings-section update-settings"><h3>App updates</h3><p>Installed {state?.currentVersion || '…'}{state?.availableVersion ? ` · Available ${state.availableVersion}` : ''}</p>
    <label className="toggle-row"><div><strong>Check daily for updates</strong><small>Asks GitHub for the newest release when the internet is available. File sync stays on your local network.</small></div><input type="checkbox" checked={settings.updateChecks ?? false} onChange={event => void save({ updateChecks: event.target.checked })} /></label>
    <label className="toggle-row"><div><strong>Include preview releases</strong><small>Get new features before they are marked stable.</small></div><input type="checkbox" checked={settings.updatePreviews ?? false} onChange={event => void save({ updatePreviews: event.target.checked })} /></label>
    <div className="row"><button disabled={busy || state?.phase === 'ready'} onClick={() => void run(() => window.syncit.checkUpdate())}><RefreshCw size={14} className={state?.phase === 'checking' ? 'spin' : ''} />{state?.phase === 'checking' ? 'Checking…' : 'Check for updates'}</button>
    {(state?.phase === 'available' || state?.phase === 'error' && state.availableVersion) && <button className="primary" disabled={busy} onClick={() => void run(() => window.syncit.downloadUpdate())}><ArrowDownToLine size={14} />Download update</button>}
    {state?.phase === 'ready' && !confirm && <button className="primary" onClick={() => setConfirm(true)}>Install update</button>}</div>
    {state?.phase === 'current' && <p role="status">You have the newest release in this channel.</p>}
    {state?.message && <p role="status" className={state.phase === 'error' ? 'error-text' : ''}>{state.message}</p>}
    {confirm && <div className="inline-warning"><p>Open notes will be saved, sync will stop, and the verified installer or disk image will open. Finish the Windows installer, or on a Mac drag Sync it to Applications, then relaunch the app.</p><div className="row"><button className="primary" onClick={() => void run(() => window.syncit.installUpdate())}>Save notes & install</button><button onClick={() => setConfirm(false)}>Later</button></div></div>}
    <p>Updates are downloaded from the project’s GitHub releases and verified against the checksums published with each release. Downloads and installation always require your click.</p><button onClick={() => void run(() => window.syncit.releasePage())}>Open releases in browser</button>
  </div>;
}
