// three.js scene for one city level. Receives the output of layoutLevel and
// reports hover/click with the layout item, nothing else.

import {
  AmbientLight, BoxGeometry, Color, DirectionalLight, Group, Mesh, MeshLambertMaterial,
  PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const PALETTE = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948',
  '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac', '#6c8ebf', '#d37295',
];

const BLOCK_THICKNESS = 0.4;
const FLY_MS = 600;
const CLICK_SLOP_PX = 5;

export function blockColor(index) {
  return PALETTE[index % PALETTE.length];
}

function buildingColor(index) {
  return new Color(blockColor(index)).lerp(new Color('#ffffff'), 0.25);
}

export function createCity(canvas) {
  const scene = new Scene();
  scene.background = new Color('#0f1218');

  const camera = new PerspectiveCamera(45, 1, 0.1, 2000);
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;

  scene.add(new AmbientLight(0xffffff, 0.7));
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(80, 140, 60);
  scene.add(sun);

  const ground = new Mesh(new PlaneGeometry(1, 1), new MeshLambertMaterial({ color: '#1a1f2a' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

  let group = new Group();
  scene.add(group);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let pointerDirty = false;
  let hovered = null;
  let hoverCb = () => {};
  let clickCb = () => {};
  let lastClient = { x: 0, y: 0 };
  let downAt = null;

  let fly = null; // { fromPos, toPos, fromTarget, toTarget, start }

  function resize() {
    const parent = canvas.parentElement;
    const w = parent.clientWidth || 1;
    const h = parent.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);
  resize();

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    scene.remove(g);
  }

  function setHover(mesh) {
    if (hovered === mesh) return;
    if (hovered) hovered.material.emissive.set(0x000000);
    hovered = mesh;
    if (hovered) hovered.material.emissive.set(0x333333);
    canvas.style.cursor = hovered && hovered.userData.item.node.children ? 'pointer' : 'default';
    hoverCb(hovered ? hovered.userData.item : null, lastClient);
  }

  function castPointer() {
    pointerDirty = false;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(group.children, false);
    const hit = hits.find((h) => h.object.userData.item && !h.object.userData.isBlock);
    setHover(hit ? hit.object : null);
  }

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    lastClient = { x: e.clientX - r.left, y: e.clientY - r.top };
    pointerDirty = true;
  });
  canvas.addEventListener('pointerleave', () => setHover(null));
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > CLICK_SLOP_PX) return;
    castPointer();
    if (hovered) clickCb(hovered.userData.item);
  });

  function render(layout) {
    disposeGroup(group);
    group = new Group();
    const half = layout.ground / 2;
    ground.scale.set(layout.ground * 1.3, layout.ground * 1.3, 1);

    for (const b of layout.blocks) {
      const w = b.x1 - b.x0;
      const d = b.y1 - b.y0;
      const mesh = new Mesh(
        new BoxGeometry(w, BLOCK_THICKNESS, d),
        new MeshLambertMaterial({ color: blockColor(b.blockIndex) }),
      );
      mesh.position.set(b.x0 + w / 2 - half, BLOCK_THICKNESS / 2, b.y0 + d / 2 - half);
      mesh.userData = { item: b, isBlock: true };
      group.add(mesh);
    }
    for (const b of layout.buildings) {
      const w = Math.max(0.05, b.x1 - b.x0 - 0.3);
      const d = Math.max(0.05, b.y1 - b.y0 - 0.3);
      const mesh = new Mesh(
        new BoxGeometry(w, b.height, d),
        new MeshLambertMaterial({ color: buildingColor(b.blockIndex) }),
      );
      mesh.position.set(b.x0 + (b.x1 - b.x0) / 2 - half, BLOCK_THICKNESS + b.height / 2, b.y0 + (b.y1 - b.y0) / 2 - half);
      mesh.userData = { item: b, isBlock: false };
      group.add(mesh);
    }
    scene.add(group);
    setHover(null);
    if (import.meta.env.DEV) console.log(`[disk-city] ${group.children.length} meshes`);
  }

  /** Fly the camera to frame a rect in ground coordinates (or the whole level when omitted). */
  function flyTo(rect, ground) {
    const half = ground / 2;
    const cx = rect ? (rect.x0 + rect.x1) / 2 - half : 0;
    const cz = rect ? (rect.y0 + rect.y1) / 2 - half : 0;
    const size = rect ? Math.max(rect.x1 - rect.x0, rect.y1 - rect.y0) : ground;
    const dist = size * 1.35;
    fly = {
      fromPos: camera.position.clone(),
      toPos: new Vector3(cx + dist * 0.55, dist * 0.9, cz + dist * 0.95),
      fromTarget: controls.target.clone(),
      toTarget: new Vector3(cx, 0, cz),
      start: performance.now(),
    };
  }

  function jumpTo(ground) {
    camera.position.set(ground * 0.75, ground * 1.2, ground * 1.3);
    controls.target.set(0, 0, 0);
  }

  const easeOut = (t) => 1 - (1 - t) ** 3;

  let raf = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (fly) {
      const t = Math.min(1, (now - fly.start) / FLY_MS);
      const k = easeOut(t);
      camera.position.lerpVectors(fly.fromPos, fly.toPos, k);
      controls.target.lerpVectors(fly.fromTarget, fly.toTarget, k);
      if (t >= 1) fly = null;
    }
    controls.update();
    if (pointerDirty) castPointer();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);

  return {
    render,
    flyTo,
    jumpTo,
    onHover(cb) { hoverCb = cb; },
    onClick(cb) { clickCb = cb; },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      disposeGroup(group);
      controls.dispose();
      renderer.dispose();
    },
  };
}
