import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, FolderOpen, Lock, Monitor, RefreshCw, X } from 'lucide-react';
import type { NearbyDevice, Peer, PendingPeer, Settings, SyncStatus } from '../shared/types';
import { UpdateSettings } from './UpdateSettings';
import { PhoneAccess } from './PhoneAccess';

type Run = (action: () => Promise<unknown>, message?: string) => Promise<void>;
const shortId = (id: string) => id.split('-').slice(0, 2).join('-');

export function SettingsPanel({ settings, sync, close, update, notify, initialTab = 'connect' }: { settings: Settings; sync: SyncStatus; close: () => void; update: (settings: Settings) => void; notify: (message: string) => void; initialTab?: 'connect' | 'preferences' }) {
  const [tab, setTab] = useState(initialTab);
  const [name, setName] = useState(settings.deviceName); const [shortcut, setShortcut] = useState(settings.shortcut); const [busy, setBusy] = useState(false);
  const [loginEnabled, setLoginEnabled] = useState(true);
  useEffect(() => { void window.syncit.initial().then(value => setLoginEnabled(value.loginEnabled)); }, [settings.startAtLogin]);
  const run: Run = async (action, message) => { setBusy(true); try { await action(); if (message) notify(message); } catch (error) { notify(String(error)); } finally { setBusy(false); } };
  const save = (patch: Partial<Settings>) => run(async () => update(await window.syncit.settings(patch)));
  return <div className="modal-shade"><section className="settings-panel" role="dialog" aria-modal="true" aria-label="Preferences">
    <header><h2>Preferences</h2><button className="icon-button" aria-label="Close preferences" onClick={close}><X size={21} /></button></header>
    <div className="settings-tabs"><button className={tab === 'connect' ? 'active' : ''} onClick={() => setTab('connect')}>Computers & sync</button><button className={tab === 'preferences' ? 'active' : ''} onClick={() => setTab('preferences')}>General</button></div>
    <div className="settings-content">
      {tab === 'connect' ? <>
        {sync.errors.length > 0 && <div className="inline-error">{sync.errors.map((error, i) => <p key={i}>{error}</p>)}<button onClick={() => void run(() => window.syncit.retrySync())}><RefreshCw size={14} /> Retry connection</button></div>}
        <div className="settings-section"><h3>Paired computers</h3>
          {sync.peers.length === 0 ? <p>No computer is paired yet. Computers running Satchel on this network appear under “Nearby”.</p> : sync.peers.map(peer => <PeerRow key={peer.id} peer={peer} busy={busy} run={run} />)}
        </div>
        {sync.pending.length > 0 && <div className="settings-section"><h3>Requests</h3><p>Compare the full device ID with the ID shown on that computer before approving. Approval shares the whole collection.</p>{sync.pending.map(peer => <PairingRequest key={peer.id} peer={peer} busy={busy} run={run} />)}</div>}
        <div className="settings-section"><h3>Nearby</h3>
          <p>{sync.nearby.length ? 'Found by local discovery and not paired yet. Confirm the device ID on the other computer, then connect; it approves this computer in return.' : settings.localDiscovery === false ? 'Discovery is off. Turn it on below, or pair with a code or device ID.' : 'No unpaired computer found yet. Open Satchel on the other computer and keep it on this network, or pair with a code or device ID below.'}</p>
          {sync.nearby.map(device => <NearbyRow key={device.id} device={device} busy={busy} run={run} />)}
        </div>
        <ThisComputer sync={sync} settings={settings} busy={busy} run={run} />
        <ManualPairing sync={sync} busy={busy} run={run} update={update} />
        <div className="settings-section"><h3>Sync controls</h3>
          <label className="toggle-row"><div><strong>Pause all sync</strong><small>Stops transfers to every paired computer. Local files stay available.</small></div><input type="checkbox" checked={settings.syncPaused ?? false} onChange={event => void save({ syncPaused: event.target.checked })} /></label>
          <label className="toggle-row"><div><strong>Local discovery</strong><small>Lets computers on this network find each other, also when their IP addresses change.</small></div><input type="checkbox" checked={settings.localDiscovery ?? true} onChange={event => void save({ localDiscovery: event.target.checked })} /></label>
          <p>Transfers are encrypted between paired computers. Discovery announces this computer’s device ID and sync port on the local network; with discovery off, pair by code or device ID and update the address if it changes. Anyone on the network can still see connection timing and traffic volume.</p>
        </div>
      </> : <>
        <UpdateSettings settings={settings} save={save} notify={notify} />
        <div className="settings-section"><h3>Collection folder</h3><p className="folder-path">{settings.root}</p><div className="row"><button onClick={() => void run(() => window.syncit.openFolder())}><FolderOpen size={16} />Open folder</button><button disabled={busy || sync.peers.length > 0} onClick={() => void run(async () => { const next = await window.syncit.chooseRoot(); if (next) update(next); })}>Choose folder</button><button onClick={() => void run(() => window.syncit.shortcut(), 'Desktop shortcut created.')}>Desktop shortcut</button></div><p>{sync.peers.length ? 'The folder can only be changed while no computer is paired. Existing files stay where they are.' : 'Changing the folder keeps existing files in their original location.'}</p></div>
        <div className="settings-section"><label>This computer’s name<div className="input-action"><input value={name} onChange={event => setName(event.target.value)} maxLength={100} /><button disabled={busy} onClick={() => void save({ deviceName: name })}>Save</button></div></label><p>Shown to paired computers and in their pairing requests.</p></div>
        <div className="settings-section"><label className="toggle-row"><div><strong>Start at login</strong><small>Keeps syncing from the tray or menu bar.</small></div><input type="checkbox" checked={settings.startAtLogin} onChange={event => void save({ startAtLogin: event.target.checked })} /></label>{settings.startAtLogin && !loginEnabled && <p className="inline-warning">The system has not enabled automatic startup. Add Satchel in Login Items or Startup Apps.</p>}<label className="toggle-row"><div><strong>Keep Quick drop on top</strong><small>The floating window stays above other windows.</small></div><input type="checkbox" checked={settings.alwaysOnTop} onChange={event => void save({ alwaysOnTop: event.target.checked })} /></label></div>
        <div className="settings-section"><label>Quick drop keyboard shortcut<div className="input-action"><input value={shortcut} onChange={event => setShortcut(event.target.value)} /><button disabled={busy} onClick={() => void save({ shortcut })}>Save</button></div></label><p>Use CommandOrControl for a shortcut that works on both platforms.</p><label>Appearance<select value={settings.theme} onChange={event => void save({ theme: event.target.value as Settings['theme'] })}><option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div>
        <div className="settings-section"><h3>Quick drop window</h3><label>Window size<select aria-label="Floating window mode" value={settings.panelMode || 'quick'} onChange={event => void save({ panelMode: event.target.value as 'quick' | 'mini' })}><option value="quick">Quick drop</option><option value="mini">Minimal capture</option></select></label><label>Drawer at the screen edge<select aria-label="Drawer edge" value={settings.drawerEdge || 'right'} onChange={event => void save({ drawerEdge: event.target.value as Settings['drawerEdge'] })}><option value="right">Right edge</option><option value="left">Left edge</option><option value="off">Off</option></select></label><p>Drag a file toward the handle and the drawer slides out; drop, and it closes by itself.</p><label>Opacity · {Math.round((settings.panelOpacity ?? 1) * 100)}%<input aria-label="Floating window opacity" type="range" min="60" max="100" step="5" value={(settings.panelOpacity ?? 1) * 100} onChange={event => void save({ panelOpacity: Number(event.target.value) / 100 })} /></label><label className="toggle-row"><div><strong>Hide when focus leaves</strong><small>Bring it back with the shortcut or the tray menu.</small></div><input type="checkbox" checked={settings.panelAutoHide ?? false} onChange={event => void save({ panelAutoHide: event.target.checked })} /></label><button onClick={() => void run(() => window.syncit.showPanel())}>Open Quick drop</button><p>Drag its top bar to move it; the arrow buttons dock it to either screen edge. Favorites stay on this computer.</p></div>
        <PhoneAccess settings={settings} save={save} notify={notify} />
        <div className="settings-section"><h3>File recovery</h3><p>Files deleted here go to this computer’s Trash or Recycle Bin. Changes received from paired computers keep a 30-day version history; open a note’s History to restore a version.</p><button onClick={() => void run(() => window.syncit.openVersions())}>Open received file history</button><p>Copy a version back into the collection to restore a file that is not a note.</p></div>
        <div className="settings-section"><h3>Local note history</h3><p>Before replacing a note, Satchel keeps the previous text on this computer: the newest 20 versions per note, for 30 days. Unsaved editor drafts are recovered as separate notes after a restart.</p><button onClick={() => void run(() => window.syncit.openRecovery())}>Open local note history folder</button></div>
        <div className="settings-footnote">Satchel · Syncthing {sync.engineVersion}<br />Closing the dashboard keeps sync running; Quit stops it.</div>
      </>}
    </div>
  </section></div>;
}

