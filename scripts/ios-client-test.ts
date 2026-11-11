import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Companion, encodeOffer } from '../electron/companion';
import { Library } from '../electron/library';

// Exercise the iOS networking code with Apple's URLSession against the real desktop service.
const dir = await mkdtemp(path.join(os.tmpdir(), 'satchel-ios-'));
const library = new Library(path.join(dir, 'collection'));
const service = new Companion({ directory: dir, port: 0, allowLoopback: true, webRoot: path.resolve('web'), library: () => library,
  deviceName: () => 'Test Mac', collectionName: () => 'Collection', syncState: () => 'synced',
  thumbnail: async () => Buffer.alloc(0), text: async () => '' });
try {
  await mkdir(library.root);
  await library.initialize();
  await service.start();
  const { offer } = service.offer();
  const encoded = encodeOffer({ ...offer, addresses: ['127.0.0.1'] });
  if (process.argv[2] === '--serve-ui') {
    await writeFile(process.argv[3], encoded, { mode: 0o600 });
    await once(process, 'SIGTERM');
  } else {
    const binary = path.join(dir, 'ClientSmoke');
    await promisify(execFile)('xcrun', ['--sdk', 'macosx', 'swiftc', '-parse-as-library', 'ios/Satchel/Companion.swift', 'ios/Tests/ClientSmoke.swift', '-o', binary]);
    const client = spawn(binary, [], { stdio: ['pipe', 'inherit', 'inherit'], timeout: 60000 });
    const exited = once(client, 'exit');
    client.stdin.end(encoded + '\n');
    const [code] = await exited;
    if (code !== 0) throw new Error('Swift client smoke test failed');
  }
} finally {
  await service.stop(); await library.close(); await rm(dir, { recursive: true, force: true });
}
