import { useEffect, useMemo, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import qrcode from 'qrcode-generator';
import type { PhoneInfo, PhoneOffer, Settings } from '../shared/types';

function formatTime(time?: number) { return time ? new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never'; }

export function PhoneAccess({ settings, save, notify }: { settings: Settings; save: (patch: Partial<Settings>) => Promise<void>; notify: (message: string) => void }) {
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [offer, setOffer] = useState<{ offer: PhoneOffer; encoded: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => window.syncit.phoneInfo().then(value => { if (active) setInfo(value); }).catch(() => {});
    void load();
    const timer = setInterval(() => { void load(); setNow(Date.now()); }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [settings.phoneAccess]);
  useEffect(() => { if (offer && info && !info.pairing) { setOffer(null); if (offer.offer.expires > Date.now()) notify('Phone paired.'); } }, [info?.pairing]);
  const qr = useMemo(() => { if (!offer) return null; const code = qrcode(0, 'M'); code.addData(offer.encoded); code.make(); return code; }, [offer]);
  async function run(action: () => Promise<unknown>) { setBusy(true); try { await action(); } catch (error) { notify(String(error)); } finally { setBusy(false); } }
  const remaining = offer ? Math.max(0, Math.round((offer.offer.expires - now) / 1000)) : 0;
  return <div className="settings-section phone-access"><h3>Phone access</h3>
    <label className="toggle-row"><div><strong>Let a paired phone browse this collection</strong><small>Serves the collection to paired phones on this local network over TLS. The phone keeps no copy; it reads and adds items while this computer is on.</small></div><input type="checkbox" checked={settings.phoneAccess ?? false} onChange={event => void save({ phoneAccess: event.target.checked })} /></label>
    {settings.phoneAccess && info && <>
      <p>{info.running ? `Listening on port ${info.port} at ${info.addresses.join(', ') || 'no local address'}.` : 'Starting…'} Certificate fingerprint, shown on the phone after pairing:</p>
      <code className="device-id">{info.fingerprint || 'Generating certificate…'}</code>
      {offer && qr ? <div className="phone-pairing">
        <svg viewBox={`0 0 ${qr.getModuleCount()} ${qr.getModuleCount()}`} shapeRendering="crispEdges" role="img" aria-label="Pairing QR code">{Array.from({ length: qr.getModuleCount() }, (_, row) => Array.from({ length: qr.getModuleCount() }, (_, col) => qr.isDark(row, col) ? <rect key={`${row}-${col}`} x={col} y={row} width={1} height={1} /> : null))}</svg>
        <div><strong>Scan with the Sync it phone app</strong><p>Or enter this code on the phone: <code>{offer.offer.code}</code></p><p>{remaining > 0 ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}. The code works once.` : 'Expired.'}</p><button onClick={() => void run(async () => { await window.syncit.phoneCancelPairing(); setOffer(null); })}><X size={14} />Cancel</button></div>
      </div> : <div className="row"><button className="primary" disabled={busy || !info.running} onClick={() => void run(async () => setOffer(await window.syncit.phoneOffer()))}><Smartphone size={15} />Pair a phone</button><small>Pairing opens a five-minute window for one phone.</small></div>}
      {info.devices.length > 0 && <ul className="phone-list">{info.devices.map(device => <li key={device.id}><Smartphone size={15} /><div><strong>{device.name}</strong><small>Paired {formatTime(device.pairedAt)} · last seen {formatTime(device.lastSeen)}</small></div><button disabled={busy} onClick={() => void run(() => window.syncit.revokePhone(device.id))}>Remove</button></li>)}</ul>}
      {info.devices.length === 0 && !offer && <p>No phone is paired.</p>}
    </>}
  </div>;
}
