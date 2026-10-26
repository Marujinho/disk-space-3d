# Plan: Disk City

**PRD**: `docs/work/disk-city-prd.md` · **Approval**: skipped (--auto) · **Date**: 2026-10-25

## Approach
Two npm packages in one repo: the root holds the dependency-free scanner (`scan.js`) and its `node:test` suite; `viewer/` is an npm workspace with Vite + `three` + `d3-hierarchy` in vanilla ESM. The viewer is split so the part that decides *where things go* (`layout.js`: JSON → treemap rectangles with heights and rebuilt paths) is pure and tested in Node, and only the part that *draws* (`city.js`, three scene) and *wires DOM* (`main.js`) is browser-only and verified by hand. The scanner walks sequentially per directory, batching `stat` calls per directory (chunks of 64) so a huge directory doesn't open thousands of descriptors but a home dir still scans in tens of seconds. CI is two workflows: `ci.yml` (test matrix on 3 OSes + build) on push/PR, `pages.yml` (deploy `viewer/dist` built against the sample) on push to `main`.

Alternatives: (a) React Three Fiber per `scope.md` — lost to the user's "as much plain JS as possible"; R3F adds react, react-dom, @react-three/fiber, drei for no functional gain at ~1k meshes. (b) No bundler, import-map + CDN — lost because Pages needs no CDN dependency at runtime and `npm ci` + build is what the brief wants proven in CI. (c) Fully parallel walk with `Promise.all` recursion — lost to EMFILE risk on large trees (EMFILE is not in the swallowed-error set and would crash the scan).

## Decisions
| Decision | Chosen | Alternatives | Why | Asked / assumed |
|---|---|---|---|---|
| Viewer framework | Vanilla three.js r186 | React Three Fiber | User instruction overrides scope stack | asked (conversation) |
| Node in CI | test matrix on 20, build + pages on 22 | 20 everywhere | Vite 8 requires Node ≥ 20.19 / 22.12; matrix on 20 proves the scanner's `≥ 20` claim | assumed |
| Treemap value | `value = bytes − Σ children.bytes` (files directly in the dir) so `node.value === bytes` and leftover ground = loose files | sum leaves only | Keeps block area proportional to real bytes under the depth cap | assumed |
| `(other)` threshold base | `min × totalBytes`, applied per parent, recursively | relative to parent | PRD §15 | assumed |
| Symlinks | skipped silently, not counted in `skipped` | count them | `skipped` means "couldn't read"; symlinks are a policy skip. README says so | assumed |
| Path separator in viewer | `/` for display, root shown verbatim | `platform`-aware | Display only; avoids per-platform code in the viewer | assumed |
| Missing vs malformed `scan.json` | non-OK or non-JSON response → sample + banner; JSON that fails validation → error banner | always fall back | A08: a corrupt real scan must not be masked by the sample | assumed |
| Linting | none | eslint flat config | Time box; recorded in README | assumed (PRD §9) |
| Tests location | `scan.test.js` root, `viewer/src/*.test.js` run from root `npm test` | per-workspace test scripts | one command, one runner | assumed |

## Critical files
| File | Role in this change |
|---|---|
| `scan.js` | The CLI: `parseArgs`, `scanDir`, `collapseSmall`, `toOutput`, `main` — all cross-OS behaviour lives here |
| `scan.test.js` | Fixture-based proof of the above on all three runners |
| `viewer/src/layout.js` | Pure JSON → rects/heights/paths; `validateScan`, `layoutLevel`, `topN` |
| `viewer/src/city.js` | three scene: meshes, raycast hover, click, camera fly |
| `viewer/src/main.js` | Loader with fallback, header, panel, breadcrumb, toggle; `textContent` only |
| `.github/workflows/ci.yml` | The matrix the brief asks for |
| `package.json` | Workspaces, scripts without shell operators |

