Disk City — 1-hour scope

One line: A CLI that scans a folder and opens a 3D city where every directory is a building sized by bytes. Runs on Linux, macOS and Windows.

Stack
Language: JavaScript (ESM, Node ≥ 20). No TypeScript, no build step for the scanner.
Scanner: scan.js — Node built-ins only (fs/promises, path, os).
Viewer: Vite + React + React Three Fiber + drei + d3-hierarchy (treemap layout).
Package manager: npm (preinstalled on every GitHub runner, no setup step).
CI: GitHub Actions, matrix on ubuntu-latest, macos-latest, windows-latest.
Repo layout
disk-city/
  scan.js               # CLI scanner
  scan.test.js          # node:test, runs against a fixture tree
  viewer/               # Vite app
    public/scan.json    # generated, gitignored; sample committed as scan.sample.json
  .github/workflows/ci.yml
  README.md
JSON contract (scanner → viewer)
json
{
  "root": "C:\\Users\\acacio",
  "platform": "win32",
  "scannedAt": "2026-10-25T21:30:00Z",
  "totalBytes": 412000000000,
  "skipped": 1203,
  "nodes": [
    { "name": "AppData", "bytes": 98000000000, "files": 412000, "children": [] }
  ]
}

Depth capped at 3. Nodes under 0.1% of total collapsed into "(other)" so sums stay correct. name only, not full paths — the viewer rebuilds paths from the tree, which sidesteps separator differences.

Scanner (~15 min)
node scan.js [dir] [--depth 3] [--min 0.001] [--out viewer/public/scan.json]. Default dir: os.homedir().
Recursive walk with readdir({ withFileTypes: true }). Always path.join, never string concat.
Skip symlinks and reparse points (dirent.isSymbolicLink()) — on Windows this also skips junctions and OneDrive placeholders, which otherwise double-count or hang.
Catch EACCES, EPERM, EBUSY, ENOENT, ELOOP per entry: count in skipped, keep going. Windows throws these constantly on AppData\Local\Application Data and friends; macOS on ~/Library without Full Disk Access.
Progress to stderr every 10k files so it doesn’t look hung.
Size via stat().size (logical size). Note in README that on-disk size differs (compression on APFS/NTFS, sparse files) — out of scope.
package.json scripts use plain node, no shell operators, no rm -rf, no && chains that break in cmd.exe. Fixture setup in tests uses fs.mkdtemp(os.tmpdir()).
Viewer (~30 min)
Load scan.json, build d3.hierarchy → d3.treemap().tile(treemapSquarify) on a fixed ground size.
Top-level dirs = city blocks (color per block), children = buildings inside.
Height = normalized log(bytes). Toggle linear/log; log is default.
Hover tooltip: path, human size, % of total, file count.
Click a block: camera flies in, treemap re-laid on its children, breadcrumb to go back.
Side panel: top-10 folders as plain list.
OrbitControls, ambient + directional light, no shadows. Plain <mesh> per building; depth 3 + 0.1% cut keeps it under ~1k meshes.
CI (.github/workflows/ci.yml, ~5 min)
yaml
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix: { os: [ubuntu-latest, macos-latest, windows-latest] }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm test            # node --test scan.test.js
      - run: node scan.js . --out /tmp/scan.json || node scan.js . --out scan.json
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci && npm run build --workspace viewer

Actually drop the || hack and use --out ${{ runner.temp }}/scan.json — one line, works on all three. The matrix is the whole point: it proves the path/permission handling, not just that it builds. Optional: deploy viewer/dist with scan.sample.json to GitHub Pages on main — gives them a live link in the README for +10 minutes.

Tests (node:test, ~5 min)
Fixture tree with known sizes → totalBytes matches.
A symlink in the fixture is skipped (skip test on Windows if symlink throws EPERM without dev mode — test.skip with a message, don’t fail).
--min collapses small nodes into (other) and the sum is preserved.
Unreadable dir (chmod 000 on POSIX; skip on Windows) increments skipped, doesn’t throw.
