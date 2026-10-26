import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateScan, buildTree, pathOf, layoutLevel, topN } from './layout.js';

const sample = JSON.parse(readFileSync(new URL('../public/scan.sample.json', import.meta.url), 'utf8'));

const leaf = (name, bytes, files = 1) => ({ name, bytes, files, children: [] });
const small = {
  root: 'C:\\Users\\me',
  platform: 'win32',
  scannedAt: '2026-10-25T00:00:00.000Z',
  totalBytes: 1000,
  skipped: 0,
  nodes: [
    { name: 'a', bytes: 600, files: 4, children: [{ name: 'b', bytes: 400, files: 2, children: [leaf('c', 300)] }, leaf('<img src=x onerror=alert(1)>', 100)] },
    leaf('solo', 300),
    leaf('(other)', 50, 9),
  ],
};

const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
const inside = (r, outer) => r.x0 >= outer.x0 - 1e-9 && r.y0 >= outer.y0 - 1e-9 && r.x1 <= outer.x1 + 1e-9 && r.y1 <= outer.y1 + 1e-9;

describe('validateScan', () => {
  it('accepts the committed sample', () => {
    assert.equal(validateScan(sample), sample);
  });
  it('rejects malformed input with TypeError', () => {
    assert.throws(() => validateScan({}), TypeError);
    assert.throws(() => validateScan(null), TypeError);
    assert.throws(() => validateScan({ root: '/', totalBytes: 1 }), TypeError);
    assert.throws(() => validateScan({ root: '/', totalBytes: '1', nodes: [] }), TypeError);
    assert.throws(() => validateScan({ root: '/', totalBytes: 1, nodes: [{ name: 'x', bytes: 'big', files: 0, children: [] }] }), TypeError);
    assert.throws(() => validateScan({ root: '/', totalBytes: 1, nodes: [{ name: 'x', bytes: 1, files: 0 }] }), /children/);
  });
});

describe('buildTree / pathOf', () => {
  it('root value equals totalBytes and every node value equals its bytes', () => {
    const tree = buildTree(small);
    assert.equal(tree.value, 1000);
    tree.each((n) => assert.equal(n.value, n.data.bytes, `value mismatch at ${n.data.name}`));
  });
  it('rebuilds paths with "/" after a verbatim root', () => {
    const tree = buildTree(small);
    const c = tree.descendants().find((n) => n.data.name === 'c');
    assert.equal(pathOf(c), 'C:\\Users\\me/a/b/c');
    assert.equal(pathOf(tree), 'C:\\Users\\me');
  });
  it('keeps odd names as plain text', () => {
    const tree = buildTree(small);
    assert.ok(tree.descendants().some((n) => n.data.name === '<img src=x onerror=alert(1)>'));
  });
});

describe('layoutLevel', () => {
  it('places every block inside the ground and buildings inside their block', () => {
    const tree = buildTree(sample);
    const { blocks, buildings } = layoutLevel(tree, { ground: 100 });
    const ground = { x0: 0, y0: 0, x1: 100, y1: 100 };
    assert.equal(blocks.length, sample.nodes.length);
    for (const b of blocks) assert.ok(inside(b, ground), `block ${b.path} outside ground`);
    for (const b of buildings) assert.ok(inside(b, blocks[b.blockIndex]), `building ${b.path} outside its block`);
  });

  it('gives blocks area proportional to bytes (within 2%)', () => {
    const tree = buildTree(small);
    const { blocks } = layoutLevel(tree, { ground: 1000, padding: 0 });
    for (const b of blocks) {
      const expected = b.bytes / small.totalBytes;
      const actual = area(b) / (1000 * 1000); // loose root files leave empty ground
      assert.ok(Math.abs(expected - actual) < 0.02, `${b.path}: expected ${expected}, got ${actual}`);
    }
  });

  it('emits a childless block as a building and children as buildings', () => {
    const tree = buildTree(small);
    const { buildings } = layoutLevel(tree);
    const names = buildings.map((b) => b.node.data.name).sort();
    assert.deepEqual(names, ['(other)', '<img src=x onerror=alert(1)>', 'b', 'solo']);
  });

  it('computes heights in (0, maxHeight] and keeps log/linear ordering consistent', () => {
    const tree = buildTree(sample);
    const log = layoutLevel(tree, { mode: 'log', maxHeight: 25 });
    const lin = layoutLevel(tree, { mode: 'linear', maxHeight: 25 });
    for (const b of [...log.buildings, ...lin.buildings]) {
      assert.ok(b.height > 0 && b.height <= 25, `${b.path} height ${b.height}`);
    }
    const order = (items) => [...items].sort((a, b) => b.height - a.height).map((b) => b.path);
    assert.deepEqual(order(log.buildings), order(lin.buildings));
    const tallest = log.buildings.reduce((m, b) => (b.bytes > m.bytes ? b : m));
    assert.equal(tallest.height, 25);
    assert.ok(log.buildings.every((b) => b.height >= lin.buildings.find((l) => l.path === b.path).height - 1e-9));
  });

  it('lays out a nested level with paths relative to the whole tree', () => {
    const tree = buildTree(small);
    const a = tree.children.find((n) => n.data.name === 'a');
    const { blocks, buildings } = layoutLevel(a);
    assert.deepEqual(blocks.map((b) => b.path), ['C:\\Users\\me/a/b', 'C:\\Users\\me/a/<img src=x onerror=alert(1)>']);
    assert.ok(buildings.some((b) => b.path === 'C:\\Users\\me/a/b/c'));
  });

  it('handles a leaf level without throwing', () => {
    const tree = buildTree(small);
    const solo = tree.children.find((n) => n.data.name === 'solo');
    const out = layoutLevel(solo);
    assert.deepEqual(out.blocks, []);
    assert.deepEqual(out.buildings, []);
  });
});

describe('topN', () => {
  it('returns at most n children sorted by bytes desc with paths', () => {
    const tree = buildTree(sample);
    const top = topN(tree, 10);
    assert.ok(top.length <= 10);
    for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].bytes >= top[i].bytes);
    assert.ok(top[0].path.startsWith('/home/sample/'));
    assert.equal(topN(tree, 2).length, 2);
  });
});