## Tasks
### T1 ✅ `436c177` — Scanner CLI with tests
- **Covers**: FR-1…FR-7, NFR-1, NFR-3, NFR-4, A01, A05 (CLI side), A06, A09, A10
- **Files**: `package.json` (new), `scan.js` (new), `scan.test.js` (new)
- **Mirror**: greenfield — PRD §11 conventions (ESM, `node:` imports, pure exports + guarded `main`, `node:test` fixtures via `mkdtemp`)
- **Do**:
  - `package.json`: `"name":"disk-city"`, `"private":true`, `"type":"module"`, `"engines":{"node":">=20"}`, `"workspaces":["viewer"]` (added in T2), scripts `"test":"node --test scan.test.js"`, `"scan":"node scan.js"`.
  - `scan.js` exports:
    - `parseArgs(argv)` → `{dir, depth, min, out}`; defaults `os.homedir()`, 3, 0.001, `viewer/public/scan.json`; non-numeric or negative `--depth`/`--min` → throws `UsageError`.
    - `SKIP_CODES = new Set(['EACCES','EPERM','EBUSY','ENOENT','ELOOP'])`.
    - `async scanDir(dir, {depth=3, fs=fsp, onProgress, progressEvery=10000, _level=0, _state})` → `{bytes, files, children, skipped}`. `readdir(dir,{withFileTypes:true})`; errors in `SKIP_CODES` → `skipped++` and return empty; others rethrow. For each dirent: `isSymbolicLink()` → continue; `isDirectory()` → recurse with `_level+1`; push `{name, bytes, files, children}` only if `_level < depth − 1`… precisely: child node included when `_level + 1 <= depth`, its own `children` are `[]` when `_level + 1 === depth`. Files: `stat(path.join(dir,name))` in `Promise.all` chunks of 64; `size` summed; each stat error in `SKIP_CODES` → `skipped++`. Shared `_state = {files:0, skipped:0, nextTick:progressEvery}`; call `onProgress({files, skipped})` whenever `files >= nextTick`.
    - `collapseSmall(nodes, threshold)` → new array; recurse into children first; siblings with `bytes < threshold` merged into one `{name:'(other)', bytes, files, children:[]}` appended last; if none small, return unchanged copy. Sort result by bytes desc.
    - `toOutput({root, result, min})` → contract object with `platform: process.platform`, `scannedAt: new Date().toISOString()`, `totalBytes`, `skipped`, `nodes: collapseSmall(children, min*totalBytes)`.
    - `main(argv)`: parse; `stat(dir)` must be a directory else exit 1 with message; run with `onProgress` writing `scanned N files (S skipped)` to stderr; `mkdir(dirname(out),{recursive:true})`; `writeFile(out, JSON.stringify(output, null, 2))`; final summary to stderr: root, human total, files, skipped, out path. `UsageError` → usage text + exit 1.
    - Guard: `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))`.
    - `humanBytes(n)` helper duplicated here (scanner must not import from viewer).
- **Tests** (`scan.test.js`, `describe` per function, fixture in `beforeEach` with `mkdtemp(join(tmpdir(),'disk-city-'))`, `afterEach` `rm recursive force`):
  - parseArgs: defaults; full flags with positional dir; `--depth abc` throws; `--min -1` throws.
  - scanDir: fixture `a/ (10 B file), a/b/ (20 B), a/b/c/ (30 B), a/b/c/d/ (40 B)`, `e.txt (5 B)` → `bytes 105`, `files 5`; `depth:2` → node `a.children[0].children` is `[]` but `a.bytes` still 100; symlink `link → a` → bytes unchanged, test.skip if `symlink` throws `EPERM`/`EPERM`-like on win32; `chmod 000` dir → resolves, `skipped ≥ 1`, sibling bytes counted, skip on win32 or uid 0; injected `fs.readdir` throwing `{code:'EIO'}` rejects; dir named `<img src=x onerror=alert(1)>` round-trips as literal `name`; no `name` includes `path.sep`; `progressEvery: 2` with 5 files → `onProgress` called ≥ 2 times with increasing `files`.
  - collapseSmall: `[100, 2, 1]` threshold 5 → `[100, (other)=3 files summed]`; all above → unchanged; nested small collapsed inside child.
  - main via `execFile(process.execPath, ['scan.js', fixture, '--out', outPath])` → exit 0, file parses, `totalBytes` matches; `['scan.js', join(fixture,'missing')]` → exit 1; `['scan.js', '--depth', 'x']` → exit 1 and stderr contains `Usage`.
- **Check**: `npm test` → all pass; `node scan.js . --out /tmp/scan.json` → exit 0, `jq .totalBytes` numeric; `node scan.js /nope` → exit 1
- **Depends on**: —

