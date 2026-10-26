# PRD: Disk City

**Source**: `scope.md` · **Type**: feature (greenfield) · **Status**: READY · **Approval**: skipped (--auto) · **Standards**: owasp-top10-2025 · **Date**: 2026-10-25

## 1. Overview
Disk City is a small CLI + web viewer: `node scan.js` walks a folder and writes a size tree as JSON; a Vite app renders that tree as a 3D city where every directory is a building whose footprint is its share of bytes and whose height is `log(bytes)`. It is the deliverable for a one-hour "build any small app with AI" brief (pasted in the conversation): JavaScript only, public GitHub repo, a GitHub Actions workflow that runs on push/PR. The repo was empty at start; a baseline commit (`024bce3`) with the pipeline scaffold, `scope.md` and `.gitignore` was made before this PRD.

## 2. Problem
"Where did my disk go?" is answered today by `du`-style lists or desktop tools (DaisyDisk, WinDirStat) that are platform-specific. A cross-platform scanner plus a browser viewer lets anyone open a folder's size distribution as a spatial picture, with the same code on Linux, macOS and Windows. The evaluators also need to see how the repo is set up, how CI is wired and what was consciously left out.

## 3. Goals & Success Metrics
| Goal | Metric | Target | How it's measured |
|---|---|---|---|
| G1 Scanner works on all three OSes | CI matrix job status | green on ubuntu, macos, windows | `ci.yml` test job runs `npm test` and a real `node scan.js .` on each runner |
| G2 Viewer renders a city from a scan | Build + manual open | `npm run build --workspace viewer` succeeds; sample scan renders with hover, drill-down, back | CI build job; local `npm run dev --workspace viewer` check |
| G3 Repo reads as "done" to a stranger | README covers run, test, limits, left-out | All four present | Review of README |
| G4 CI wired by default | Workflow triggers | runs on `push` and `pull_request` | Workflow file + a run on the PR |

**Non-goals**: on-disk (allocated) size, per-file view, deleting files from the UI, persistence or accounts, mobile layout, shadows/post-processing.

## 4. Users & Personas
- **Developer on their own machine** — runs `npx`/`node scan.js`, opens the viewer, finds the big folders. Can do after: see a 3D treemap of their home dir and drill into it.
- **Evaluator of the brief** — clones the repo, reads README, checks CI is green, opens the sample. Can do after: judge choices, delivery quality and what was left out without asking.

## 5. User Stories
- **US-1**: As a developer, I want to scan a folder from the terminal on any OS, so that I get a JSON tree of directory sizes without the scan hanging or crashing on protected folders.
- **US-2**: As a developer, I want to see that tree as a 3D city, so that big folders are visually obvious.
- **US-3**: As a developer, I want to hover and click into blocks, so that I can find the exact path and size of what's taking space.
- **US-4**: As an evaluator, I want CI proving the scanner on Linux/macOS/Windows, so that the cross-platform claim is tested, not stated.
- **US-5**: As an evaluator, I want a README that explains what was built, how to run it and what was left out, so that I can assess judgment under the time box.

## 6. User Flows
**Main**: `npm install` → `node scan.js ~/some/dir` → stderr shows progress every 10k files → writes `viewer/public/scan.json` and prints a one-line summary → `npm run dev --workspace viewer` → browser shows the city, side panel lists top-10 folders → hover shows tooltip (path, human size, % of total, files) → click a block: camera flies in, treemap re-laid on its children, breadcrumb appears → click a breadcrumb to go back → toggle linear/log height.

**Alternate**: no `scan.json` present → viewer falls back to `scan.sample.json` and shows a banner "sample data — run `node scan.js` to scan your disk". Empty tree (0 bytes) → viewer shows "nothing to show" instead of an empty canvas.

**Errors**: unreadable entries → counted in `skipped`, shown in the viewer header ("1 203 entries skipped"). Target dir doesn't exist → scanner exits 1 with a clear message. Invalid flag value (`--depth abc`) → exits 1 with usage.

