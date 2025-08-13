// main.js
// ---------------------------------------------
// ES–module imports (no bundler)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.module.js';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/jsm/loaders/FBXLoader.js';
import { initLoginGate } from './login.js';

// -- Utility --------------------------------------------------------------
function decodeJwtPayload(jwt) {
  try {
    return JSON.parse(atob(jwt.split('.')[1]));
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------------
// DOM refs / globals
const debug       = document.getElementById('debug');
const overlay     = document.getElementById('overlay');
const wheel       = document.getElementById('wheel');
const startBtn    = document.getElementById('startBtn');
const nameInput   = document.getElementById('nameInput');
const colorHexEl  = document.getElementById('colorHex');
const previewWrap = document.getElementById('previewWrap');

const bottomBar   = document.getElementById('bottomBar');
const chatInput   = document.getElementById('chatInput');
const chatSend    = document.getElementById('chatSend');
const historyBtn   = document.getElementById('historyBtn');
const friendsBtn   = document.getElementById('friendsBtn');
const historyPanel = document.getElementById('historyPanel');
const friendsPanel = document.getElementById('friendsPanel');
const friendsList  = document.getElementById('friendsList');
const logoutBtn    = document.getElementById('logoutBtn');
const knitOverlay  = document.getElementById('knitOverlay');
const knitClose    = document.getElementById('knitClose');

const socket = window.io();

// Prevent click-to-move when focusing chat
function isTypingInChat(e) {
  return (
    e &&
    (e.target === chatInput ||
      (e.target &&
        e.target.closest &&
        (e.target.closest('#bottomBar') || e.target.closest('#knitOverlay'))))
  );
}

function openKnitGame() {
  knitOverlay.classList.remove('hidden');
}

function closeKnitGame() {
  knitOverlay.classList.add('hidden');
}

knitClose.addEventListener('click', closeKnitGame);

// ------------------------------------------------------------------------
// THREE.js main scene
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

// Lights -----------------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.25));

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemi.position.set(0, 20, 0);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(5, 10, 7);
dir.castShadow = true;
scene.add(dir);

// Room -------------------------------------------------------------------
let floor = null;
const envLoader = new FBXLoader();
envLoader.load('/models/WaitingRoom.fbx', (fbx) => {
  fbx.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
      if (!floor && c.name && c.name.toLowerCase().includes('floor')) {
        floor = c;
      }
    }
  });
  if (!floor) floor = fbx;
  scene.add(fbx);
});

// Knit minigame character --------------------------------------------------
let knitModel = null;
const miscLoader = new FBXLoader();
miscLoader.load('/models/Knit.fbx', (fbx) => {
  const box = new THREE.Box3().setFromObject(fbx);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = 1.7 / Math.max(size.y || 0.001, 0.001);
  fbx.scale.setScalar(s);
  const scaled = new THREE.Box3().setFromObject(fbx);
  fbx.position.y -= scaled.min.y;
  fbx.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  fbx.position.set(2, 0, 2);
  knitModel = fbx;
  scene.add(fbx);
});

// ------------------------------------------------------------------------
// Helpers & state
const loader = new FBXLoader();
const players = new Map(); // id -> Group
let myId = null;
let targetPos = null;
let chatTarget = null; // current private chat target
const chatHistory = [];
const friends = new Map();

let audioCtx = null;
let clickInterval = null;
function playAmbientSound() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.25;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.3;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    src.start();

    // add random clicks for a mysterious vibe
    if (!clickInterval) {
      clickInterval = setInterval(() => {
        if (!audioCtx || audioCtx.state !== 'running') return;
        if (Math.random() < 0.3) {
          const t = audioCtx.currentTime;
          const osc = audioCtx.createOscillator();
          osc.type = 'square';
          osc.frequency.value = 200 + Math.random() * 800;
          const g = audioCtx.createGain();
          g.gain.setValueAtTime(0.2, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
          osc.connect(g);
          g.connect(audioCtx.destination);
          osc.start(t);
          osc.stop(t + 0.05);
        }
      }, 1000);
    }
  } else if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

let typing = false;
let typingTimer = null;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const cameraOffset = new THREE.Vector3(0, 6, 10);

// -- Chat bubble state ----------------------------------------------------
const activeBubbles = [];

