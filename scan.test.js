import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseArgs, scanDir, collapseSmall, toOutput, humanBytes, UsageError, DEFAULTS } from './scan.js';

const execFileP = promisify(execFile);
const SCAN_JS = fileURLToPath(new URL('./scan.js', import.meta.url));
const IS_WIN = process.platform === 'win32';
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

async function writeBytes(file, n) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, Buffer.alloc(n, 'x'));
}

/** a/ (10) a/b/ (20) a/b/c/ (30) a/b/c/d/ (40) e.txt (5) => 105 bytes, 5 files */
async function makeFixture(root) {
  await writeBytes(path.join(root, 'a', 'a.bin'), 10);
  await writeBytes(path.join(root, 'a', 'b', 'b.bin'), 20);
  await writeBytes(path.join(root, 'a', 'b', 'c', 'c.bin'), 30);
  await writeBytes(path.join(root, 'a', 'b', 'c', 'd', 'd.bin'), 40);
  await writeBytes(path.join(root, 'e.txt'), 5);
}

function findChild(node, name) {
  return node.children.find((c) => c.name === name);
}

describe('parseArgs', () => {
  it('uses defaults when no args are given', () => {
    const opts = parseArgs([]);
    assert.equal(opts.dir, os.homedir());
    assert.equal(opts.depth, DEFAULTS.depth);
    assert.equal(opts.min, DEFAULTS.min);
    assert.equal(opts.out, DEFAULTS.out);
  });

  it('reads every flag and the positional dir', () => {
    const opts = parseArgs(['--depth', '2', '--min', '0.05', '--out', 'x.json', 'some/dir']);
    assert.deepEqual(opts, { dir: 'some/dir', depth: 2, min: 0.05, out: 'x.json' });
  });

  it('rejects non-numeric depth', () => {
    assert.throws(() => parseArgs(['--depth', 'abc']), UsageError);
  });

  it('rejects negative min and missing values and unknown flags', () => {
    assert.throws(() => parseArgs(['--min', '-1']), UsageError);
    assert.throws(() => parseArgs(['--out']), UsageError);
    assert.throws(() => parseArgs(['--bogus']), UsageError);
  });
});

describe('scanDir', () => {
  let root;
  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'disk-city-'));
    await makeFixture(root);
  });
  afterEach(async () => {
    // restore permissions first so rm can clean the unreadable-dir fixture
    await fsp.chmod(path.join(root, 'locked'), 0o755).catch(() => {});
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('sums bytes and files exactly', async () => {
    const r = await scanDir(root);
    assert.equal(r.bytes, 105);
    assert.equal(r.files, 5);
    assert.equal(r.skipped, 0);
    const a = findChild(r, 'a');
    assert.equal(a.bytes, 100);
    assert.equal(findChild(a, 'b').bytes, 90);
  });

  it('caps depth but keeps aggregating deeper bytes into the parent', async () => {
    const r = await scanDir(root, { depth: 2 });
    assert.equal(r.bytes, 105);
    const b = findChild(findChild(r, 'a'), 'b');
    assert.equal(b.bytes, 90);
    assert.deepEqual(b.children, []);
    const depth1 = await scanDir(root, { depth: 1 });
    assert.deepEqual(findChild(depth1, 'a').children, []);
    assert.equal(findChild(depth1, 'a').bytes, 100);
  });

  it('never puts a path separator in a node name and keeps odd names verbatim', async () => {
    const odd = IS_WIN ? 'img src=x onerror=alert(1)' : '<img src=x onerror=alert(1)>';
    await writeBytes(path.join(root, odd, 'f.bin'), 7);
    const r = await scanDir(root);
    assert.ok(findChild(r, odd), 'odd name should round-trip as-is');
    const walk = (n) => { for (const c of n.children) { assert.ok(!c.name.includes(path.sep)); walk(c); } };
    walk(r);
  });

  it('skips symlinks', async (t) => {
    try {
      await fsp.symlink(path.join(root, 'a'), path.join(root, 'link'), 'dir');
    } catch (err) {
      if (IS_WIN && (err.code === 'EPERM' || err.code === 'EACCES')) {
        t.skip('symlink creation needs Developer Mode or admin on Windows');
        return;
      }
      throw err;
    }
    const r = await scanDir(root);
    assert.equal(r.bytes, 105, 'symlinked dir must not be counted');
    assert.equal(findChild(r, 'link'), undefined);
  });

  it('counts an unreadable directory in skipped and keeps going', async (t) => {
    if (IS_WIN) { t.skip('chmod 000 has no effect on Windows'); return; }
    if (IS_ROOT) { t.skip('root can read anything, chmod 000 would not block'); return; }
    await writeBytes(path.join(root, 'locked', 'secret.bin'), 1000);
    await fsp.chmod(path.join(root, 'locked'), 0o000);
    const r = await scanDir(root);
    assert.ok(r.skipped >= 1);
    assert.equal(r.bytes, 105, 'siblings still counted, locked dir contributes nothing');
    assert.equal(findChild(r, 'locked').bytes, 0);
  });

  it('rethrows errors that are not in the skip set', async () => {
    const fs = {
      readdir: async () => { throw Object.assign(new Error('boom'), { code: 'EIO' }); },
      stat: fsp.stat,
    };
    await assert.rejects(scanDir(root, { fs }), /boom/);
  });

  it('skips a missing entry (ENOENT) without failing the scan', async () => {
    const fs = {
      readdir: fsp.readdir,
      stat: async (p) => {
        if (p.endsWith('e.txt')) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        return fsp.stat(p);
      },
    };
    const r = await scanDir(root, { fs });
    assert.equal(r.bytes, 100);
    assert.equal(r.skipped, 1);
    assert.equal(r.files, 4, 'a file whose stat failed is not counted');
  });

  it('reports progress at the configured interval', async () => {
    const calls = [];
    await scanDir(root, { progressEvery: 2, onProgress: (p) => calls.push(p.files) });
    assert.ok(calls.length >= 2, `expected >= 2 progress calls, got ${calls.length}`);
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i] > calls[i - 1]);
  });
});