## 7. Functional Requirements
| ID | Requirement | Priority | Story | Acceptance criteria |
|---|---|---|---|---|
| FR-1 | `scan.js` accepts `[dir] [--depth N] [--min F] [--out PATH]`; defaults `os.homedir()`, 3, 0.001, `viewer/public/scan.json` | Must | US-1 | Given no args, when run, then it scans the home dir and writes the default path. Given `--depth abc`, then exit code 1 and usage on stderr |
| FR-2 | Output follows the JSON contract: `root, platform, scannedAt, totalBytes, skipped, nodes[]` with nodes `{name, bytes, files, children}`; `name` only, never full paths | Must | US-1 | Given a fixture tree, when scanned, then output parses and every key is present with the right type; no node `name` contains a path separator |
| FR-3 | Walk uses `readdir({withFileTypes:true})`, `path.join` only, skips symlinks/reparse points (`dirent.isSymbolicLink()`) | Must | US-1 | Given a fixture with a symlink to a large dir, then `totalBytes` excludes it (test skipped on Windows if symlink creation throws EPERM) |
| FR-4 | `EACCES, EPERM, EBUSY, ENOENT, ELOOP` per entry are caught, counted in `skipped`, walk continues | Must | US-1 | Given a `chmod 000` dir in the fixture (POSIX only), then scan resolves, `skipped ≥ 1`, sibling sizes are still counted |
| FR-5 | Depth capped at `--depth`; beyond it, bytes/files are still aggregated into the parent | Must | US-1 | Given a tree deeper than `--depth`, then `totalBytes` equals the full tree size and no node has depth > N |
| FR-6 | Nodes under `--min` fraction of `totalBytes` are collapsed into a single `(other)` sibling per parent; sums preserved | Must | US-1 | Given many tiny dirs, then parent `bytes` equals the sum of its children incl. `(other)` and `(other).bytes` equals the sum of the collapsed ones |
| FR-7 | Progress to stderr every 10 000 files; final summary line on completion | Should | US-1 | Given a fixture > 10k files is impractical; verified by unit-testing the progress callback threshold |
| FR-8 | Viewer loads `scan.json`, falls back to `scan.sample.json` with a visible banner | Must | US-2 | Given no `scan.json`, then the sample renders and the banner is shown |
| FR-9 | Treemap layout via `d3.hierarchy` + `d3.treemap().tile(treemapSquarify)` on a fixed ground; top-level dirs are blocks (one color each), children are buildings inside | Must | US-2 | Given the sample, then the canvas shows ≥ 1 block per top-level node and buildings inside each |
| FR-10 | Height = normalized `log(bytes)` by default; toggle to linear | Must | US-2 | Given the toggle is clicked, then heights change and the toggle label reflects the mode |
| FR-11 | Hover tooltip: full path (rebuilt from tree), human-readable size, % of total, file count | Must | US-3 | Given the pointer is over a building, then a tooltip shows those four values; leaving hides it |
| FR-12 | Click a block: camera flies to it, treemap re-laid on its children; breadcrumb navigates back up | Must | US-3 | Given a click on a node with children, then the scene shows only its children and the breadcrumb shows the path; clicking a crumb restores that level |
| FR-13 | Side panel lists top-10 folders of the current level by bytes | Must | US-2 | Given a level, then the panel lists ≤ 10 entries sorted desc with human sizes |
| FR-14 | Header shows root, total size, scanned-at, skipped count | Should | US-3 | Values from the JSON are displayed |
| FR-15 | CI workflow on `push` and `pull_request`: test job on ubuntu/macos/windows (`npm ci`, `npm test`, `node scan.js . --out ${{ runner.temp }}/scan.json`), build job on ubuntu (`npm ci`, `npm run build --workspace viewer`) | Must | US-4 | Workflow file exists with those triggers and jobs; the PR run is green on all four jobs |
| FR-16 | Deploy `viewer/dist` (built with the sample) to GitHub Pages on push to `main` | Could | US-5 | Pages workflow exists; live link in README once merged |
| FR-17 | README: what it is, how to run scanner and viewer, JSON contract, limits (logical vs on-disk size, Full Disk Access on macOS), what was left out and why, how AI was used | Must | US-5 | Each section present |

