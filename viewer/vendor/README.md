# Vendored libraries

Copied verbatim from npm so the viewer runs with no install and no build step.
The browser resolves `three` through the import map in `../index.html`.
`layout.js` imports d3-hierarchy by relative path, so `node --test` needs no install either.

| Library | Version | Copied from the npm package | License |
|---|---|---|---|
| three | 0.186.1 | `build/three.module.js`, `build/three.core.js`, `examples/jsm/controls/OrbitControls.js` | MIT, `three/LICENSE` |
| d3-hierarchy | 3.1.2 | `src/` | ISC, `d3-hierarchy/LICENSE` |

To upgrade, copy the same files from the new version and update this table.
