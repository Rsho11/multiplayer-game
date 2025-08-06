// ES-module imports from CDN (no bundler)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.module.js';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/jsm/loaders/FBXLoader.js';

const debug = document.getElementById('debug');
const overlay = document.getElementById('overlay');
const wheel = document.getElementById('wheel');
const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const colorHexEl = document.getElementById('colorHex');
const previewWrap = document.getElementById('previewWrap');

const socket = window.io();

// ----------------- Main Game Scene -----------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e16);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 6, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// lights
scene.add(new THREE.AmbientLight(0xffffff, 0.25));
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemi.position.set(0, 20, 0); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(5, 10, 7); dir.castShadow = true; scene.add(dir);

// room
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x2a2f45, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor'; scene.add(floor);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e2233 });
const H = 4, T = 0.4, L = 28;
const w1 = new THREE.Mesh(new THREE.BoxGeometry(L, H, T), wallMat); w1.position.set(0, H/2, -L/2); scene.add(w1);
const w2 = w1.clone(); w2.position.set(0, H/2,  L/2); scene.add(w2);
const w3 = new THREE.Mesh(new THREE.BoxGeometry(T, H, L), wallMat); w3.position.set(-L/2, H/2, 0); scene.add(w3);
const w4 = w3.clone(); w4.position.set( L/2, H/2, 0); scene.add(w4);

// helpers
const loader = new FBXLoader();
const players = new Map(); // id -> Group
let myId = null;
let targetPos = null;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const cameraOffset = new THREE.Vector3(0, 6, 10);

// tint materials robustly
// --- REPLACE your existing applyColor with this ---
function applyColor(root, hex, { forceFlat = false } = {}) {
  const c = new THREE.Color(hex);

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];

    for (let i = 0; i < mats.length; i++) {
      let m = mats[i];

      if (forceFlat) {
        // In the preview we want a guaranteed, vivid tint:
        m = mats[i] = new THREE.MeshStandardMaterial({
          color: c.clone(),
          metalness: 0.1,
          roughness: 0.8
        });
      } else {
        // In-game, try to tint existing materials:
        if (m.color) m.color.copy(c);
        if (m.emissive) m.emissive.copy(c).multiplyScalar(0.12);
        if ('vertexColors' in m && m.vertexColors) m.vertexColors = false;
        if (m.map) m.map = null; // drop texture if it fights the tint
      }

      m.needsUpdate = true;
    }
  });
}


function makeNameTag(text) {
  const padX = 12, padY = 6;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '700 34px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = 50 + padY * 2;
  ctx.canvas.width = w; ctx.canvas.height = h;

  // rounded bubble
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(1,1,w-2,h-2,10); ctx.fill(); }
  else ctx.fillRect(1,1,w-2,h-2);

  ctx.fillStyle = '#e2e8f0';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = '700 34px system-ui, sans-serif';
  ctx.fillText(text, w/2, h/2);

  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w/100, h/100, 1);
  sprite.position.set(0, 2.0, 0);
  return sprite;
}

function spawnPlayer(id, pos, name, color, isLocal = false) {
  const root = new THREE.Group();
  root.position.set(pos.x, pos.y, pos.z);
  scene.add(root);
  players.set(id, root);

  // FBX
  loader.load('/models/player.fbx', (fbx) => {
    const box = new THREE.Box3().setFromObject(fbx);
    const size = new THREE.Vector3(); box.getSize(size);
    const s = 1.7 / Math.max(size.y || 0.001, 0.001);
    fbx.scale.setScalar(s);
    const scaled = new THREE.Box3().setFromObject(fbx);
    fbx.position.y -= scaled.min.y;
    fbx.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });

    if (color) applyColor(fbx, color);
    root.add(fbx);
  }, undefined, () => {
    const g = new THREE.BoxGeometry(0.6, 1, 0.6);
    const m = new THREE.MeshStandardMaterial({ color: color || '#4ADE80' });
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; root.add(mesh);
  });

  if (name) root.add(makeNameTag(name));

  if (isLocal) {
    addEventListener('click', (e) => {
      mouse.x = (e.clientX / innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObjects([floor], false);
      if (hit.length) { targetPos = hit[0].point.clone(); targetPos.y = 0; }
    });
  }
}