// -- Materials / tint helpers --------------------------------------------
function tintMaterial(m, color) {
  let mat = m && m.isMaterial ? m.clone() : null;
  if (!mat || !mat.color) {
    mat = new THREE.MeshStandardMaterial({
      color: color.clone(),
      metalness: 0.05,
      roughness: 0.85,
    });
  } else {
    if (mat.map) mat.map = null;
    if (mat.vertexColors) mat.vertexColors = false;
    mat.color.copy(color);
    if (mat.emissive) mat.emissive.copy(color).multiplyScalar(0.12);
  }
  mat.needsUpdate = true;
  return mat;
}

function applyColor(root, hex) {
  const c = new THREE.Color(hex);
  root.traverse((obj) => {
    if (!obj.isMesh) return;

    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m) => tintMaterial(m, c));
    } else {
      obj.material = tintMaterial(obj.material, c);
    }
  });
}

// ------------------------------------------------------------------------
// Name tags ---------------------------------------------------------------
function makeNameTag(text) {
  const padX = 12,
    padY = 6;
  const ctx = document.createElement('canvas').getContext('2d');

  ctx.font = '700 34px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = 50 + padY * 2;

  ctx.canvas.width = w;
  ctx.canvas.height = h;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, h - 2, 10);
    ctx.fill();
  } else {
    ctx.fillRect(1, 1, w - 2, h - 2);
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = '700 34px system-ui, sans-serif';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.anisotropy = 4;

  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w / 100, h / 100, 1);
  sprite.position.set(0, 2.0, 0);

  return sprite;
}

// ------------------------------------------------------------------------
// Chat bubbles ------------------------------------------------------------
function makeChatBubble(text) {
  const ctx = document.createElement('canvas').getContext('2d');
  const maxWidth = 360;
  ctx.font = '600 28px system-ui, sans-serif';

  // -- Simple word-wrap ---------------------------------------------------
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const padX = 18,
    padY = 12,
    lineH = 34;
  const w = Math.ceil(
    Math.min(
      maxWidth,
      Math.max(...lines.map((l) => ctx.measureText(l).width))
    ) +
      padX * 2
  );
  const h = Math.ceil(lines.length * lineH + padY * 2);

  ctx.canvas.width = w;
  ctx.canvas.height = h;

  ctx.fillStyle = '#e5eefc';
  ctx.strokeStyle = 'rgba(51,65,85,0.45)';
  ctx.lineWidth = 2;

  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, h - 2, 12);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(1, 1, w - 2, h - 2);
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 28px system-ui, sans-serif';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, padY + lineH * i + lineH / 2));

  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.anisotropy = 4;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    depthTest: false,
    transparent: true,
    opacity: 1,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w / 110, h / 110, 1);

  return sprite;
}

const BUBBLE_BASE = 2.8;
const BUBBLE_GAP = 0.15;

function layoutBubbles(root) {
  const list = root.userData.chatBubbles || [];
  let y = BUBBLE_BASE;
  for (const b of list) {
    const half = b.scale.y / 2;
    y += half;
    b.position.y = y;
    y += half + BUBBLE_GAP;
  }
  if (root.userData.typingBubble) {
    const tb = root.userData.typingBubble;
    const half = tb.scale.y / 2;
    y += half;
    tb.position.y = y;
  }
}

function showChatBubble(id, text) {
  const root = players.get(id);
  if (!root) return;

  const list = root.userData.chatBubbles || [];
  const bubble = makeChatBubble(text);
  root.add(bubble);
  // Insert newest bubble at start so older ones are pushed upward
  list.unshift(bubble);
  root.userData.chatBubbles = list;

  // Limit to 3 bubbles, removing the oldest (last in the array)
  if (list.length > 3) {
    const old = list.pop();
    if (old) {
      root.remove(old);
      const idx = activeBubbles.findIndex((b) => b.sprite === old);
      if (idx >= 0) activeBubbles.splice(idx, 1);
    }
  }

  layoutBubbles(root);
  const ttl = 2 + text.length * 0.05; // allow longer time for longer text
  activeBubbles.push({ sprite: bubble, root, ttl });
}

function showTyping(id, flag) {
  const root = players.get(id);
  if (!root) return;
  if (flag) {
    if (root.userData.typingBubble) return;
    const bubble = makeChatBubble('...');
    bubble.scale.multiplyScalar(0.6);
    root.add(bubble);
    root.userData.typingBubble = bubble;
    layoutBubbles(root);
  } else {
    const b = root.userData.typingBubble;
    if (b) {
      root.remove(b);
      delete root.userData.typingBubble;
      layoutBubbles(root);
    }
  }
}

