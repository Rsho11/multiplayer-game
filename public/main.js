import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.module.js';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/jsm/loaders/FBXLoader.js';

const debug = document.getElementById('debug');

// Socket connection (global on window from the non-module script)
const socket = window.io();

// --- THREE.js setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e16);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 6, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Lights
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemi.position.set(0, 20, 0);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(5, 10, 7);
dir.castShadow = true;
scene.add(dir);

// Floor
const floorGeo = new THREE.PlaneGeometry(30, 30);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2f45, roughness: 0.9, metalness: 0.0 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.name = 'floor';
scene.add(floor);

// Simple room (4 walls)
const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e2233 });
const wallH = 4, wallT = 0.4, room = 28;
const wall1 = new THREE.Mesh(new THREE.BoxGeometry(room, wallH, wallT), wallMat);
wall1.position.set(0, wallH/2, -room/2);
wall1.receiveShadow = true; wall1.castShadow = true;
scene.add(wall1);

const wall2 = wall1.clone(); wall2.position.set(0, wallH/2, room/2); scene.add(wall2);
const wall3 = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, room), wallMat);
wall3.position.set(-room/2, wallH/2, 0); wall3.receiveShadow = true; wall3.castShadow = true; scene.add(wall3);
const wall4 = wall3.clone(); wall4.position.set(room/2, wallH/2, 0); scene.add(wall4);

// Raycaster for click-to-move (local player)
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let targetPos = null;

// Player storage
const players = new Map(); // id -> Object3D
let myId = null;

// Load FBX for a player
const loader = new FBXLoader();
function createFallback() {
  const g = new THREE.BoxGeometry(0.6, 1, 0.6);
  const m = new THREE.MeshStandardMaterial({ color: 0x4ade80 });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

function spawnPlayer(id, pos, isLocal=false) {
  const objectRoot = new THREE.Group();
  objectRoot.position.set(pos.x, pos.y, pos.z);
  scene.add(objectRoot);

  loader.load('/models/player.fbx',
    (fbx) => {
      fbx.scale.setScalar(1);
      fbx.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      objectRoot.add(fbx);
    },
    undefined,
    (err) => {
      console.warn('FBX failed to load, using fallback cube for', id, err);
      objectRoot.add(createFallback());
    }
  );

  players.set(id, objectRoot);

  if (isLocal) {
    window.addEventListener('click', (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObjects([floor], false);
      if (hit.length) {
        targetPos = hit[0].point.clone();
        targetPos.y = 0;
      }
    });
  }
}

// Smoothly move local player towards targetPos
function updateLocalMovement(dt) {
  if (!myId) return;
  const me = players.get(myId);
  if (!me || !targetPos) return;
  const dir = new THREE.Vector3().subVectors(targetPos, me.position);
  const dist = dir.length();
  if (dist > 0.02) {
    dir.normalize();
    const speed = 3.0; // m/s
    me.position.addScaledVector(dir, speed * dt);
    // face movement direction
    const yaw = Math.atan2(dir.x, dir.z);
    me.rotation.y = yaw;
    // broadcast
    socket.emit('move', { x: me.position.x, y: me.position.y, z: me.position.z });
  }
}

// Camera follow
function updateCamera(dt) {
  if (!myId) return;
  const me = players.get(myId);
  if (!me) return;
  const desired = new THREE.Vector3(me.position.x + 6, me.position.y + 6, me.position.z + 6);
  camera.position.lerp(desired, 1 - Math.pow(0.0001, dt)); // smooth
  camera.lookAt(me.position.x, me.position.y + 1, me.position.z);
}

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Socket handlers ---
socket.on('connect', () => {
  debug.textContent = 'Connected ✔';
});

socket.on('currentPlayers', (payload) => {
  myId = payload.you;
  // spawn everyone
  Object.entries(payload.players).forEach(([id, pos]) => {
    spawnPlayer(id, pos, id === myId);
  });
});

socket.on('newPlayer', (player) => {
  spawnPlayer(player.id, player, false);
});

socket.on('playerMoved', (player) => {
  const p = players.get(player.id);
  if (p) p.position.set(player.x, player.y, player.z);
});

socket.on('removePlayer', (id) => {
  const p = players.get(id);
  if (p) {
    scene.remove(p);
    players.delete(id);
  }
});

// --- Loop ---
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateLocalMovement(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
