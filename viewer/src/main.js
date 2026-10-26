import { createCity, blockColor } from './city.js';
import { humanBytes, percent, formatInt } from './format.js';
import { buildTree, layoutLevel, topN, validateScan } from './layout.js';

const GROUND = 100;
const $ = (id) => document.getElementById(id);

const els = {
  banner: $('banner'),
  crumbs: $('crumbs'),
  mode: $('mode'),
  tip: $('tip'),
  tipPath: $('tip-path'),
  tipSize: $('tip-size'),
  tipPct: $('tip-pct'),
  tipFiles: $('tip-files'),
  topList: document.querySelector('#top ol'),
  metaRoot: $('meta-root'),
  metaTotal: $('meta-total'),
  metaScanned: $('meta-scanned'),
  metaSkipped: $('meta-skipped'),
};

function showBanner(text, { error = false, code } = {}) {
  els.banner.replaceChildren();
  els.banner.append(text);
  if (code) {
    const c = document.createElement('code');
    c.textContent = code;
    els.banner.append(' ', c);
  }
  els.banner.classList.toggle('error', error);
  els.banner.hidden = false;
}

/**
 * Try the real scan first; fall back to the sample when it's missing.
 * Some static servers answer unknown paths with index.html (200, text/html),
 * so "missing" means non-OK *or* non-JSON.
 */
async function loadScan() {
  const real = await fetch('./public/scan.json').catch(() => null);
  if (real && real.ok && (real.headers.get('content-type') ?? '').includes('json')) {
    return { scan: validateScan(await real.json()), sample: false };
  }
  const sample = await fetch('./public/scan.sample.json');
  if (!sample.ok) throw new TypeError(`scan.sample.json: HTTP ${sample.status}`);
  return { scan: validateScan(await sample.json()), sample: true };
}

function renderHeader(scan) {
  els.metaRoot.textContent = scan.root;
  els.metaRoot.title = scan.root;
  els.metaTotal.textContent = `${humanBytes(scan.totalBytes)}${scan.files != null ? ` · ${formatInt(scan.files)} files` : ''}`;
  els.metaScanned.textContent = `${new Date(scan.scannedAt).toLocaleString()} · ${scan.platform ?? ''}`.trim();
  els.metaSkipped.textContent = `${formatInt(scan.skipped ?? 0)} entries`;
}

function start({ scan, sample }) {
  if (sample) {
    showBanner('Sample data — run', { code: 'node scan.js' });
    els.banner.append(' to scan your own disk, then reload.');
  }
  renderHeader(scan);

  if (!scan.nodes.length || scan.totalBytes === 0) {
    showBanner('Nothing to show: the scan found no directories with bytes in them.');
    return;
  }

  const tree = buildTree(scan);
  const city = createCity($('c'));
  const state = { stack: [tree], mode: 'log' };
  const current = () => state.stack[state.stack.length - 1];

  function renderCrumbs() {
    els.crumbs.replaceChildren();
    state.stack.forEach((node, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '›';
        els.crumbs.append(sep);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = node.data.name;
      if (i === state.stack.length - 1) b.setAttribute('aria-current', 'page');
      else b.addEventListener('click', () => { state.stack.length = i + 1; showLevel(); });
      els.crumbs.append(b);
    });
  }

  function renderTop(level) {
    els.topList.replaceChildren();
    const blocks = level.children ?? [];
    for (const entry of topN(level, 10)) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      const swatch = document.createElement('i');
      swatch.className = 'swatch';
      swatch.style.background = blockColor(blocks.indexOf(entry.node));
      name.append(swatch, entry.node.data.name);
      name.title = entry.path;
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = `${humanBytes(entry.bytes)} · ${percent(entry.bytes, scan.totalBytes)} · ${formatInt(entry.files)} files`;
      li.append(name, size);
      if (entry.node.children) {
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => { state.stack.push(entry.node); showLevel(); });
      }
      els.topList.append(li);
    }
  }

  function showLevel({ fly = true } = {}) {
    const level = current();
    const layout = layoutLevel(level, { ground: GROUND, mode: state.mode });
    city.render(layout);
    renderCrumbs();
    renderTop(level);
    if (fly) city.flyTo(null, GROUND);
  }

  city.onHover((item, at) => {
    if (!item) { els.tip.hidden = true; return; }
    const { bytes, files } = item.node.data;
    els.tipPath.textContent = item.path;
    els.tipSize.textContent = humanBytes(bytes);
    els.tipPct.textContent = `${percent(bytes, scan.totalBytes)} of total`;
    els.tipFiles.textContent = `${formatInt(files)} files${item.node.children ? '' : ' · no subfolders'}`;
    els.tip.hidden = false;
    const main = els.tip.parentElement;
    const x = Math.min(at.x + 14, main.clientWidth - els.tip.offsetWidth - 8);
    const y = Math.min(at.y + 14, main.clientHeight - els.tip.offsetHeight - 8);
    els.tip.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
  });

  city.onClick((item) => {
    // Walk up to the block this building belongs to when the building is a leaf.
    let target = item.node;
    while (target && target !== current() && !target.children) target = target.parent;
    if (!target || target === current() || !target.children) return;
    // Only dive one level per click: the block directly under the current level.
    while (target.parent && target.parent !== current()) target = target.parent;
    state.stack.push(target);
    showLevel();
  });

  els.mode.addEventListener('click', () => {
    state.mode = state.mode === 'log' ? 'linear' : 'log';
    els.mode.textContent = `height: ${state.mode}`;
    showLevel({ fly: false });
  });

  city.jumpTo(GROUND);
  showLevel();
}

loadScan().then(start).catch((err) => {
  console.error(err);
  showBanner(`Could not load the scan: ${err.message}`, { error: true });
});