function addHistory(id, text, isPrivate = false) {
  const name = players.get(id)?.userData?.name || 'Player';
  const row = document.createElement('div');
  row.textContent = `${isPrivate ? '(PM) ' : ''}${name}: ${text}`;
  historyPanel.appendChild(row);
  historyPanel.scrollTop = historyPanel.scrollHeight;
  chatHistory.push({ id, text, isPrivate });
}

// ------------------------------------------------------------------------
// Spawn & movement --------------------------------------------------------
function spawnPlayer(id, pos, name, color, isLocal = false) {
  const root = new THREE.Group();
  root.position.set(pos.x, pos.y, pos.z);
  scene.add(root);
  root.userData.id = id;
  root.userData.name = name;
  players.set(id, root);

  // Model
  loader.load(
    '/models/player.fbx',
    (fbx) => {
      // Normalise height
      const box = new THREE.Box3().setFromObject(fbx);
      const size = new THREE.Vector3();
      box.getSize(size);
      const s = 1.7 / Math.max(size.y || 0.001, 0.001);
      fbx.scale.setScalar(s);

      const scaled = new THREE.Box3().setFromObject(fbx);
      fbx.position.y -= scaled.min.y;

      fbx.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          c.userData.playerId = id;
        }
      });

      if (color) applyColor(fbx, color);
      root.add(fbx);
    },
    undefined,
    () => {
      // fallback: box
      const g = new THREE.BoxGeometry(0.6, 1, 0.6);
      const m = new THREE.MeshStandardMaterial({ color: color || '#4ADE80' });
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.userData.playerId = id;
      root.add(mesh);
    }
  );

  if (name) root.add(makeNameTag(name));

  // Local player specific -----------------------------------------------
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
      if (knitModel) {
        const khit = raycaster.intersectObject(knitModel, true);
        if (khit.length) {
          openKnitGame();
          return;
        }
      }

      const objs = Array.from(players.values());
      const phit = raycaster.intersectObjects(objs, true);
      if (phit.length) {
        let o = phit[0].object;
        while (o && !o.userData.playerId) o = o.parent;
        if (o && o.userData.playerId && o.userData.playerId !== myId) {
          sendFriendRequest(o.userData.playerId);
          return;
        }
      }

      if (floor) {
        const hit = raycaster.intersectObject(floor, true);
        if (hit.length) {
          targetPos = hit[0].point.clone();
          targetPos.y = 0;
        }
      }
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

// Smooth chase camera ----------------------------------------------------
function updateCamera(dt) {
  if (!myId) return;

  const me = players.get(myId);
  if (!me) return;

  const desired = me.position.clone().add(cameraOffset);
  const smooth = 1 - Math.pow(0.0001, dt); // ≈0.12 at 60fps

  camera.position.lerp(desired, smooth);
  camera.lookAt(me.position.x, me.position.y + 1.2, me.position.z);
}

// Resize -----------------------------------------------------------------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------------
// Character Creator: Preview Scene ---------------------------------------
let pScene,
  pCamera,
  pRenderer,
  pRoot,
  pModel;
let isDragging = false,
  lastX = 0;
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

  const amb = new THREE.AmbientLight(0xffffff, 0.35);
  pScene.add(amb);
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(3, 4, 5);
  pScene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(-3, 3, -3);
  pScene.add(rim);

  pRoot = new THREE.Group();
  pScene.add(pRoot);

  const fbxLoader = new FBXLoader();
  fbxLoader.load(
    '/models/player.fbx',
    (fbx) => {
      const box = new THREE.Box3().setFromObject(fbx);
      const size = new THREE.Vector3();
      box.getSize(size);
      const s = 1.7 / Math.max(size.y || 0.001, 0.001);
      fbx.scale.setScalar(s);

      fbx.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      pModel = fbx;
      pRoot.add(pModel);

      applyColor(pModel, selectedColor);
      framePreview(pRoot);
    },
    undefined,
    () => {
      // fallback: box
      const g = new THREE.BoxGeometry(0.6, 1, 0.6);
      const m = new THREE.MeshStandardMaterial({ color: selectedColor });
      pModel = new THREE.Mesh(g, m);
      pRoot.add(pModel);
      framePreview(pRoot);
    }
  );

  // Rotate via dragging ---------------------------------------------------
  const onDown = (e) => {
    isDragging = true;
    lastX = e.clientX || e.touches?.[0]?.clientX || 0;
  };
  const onMove = (e) => {
    if (!isDragging) return;
    const x = e.clientX || e.touches?.[0]?.clientX || 0;
    const dx = x - lastX;
    lastX = x;
    pRoot.rotation.y -= dx * 0.01;
  };
  const onUp = () => {
    isDragging = false;
  };

  previewWrap.addEventListener('mousedown', onDown);
  previewWrap.addEventListener('mousemove', onMove);
  addEventListener('mouseup', onUp);

  previewWrap.addEventListener('touchstart', onDown, { passive: true });
  previewWrap.addEventListener('touchmove', onMove, { passive: true });
  addEventListener('touchend', onUp);

  const resizePreview = () => {
    const r = previewWrap.getBoundingClientRect();
    const w = Math.max(240, Math.floor(r.width));
    const h = Math.max(220, Math.floor(r.height));
    pCamera.aspect = w / h;
    pCamera.updateProjectionMatrix();
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
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  obj.position.sub(center); // center object at origin

  const fov = THREE.MathUtils.degToRad(pCamera.fov);
  const fitHeightDist = (size.y * 0.6) / Math.tan(fov * 0.5);
  const fitWidthDist =
    (size.x * 0.6) / Math.tan(fov * 0.5) / pCamera.aspect;
  const dist = Math.max(fitHeightDist, fitWidthDist) * 1.25;

  const yOffset = size.y * 0.12;
  pCamera.position.set(0, yOffset, dist);
  pCamera.lookAt(0, yOffset, 0);
}