function PeerRow({ peer, busy, run }: { peer: Peer; busy: boolean; run: Run }) {
  const [confirm, setConfirm] = useState(false);
  return <div className="peer-card">
    <div className="peer-main"><span className={`status-dot ${peer.connected ? 'green' : ''}`} /><div><strong>{peer.name}</strong><small>{peer.connected ? `Connected · ${Math.floor(peer.completion)}% up to date` : 'Offline · catches up when it reconnects'}</small></div>{peer.encrypted && <span className="tag"><Lock size={10} />Encrypted copy</span>}{!confirm && <button disabled={busy} onClick={() => setConfirm(true)}>Revoke</button>}</div>
    <progress max={100} value={peer.completion} />
    <code className="device-id">{peer.id}</code>
    {confirm && <div className="inline-warning"><p>Revoke {peer.name}? It stops receiving changes, but files already copied to it are not erased.</p><div className="row"><button className="danger-button" disabled={busy} onClick={() => void run(async () => { await window.syncit.revoke(peer.id); setConfirm(false); }, `${peer.name} no longer receives this collection.`)}>Revoke access</button><button onClick={() => setConfirm(false)}>Keep</button></div></div>}
  </div>;
}

function EncryptionOption({ enabled, password, setEnabled, setPassword }: { enabled: boolean; password: string; setEnabled: (value: boolean) => void; setPassword: (value: string) => void }) {
  return <details className="encryption-option"><summary>Untrusted device (encrypted copy only)</summary>
    <label className="toggle-row"><div><strong>Send only encrypted data to this device</strong><small>For a NAS or server that should hold a backup without being able to read it. Every trusted computer must use the same password for this device.</small></div><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /></label>
    {enabled && <label>Encryption password<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="off" /></label>}
  </details>;
}