describe('collapseSmall', () => {
  const n = (name, bytes, files = 1, children = []) => ({ name, bytes, files, children });

  it('merges small siblings into (other) and preserves sums', () => {
    const out = collapseSmall([n('big', 100), n('s1', 2, 3), n('s2', 1, 4)], 5);
    assert.deepEqual(out.map((x) => x.name), ['big', '(other)']);
    assert.equal(out[1].bytes, 3);
    assert.equal(out[1].files, 7);
    assert.deepEqual(out[1].children, []);
    assert.equal(out.reduce((s, x) => s + x.bytes, 0), 103);
  });

  it('returns an equal copy when nothing is small', () => {
    const input = [n('a', 10), n('b', 20)];
    const out = collapseSmall(input, 5);
    assert.deepEqual(out, [n('b', 20), n('a', 10)]);
    assert.notEqual(out, input);
  });

  it('leaves a lone small sibling alone instead of renaming it (other)', () => {
    const out = collapseSmall([n('big', 100), n('tiny', 1)], 5);
    assert.deepEqual(out.map((x) => x.name), ['big', 'tiny']);
  });

  it('collapses recursively inside children', () => {
    const out = collapseSmall([n('p', 50, 3, [n('c1', 45), n('c2', 3), n('c3', 2)])], 5);
    assert.deepEqual(out[0].children.map((x) => x.name), ['c1', '(other)']);
    assert.equal(out[0].children[1].bytes, 5);
  });
});

describe('toOutput', () => {
  it('produces the viewer contract', () => {
    const result = { bytes: 1000, files: 4, skipped: 2, children: [{ name: 'x', bytes: 998, files: 2, children: [] }, { name: 'y', bytes: 1, files: 1, children: [] }, { name: 'z', bytes: 1, files: 1, children: [] }] };
    const out = toOutput({ root: '/r', result, min: 0.01, platform: 'linux', now: new Date('2026-10-25T00:00:00Z') });
    assert.equal(out.root, '/r');
    assert.equal(out.platform, 'linux');
    assert.equal(out.scannedAt, '2026-10-25T00:00:00.000Z');
    assert.equal(out.totalBytes, 1000);
    assert.equal(out.skipped, 2);
    assert.deepEqual(out.nodes.map((x) => x.name), ['x', '(other)']);
  });
});

describe('humanBytes', () => {
  it('formats units', () => {
    assert.equal(humanBytes(0), '0 B');
    assert.equal(humanBytes(1023), '1023 B');
    assert.equal(humanBytes(1024), '1.0 KB');
    assert.equal(humanBytes(1.5e9), '1.4 GB');
  });
});

describe('main (CLI)', () => {
  let root;
  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'disk-city-cli-'));
    await makeFixture(root);
  });
  afterEach(() => fsp.rm(root, { recursive: true, force: true }));

  it('writes --out and exits 0', async () => {
    const out = path.join(root, 'out', 'scan.json');
    const { stderr } = await execFileP(process.execPath, [SCAN_JS, root, '--out', out]);
    const json = JSON.parse(await fsp.readFile(out, 'utf8'));
    assert.equal(json.totalBytes, 105);
    assert.equal(json.root, path.resolve(root));
    assert.match(stderr, /Done in/);
  });

  it('exits 1 on a missing root', async () => {
    await assert.rejects(
      execFileP(process.execPath, [SCAN_JS, path.join(root, 'missing')]),
      (err) => err.code === 1 && /Cannot read/.test(err.stderr),
    );
  });

  it('exits 1 on an unreadable root instead of writing an empty scan', async (t) => {
    if (IS_WIN) { t.skip('chmod 000 has no effect on Windows'); return; }
    if (IS_ROOT) { t.skip('root can read anything'); return; }
    const locked = path.join(root, 'locked-root');
    await fsp.mkdir(locked);
    await fsp.chmod(locked, 0o000);
    try {
      await assert.rejects(
        execFileP(process.execPath, [SCAN_JS, locked, '--out', path.join(root, 'never.json')]),
        (err) => err.code === 1 && /Cannot read/.test(err.stderr),
      );
      await assert.rejects(fsp.access(path.join(root, 'never.json')));
    } finally {
      await fsp.chmod(locked, 0o755);
    }
  });

  it('exits 1 with usage on a bad flag', async () => {
    await assert.rejects(
      execFileP(process.execPath, [SCAN_JS, '--depth', 'x']),
      (err) => err.code === 1 && /Usage/.test(err.stderr),
    );
  });
});