function disposePreview() {
  if (!pRenderer) return;
  pRenderer.dispose();
  previewWrap.innerHTML = '<div id="previewHint">Drag to rotate</div>';
  pRenderer = pScene = pCamera = pRoot = pModel = null;
}

function updatePreviewColor(hex) {
  selectedColor = hex;
  if (pModel) applyColor(pModel, hex);
}

// ------------------------------------------------------------------------
// UI: Color wheel + name --------------------------------------------------
const palette = [
  '#4ADE80',
  '#60A5FA',
  '#F472B6',
  '#FBBF24',
  '#34D399',
  '#A78BFA',
  '#F87171',
  '#F59E0B',
];
let selectedIdx = 0;

function buildWheel() {
  const r = 100;
  palette.forEach((hex, i) => {
    const angle = (i / palette.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * r + 120;
    const y = Math.sin(angle) * r + 120;

    const b = document.createElement('button');
    b.className = 'swatch' + (i === selectedIdx ? ' selected' : '');
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    b.style.background = hex;
    b.title = hex;
    b.onclick = () => {
      selectedIdx = i;
      colorHexEl.textContent = hex.toUpperCase();
      Array.from(wheel.children).forEach((c) =>
        c.classList.remove('selected')
      );
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

// ------------------------------------------------------------------------
// Chat --------------------------------------------------------------------
function sendChat() {
  const text = (chatInput.value || '').trim();
  if (!text) return;

  if (chatTarget) {
    socket.emit('privateChat', { to: chatTarget, text });
  } else {
    socket.emit('chat', text);
  }
  chatInput.value = '';
  if (typing) {
    typing = false;
    socket.emit('typing', false);
  }
}
chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChat();
  }
});

chatInput.addEventListener('input', () => {
  if (!typing) {
    typing = true;
    socket.emit('typing', true);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (typing) {
      typing = false;
      socket.emit('typing', false);
    }
  }, 1000);
});
chatInput.addEventListener('blur', () => {
  if (typing) {
    typing = false;
    socket.emit('typing', false);
  }
});

historyBtn.onclick = () => historyPanel.classList.toggle('open');
friendsBtn.onclick = () => friendsPanel.classList.toggle('open');

function refreshFriendsList() {
  friendsList.innerHTML = '';
  const global = document.createElement('div');
  global.textContent = 'Global Chat';
  global.onclick = () => {
    chatTarget = null;
    chatInput.placeholder = 'Type a message…';
    friendsPanel.classList.remove('open');
  };
  friendsList.appendChild(global);
  friends.forEach((name, id) => {
    const div = document.createElement('div');
    div.textContent = name;
    div.onclick = () => {
      chatTarget = id;
      chatInput.placeholder = `Message ${name}`;
      friendsPanel.classList.remove('open');
    };
    friendsList.appendChild(div);
  });
}

function sendFriendRequest(id) {
  if (friends.has(id)) return;
  const name = players.get(id)?.userData?.name || 'Player';
  if (confirm(`Add ${name} as friend?`)) {
    socket.emit('friendRequest', { to: id });
  }
}

refreshFriendsList();

// ------------------------------------------------------------------------
// Socket.io ----------------------------------------------------------------
socket.on('connect', () => {
  debug.textContent = 'Connected ✔';

  initLoginGate({
    onGuest() {
      showCharCreator();
    },
    onGoogle(idToken) {
      showCharCreator(idToken);
    },
  });
});

// Character creator entry point ------------------------------------------
function showCharCreator(idToken = null) {
  // Guests don't see the friends tab
  friendsBtn.style.display = idToken ? '' : 'none';
  friendsPanel.style.display = idToken ? '' : 'none';
  overlay.classList.remove('hidden');
  initPreview();
  updatePreviewColor(palette[selectedIdx]);

  // -- Logged-in banner ---------------------------------------------------
  if (idToken) {
    const { name, picture } = decodeJwtPayload(idToken);
    const infoRow = document.createElement('div');
    infoRow.className = 'profileRow';
    infoRow.innerHTML = `
      <img src="${picture}" style="width:32px;height:32px;border-radius:50%;margin-right:8px">
      <span style="color:#94a3b8;font-size:14px;">Logged in as <b>${name}</b></span>
    `;
    overlay.querySelector('.subtitle').after(infoRow);
  }

  // -- Start button handler (inside so idToken is in scope) --------------
  startBtn.onclick = () => {
    const displayName = nameInput.value.trim() || 'Player';

    overlay.classList.add('hidden');
    disposePreview();
    bottomBar.classList.remove('hidden');
    playAmbientSound();
    setTimeout(() => chatInput.focus(), 50);

    if (idToken) {
      socket.emit('googleLogin', {
        idToken,
        name: displayName,
        color: selectedColor,
      });
      logoutBtn.style.display = '';
    } else {
      socket.emit('registerGuest', {
        name: displayName,
        color: selectedColor,
      });
      logoutBtn.style.display = 'none';
    }
  };
} // <-- correct end of showCharCreator()
logoutBtn.onclick = () => {
  google.accounts.id.disableAutoSelect();
  location.reload();
};

// ------------------------------------------------------------------------
// Server events -----------------------------------------------------------
socket.on('currentPlayers', ({ players: list, you }) => {
  myId = you;
  Object.entries(list).forEach(([id, p]) => {
    spawnPlayer(id, p, p.name, p.color, id === myId);
  });
});

socket.on('newPlayer', (p) =>
  spawnPlayer(p.id, p, p.name, p.color, false)
);
socket.on('playerMoved', (p) => {
  const obj = players.get(p.id);
  if (obj) obj.position.set(p.x, p.y, p.z);
});
socket.on('removePlayer', (id) => {
  const obj = players.get(id);
  if (obj) {
    scene.remove(obj);
    players.delete(id);
  }
});

// NEW: receive chat messages -> show bubbles
socket.on('chat', ({ id, text }) => {
  showChatBubble(id, text);
  addHistory(id, text);
});
socket.on('privateChat', ({ id, text }) => {
  showChatBubble(id, text);
  addHistory(id, text, true);
});
socket.on('typing', ({ id, typing }) => showTyping(id, typing));
socket.on('friendRequest', ({ from, name }) => {
  if (confirm(`${name} wants to be your friend. Accept?`)) {
    socket.emit('friendAccept', { from });
  }
});
socket.on('friendAccepted', ({ id, name }) => {
  friends.set(id, name);
  refreshFriendsList();
});

// ------------------------------------------------------------------------
// Main loop ---------------------------------------------------------------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  updateLocal(dt);
  updateCamera(dt);

  // Fade chat bubbles
  for (let i = activeBubbles.length - 1; i >= 0; i--) {
    const b = activeBubbles[i];
    b.ttl -= dt;

    if (b.ttl <= 0 && b.sprite && b.sprite.material) {
      b.sprite.material.opacity = Math.max(
        0,
        (b.ttl + 0.5) / 0.5
      ); // fade last 0.5s
    }
    if (b.ttl <= -0.5) {
      if (b.root) {
        b.root.remove(b.sprite);
        const list = b.root.userData.chatBubbles;
        if (list) {
          const idx = list.indexOf(b.sprite);
          if (idx >= 0) list.splice(idx, 1);
        }
        layoutBubbles(b.root);
      }
      activeBubbles.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ------------------------------------------------------------------------
// Google Identity One-Tap / FedCM warnings -------------------------------
// NOTE: The console notices you see are warnings from Google’s FedCM
//       migration. They don’t break the game, but you’ll eventually
//       want to follow the guide here:
//       https://developers.google.com/identity/gsi/web/guides/fedcm-migration
// ------------------------------------------------------------------------
