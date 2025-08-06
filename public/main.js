// ES-module imports from CDN (avoids "module specifier 'three'" errors)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.module.js';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/jsm/loaders/FBXLoader.js';

const debug = document.getElementById('debug');
const overlay = document.getElementById('overlay');
const wheel = document.getElementById('wheel');
const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const colorHexEl = document.getElementById('colorHex');
const socket = window.io();

// ---------- Scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e16);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 6, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
// r150+ color space
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.25));
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemi.position.set(0, 20, 0); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(5, 10, 7); dir.castShadow = true; scene.add(dir);

// Room
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x2a2f45, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor'; scene.add(floor);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e2233 });
const H = 4, T = 0.4, L = 28;
const w1 = new THREE.Mesh(new THREE.BoxGeometry(L, H, T), wallMat); w1.position.set(0, H/2, -L/2); scene.add(w1);
const w2 = w1.clone(); w2.position.set(0, H/2,  L/2); scene.add(w2);
const w3 = new THREE.Mesh(new THREE.BoxGeometry(T, H, L), wallMat); w3.position.set(-L/2, H/2, 0); scene.add(w3);
const w4 = w3.clone(); w4.position.set( L/2, H/2, 0); scene.add(w4);

// ---------- Helpers ----------
const loader = new FBXLoader();
const players = new Map(); // id -> Group
let myId = null;
let targetPos = null;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const cameraOffset = new THREE.Vector3(0, 6, 10);

// Better tint: handles arrays, emissive, vertexColors
function applyColor(root, hex) {
  const c = new THREE.Color(hex);
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (m.color) m.color.set(c);
      if (m.emissive) m.emissive.set(c).multiplyScalar(0.12);
      if ('vertexColors' in m && m.vertexColors) m.vertexColors = false;
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

  if (ctx.roundRect) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(1, 1, w-2, h-2, 10);
    ctx.fill(); ctx.stroke();
  } else {
    // Fallback rectangle
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(1,1,w-2,h-2);
  }

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

  // Load FBX (autoscale to ~1.7m, place feet on floor, tint)
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
    // Fallback cube if FBX fails
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
      if (hit.length) {
        targetPos = hit[0].point.clone(); targetPos.y = 0;
      }
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
    me.position.addScaledVector(dir, 3.0 * dt); // speed
    const yaw = Math.atan2(dir.x, dir.z);
    me.rotation.y = yaw;
    socket.emit('move', { x: me.position.x, y: me.position.y, z: me.position.z });
  }
}

function updateCamera(dt) {
  if (!myId) return;
  const me = players.get(myId); if (!me) return;
  const desired = me.position.clone().add(cameraOffset);
  camera.position.lerp(desired, 0.12); // smoothing
  camera.lookAt(me.position.x, me.position.y + 1.2, me.position.z);
}

// Resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Overlay (radial color + name) ----------
const palette = ['#4ADE80','#60A5FA','#F472B6','#FBBF24','#34D399','#A78BFA','#F87171','#F59E0B'];
let selectedIdx = 0;
let selectedColor = palette[selectedIdx];

function buildWheel() {
  const r = 92;
  palette.forEach((hex, i) => {
    const angle = (i / palette.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * r + 110;
    const y = Math.sin(angle) * r + 110;
    const b = document.createElement('button');
    b.className = 'swatch' + (i===selectedIdx ? ' selected' : '');
    b.style.left = x + 'px'; b.style.top = y + 'px';
    b.style.background = hex; b.title = hex;
    b.onclick = () => {
      selectedIdx = i; selectedColor = hex; colorHexEl.textContent = hex.toUpperCase();
      Array.from(wheel.children).forEach(c => c.classList.remove('selected'));
      b.classList.add('selected');
      validateForm();
    };
    wheel.appendChild(b);
  });
  colorHexEl.textContent = selectedColor.toUpperCase();
}
function validateForm() {
  startBtn.disabled = nameInput.value.trim().length === 0;
}
nameInput.addEventListener('input', validateForm);
buildWheel();

// ---------- Socket flow ----------
socket.on('connect', () => {
  debug.textContent = 'Connected ✔';
  overlay.classList.remove('hidden'); // show the setup UI after connected
});

startBtn.onclick = () => {
  const name = nameInput.value.trim();
  if (!name) return;
  overlay.classList.add('hidden');
  socket.emit('register', { name, color: selectedColor });
};

socket.on('currentPlayers', ({ players: list, you }) => {
  myId = you;
  Object.entries(list).forEach(([id, p]) => {
    spawnPlayer(id, p, p.name, p.color, id === myId);
  });
});
socket.on('newPlayer', (p) => { spawnPlayer(p.id, p, p.name, p.color, false); });
socket.on('playerMoved', (p) => {
  const obj = players.get(p.id);
  if (obj) obj.position.set(p.x, p.y, p.z);
});
socket.on('removePlayer', (id) => {
  const obj = players.get(id);
  if (obj) { scene.remove(obj); players.delete(id); }
});

// ---------- Loop ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  updateLocal(dt); updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
