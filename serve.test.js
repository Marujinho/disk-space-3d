import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { resolvePath, createHandler, parseArgs, main, DEFAULT_PORT, VIEWER_DIR } from './serve.js';

const ROOT = path.resolve('/srv/viewer');

/** Raw GET so the URL reaches the server exactly as written (fetch would normalise "../"). */
function request(port, urlPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('resolvePath', () => {
  it('maps "/" to index.html', () => {
    assert.equal(resolvePath(ROOT, '/'), path.join(ROOT, 'index.html'));
  });
  it('maps nested paths and ignores the query string', () => {
    assert.equal(resolvePath(ROOT, '/src/main.js?v=1'), path.join(ROOT, 'src', 'main.js'));
  });
  it('decodes percent-escapes', () => {
    assert.equal(resolvePath(ROOT, '/a%20b.json'), path.join(ROOT, 'a b.json'));
  });
  it('keeps "../" inside the root', () => {
    assert.equal(resolvePath(ROOT, '/../../etc/passwd'), path.join(ROOT, 'etc', 'passwd'));
  });
  it('rejects encoded traversal that escapes the root', () => {
    assert.equal(resolvePath(ROOT, '/%2e%2e/%2e%2e/etc/passwd'), path.join(ROOT, 'etc', 'passwd'));
    assert.equal(resolvePath(ROOT, '/..%2f..%2fetc%2fpasswd'), null);
  });
  it('rejects NUL bytes and malformed escapes', () => {
    assert.equal(resolvePath(ROOT, '/a%00.js'), null);
    assert.equal(resolvePath(ROOT, '/%E0%A4%A'), null);
  });
});

describe('createHandler', () => {
  let root;
  let outside;
  let server;
  let port;
  before(async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'disk-city-serve-'));
    root = path.join(base, 'viewer');
    outside = path.join(base, 'secret.txt');
    await fsp.mkdir(path.join(root, 'sub'), { recursive: true });
    await fsp.writeFile(path.join(root, 'index.html'), '<!doctype html>');
    await fsp.writeFile(path.join(root, 'data.json'), '{"ok":true}');
    await fsp.writeFile(path.join(root, 'sub', 'app.js'), 'export {};');
    await fsp.writeFile(path.join(root, 'blob.xyz'), 'x');
    await fsp.writeFile(outside, 'do not serve');
    server = http.createServer(createHandler(root));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    port = server.address().port;
  });
  after(async () => {
    server.close();
    await fsp.rm(path.dirname(root), { recursive: true, force: true });
  });

  it('serves index.html at "/" as HTML', async () => {
    const r = await request(port, '/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.equal(r.body, '<!doctype html>');
  });
  it('serves JSON with a JSON content type, which the viewer checks', async () => {
    const r = await request(port, '/data.json');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /json/);
    assert.deepEqual(JSON.parse(r.body), { ok: true });
  });
  it('serves ES modules as JavaScript, which browsers require', async () => {
    const r = await request(port, '/sub/app.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/javascript/);
  });
  it('falls back to octet-stream for unknown extensions', async () => {
    const r = await request(port, '/blob.xyz');
    assert.equal(r.headers['content-type'], 'application/octet-stream');
  });
  it('answers 404 for a missing file and for a directory', async () => {
    assert.equal((await request(port, '/scan.json')).status, 404);
    assert.equal((await request(port, '/sub')).status, 404);
  });
  it('never serves a file outside the root', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt']) {
      const r = await request(port, p);
      assert.notEqual(r.body, 'do not serve', p);
      assert.ok(r.status === 400 || r.status === 404, `${p} -> ${r.status}`);
    }
  });
  it('answers HEAD with headers and no body', async () => {
    const r = await request(port, '/data.json', 'HEAD');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-length'], '11');
    assert.equal(r.body, '');
  });
  it('refuses methods other than GET and HEAD', async () => {
    const r = await request(port, '/data.json', 'POST');
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET, HEAD');
  });
});

describe('parseArgs', () => {
  it('defaults the port', () => {
    assert.deepEqual(parseArgs([]), { port: DEFAULT_PORT });
  });
  it('accepts --port, including the boundaries', () => {
    assert.equal(parseArgs(['--port', '0']).port, 0);
    assert.equal(parseArgs(['--port', '65535']).port, 65535);
  });
  it('rejects bad ports and unknown arguments', () => {
    for (const argv of [['--port'], ['--port', '-1'], ['--port', '65536'], ['--port', '1.5'], ['--port', 'x'], ['viewer']]) {
      assert.throws(() => parseArgs(argv), Error, argv.join(' '));
    }
  });
});

describe('main', () => {
  it('serves the real viewer directory on localhost', async () => {
    let log = '';
    const server = main(['--port', '0'], { stderr: { write: (s) => { log += s; } } });
    try {
      await once(server, 'listening');
      assert.equal(server.address().address, '127.0.0.1');
      const { port } = server.address();
      const page = await request(port, '/');
      assert.equal(page.status, 200);
      assert.match(page.body, /<script type="importmap">/);
      const sample = await request(port, '/public/scan.sample.json');
      assert.equal(sample.status, 200);
      assert.match(sample.headers['content-type'], /json/);
      const three = await request(port, '/vendor/three/three.module.js', 'HEAD');
      assert.equal(three.status, 200);
      assert.match(log, new RegExp(`http://127\\.0\\.0\\.1:${port}/`));
    } finally {
      server.close();
    }
  });
  it('returns null and prints usage on bad arguments', () => {
    let log = '';
    assert.equal(main(['--nope'], { stderr: { write: (s) => { log += s; } } }), null);
    assert.match(log, /Usage: node serve\.js/);
  });
  it('points at the viewer directory next to it', () => {
    assert.equal(path.basename(VIEWER_DIR), 'viewer');
  });
});