### T2 ✅ `7f5a426` — Viewer scaffold, pure layout module, sample data
- **Covers**: FR-8 (data side), FR-9 (layout), FR-10 (height math), FR-11 (path rebuild), FR-13 (`topN`), NFR-2 (mesh budget is layout count), NFR-5, A02 (vite config), A03 (lockfile), A08 (`validateScan`)
- **Files**: `viewer/package.json` (new), `viewer/vite.config.js` (new), `viewer/index.html` (new, placeholder body), `viewer/src/format.js` + `format.test.js` (new), `viewer/src/layout.js` + `layout.test.js` (new), `viewer/public/scan.sample.json` (new), `package.json` (edit: workspaces, test script lists the three test files), `package-lock.json` (generated by `npm install`)
- **Mirror**: `scan.js` from T1 — export style, `humanBytes`; test style from `scan.test.js`
- **Do**:
  - `viewer/package.json`: `"name":"disk-city-viewer"`, `"private":true`, `"type":"module"`, scripts `dev: vite`, `build: vite build`, `preview: vite preview`; deps `three`, `d3-hierarchy`; devDep `vite`.
  - `vite.config.js`: `export default { base: './' }` (no `server.host`).
  - `format.js`: `humanBytes(n)` (B, KB, MB, GB, TB, 1 decimal), `percent(part, total)`, `formatInt(n)` with thin-space grouping.
  - `layout.js`: `validateScan(json)` throws `TypeError` unless `nodes` array, `totalBytes` finite number ≥ 0, `root` string; each node `name` string, `bytes`/`files` numbers, `children` array (recursive). `buildTree(scan)` → `d3.hierarchy({name: scan.root, children: scan.nodes, bytes: scan.totalBytes, files})` with `.sum(d => Math.max(0, d.bytes − Σ(d.children||[]).bytes))` and `.sort((a,b)=>b.value−a.value)`; `pathOf(h)` → `scan.root` + (`/` + names of ancestors after root). `layoutLevel(levelNode, {ground=100, mode='log', maxHeight=25, padding=1})` → runs `treemap().size([ground,ground]).paddingInner(padding).paddingOuter(padding).tile(treemapSquarify)` on a *copy* of the subtree limited to two levels (children + grandchildren; deeper descendants' value folded in by `.sum`), returns `{blocks:[{node, path, color index i, x0,y0,x1,y1, height}], buildings:[…same, blockIndex]}`; height per item = `mode==='log' ? log1p(bytes)/log1p(maxBytes) : bytes/maxBytes` × `maxHeight`, where `maxBytes` is the largest building at this level (or largest block if a block has no children, in which case the block itself is emitted as a building). `topN(levelNode, n=10)` → children sorted desc by value.
  - `scan.sample.json`: synthetic ~25 nodes, 3 levels, includes an `(other)`, `root: "/home/sample"`, `totalBytes` consistent with sums.
  - Root `package.json`: `"workspaces":["viewer"]`, `"test":"node --test scan.test.js viewer/src/format.test.js viewer/src/layout.test.js"`, add `"dev":"npm run dev --workspace viewer"`, `"build":"npm run build --workspace viewer"`.
- **Tests**:
  - format: `humanBytes(0)==='0 B'`, `1023`, `1024`→`1.0 KB`, `1.5e9`→`1.4 GB`; `percent(1,3)`→`33.3%`; `percent(0,0)`→`0%`.
  - layout: `validateScan` rejects `{}`/missing `nodes`/string bytes; accepts sample; `buildTree(sample).value === totalBytes`; `layoutLevel` on sample: every block inside `[0,ground]²`, block areas proportional to bytes within 2 %, every building inside its block, `height` ∈ (0, maxHeight], log mode heights ordered like linear mode heights, a node with no children is emitted as a building; `pathOf` on a depth-3 node equals `root + '/a/b/c'`; name `<img …>` preserved verbatim in `blocks[i].node.data.name`; `topN` returns ≤ 10 sorted desc; `(other)` included and sums preserved (`Σ blocks bytes === level bytes` within loose files).
- **Check**: `npm install` (generates lock) → `npm test` all pass → `npm run build --workspace viewer` emits `viewer/dist/index.html`
- **Depends on**: T1

### T3 ✅ `486f6cd` — 3D city, interaction and DOM wiring
- **Covers**: FR-8 (fallback banner), FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, NFR-2, A05 (`textContent`), A08 (error banner)
- **Files**: `viewer/index.html` (edit), `viewer/src/style.css` (new), `viewer/src/city.js` (new), `viewer/src/main.js` (new)
- **Mirror**: `viewer/src/layout.js` from T2 for data shapes
- **Do**:
  - `index.html`: `<header>` (title, root, total, scanned-at, skipped), `<nav id="crumbs">`, `<button id="mode">` (text `height: log`), `<div id="banner" hidden>`, `<main><canvas id="c"></canvas><div id="tip" hidden></div></main>`, `<aside id="top"><h2>Top 10</h2><ol></ol></aside>`. Module script `src/main.js`.
  - `city.js` exports `createCity(canvas)` → `{render(level), onHover(cb), onClick(cb), flyTo(rect), dispose()}`. Scene, `PerspectiveCamera`, `WebGLRenderer({canvas, antialias:true})`, `OrbitControls` from `three/addons/controls/OrbitControls.js`, `AmbientLight(0xffffff, .6)` + `DirectionalLight(0xffffff, .8)`, flat `PlaneGeometry` ground. `render(level)`: dispose previous group; for each block a thin `BoxGeometry(w, 0.4, d)` with `MeshLambertMaterial` colour from a 12-colour palette by block index; for each building a `BoxGeometry(w, h, d)` positioned at `(cx, h/2, cz)` with the block colour lightened; `mesh.userData = item`. One shared geometry per mesh is fine (≤ 1k). `pointermove` → `Raycaster` against the group, throttled to one cast per animation frame; on change set `material.emissive` highlight and call hover cb with `item` + client coords (or `null`). `click` (only if pointer moved < 5 px since `pointerdown`) → click cb with `item`. `flyTo({cx, cz, size})`: target position/lookAt computed from the rect, lerped over 600 ms in the RAF loop. `ResizeObserver` on the canvas parent. Mesh count logged once per `render` in dev (`import.meta.env.DEV`).
  - `main.js`: `loadScan()` → `fetch('./scan.json')`; if `!res.ok` or content-type lacks `json` → `fetch('./scan.sample.json')` and show banner "Sample data — run `node scan.js` to scan your own disk". Parse; `validateScan` failure on the real file → banner "scan.json is malformed: …" and stop; on the sample → same (shouldn't happen). State: `{scan, tree, stack:[levelNode], mode}`. `showLevel()`: `layoutLevel(top of stack, {mode})` → `city.render`, crumbs rebuilt (`button` per ancestor, `textContent` = name, click pops to it), top-10 `<ol>` rebuilt (`li` per entry: name, humanBytes, percent; `textContent` only), `city.flyTo` whole level. Hover cb → fill `#tip` with four `span`s via `textContent`, position at pointer, `hidden=false/true`. Click cb → if item node has children: push, `showLevel()`. Mode button toggles `log`/`linear`, label updates, `showLevel()` keeps stack. Header fields from `scan`. Empty `nodes` or `totalBytes===0` → banner "Nothing to show".
  - `style.css`: dark background, system font, header/aside as plain flex columns, tooltip absolute, `canvas{display:block;width:100%;height:100%}`.
- **Tests**: no unit tests (browser-only; `layout.js` holds the logic). Manual check list below is the gate.
- **Check**: `npm run build` → OK; `npm run dev` → open: (1) banner shows with sample, (2) hover shows path/size/%/files, (3) click a block drills in and camera moves, (4) breadcrumb returns, (5) toggle changes heights and label, (6) `grep -rn innerHTML viewer/src` → nothing. Then `node scan.js ~ --out viewer/public/scan.json` → reload → banner gone, header shows real root
- **Depends on**: T2

### T4 ✅ `c3ec702` — CI and Pages workflows
- **Covers**: FR-15, FR-16, A02, A03
- **Files**: `.github/workflows/ci.yml` (new), `.github/workflows/pages.yml` (new)
- **Mirror**: `scope.md` CI block, with the `${{ runner.temp }}` fix it proposes
- **Do**:
  - `ci.yml`: `name: CI`, `on: [push, pull_request]`, `permissions: contents: read`. Job `test`: `strategy.fail-fast: false`, matrix `os: [ubuntu-latest, macos-latest, windows-latest]`, steps checkout@v4, setup-node@v4 (`node-version: 20`, `cache: npm`), `npm ci`, `npm test`, `node scan.js . --depth 2 --out ${{ runner.temp }}/scan.json`, then `node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" ${{ runner.temp }}/scan.json` as a smoke assertion. Job `build`: ubuntu, node 22, `npm ci`, `npm run build --workspace viewer`.
  - `pages.yml`: `on: push: branches: [main]`, `permissions: {contents: read, pages: write, id-token: write}`, `concurrency: {group: pages, cancel-in-progress: true}`; job `deploy` with `environment: github-pages`: checkout, setup-node 22, `npm ci`, `npm run build --workspace viewer`, `actions/configure-pages@v5` with `enablement: true`, `actions/upload-pages-artifact@v3` (`path: viewer/dist`), `actions/deploy-pages@v4`.
- **Tests**: none locally; the PR run is the test
- **Check**: `node -e "require('yaml')"` is not available — validate with `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" .github/workflows/ci.yml` (PyYAML present on macOS python3? if not, rely on `gh workflow view` after push). PR run: 4 green checks
- **Depends on**: T1, T2

### T5 ✅ `532dc06` — README
- **Covers**: FR-17, A09 (don't commit `scan.json`)
- **Files**: `README.md` (new)
- **Mirror**: PRD §9 "Out of scope" and §14 risks become the "Left out / Known limits" sections
- **Do**: sections — one-paragraph what/why with a screenshot placeholder replaced by the Pages link once live; Quick start (`npm install`, `node scan.js [dir]`, `npm run dev`); CLI flags table; JSON contract (copy from scope); How it's drawn (treemap, log height, blocks vs buildings, loose files = empty ground); Limits (logical vs on-disk size, symlinks skipped, macOS Full Disk Access, Windows reparse points, `(other)` collapse); Tests & CI (what the matrix proves); Left out on purpose (ESLint, per-file view, on-disk size, R3F, a11y of canvas) with one-line reasons; How AI was used (pipeline in `.claude/`, where it was overridden: R3F → vanilla, `||` hack → `runner.temp`, Node 22 for Vite). Keep under ~120 lines.
- **Tests**: none
- **Check**: every command in the README executed once in a clean clone (`git clone` into scratchpad, `npm ci`, `npm test`, `npm run build`)
- **Depends on**: T1–T4

## Coverage
| PRD item | Task |
|---|---|
| FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7 | T1 |
| FR-8 | T2 (sample), T3 (fallback + banner) |
| FR-9, FR-10, FR-11, FR-13 | T2 (math), T3 (UI) |
| FR-12, FR-14 | T3 |
| FR-15 | T4 |
| FR-16 (Could) | T4 |
| FR-17 | T5 |
| NFR-1 | T1 (built-ins only), T2 (scripts) |
| NFR-2 | T2 (layout count), T3 (one mesh per item, dev log) |
| NFR-3 | T1 |
| NFR-4 | T1 |
| NFR-5 | T2 |
| A01 | T1 (symlink test) |
| A02 | T2 (vite config), T4 (permissions) |
| A03 | T2 (lockfile), T4 (`npm ci`, pinned actions), review stage `npm audit` |
| A05 | T1 (name round-trip), T2 (layout keeps text), T3 (`textContent`, grep) |
| A06 | T1 (`--out` only write; grep) |
| A08 | T2 (`validateScan`), T3 (error banner), T4 (deploy-pages from main) |
| A09 | `.gitignore` (baseline), T5 |
| A10 | T1 (EIO rethrow test) |
| §17 scan tests | T1 |
| §17 layout tests | T2 |

## Risks
| Risk | Where it bites | What to do if it does |
|---|---|---|
| Vite 8 / three r186 API mismatch (`three/addons` path, `WebGLRenderer` deprecations) | T3 build | Pin the versions the lockfile resolved; check the three migration guide for r186 |
| Windows runner: `node --test` with forward-slash paths | T4 | Paths are passed to Node, not the shell; if it fails, switch to `node --test` with no args and a `--test-name-pattern` |
| `setup-node cache: npm` on Windows needs `package-lock.json` at root | T4 | It is at root (workspaces) |
| macOS `tmpdir` symlink makes `realpath` comparisons differ | T1 tests | Compare names and sizes, not absolute paths |
| `chmod 000` ineffective on the macOS runner (runs as non-root, should be fine) | T1 | Test already skips when uid 0 |
| Pages `enablement: true` needs repo admin — `GITHUB_TOKEN` has it for the owner's repo | T4 | If it fails, enable Pages → "GitHub Actions" in repo settings once |

## Verification
```
npm ci
npm test                                       # 3 files, all pass
node scan.js . --out /tmp/scan.json && node -e "JSON.parse(require('fs').readFileSync('/tmp/scan.json'))"
node scan.js /nope; echo $?                    # 1
npm run build                                   # viewer/dist
grep -rn innerHTML viewer/src                   # no output
npm audit --omit=dev                            # no high/critical
npm run dev                                     # manual list in T3
```
Clean clone in the scratchpad: `npm ci && npm test && npm run build`. PR: 4 green jobs (test × 3, build).

## Implementation

**Branch**: `feat/disk-city` · **Base**: `main` (`024bce3`) · **Date**: 2026-10-25

| Task | Commit | Check | Lint / Types / Tests |
|---|---|---|---|
| T1 | `436c177` | ✅ `npm test`, `node scan.js .` exit 0, `/nope` exit 1 | – / – / ✅ (20 passed) |
| T2 | `7f5a426` | ✅ `npm test`, `npm run build` | – / – / ✅ (35 passed) |
| T3 | `486f6cd` | ✅ build, `grep innerHTML` empty, manual: banner, hover tooltip (4 fields), click-dive, breadcrumb back, log/linear toggle, real scan of `~/projetos` (50.9 GB, 1.53 M files, 45 s) rendered with banner gone | – / – / ✅ (35 passed) |
| T4 | `c3ec702` | ⚠️ YAML not validated locally (no PyYAML); validated by the GitHub run in `/review-work` | – / – / ✅ |
| T5 | `532dc06` | ✅ every README command run in a clean clone | – / – / ✅ |

No linter and no type checker are configured (PRD §9, plan Decisions) — the Lint/Types cells are "–", not skipped checks.

### Deviations
- **T1** — output JSON carries an extra top-level `files` count (total files) beyond the scope's contract. Additive; the viewer uses it in the header and tolerates its absence.
- **T2** — the PRD and plan artifacts (`docs/work/*.md`) went into the T2 commit instead of a separate `docs:` commit. Content unaffected.
- **T3** — a click on a *building* dives into its parent **block** (one level per click) rather than straight into the building, so the breadcrumb always has every intermediate level. The top-10 list is also clickable (not in the plan; three lines, same handler).
- **T4** — added `workflow_dispatch` to `pages.yml` so the deploy can be re-run by hand; added a JSON smoke assertion after the CI scan.
- **T5** — README screenshot is `docs/screenshot.jpg` (taken from the running viewer with the sample).

### Definition of Done
- [x] Every Must requirement meets its acceptance criteria — FR-1…FR-15, FR-17 verified above; FR-16 (Could) is wired, fires after merge.
- [x] `npm test` passes locally on macOS — 35/35. In CI on ubuntu/macos/windows — **pending the PR run** (`/review-work`).
- [x] `node scan.js .` produces valid JSON — locally and in the clean clone; on the three runners **pending the PR run**.
- [x] `npm run build --workspace viewer` succeeds — locally; CI **pending**.
- [x] Viewer opened against a real scan: hover, click-in, breadcrumb-back, toggle all work — verified in Chrome.
- [x] `viewer/public/scan.sample.json` committed and renders when `scan.json` is absent — verified (banner shown).
- [ ] Public GitHub repo with a PR whose CI run is green — next stage.
- [x] README complete per FR-17.

### Verification
Clean clone of `feat/disk-city` in the scratchpad:
```
npm ci                      → added 19 packages
npm test                    → tests 35, pass 35, fail 0, skipped 0
node scan.js . --out out/scan.json → valid JSON, totalBytes 51321319, 4 nodes
node scan.js /nope          → "Cannot read /nope: ENOENT", exit 1
npm run build               → ✓ built in 486ms
grep -rn innerHTML viewer/src → none
npm audit --omit=dev        → found 0 vulnerabilities
```

### Inherited failures
none (greenfield)
