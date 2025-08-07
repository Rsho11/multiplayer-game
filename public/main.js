// ES-module imports from CDN (no bundler)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.module.js';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/jsm/loaders/FBXLoader.js';
import { initLoginGate } from './login.js';

const debug = document.getElementById('debug');
const overlay = document.getElementById('overlay');
const wheel = document.getElementById('wheel');
const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const colorHexEl = document.getElementById('colorHex');
const previewWrap = document.getElementById('previewWrap');

const chatBar = document.getElementById('chatBar');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');

const socket = window.io();

// Prevent click-to-move when focusing chat
function isTypingInChat(e) {
  return e && (e.target === chatInput || (e.target && e.target.closest && e.target.closest('#chatBar')));
}

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

// helpers & state
const loader = new FBXLoader();
const players = new Map(); // id -> Group
let myId = null;
let targetPos = null;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const cameraOffset = new THREE.Vector3(0, 6, 10);

// ---- Chat bubbles state ----
const activeBubbles = [];

// ---- Materials / tint helpers ----
function tintOrReplaceMaterial(m, color, forceFlat) {
  if (forceFlat || !m || !('color' in m)) {
    const mat = new THREE.MeshStandardMaterial({
      color: color.clone(),
      metalness: 0.05,
      roughness: 0.85
    });
    mat.needsUpdate = true;
    return mat;
  }
  if (m.map) m.map = null;
  if (m.vertexColors) m.vertexColors = false;
  if (m.color) m.color.copy(color);
  if (m.emissive) m.emissive.copy(color).multiplyScalar(0.12);
  m.needsUpdate = true;
  return m;
}

// robust tint across single/multi-material meshes
function applyColor(root, hex, { forceFlat = false } = {}) {
  const c = new THREE.Color(hex);
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m) => tintOrReplaceMaterial(m, c, forceFlat));
    } else {
      obj.material = tintOrReplaceMaterial(obj.material, c, forceFlat);
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

// ---- Chat bubble creation & display ----
function makeChatBubble(text) {
  const ctx = document.createElement('canvas').getContext('2d');
  const maxWidth = 260;
  ctx.font = '600 28px system-ui, sans-serif';

  // word wrap
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const padX = 18, padY = 12, lineH = 34;
  const w = Math.ceil(Math.min(maxWidth, Math.max(...lines.map(l => ctx.measureText(l).width))) + padX * 2);
  const h = Math.ceil(lines.length * lineH + padY * 2);

  ctx.canvas.width = w;
  ctx.canvas.height = h;

  // light bubble (distinct from name tag)
  ctx.fillStyle = '#e5eefc';
  ctx.strokeStyle = 'rgba(51,65,85,0.45)';
  ctx.lineWidth = 2;
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(1,1,w-2,h-2,12); ctx.fill(); ctx.stroke(); }
  else { ctx.fillRect(1,1,w-2,h-2); ctx.strokeRect(1,1,w-2,h-2); }

  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 28px system-ui, sans-serif';
  lines.forEach((l, i) => ctx.fillText(l, w/2, padY + lineH * i + lineH/2));

  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity: 1 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w/110, h/110, 1);
  sprite.position.set(0, 2.6, 0); // above name tag
  return sprite;
}

function showChatBubble(id, text) {
  const root = players.get(id);
  if (!root) return;
  if (root.userData.chatBubble) root.remove(root.userData.chatBubble);
  const bubble = makeChatBubble(text);
  root.add(bubble);
  root.userData.chatBubble = bubble;
  activeBubbles.push({ sprite: bubble, root, ttl: 4.5 }); // seconds
}

