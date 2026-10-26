// Pure layout: scan JSON -> treemap rectangles with heights and rebuilt paths.
// No DOM, no three.js, so it runs under node:test.

import { hierarchy, treemap, treemapSquarify } from '../vendor/d3-hierarchy/index.js';

const MIN_HEIGHT = 0.1;

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function validateNode(node, where) {
  if (!node || typeof node !== 'object') throw new TypeError(`${where}: node must be an object`);
  if (typeof node.name !== 'string') throw new TypeError(`${where}: name must be a string`);
  if (!isNum(node.bytes) || node.bytes < 0) throw new TypeError(`${where}: bytes must be a non-negative number`);
  if (!isNum(node.files) || node.files < 0) throw new TypeError(`${where}: files must be a non-negative number`);
  if (!Array.isArray(node.children)) throw new TypeError(`${where}: children must be an array`);
  node.children.forEach((c, i) => validateNode(c, `${where}.children[${i}]`));
}

/** Throws TypeError unless `json` matches the scanner contract. Returns it unchanged. */
export function validateScan(json) {
  if (!json || typeof json !== 'object') throw new TypeError('scan must be an object');
  if (typeof json.root !== 'string') throw new TypeError('root must be a string');
  if (!isNum(json.totalBytes) || json.totalBytes < 0) throw new TypeError('totalBytes must be a non-negative number');
  if (!Array.isArray(json.nodes)) throw new TypeError('nodes must be an array');
  json.nodes.forEach((n, i) => validateNode(n, `nodes[${i}]`));
  return json;
}

function sumChildren(d) {
  return (d.children ?? []).reduce((s, c) => s + c.bytes, 0);
}

/**
 * d3 hierarchy of the whole scan. Root data is a synthetic node named after
 * `scan.root`. Each node's own value is "bytes not explained by children"
 * (files directly inside it), so node.value === node.data.bytes everywhere.
 */
export function buildTree(scan) {
  const rootData = {
    name: scan.root,
    bytes: scan.totalBytes,
    files: scan.files ?? scan.nodes.reduce((s, n) => s + n.files, 0),
    children: scan.nodes,
  };
  return hierarchy(rootData)
    .sum((d) => Math.max(0, d.bytes - sumChildren(d)))
    .sort((a, b) => b.value - a.value);
}

/** Display path rebuilt from the tree: root verbatim, then "/" + names. */
export function pathOf(node) {
  const chain = node.ancestors().reverse();
  const root = chain[0].data.name;
  const rest = chain.slice(1).map((n) => n.data.name);
  return rest.length ? `${root}/${rest.join('/')}` : root;
}

function heightFor(bytes, maxBytes, mode, maxHeight) {
  if (!maxBytes) return MIN_HEIGHT;
  const ratio = mode === 'linear'
    ? bytes / maxBytes
    : Math.log1p(bytes) / Math.log1p(maxBytes);
  return Math.max(MIN_HEIGHT, ratio * maxHeight);
}

/**
 * Lay out one level of the city. `level` is a node from buildTree.
 * Blocks = level.children, buildings = their children (or the block itself
 * when it has none). Returns rects in [0, ground]² plus a height per item.
 */
export function layoutLevel(level, { ground = 100, mode = 'log', maxHeight = 25, padding = 1 } = {}) {
  const levelData = level.data;
  const children = level.children ?? [];
  const byData = new Map();
  for (const c of children) {
    byData.set(c.data, c);
    for (const g of c.children ?? []) byData.set(g.data, g);
  }

  // Fresh two-level hierarchy for the treemap; data objects are shared with `level`.
  const local = hierarchy(levelData, (d) => {
    if (d === levelData) return d.children;
    if (byData.get(d)?.parent === level) return d.children;
    return null;
  });
  // Clamp so hand-edited JSON with bytes < sum(children) can't overflow its block.
  local.each((n) => { n.value = Math.max(n.data.bytes, sumChildren(n.data)); });
  local.sort((a, b) => b.value - a.value);

  treemap()
    .size([ground, ground])
    .paddingInner(padding)
    .paddingOuter(padding)
    .tile(treemapSquarify)(local);

  const blocks = [];
  const buildings = [];
  const rect = (n) => ({ x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1 });

  (local.children ?? []).forEach((b, i) => {
    const node = byData.get(b.data);
    blocks.push({ node, path: pathOf(node), blockIndex: i, ...rect(b), bytes: node.data.bytes });
    const kids = b.children ?? [];
    if (kids.length === 0) {
      buildings.push({ node, path: pathOf(node), blockIndex: i, ...rect(b), bytes: node.data.bytes });
    }
    for (const g of kids) {
      const gn = byData.get(g.data);
      buildings.push({ node: gn, path: pathOf(gn), blockIndex: i, ...rect(g), bytes: gn.data.bytes });
    }
  });

  const maxBytes = buildings.reduce((m, b) => Math.max(m, b.bytes), 0);
  for (const b of buildings) b.height = heightFor(b.bytes, maxBytes, mode, maxHeight);
  for (const b of blocks) b.height = 0;

  return { blocks, buildings, ground, mode };
}

/** Largest n children of `level`, with display paths. */
export function topN(level, n = 10) {
  return [...(level.children ?? [])]
    .sort((a, b) => b.data.bytes - a.data.bytes)
    .slice(0, n)
    .map((node) => ({ node, path: pathOf(node), bytes: node.data.bytes, files: node.data.files }));
}