function updateLocal(dt) {
  if (!myId || !targetPos) return;
  const me = players.get(myId);
  if (!me) return;
  const dir = new THREE.Vector3().subVectors(targetPos, me.position);
  const d = dir.length();
  if (d > 0.02) {
    dir.normalize();
    me.position.addScaledVector(dir, 3.0 * dt);
    me.rotation.y = Math.atan2(dir.x, dir.z);
    socket.emit('move', { x: me.position.x, y: me.position.y, z: me.position.z });
  }
}

function updateCamera(dt) {
  if (!myId) return;
  const me = players.get(myId); if (!me) return;
  const desired = me.position.clone().add(cameraOffset);
  camera.position.lerp(desired, 0.12);
  camera.lookAt(me.position.x, me.position.y + 1.2, me.position.z);
}

// resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ----------------- Character Creation: Preview Scene -----------------
let pScene, pCamera, pRenderer, pRoot, pModel;
let isDragging = false, lastX = 0;
let selectedColor = '#4ADE80';

function initPreview() {
  pScene = new THREE.Scene();
  pScene.background = null; // let CSS bg show through

  pCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  pCamera.position.set(0, 1.6, 4);

  pRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  pRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  previewWrap.appendChild(pRenderer.domElement);

  const amb = new THREE.AmbientLight(0xffffff, 0.35); pScene.add(amb);
  const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(3, 4, 5); pScene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-3, 3, -3); pScene.add(rim);

  pRoot = new THREE.Group();
  pScene.add(pRoot);

// --- In initPreview(), REPLACE the FBX load callback with this ---
const fbxLoader = new FBXLoader();
fbxLoader.load('/models/player.fbx', (fbx) => {
  // autoscale ~1.7m tall and lift to y=0
  const box = new THREE.Box3().setFromObject(fbx);
  const size = new THREE.Vector3(); box.getSize(size);
  const s = 1.7 / Math.max(size.y || 0.001, 0.001);
  fbx.scale.setScalar(s);

  // ensure meshes cast/receive, then tint (force flat in preview)
  fbx.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  applyColor(fbx, selectedColor, { forceFlat: true });

  pModel = fbx;
  pRoot.add(pModel);

  // Center and frame the model in the preview
  framePreview(pRoot);
}, undefined, () => {
  // Fallback cube
  const g = new THREE.BoxGeometry(0.6, 1, 0.6);
  const m = new THREE.MeshStandardMaterial({ color: selectedColor });
  pModel = new THREE.Mesh(g, m);
  pRoot.add(pModel);
  framePreview(pRoot);
});


  // events
  const onDown = (e) => { isDragging = true; lastX = e.clientX || e.touches?.[0]?.clientX || 0; };
  const onMove = (e) => {
    if (!isDragging) return;
    const x = e.clientX || e.touches?.[0]?.clientX || 0;
    const dx = x - lastX; lastX = x;
    pRoot.rotation.y -= dx * 0.01; // rotate left/right
  };
  const onUp = () => { isDragging = false; };

  previewWrap.addEventListener('mousedown', onDown);
  previewWrap.addEventListener('mousemove', onMove);
  addEventListener('mouseup', onUp);
  previewWrap.addEventListener('touchstart', onDown, {passive:true});
  previewWrap.addEventListener('touchmove', onMove, {passive:true});
  addEventListener('touchend', onUp);

  // size
  const resizePreview = () => {
    const r = previewWrap.getBoundingClientRect();
    const w = Math.max(240, Math.floor(r.width));
    const h = Math.max(220, Math.floor(r.height));
    pCamera.aspect = w / h; pCamera.updateProjectionMatrix();
    pRenderer.setSize(w, h, false);
  };
  resizePreview();
  new ResizeObserver(resizePreview).observe(previewWrap);

  // loop
  const loop = () => {
    if (!pRenderer) return;
    pRenderer.render(pScene, pCamera);
    requestAnimationFrame(loop);
  };
  loop();
}
// --- ADD this helper (near the preview code) ---
function framePreview(obj) {
  if (!pCamera) return;

  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);

  // Move the root so the model is centered around origin (0,0,0)
  pRoot.position.y -= center.y;

  // Compute a distance that fits the model in the camera frustum
  const fov = THREE.MathUtils.degToRad(pCamera.fov);
  const fitHeightDist = (size.y * 0.6) / Math.tan(fov * 0.5);   // 0.6 for a little margin
  const fitWidthDist  = (size.x * 0.6) / Math.tan(fov * 0.5) / pCamera.aspect;
  const dist = Math.max(fitHeightDist, fitWidthDist) * 1.2;

  // Place camera slightly above center, looking at the origin
  pCamera.position.set(0, size.y * 0.15, dist);
  pCamera.lookAt(0, 0.5, 0);
}