// ---- Spawn & movement ----
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

    if (color) applyColor(fbx, color, { forceFlat: true }); // guarantee vivid player color
    root.add(fbx);
  }, undefined, () => {
    const g = new THREE.BoxGeometry(0.6, 1, 0.6);
    const m = new THREE.MeshStandardMaterial({ color: color || '#4ADE80' });
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; root.add(mesh);
  });

  if (name) root.add(makeNameTag(name));

  if (isLocal) {
    // snap camera initially
    const start = root.position.clone().add(cameraOffset);
    camera.position.copy(start);
    camera.lookAt(root.position.x, root.position.y + 1.2, root.position.z);

    // click-to-move (ignore clicks on chat)
    addEventListener('click', (e) => {
      if (isTypingInChat(e)) return;
      mouse.x = (e.clientX / innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObjects([floor], false);
      if (hit.length) { targetPos = hit[0].point.clone(); targetPos.y = 0; }
    });
  }
} // <-- important: close spawnPlayer

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

// Smooth chase camera
function updateCamera(dt) {
  if (!myId) return;
  const me = players.get(myId);
  if (!me) return;

  const desired = me.position.clone().add(cameraOffset);
  const smooth = 1 - Math.pow(0.0001, dt);  // ≈0.12 at 60fps
  camera.position.lerp(desired, smooth);
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
  pScene.background = null;

  pCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  pCamera.position.set(0, 1.6, 4);

  pRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  pRenderer.outputColorSpace = THREE.SRGBColorSpace;
  pRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  previewWrap.appendChild(pRenderer.domElement);

  const amb = new THREE.AmbientLight(0xffffff, 0.35); pScene.add(amb);
  const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(3, 4, 5); pScene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-3, 3, -3); pScene.add(rim);

  pRoot = new THREE.Group();
  pScene.add(pRoot);

  const fbxLoader = new FBXLoader();
  fbxLoader.load('/models/player.fbx', (fbx) => {
    const box = new THREE.Box3().setFromObject(fbx);
    const size = new THREE.Vector3(); box.getSize(size);
    const s = 1.7 / Math.max(size.y || 0.001, 0.001);
    fbx.scale.setScalar(s);

    fbx.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    pModel = fbx;
    pRoot.add(pModel);

    applyColor(pModel, selectedColor, { forceFlat: true });
    framePreview(pRoot);
  }, undefined, () => {
    const g = new THREE.BoxGeometry(0.6, 1, 0.6);
    const m = new THREE.MeshStandardMaterial({ color: selectedColor });
    pModel = new THREE.Mesh(g, m);
    pRoot.add(pModel);
    framePreview(pRoot);
  });

  // rotate by dragging
  const onDown = (e) => { isDragging = true; lastX = e.clientX || e.touches?.[0]?.clientX || 0; };
  const onMove = (e) => {
    if (!isDragging) return;
    const x = e.clientX || e.touches?.[0]?.clientX || 0;
    const dx = x - lastX; lastX = x;
    pRoot.rotation.y -= dx * 0.01;
  };
  const onUp = () => { isDragging = false; };

  previewWrap.addEventListener('mousedown', onDown);
  previewWrap.addEventListener('mousemove', onMove);
  addEventListener('mouseup', onUp);
  previewWrap.addEventListener('touchstart', onDown, {passive:true});
  previewWrap.addEventListener('touchmove', onMove, {passive:true});
  addEventListener('touchend', onUp);

  const resizePreview = () => {
    const r = previewWrap.getBoundingClientRect();
    const w = Math.max(240, Math.floor(r.width));
    const h = Math.max(220, Math.floor(r.height));
    pCamera.aspect = w / h; pCamera.updateProjectionMatrix();
    pRenderer.setSize(w, h, false);
  };
  resizePreview();
  new ResizeObserver(resizePreview).observe(previewWrap);

  const loop = () => {
    if (!pRenderer) return;
    pRenderer.render(pScene, pCamera);
    requestAnimationFrame(loop);
  };
  loop();
}