function PairingRequest({ peer, busy, run }: { peer: PendingPeer; busy: boolean; run: Run }) {
  const [encrypted, setEncrypted] = useState(false); const [password, setPassword] = useState('');
  return <div className="pair-request"><h3>{peer.name} asks to join</h3><code className="device-id">{peer.id}</code>{peer.address && <small>{peer.address}</small>}
    <EncryptionOption enabled={encrypted} password={password} setEnabled={setEncrypted} setPassword={setPassword} />
    <div className="row"><button disabled={busy || (encrypted && password.length < 8)} className="primary" onClick={() => void run(() => window.syncit.approve(peer.id, encrypted ? { encryptionPassword: password } : undefined), `${peer.name} approved. The collection starts syncing.`)}><Check size={16} />Approve</button><button disabled={busy} onClick={() => void run(() => window.syncit.reject(peer.id))}>Dismiss</button></div>
  </div>;
}

function NearbyRow({ device, busy, run }: { device: NearbyDevice; busy: boolean; run: Run }) {
  return <div className="nearby-card"><Monitor size={18} /><div><strong>Computer {shortId(device.id)}</strong><code className="device-id">{device.id}</code><small>{device.addresses.map(address => address.replace(/^tcp:\/\//, '')).join(' · ') || 'Address not announced yet'}</small></div>
    <button className="primary" disabled={busy} onClick={() => void run(() => window.syncit.connect(device.id, device.addresses[0]), 'Request sent. Approve this computer on the other one.')}>Connect <ArrowRight size={14} /></button></div>;
}

function ThisComputer({ sync, settings, busy, run }: { sync: SyncStatus; settings: Settings; busy: boolean; run: Run }) {
  const [code, setCode] = useState('');
  useEffect(() => { void window.syncit.pairingCode().then(setCode).catch(() => {}); }, [sync.deviceId, settings.folderId]);
  return <div className="settings-section"><h3>This computer</h3>
    <p>Device ID, shown on the other computer when it approves or connects to {settings.deviceName}.</p>
    <code className="device-id">{sync.deviceId || 'Starting…'}</code>
    <p>Local IPv4: {sync.localAddresses.join(', ') || 'no local network detected'} · sync port 22027 TCP · discovery 21027 UDP</p>
    <div className="row"><button disabled={!code || busy} onClick={() => void run(() => window.syncit.copyPairingCode(), 'Pairing code copied.')}><Copy size={16} />Copy pairing code</button><small>A pairing code carries this ID and the collection ID for computers that cannot see this one.</small></div>
  </div>;
}

function ManualPairing({ sync, busy, run, update }: { sync: SyncStatus; busy: boolean; run: Run; update: (settings: Settings) => void }) {
  const [incoming, setIncoming] = useState(''); const [ip, setIP] = useState(''); const [deviceId, setDeviceId] = useState(''); const [deviceIP, setDeviceIP] = useState('');
  return <details className="settings-section manual-pairing"><summary>Pair with a code or device ID</summary>
    <label>Pairing code from the other computer<textarea aria-label="Other computer's pairing code" placeholder="syncit1:…" value={incoming} onChange={event => setIncoming(event.target.value)} rows={3} /></label>
    <label>Its local IPv4 address (only if discovery cannot find it)<input value={ip} onChange={event => setIP(event.target.value.trim())} placeholder="192.168.1.42" /></label>
    <button className="primary" disabled={busy || !incoming.trim() || !sync.deviceId} onClick={() => void run(async () => { await window.syncit.join(incoming.trim(), ip || undefined); update((await window.syncit.initial()).settings); setIncoming(''); }, 'Request sent. Approve this computer on the other one.')}>Join with code <ArrowRight size={16} /></button>
    <hr />
    <label>Other computer’s device ID<input value={deviceId} onChange={event => setDeviceId(event.target.value.trim().toUpperCase())} placeholder="XXXXXXX-XXXXXXX-…" spellCheck={false} /></label>
    <label>Its local IPv4 address (optional)<input value={deviceIP} onChange={event => setDeviceIP(event.target.value.trim())} placeholder="192.168.1.42" /></label>
    <button disabled={busy || !deviceId || !sync.deviceId} onClick={() => void run(async () => { await window.syncit.connect(deviceId, deviceIP || undefined); setDeviceId(''); }, 'Request sent. Approve this computer on the other one.')}>Connect by device ID <ArrowRight size={16} /></button>
    <p>Both computers need TCP 22027 allowed on a private network. Guest Wi-Fi often isolates devices.</p>
  </details>;
}