## 8. Non-Functional Requirements
| ID | Category | Requirement | Acceptance criteria |
|---|---|---|---|
| NFR-1 | Portability | Scanner: Node ≥ 20 built-ins only (`fs/promises`, `path`, `os`, `process`). npm scripts are plain `node …`, no shell operators | `package.json` has no `&&`, `rm -rf`, or redirects; scanner imports only built-ins |
| NFR-2 | Performance | Viewer stays under ~1 000 meshes for a depth-3 / 0.1% scan; one `Mesh` per building, no shadows | Sample scan renders at interactive frame rate; mesh count logged in dev ≤ 1 000 |
| NFR-3 | Reliability | Scanner never throws on a permission error inside the tree; exits non-zero only for bad args or an unreadable root | Covered by FR-4 test and a bad-root test |
| NFR-4 | Portability (tests) | Tests use `fs.mkdtemp` under `os.tmpdir()`, clean up after, and `test.skip` with a message where the OS can't do the thing (symlink/chmod on Windows) | `npm test` green on the three CI runners |
| NFR-5 | Simplicity | Viewer is vanilla JS (ESM) + `three` + `d3-hierarchy`, bundled by Vite. No React, no TypeScript, no CSS framework | Dependency list of `viewer/package.json` is exactly those |

## 9. Out of Scope
- On-disk / allocated size (APFS/NTFS compression, sparse files) — needs platform syscalls; README notes the difference.
- Per-file nodes — depth-3 directory tree is the contract; files are only counted.
- Deleting or opening files from the viewer — write actions are out of a one-hour toy.
- ESLint / Prettier — nothing to enforce yet in a 3-file project; CI's cross-OS test matrix is the quality gate. Recorded in README "left out".
- Persisting multiple scans, comparing scans, auth, backend — none exist; the app is static.
- Accessibility pass for the 3D canvas — the side panel and breadcrumb are plain DOM and keyboard-reachable; the canvas itself is not.

## 10. Definition of Done
- [ ] Every Must requirement meets its acceptance criteria
- [ ] `npm test` passes locally on macOS and in CI on ubuntu, macos, windows
- [ ] `node scan.js .` on the repo itself produces a valid `scan.json` on all three runners
- [ ] `npm run build --workspace viewer` succeeds in CI
- [ ] Viewer opened locally against a real home-dir scan: hover, click-in, breadcrumb-back, log/linear toggle all work
- [ ] `viewer/public/scan.sample.json` committed and renders when `scan.json` is absent
- [ ] Public GitHub repo with a PR whose CI run is green
- [ ] README complete per FR-17

## 11. Technical Context
**Stack & areas affected**: Node 20+ (local: v23.11.0, npm 11.12.1). Greenfield: root package (`scan.js`, `scan.test.js`) with an npm workspace `viewer/` (Vite 6, `three` ^0.17x, `d3-hierarchy` ^3). GitHub Actions. Nothing existing is touched.

**Conventions** (all PROPOSED — empty repo):
- ESM everywhere: `"type": "module"` in both `package.json`s; `import … from 'node:fs/promises'` with the `node:` prefix.
- Scanner is one file, pure functions exported for tests (`scanDir`, `collapseSmall`, `parseArgs`) plus a `main()` guarded by `import.meta.url === pathToFileURL(process.argv[1]).href` so the test can import without running.
- Errors: per-entry errors are caught by code in an allow-set and counted; anything else rethrows. CLI errors print to stderr and `process.exit(1)`.
- Tests: `node:test` + `node:assert/strict`, one `describe` per exported function, fixtures built in `beforeEach` with `fs.mkdtemp`, removed in `afterEach` with `fs.rm(dir, {recursive:true, force:true})`.
- Viewer: `viewer/src/main.js` (bootstrap + DOM), `viewer/src/layout.js` (pure: JSON → treemap rects, testable without a browser), `viewer/src/city.js` (three scene), `viewer/src/format.js` (human bytes). No classes unless three needs them.
- Naming: kebab-case files, camelCase functions, `SCREAMING_CASE` for module constants.
- Commits: conventional prefixes (`feat:`, `test:`, `ci:`, `docs:`), one task per commit.

**Data & contracts**: The scanner→viewer JSON in `scope.md` is the only contract. `nodes` is the children of `root` (root itself is not a node). `bytes` of a node includes everything beneath it regardless of depth cap. `(other)` is a synthetic node with `children: []`. No migrations.

**Constraints**: scanner has zero npm dependencies; no build step for it; no shell operators in npm scripts; `path.join` only; skip symlinks; never follow reparse points. Viewer must work from `file`-less static hosting (Pages) → fetch relative paths, `base: './'` in Vite config.

