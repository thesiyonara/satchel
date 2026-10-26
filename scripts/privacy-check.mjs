// Release hygiene check. Reports file names, never matching credential contents.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const account = os.userInfo().username;
const personal = account.length >= 3 && !/^(?:runner|root|user|administrator|admin|node|ubuntu|system)$/i.test(account) ? new RegExp(`\\b${escaped(account)}\\b`, 'i') : null;
const secrets = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}/;
const profilePath = /[A-Z]:[\\/]+Users[\\/]+(?!(?:example|public|default|user|your_username)\b|[<{])[^\\/\s]+/i;
const failures = [];
for (const file of files) {
  if (/^(?:\.cache|node_modules|release|vendor|dist|dist-electron|test-results)(?:\/|$)/.test(file) || /(?:^|\/)(?:\.env(?:\..*)?|control\.json|settings\.json)$|\.(?:log|map|pem|key|p12|pfx)$/i.test(file)) { failures.push(file); continue; }
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|yaml|yml|txt|html|css|swift|sh|xml)$|(?:^|\/)LICENSE$/.test(file)) continue;
  const content = await readFile(file, 'utf8');
  if (secrets.test(content) || profilePath.test(content) || personal?.test(content) || content.toLowerCase().includes(os.homedir().toLowerCase())) failures.push(file);
}
if (failures.length) { console.error('Release privacy review required for: ' + [...new Set(failures)].join(', ')); process.exitCode = 1; }
else console.log(`Release privacy scan passed for ${files.length} tracked files. Review images and public account metadata separately.`);
