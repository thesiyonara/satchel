import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { XMLParser } from 'fast-xml-parser';
import { getCurrentFuseWire, FuseV1Options, FuseState } from '@electron/fuses';

// Packaged builds intentionally cannot be controlled through Electron's debugger.
const mac = process.platform === 'darwin';
const output = path.resolve(process.argv[2] || 'release');
const bundle = path.join(output, `mac${process.arch === 'arm64' ? '-arm64' : ''}/Satchel.app`);
const executable = mac ? path.join(bundle, 'Contents/MacOS/Satchel') : path.join(output, 'win-unpacked/Satchel.exe');
const resources = mac ? path.join(bundle, 'Contents/Resources') : path.join(output, 'win-unpacked/resources');
const fuses = await getCurrentFuseWire(executable);
for (const option of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.EnableNodeCliInspectArguments]) assert.equal(fuses[option], FuseState.DISABLE);
for (const option of [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) assert.equal(fuses[option], FuseState.ENABLE);
const profile = path.resolve('.cache', `packaged-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const child = spawn(executable, [`--profile=${profile}`], { windowsHide: true, stdio: 'ignore' });
let gui;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    assert.equal(child.exitCode, null, 'Packaged app must remain running');
    try {
      const xml = new XMLParser().parse(await readFile(path.join(profile, 'engine/config.xml'), 'utf8'));
      gui = xml.configuration.gui;
      const response = await fetch(`http://${gui.address}/rest/system/status`, { headers: { 'X-API-Key': gui.apikey }, signal: AbortSignal.timeout(1000) });
      const status = await response.json();
      if (response.ok && status.myID) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Bundled helper must start with authenticated controls');
  const denied = await fetch(`http://${gui.address}/rest/config`);
  assert.ok([401, 403].includes(denied.status));
  const execute = promisify(execFile);
  const cli = async (...args) => JSON.parse((await execute(process.execPath, [path.join(resources, 'cli/syncit.mjs'), '--profile', profile, ...args], { windowsHide: true })).stdout);
  const created = await cli('capture', 'Packaged CLI verification');
  const update = await cli('update', 'status');
  assert.equal(update.phase, 'idle');
  assert.equal(update.currentVersion, JSON.parse(await readFile('package.json', 'utf8')).version);
  if (process.env.SYNCIT_LIVE_UPDATE_TEST === '1') assert.ok(['current', 'available'].includes((await cli('update', 'check')).phase), 'Packaged updater must reach the public releases');
  assert.equal((await cli('read', created.path)).text, 'Packaged CLI verification');
  await cli('window', 'mini');
  const status = await cli('status');
  assert.equal(status.panelMode, 'mini');
  const height = status.windows.find(window => window.name === 'dashboard').bounds.height; // one window: mini is its small shape
  assert.ok(height >= 210 && height <= 250, 'Minimal size must tolerate native DPI rounding');
  await cli('window', 'hide');
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal((await cli('status')).windows.find(window => window.name === 'dashboard').visible, false);
  await cli('call', 'quit', '[]');
  // Engine shutdown can include a 6s API timeout plus its bounded process-exit grace period.
  for (let attempt = 0; child.exitCode === null && child.signalCode === null && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(child.exitCode, 0, 'CLI quit must close the packaged app cleanly');
  await assert.rejects(readFile(path.join(profile, 'control.json')));
  console.log('Packaged startup passed: ASAR integrity, five fuse settings, bundled verified helper, authenticated controls, installed CLI note capture/read and minimal-window control.');
} finally {
  if (gui) await fetch(`http://${gui.address}/rest/system/shutdown`, { method: 'POST', headers: { 'X-API-Key': gui.apikey } }).catch(() => {});
  if (child.exitCode === null) {
    if (mac) child.kill('SIGTERM');
    else execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
}