**Dependencies**: `vite`, `three`, `d3-hierarchy` from the npm registry; GitHub Actions runners. No external services.

## 12. Security & Compliance

### OWASP Top 10:2025

| # | Category | Applies? | Requirement | How it's tested |
|---|---|---|---|---|
| A01 | Broken Access Control | No | Local CLI reading files the OS user already can read; no multi-user boundary. Scanner must not escalate: it never follows symlinks, so it cannot be steered outside the target tree | FR-3 symlink test |
| A02 | Security Misconfiguration | Yes | CI workflow uses least privilege: `permissions: contents: read` on test/build; Pages job only gets `pages: write, id-token: write`. Vite dev server not exposed (`host` default localhost) | Review of `ci.yml` permissions block; `vite.config.js` has no `server.host` |
| A03 | Software Supply Chain Failures | Yes | Actions pinned to major tags (`actions/checkout@v4`, `setup-node@v4`); `package-lock.json` committed; `npm ci` (not `install`) in CI; scanner has zero dependencies | `npm ci` in CI fails on a lock mismatch; `npm audit --omit=dev` run once at review |
| A04 | Cryptographic Failures | No | No secrets, no transport, no storage of sensitive data | N/A |
| A05 | Injection | Yes | Directory names from disk are rendered in the DOM (tooltip, panel, breadcrumb) and must be inserted as text (`textContent`), never `innerHTML`. CLI args are parsed as values, never passed to a shell | Fixture dir named `<img src=x onerror=alert(1)>` renders literally in the layout test (name preserved as text); grep: no `innerHTML` in `viewer/src` |
| A06 | Insecure Design | Yes | The scanner is read-only by design: no `unlink`, `rm`, `rename`, `write` other than `--out`. `--out` is written with `writeFile`, not appended to or executed | grep for `rm`/`unlink` in `scan.js`; `--out` test writes to the given path only |
| A07 | Authentication Failures | No | No users | N/A |
| A08 | Software or Data Integrity Failures | Yes | Viewer validates the JSON shape before layout (`nodes` array, numeric `totalBytes`); malformed file → error banner, not a crash. Pages deploys only from `main` via the official `actions/deploy-pages` | Layout test with malformed input throws a typed error; workflow review |
| A09 | Security Logging and Alerting Failures | Yes | Scanner logs only counts and the root path to stderr; never file contents. Scan output contains directory names (may be personal) — README tells users not to commit `scan.json`; it is gitignored | `.gitignore` contains `viewer/public/scan.json`; review of stderr output |
| A10 | Mishandling of Exceptional Conditions | Yes | Only the listed errno codes are swallowed; anything else (e.g. ENOMEM, programming errors) propagates. Progress and summary never hide `skipped` | FR-4 test; a test that a non-listed error from a stubbed `readdir` rethrows |

**Existing controls at risk**: None identified (greenfield).
**Secrets / PII touched**: No secrets. `scan.json` contains the user's directory names and root path — stays local, gitignored; `scan.sample.json` is hand-made synthetic data, not a real scan.

## 13. Do / Don't
- Do: keep `scan.js` dependency-free and runnable with plain `node scan.js`.
- Do: skip symlinks before `stat` — stat follows them.
- Do: insert all names via `textContent`.
- Don't: use `&&`, `||`, `rm -rf` or redirects in npm scripts — breaks in `cmd.exe`.
- Don't: build full paths into the JSON — separators differ per OS; rebuild in the viewer.
- Don't: let the fixture tests depend on a specific `tmpdir` layout — macOS `tmpdir` is a symlink itself (`/var` → `/private/var`); use `fs.realpath` where comparisons matter.
- Don't: add React, TypeScript or a CSS framework — the user asked for as much plain JavaScript as possible.

