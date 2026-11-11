import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
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
  thumbnail: async relative => relative === 'Desktop reference.png' ? readFile(path.resolve('site/img/pinboard.png')) : Buffer.alloc(0), text: async () => '' });
try {
  await mkdir(library.root);
  await library.initialize();
  await service.start();
  const localOffer = () => encodeOffer({ ...service.offer().offer, addresses: ['127.0.0.1'] });
  if (process.argv[2] === '--serve-ui') {
    await library.createNote('Handoff notes\nThe revised cut is ready for review. Check the opening sequence and the end credits.');
    await library.addBytes('Shot list.csv', Buffer.from('Scene,Location\nOpening,North entrance\nClose,Studio'));
    await library.addBytes('Desktop reference.png', await readFile(path.resolve('site/img/pinboard.png')));
    await library.createNote('Field notes\nThe north entrance gets the best morning light. Bring the short tripod and a spare battery.');
    await library.savePasteboard('Meet at the north entrance at 8:30.', 'Studio Mac');
    await library.savePasteboard('', 'Studio Mac');
    // Create the five-minute offer after XCTest launches, even on a slow simulator runner.
    const offers = createServer((req, res) => {
      if (req.url !== '/offer') { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end(localOffer());
    });
    offers.listen(31926, '127.0.0.1');
    await once(offers, 'listening');
    try { await once(process, 'SIGTERM'); } finally { offers.close(); }
  } else {
    const binary = path.join(dir, 'ClientSmoke');
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    await promisify(execFile)('xcrun', ['--sdk', 'macosx', 'swiftc', '-target', `${architecture}-apple-macosx14.0`,
      '-parse-as-library', 'ios/Satchel/Companion.swift', 'ios/Satchel/SatchelIntents.swift',
      'ios/Tests/ClientSmoke.swift', 'ios/Tests/ShortcutSmoke.swift', '-o', binary]);
    const client = spawn(binary, [], { stdio: ['pipe', 'inherit', 'inherit'], timeout: 60000 });
    const exited = once(client, 'exit');
    client.stdin.end(localOffer() + '\n');
    const [code] = await exited;
    if (code !== 0) throw new Error('Swift client smoke test failed');
  }
} finally {
  await service.stop(); await library.close(); await rm(dir, { recursive: true, force: true });
}
