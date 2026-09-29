'use strict';

// Minimal localhost-only HTTP server: serves the static browser UI from
// public/ and exposes the demo API. No external network access.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

import { runTrial, seedFixture, status, readEvidence } from './demo.js';
import { closeClient } from './saver.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'public');

const HOST = '127.0.0.1';
const PORT = Number(process.env.DEMO_PORT ?? 4400);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJSON(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  // Prevent path traversal: resolve within PUBLIC_DIR only.
  const filePath = normalize(join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJSON(res, 403, { error: 'Forbidden' });
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    sendJSON(res, 404, { error: 'Not found' });
  }
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJSON(res, 200, await status());
  }
  if (pathname === '/api/run' && req.method === 'POST') {
    const body = await readBody(req);
    const version = body.version === '1.3.1' ? '1.3.1' : '1.3.0';
    const requestKind = body.requestKind === 'operator' ? 'operator' : 'normal';
    return sendJSON(res, 200, await runTrial({ version, requestKind }));
  }
  if (pathname === '/api/reset' && req.method === 'POST') {
    await seedFixture();
    return sendJSON(res, 200, { ok: true });
  }
  if (pathname === '/api/evidence' && req.method === 'GET') {
    try {
      const body = await readEvidence();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="nosql-demo-evidence.json"',
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    } catch {
      return sendJSON(res, 404, { error: 'No evidence captured yet.' });
    }
  }
  return sendJSON(res, 404, { error: 'Unknown endpoint' });
}

const server = createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0];
  const work = pathname.startsWith('/api/')
    ? handleApi(req, res, pathname)
    : serveStatic(req, res);
  Promise.resolve(work).catch((error) => sendJSON(res, 500, { error: error.message }));
});

async function main() {
  process.stdout.write('Seeding fictional Alice/Bob fixture (both saver versions)...\n');
  await seedFixture();
  server.listen(PORT, HOST, () => {
    process.stdout.write(`\nCS440 NoSQL injection demo ready.\n`);
    process.stdout.write(`Open: http://${HOST}:${PORT}\n\n`);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await closeClient().catch(() => {});
    server.close(() => process.exit(0));
  });
}

main().catch((error) => {
  process.stderr.write(`Failed to start demo: ${error.message}\n`);
  process.exit(1);
});