## 14. Risks & Caveats
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Windows runner can't create symlinks (no dev mode) | High | Symlink test can't run there | `test.skip` with message when `symlink` throws EPERM; the other tests still prove the walk |
| `chmod 000` has no effect when running as root (some CI containers) | Low (GitHub runners aren't root) | Unreadable-dir test wouldn't fail as expected | Assert `skipped ≥ 1` only when `process.getuid?.() !== 0`, else skip with message |
| `node scan.js .` in CI hits `node_modules` → fine but slow | Low | Longer CI | Acceptable; repo is small |
| Home dir scan on macOS without Full Disk Access skips `~/Library` subtrees | Certain | Lower totals | Counted in `skipped`, README explains |
| Three.js version drift breaks `OrbitControls` import path | Low | Build fails | Pin minor version in lockfile; import from `three/addons/controls/OrbitControls.js` |
| Pages not enabled on the repo | Medium | Deploy job fails | `actions/configure-pages@v5` with `enablement: true`; FR-16 is Could |

## 15. Assumptions
| Assumption | Basis | If wrong |
|---|---|---|
| Viewer is vanilla Three.js, not React Three Fiber | User in conversation: "quanto mais JavaScript puro tiver, melhor"; overrides `scope.md` stack line | Rewrite viewer in R3F (~30 min) |
| GitHub repo is named `disk-city`, public, owner `Marujinho` | `scope.md` layout uses `disk-city/`; `gh` is logged in as Marujinho | Rename repo |
| `main` is the base branch; feature work on `feat/disk-city` and merged via PR | CLAUDE.md `base_branch` detection → repo default | Change PR target |
| Root `package.json` uses npm workspaces so one `npm ci` installs the viewer | Scope's CI uses `--workspace viewer` | Add a second `npm ci` step in `viewer/` |
| No ESLint in the time box | Scope doesn't list one; 3 source files | Add `eslint` flat config later (10 min) |
| `(other)` collapse is applied per parent, with threshold relative to `totalBytes` (not the parent) | Scope: "nodes under 0.1% of total" | Change threshold base to parent bytes |
| Vite is acceptable as the single build-time dependency of the viewer | Scope lists Vite; needed to bundle `three` for Pages | Use import maps + CDN and drop the build job |

## 16. Open Questions
None.

## 17. Tests
`scan.test.js` (node:test):
- `parseArgs`: defaults; `--depth 2 --min 0.05 --out x.json dir`; invalid number → throws.
- `scanDir`: fixture with known file sizes → `totalBytes` exact, `files` exact; depth cap aggregates deeper bytes; symlink skipped (skip on Windows EPERM); unreadable dir → `skipped ≥ 1`, no throw (skip on Windows / root); non-listed error from an injected `readdir` rethrows (A10); node names never contain `path.sep`; a dir named `<img src=x onerror=alert(1)>` survives as literal text (A05 input side).
- `collapseSmall`: small siblings merged into `(other)`, sums preserved, nothing collapsed when all above threshold.
- `main` writes `--out` and prints a summary; bad root → exit code 1 (spawn `node scan.js /nonexistent`).

`viewer/src/layout.test.js` (node:test, pure):
- JSON → rects: every node gets `x0,y0,x1,y1,height`, areas proportional to bytes, log vs linear height modes, path rebuilt with `/` from tree; malformed input throws (A08).

Fixtures: built in tests with `mkdtemp`; none committed. `viewer/public/scan.sample.json`: synthetic, committed.

## 18. Verification
```
npm ci
npm test                                  # root: node --test scan.test.js viewer/src/layout.test.js
node scan.js . --out /tmp/scan.json       # exit 0, valid JSON
node scan.js /definitely/missing          # exit 1
npm run build --workspace viewer
npm run dev --workspace viewer            # open, check hover / click / breadcrumb / toggle / banner
grep -rn innerHTML viewer/src             # no matches
```
E2E: `node scan.js ~ --out viewer/public/scan.json`, open the viewer, confirm the top-10 panel matches `du -sh ~/* | sort -h | tail` within rounding.

## 19. Release Plan
- **Branch**: new `feat/disk-city` off `main` (baseline `024bce3`)
- **Milestones**: single release; Pages deploy (FR-16) only after merge to `main`
- **Migrations / ordering**: none
- **Config / secrets**: none. Pages uses the workflow's `GITHUB_TOKEN`
- **Feature flag**: none
- **Rollout**: open PR → CI green on 4 jobs → merge (human gate) → Pages deploys
- **Rollback**: revert the merge commit; Pages redeploys the previous `main`
- **Post-launch**: G1/G4 checked on the PR's CI run; G2 by opening the Pages URL; G3 by README review