function disposePreview() {
  if (!pRenderer) return;
  pRenderer.dispose();
  previewWrap.innerHTML = '<div id="previewHint">Drag to rotate</div>';
  pRenderer = null; pScene = null; pCamera = null; pRoot = null; pModel = null;
}

// --- REPLACE updatePreviewColor with this ---
function updatePreviewColor(hex) {
  selectedColor = hex;
  // Repaint the preview immediately (force flat for guaranteed result)
  if (pRoot) applyColor(pRoot, hex, { forceFlat: true });
}


// ----------------- UI: Color Wheel + Name -----------------
const palette = ['#4ADE80','#60A5FA','#F472B6','#FBBF24','#34D399','#A78BFA','#F87171','#F59E0B'];
let selectedIdx = 0;

function buildWheel() {
  const r = 100;
  palette.forEach((hex, i) => {
    const angle = (i / palette.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * r + 120;
    const y = Math.sin(angle) * r + 120;
    const b = document.createElement('button');
    b.className = 'swatch' + (i===selectedIdx ? ' selected' : '');
    b.style.left = x + 'px'; b.style.top = y + 'px';
    b.style.background = hex; b.title = hex;
    b.onclick = () => {
      selectedIdx = i;
      colorHexEl.textContent = hex.toUpperCase();
      Array.from(wheel.children).forEach(c => c.classList.remove('selected'));
      b.classList.add('selected');
      updatePreviewColor(hex);     // live-update preview tint
      validateForm();
    };
    wheel.appendChild(b);
  });
  colorHexEl.textContent = palette[selectedIdx].toUpperCase();
}
function validateForm() {
  startBtn.disabled = nameInput.value.trim().length === 0;
}
nameInput.addEventListener('input', validateForm);
buildWheel();

// ----------------- Socket flow -----------------
socket.on('connect', () => {
  debug.textContent = 'Connected ✔';
  overlay.classList.remove('hidden');   // show setup UI
  initPreview();                         // start preview
  // ensure wheel selection applies initial color to preview
  updatePreviewColor(palette[selectedIdx]);
});

startBtn.onclick = () => {
  const name = nameInput.value.trim();
  if (!name) return;
  overlay.classList.add('hidden');
  disposePreview();                      // free preview context
  socket.emit('register', { name, color: selectedColor });
};

socket.on('currentPlayers', ({ players: list, you }) => {
  myId = you;
  Object.entries(list).forEach(([id, p]) => {
    spawnPlayer(id, p, p.name, p.color, id === myId);
  });
});
socket.on('newPlayer', (p) => { spawnPlayer(p.id, p, p.name, p.color, false); });
socket.on('playerMoved', (p) => { const obj = players.get(p.id); if (obj) obj.position.set(p.x, p.y, p.z); });
socket.on('removePlayer', (id) => { const obj = players.get(id); if (obj) { scene.remove(obj); players.delete(id); } });

// ----------------- Main loop -----------------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  updateLocal(dt); updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