function framePreview(obj) {
  if (!pCamera) return;
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);

  obj.position.sub(center); // center whole object at origin

  const fov = THREE.MathUtils.degToRad(pCamera.fov);
  const fitHeightDist = (size.y * 0.6) / Math.tan(fov * 0.5);
  const fitWidthDist  = (size.x * 0.6) / Math.tan(fov * 0.5) / pCamera.aspect;
  const dist = Math.max(fitHeightDist, fitWidthDist) * 1.25;

  const yOffset = size.y * 0.12;
  pCamera.position.set(0, yOffset, dist);
  pCamera.lookAt(0, yOffset, 0);
}

function disposePreview() {
  if (!pRenderer) return;
  pRenderer.dispose();
  previewWrap.innerHTML = '<div id="previewHint">Drag to rotate</div>';
  pRenderer = null; pScene = null; pCamera = null; pRoot = null; pModel = null;
}

function updatePreviewColor(hex) {
  selectedColor = hex;
  if (pModel) applyColor(pModel, hex, { forceFlat: true });
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
      updatePreviewColor(hex);
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

// ----------------- Chat send -----------------
function sendChat() {
  const text = (chatInput.value || '').trim();
  if (!text) return;
  socket.emit('chat', text);
  chatInput.value = '';
}
chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });

socket.on('connect', () => {
  debug.textContent = 'Connected ✔';

  // Show the gate first
  initLoginGate({
    onGuest: () => {
      document.getElementById('loginGate').style.display = 'none';
      showCharCreator();                 // old flow
    },
    onGoogle: (idToken) => {
      document.getElementById('loginGate').style.display = 'none';
      showCharCreator(idToken);          // pass token along
    }
  });
});

function showCharCreator(idToken = null) {
  overlay.classList.remove('hidden');
  initPreview();
  updatePreviewColor(palette[selectedIdx]);

  // — register only after the player clicks “Start” —
  startBtn.onclick = () => {
    const displayName = nameInput.value.trim() || 'Player';

    overlay.classList.add('hidden');
    disposePreview();

    chatBar.classList.remove('hidden');
    setTimeout(() => chatInput.focus(), 50);

    if (idToken) {
      // Google-authenticated path
      socket.emit('googleLogin', {
        idToken,
        name:  displayName,
        color: selectedColor
      });
      addLogout();            // put the red “Logout” button on screen
    } else {
      // Guest path
      socket.emit('registerGuest', {
        name:  displayName,
        color: selectedColor
      });
    }
  };
}

function addLogout() {
  const btn = document.createElement('button');
  btn.textContent = "Logout";
  btn.style.cssText = "position:fixed; right:16px; bottom:16px; padding:10px 18px; background:#dc2626; color:#fff; border:0; border-radius:12px; cursor:pointer; z-index:9;";
  document.body.appendChild(btn);
  btn.onclick = () => {
    google.accounts.id.disableAutoSelect();
    location.reload();
  };
}


socket.on('currentPlayers', ({ players: list, you }) => {
  myId = you;
  Object.entries(list).forEach(([id, p]) => {
    spawnPlayer(id, p, p.name, p.color, id === myId);
  });
});
socket.on('newPlayer', (p) => { spawnPlayer(p.id, p, p.name, p.color, false); });
socket.on('playerMoved', (p) => { const obj = players.get(p.id); if (obj) obj.position.set(p.x, p.y, p.z); });
socket.on('removePlayer', (id) => { const obj = players.get(id); if (obj) { scene.remove(obj); players.delete(id); } });

// NEW: receive chat messages -> show bubbles
socket.on('chat', ({ id, text }) => {
  showChatBubble(id, text);
});

// ----------------- Main loop -----------------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;

  updateLocal(dt);
  updateCamera(dt);

  // fade chat bubbles
  for (let i = activeBubbles.length - 1; i >= 0; i--) {
    const b = activeBubbles[i];
    b.ttl -= dt;
    if (b.ttl <= 0 && b.sprite && b.sprite.material) {
      b.sprite.material.opacity = Math.max(0, (b.ttl + 0.5) / 0.5); // fade last 0.5s
    }
    if (b.ttl <= -0.5) {
      if (b.root) b.root.remove(b.sprite);
      activeBubbles.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
