import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite, errorMessage } from './files';

export type ControlHandlers = Map<string, (...args: any[]) => unknown>;
export async function startControl(directory: string, handlers: ControlHandlers) {
  const token = randomBytes(32).toString('hex');
  const descriptor = path.join(directory, 'control.json');
  let active = 0;
  const server = http.createServer(async (request, response) => {
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    const address = server.address();
    const supplied = Buffer.from(request.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (request.headers.origin || request.headers.host !== `127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(403, { error: 'Unauthorized local control request' });
    if (request.method !== 'POST' || request.url !== '/command' || request.headers['content-type'] !== 'application/json') return reply(400, { error: 'Use a JSON command' });
    if (active >= 4) return reply(429, { error: 'Too many active commands' });
    active++;
    try {
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) { reply(413, { error: 'Command exceeds 2 MB' }); request.destroy(); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body.command !== 'string' || !Array.isArray(body.args) || body.args.length > 8 || !handlers.has(body.command)) return reply(400, { error: 'Unknown command or invalid arguments' });
      const result = await handlers.get(body.command)!(...body.args);
      reply(200, { ok: true, result: result ?? null });
    } catch (error) { if (!response.headersSent) reply(400, { error: errorMessage(error) }); }
    finally { active--; }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.maxConnections = 12;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as { port: number };
  try { await atomicWrite(descriptor, JSON.stringify({ version: 1, port: address.port, token, pid: process.pid })); }
  catch (error) { server.close(); throw error; }
  return async () => {
    await fs.unlink(descriptor).catch(() => {});
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  };
}
