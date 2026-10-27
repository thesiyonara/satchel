#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
let profile = process.env.SYNCIT_PROFILE;
const index = args.indexOf('--profile');
if (index >= 0) { profile = args[index + 1]; if (!profile) throw new Error('--profile requires a directory'); args.splice(index, 2); }
const [command = 'help', ...values] = args;
if (command === 'help' || command === '--help') {
  console.log(`Satchel local CLI — start the app first. Requires Node.js 24.
Usage: node syncit.mjs [--profile DIRECTORY] COMMAND [arguments]
  status                         Sync status and native window state
  list [search]                  Search filenames and note text
  capture TEXT | capture --stdin Create a note, including multiline prompts
  import PATH...                 Copy files or folders into the collection
  read RELATIVE_PATH             Read a note and its revision
  window dashboard|quick|mini|hide|left|right
  favorite RELATIVE_PATH on|off  Set a local favorite
  settings JSON                 Change validated preferences
  pause | resume                Stop or resume transfers
  update status|check|download|install  Manage private GitHub updates
  phone status|pair|cancel|revoke ID    Phone access: paired phones, a pairing URL and code, revocation
  screenshot dashboard|panel    Save a UI screenshot in the app profile
  commands                      List supported API operations
  call OPERATION JSON_ARRAY      Advanced API: notes, board, pairing, files, quit
All responses are JSON. No shell execution or JavaScript evaluation is exposed.
Control access uses a rotating secret in your private local app profile.`);
  process.exit(0);
}
try {
  let descriptor;
  const base = process.platform === 'win32' ? process.env.APPDATA : path.join(os.homedir(), 'Library', 'Application Support');
  const candidates = profile ? [path.resolve(profile)] : ['Satchel', 'Sync it', 'sync-it'].map(name => path.join(base, name));
  for (const candidate of candidates) { try { descriptor = JSON.parse(await readFile(path.join(candidate, 'control.json'), 'utf8')); break; } catch {} }
  if (!descriptor || !Number.isInteger(descriptor.port) || descriptor.port < 1 || descriptor.port > 65535 || !/^[a-f0-9]{64}$/.test(descriptor.token)) throw new Error('No running app control endpoint. Start Satchel 0.2.0 or newer, or specify --profile.');
  let operation = command; let parameters = values;
  if (command === 'update') { const operations = { status: 'updateState', check: 'checkUpdate', download: 'downloadUpdate', install: 'installUpdate' }; operation = operations[values[0]]; if (!operation) throw new Error('Use update status|check|download|install'); parameters = []; }
  if (command === 'phone') { const operations = { status: 'phoneInfo', pair: 'phoneOffer', cancel: 'phoneCancelPairing', revoke: 'revokePhone' }; operation = operations[values[0]]; if (!operation) throw new Error('Use phone status|pair|cancel|revoke ID'); parameters = values[0] === 'revoke' ? [values[1]] : []; }
  if (command === 'capture') {
    operation = 'createNote';
    let text = values.join(' ');
    if (values[0] === '--stdin') { const chunks = []; let length = 0; for await (const chunk of process.stdin) { length += chunk.length; if (length > 1024 * 1024) throw new Error('Note exceeds 1 MB'); chunks.push(chunk); } text = Buffer.concat(chunks).toString('utf8'); }
    if (!text.trim()) throw new Error('Supply note text or --stdin');
    parameters = [text];
  } else if (command === 'import') { operation = 'importFiles'; parameters = [values.map(value => path.resolve(value))]; }
  else if (command === 'read') operation = 'readNote';
  else if (command === 'list') parameters = [];
  else if (command === 'favorite') { if (!['on', 'off'].includes(values[1])) throw new Error('Use favorite PATH on|off'); parameters = [values[0], values[1] === 'on']; }
  else if (command === 'settings') parameters = [JSON.parse(values.join(' '))];
  else if (command === 'pause' || command === 'resume') { operation = 'settings'; parameters = [{ syncPaused: command === 'pause' }]; }
  else if (command === 'call') { operation = values[0]; parameters = JSON.parse(values.slice(1).join(' ') || '[]'); }
  const response = await fetch(`http://127.0.0.1:${descriptor.port}/command`, { method: 'POST', headers: { Authorization: `Bearer ${descriptor.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ command: operation, args: parameters }), signal: AbortSignal.timeout(operation === 'downloadUpdate' ? 660000 : 90000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Command failed');
  if (command === 'list' && values.length) result.result.items = result.result.items.filter(item => `${item.name} ${item.preview || ''}`.toLowerCase().includes(values.join(' ').toLowerCase()));
  console.log(JSON.stringify(result.result, null, 2));
} catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
