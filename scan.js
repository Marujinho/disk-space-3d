#!/usr/bin/env node
// Disk City scanner — Node built-ins only. Walks a directory tree and writes
// a depth-capped size tree as JSON for the viewer. See README for the contract.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SKIP_CODES = new Set(['EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'ELOOP']);
export const DEFAULTS = Object.freeze({
  depth: 3,
  min: 0.001,
  out: path.join('viewer', 'public', 'scan.json'),
});
const STAT_BATCH = 64;
const OTHER_NAME = '(other)';

export class UsageError extends Error {}

export const USAGE = `Usage: node scan.js [dir] [--depth N] [--min FRACTION] [--out PATH]

  dir            directory to scan (default: your home directory)
  --depth N      how many directory levels to keep (default: ${DEFAULTS.depth})
  --min FRACTION collapse nodes under this share of the total into "(other)" (default: ${DEFAULTS.min})
  --out PATH     where to write the JSON (default: ${DEFAULTS.out})
`;

/** Parse CLI arguments. Throws UsageError on bad input. */
export function parseArgs(argv) {
  const opts = { dir: os.homedir(), ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--depth' || arg === '--min' || arg === '--out') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      if (arg === '--out') {
        opts.out = value;
      } else {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) throw new UsageError(`${arg} must be a non-negative number, got "${value}"`);
        opts[arg.slice(2)] = n;
      }
    } else if (arg === '--help' || arg === '-h') {
      throw new UsageError('');
    } else if (arg.startsWith('--')) {
      throw new UsageError(`Unknown flag ${arg}`);
    } else {
      opts.dir = arg;
    }
  }
  return opts;
}

/**
 * Recursively measure `dir`. Returns { bytes, files, children, skipped }.
 * Symlinks (and Windows reparse points) are skipped. Errors whose code is in
 * SKIP_CODES are counted in `skipped`; anything else propagates.
 */
export async function scanDir(dir, options = {}) {
  const {
    depth = DEFAULTS.depth,
    fs = fsp,
    onProgress,
    progressEvery = 10_000,
  } = options;
  const state = options._state ?? { files: 0, skipped: 0, nextTick: progressEvery };
  const level = options._level ?? 0;

  const node = { bytes: 0, files: 0, children: [] };
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (SKIP_CODES.has(err?.code)) {
      state.skipped++;
      return { ...node, skipped: state.skipped };
    }
    throw err;
  }

  const fileNames = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const child = await scanDir(path.join(dir, entry.name), {
        ...options, fs, depth, onProgress, progressEvery, _state: state, _level: level + 1,
      });
      node.bytes += child.bytes;
      node.files += child.files;
      if (level + 1 <= depth) {
        node.children.push({
          name: entry.name,
          bytes: child.bytes,
          files: child.files,
          children: level + 1 < depth ? child.children : [],
        });
      }
    } else if (entry.isFile()) {
      fileNames.push(entry.name);
    }
  }

  for (let i = 0; i < fileNames.length; i += STAT_BATCH) {
    const batch = fileNames.slice(i, i + STAT_BATCH);
    const sizes = await Promise.all(batch.map(async (name) => {
      try {
        return (await fs.stat(path.join(dir, name))).size;
      } catch (err) {
        if (SKIP_CODES.has(err?.code)) {
          state.skipped++;
          return null;
        }
        throw err;
      }
    }));
    let counted = 0;
    for (const size of sizes) {
      if (size === null) continue;
      node.bytes += size;
      counted++;
    }
    node.files += counted;
    state.files += batch.length;
    if (onProgress && state.files >= state.nextTick) {
      state.nextTick = state.files + progressEvery;
      onProgress({ files: state.files, skipped: state.skipped });
    }
  }

  node.children.sort((a, b) => b.bytes - a.bytes);
  return { ...node, skipped: state.skipped };
}

/**
 * Collapse siblings below `threshold` bytes into a single "(other)" node,
 * recursively. Sums are preserved. Returns a new array sorted by bytes desc.
 */
export function collapseSmall(nodes, threshold) {
  const kept = [];
  const other = { name: OTHER_NAME, bytes: 0, files: 0, children: [] };
  let collapsed = 0;
  for (const n of nodes) {
    const node = { ...n, children: collapseSmall(n.children ?? [], threshold) };
    if (node.bytes < threshold) {
      other.bytes += node.bytes;
      other.files += node.files;
      collapsed++;
    } else {
      kept.push(node);
    }
  }
  if (collapsed === 1) {
    // A lone small sibling keeps its own name; "(other)" only earns its place by merging.
    return nodes.map((n) => ({ ...n, children: collapseSmall(n.children ?? [], threshold) }))
      .sort((a, b) => b.bytes - a.bytes);
  }
  if (collapsed > 1) kept.push(other);
  return kept.sort((a, b) => b.bytes - a.bytes);
}

/** Shape the scan result into the viewer's JSON contract. */
export function toOutput({ root, result, min = DEFAULTS.min, platform = process.platform, now = new Date() }) {
  return {
    root,
    platform,
    scannedAt: now.toISOString(),
    totalBytes: result.bytes,
    files: result.files,
    skipped: result.skipped,
    nodes: collapseSmall(result.children, min * result.bytes),
  };
}

export function humanBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${v} B` : `${v.toFixed(1)} ${units[i]}`;
}

export async function main(argv, { stderr = process.stderr } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      if (err.message) stderr.write(`${err.message}\n\n`);
      stderr.write(USAGE);
      return 1;
    }
    throw err;
  }

  const root = path.resolve(opts.dir);
  try {
    const st = await fsp.stat(root);
    if (!st.isDirectory()) {
      stderr.write(`Not a directory: ${root}\n`);
      return 1;
    }
    await fsp.readdir(root); // an unreadable root is fatal; unreadable subtrees are not
  } catch (err) {
    stderr.write(`Cannot read ${root}: ${err.code ?? err.message}\n`);
    return 1;
  }

  stderr.write(`Scanning ${root} (depth ${opts.depth}, min ${opts.min})...\n`);
  const started = Date.now();
  let result;
  try {
    result = await scanDir(root, {
      depth: opts.depth,
      onProgress: ({ files, skipped }) => stderr.write(`  ${files} files (${skipped} skipped)\n`),
    });
  } catch (err) {
    if (!err?.code) throw err;
    stderr.write(`Scan aborted: ${err.code} at ${err.path ?? '?'} (only ${[...SKIP_CODES].join(', ')} are skipped)\n`);
    return 1;
  }
  const output = toOutput({ root, result, min: opts.min });

  await fsp.mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
  await fsp.writeFile(opts.out, JSON.stringify(output, null, 2));

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  stderr.write(
    `Done in ${secs}s: ${humanBytes(result.bytes)} in ${result.files} files, `
    + `${result.skipped} entries skipped, ${output.nodes.length} top-level nodes -> ${opts.out}\n`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(err); process.exitCode = 1; },
  );
}
