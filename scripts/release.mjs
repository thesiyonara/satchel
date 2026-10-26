// Prepare checksum metadata for the in-app updater; publishing is explicit.
// CI does the same on a tag (see .github/workflows/desktop.yml); this script covers local builds.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
execFileSync(process.execPath, ['scripts/privacy-check.mjs'], { stdio: 'inherit' });
const { version } = pkg;
const repository = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository.url)?.[1];
if (!repository) throw new Error('package.json repository.url must point at a GitHub repository');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a numeric release version');
const files = (await readdir('release')).filter(name => name.startsWith(`Sync-it-${version}-`) && /\.(exe|dmg|zip)$/.test(name));
if (!files.length) throw new Error('Build installers before preparing a release');
const lines = [];
for (const name of files) { const digest = createHash('sha256'); for await (const chunk of createReadStream(path.join('release', name))) digest.update(chunk); lines.push(`${digest.digest('hex')}  ${name}`); }
const checksum = path.join('release', `SHA256SUMS-${version}.txt`); await writeFile(checksum, lines.join('\n') + '\n');
console.log(`Prepared ${files.length} artifacts and ${checksum}`);
if (process.argv.includes('--publish')) {
  const notesIndex = process.argv.indexOf('--notes');
  if (notesIndex < 0 || !process.argv[notesIndex + 1]) throw new Error('Publishing requires --notes PATH');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Commit source changes before publishing');
  const args = ['release', 'create', `v${version}`, ...files.map(name => path.join('release', name)), checksum, '--repo', repository, '--target', revision, '--title', `Sync it ${version}`, '--notes-file', process.argv[notesIndex + 1]];
  if (process.argv.includes('--preview')) args.push('--prerelease');
  if (process.argv.includes('--draft')) args.push('--draft');
  const result = spawnSync('gh', args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
