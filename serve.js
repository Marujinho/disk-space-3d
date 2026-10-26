#!/usr/bin/env node
// Disk City dev server — Node built-ins only. Serves viewer/ as static files on
// localhost so the page can fetch scan.json (browsers block fetch from file://).

import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_PORT = 5173;
export const HOST = '127.0.0.1';
export const VIEWER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'viewer');

export const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
});

/**
 * Map a request URL to a file under `root`. Returns null when the path escapes
 * `root` or can't be decoded. A path ending in "/" maps to its index.html.
 */
export function resolvePath(root, urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.resolve(root, `.${pathname}`);
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

/** Build the request handler that serves files from `root`. */
export function createHandler(root = VIEWER_DIR) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const file = resolvePath(root, req.url);
    if (!file) {
      res.writeHead(400).end();
      return;
    }
    let body;
    try {
      body = await fsp.readFile(file);
    } catch (err) {
      const status = err?.code === 'ENOENT' || err?.code === 'EISDIR' ? 404 : 500;
      res.writeHead(status).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

/** Parse `--port N`. Throws Error on bad input. */
export function parseArgs(argv) {
  const opts = { port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--port') throw new Error(`Unknown argument ${argv[i]}\n\nUsage: node serve.js [--port N]`);
    const n = Number(argv[++i]);
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`--port must be an integer from 0 to 65535, got "${argv[i]}"`);
    opts.port = n;
  }
  return opts;
}

/** Start the server. Returns it, or null when the arguments are bad. */
export function main(argv, { stderr = process.stderr } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return null;
  }
  const server = http.createServer(createHandler());
  server.on('error', (err) => {
    stderr.write(`Cannot listen on ${HOST}:${opts.port}: ${err.code ?? err.message}\n`);
    process.exitCode = 1;
  });
  server.listen(opts.port, HOST, () => {
    stderr.write(`Disk City viewer on http://127.0.0.1:${server.address().port}/ (Ctrl+C to stop)\n`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!main(process.argv.slice(2))) process.exitCode = 1;
}
