// public/script-3d-esm.js
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.155.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/controls/OrbitControls.js";

/* ------------------ Trail helper ------------------ */
class Trail {
  constructor(scene, color = 0xffffff, maxSegs = 120, radius = 0.35, yOffset = 0.25) {
    this.maxSegs = maxSegs;
    this.radius = radius;
    this.yOffset = yOffset;

    const segGeom = new THREE.CylinderGeometry(radius, radius, 1, 8, 1);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0.0,
      emissive: new THREE.Color(color).multiplyScalar(0.15),
      transparent: true,
      opacity: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: 1,
    });

    this.mesh = new THREE.InstancedMesh(segGeom, mat, maxSegs);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this._last = null;
    this._i = 0;
    this._mat4 = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._vDir = new THREE.Vector3();
    this._mid = new THREE.Vector3();
  }

  reset() {
    this.mesh.count = 0;
    this._last = null;
  }

  addPoint(x, y, z) {
    y = this.yOffset;
    if (!this._last) { this._last = new THREE.Vector3(x, y, z); return; }

    const a = this._last;
    const b = new THREE.Vector3(x, y, z);
    const len = a.distanceTo(b);
    if (len < 0.5) return;

    this._vDir.copy(b).sub(a).normalize();
    this._mid.copy(a).add(b).multiplyScalar(0.5);

    const up = new THREE.Vector3(0, 1, 0);
    this._quat.setFromUnitVectors(up, this._vDir);

    this._mat4.compose(this._mid, this._quat, new THREE.Vector3(1, len, 1));

    const i = this._i % this.maxSegs;
    this.mesh.setMatrixAt(i, this._mat4);
    this.mesh.count = Math.min(this.mesh.count + 1, this.maxSegs);
    this.mesh.instanceMatrix.needsUpdate = true;

    this._last = b;
    this._i++;
  }
}

/* ------------------ Socket / UI ------------------ */
const socket = io();
console.log("[client] script-3d-esm.js loaded");

let myName = "";
document.getElementById("startGame").onclick = () => {
  myName = document.getElementById("nameInput").value.trim();
  if (!myName) return alert("Please enter your name!");
  document.getElementById("nameModal").style.display = "none";
  const myColor = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  socket.emit("join", { name: myName, color: myColor });
};

// Chat
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const messages = document.getElementById("messages");
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (msg) socket.emit("chat", msg);
  chatInput.value = "";
});
socket.on("chat", ({ name, text }) => {
  const div = document.createElement("div");
  div.innerHTML = `<strong>${name}:</strong> ${text}`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
});

// Leaderboard
const leaderboardList = document.getElementById("leaderboardList");
function updateLeaderboard(snapshot) {
  const top = [...snapshot].sort((a,b)=>b.score-a.score).slice(0,10);
  leaderboardList.innerHTML = "";
  top.forEach((p, i) => {
    const li = document.createElement("li");
    li.textContent = `#${i+1} ${p.name}: ${p.score}`;
    leaderboardList.appendChild(li);
  });
}

/* ------------------ Three.js Scene ------------------ */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x131313);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// "waiting" overlay
const waitDiv = document.createElement("div");
Object.assign(waitDiv.style, {
  position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
  color: "#ddd", font: "16px Segoe UI, sans-serif", padding: "8px 12px",
  background: "rgba(0,0,0,0.5)", border: "1px solid #444", borderRadius: "8px", zIndex: "4"
});
waitDiv.textContent = "Waiting for server state...";
document.body.appendChild(waitDiv);

// Camera + Controls
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000);
camera.position.set(0, 170, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.target.set(0, 6, 0);
controls.minDistance = 90;
controls.maxDistance = 700;
controls.minPolarAngle = 0.2 * Math.PI;
controls.maxPolarAngle = 0.49 * Math.PI;

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 0.85);
dir.position.set(200, 400, 200);
scene.add(dir);

// Arena (MATCH SERVER SIZE)
const ARENA_W = 2400, ARENA_H = 1600;   // must match index.js ARENA
{
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_W, ARENA_H),
    new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  const borderMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, metalness: 0.2, roughness: 0.7 });
  const wallH = 16, wallT = 3;
  const wallNorth = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W, wallH, wallT), borderMat);
  wallNorth.position.set(0, wallH/2, -ARENA_H/2);
  const wallSouth = wallNorth.clone(); wallSouth.position.z = ARENA_H/2;
  const wallWest  = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, ARENA_H), borderMat);
  wallWest.position.set(-ARENA_W/2, wallH/2, 0);
  const wallEast  = wallWest.clone(); wallEast.position.x = ARENA_W/2;
  scene.add(wallNorth, wallSouth, wallWest, wallEast);
}

/* -------- Optional: Fabric décor (instanced) -------- */
(function addYarnDecor() {
  const palette = [0xD9747A, 0x6AA9FF, 0x9EE09E, 0xE7C77A, 0xCE98F7, 0xF2A65A, 0x84DCC6];
  const pick = () => palette[(Math.random() * palette.length) | 0];

  const loopCount = 300, strandCount = 300;
  const loopGeom  = new THREE.TorusGeometry(6, 0.35, 8, 24);
  const loopMat   = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  const loopMesh  = new THREE.InstancedMesh(loopGeom, loopMat, loopCount);
  loopMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(loopMesh);

  const strandGeom = new THREE.CylinderGeometry(0.2, 0.2, 8, 8);
  const strandMat  = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  const strandMesh = new THREE.InstancedMesh(strandGeom, strandMat, strandCount);
  strandMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(strandMesh);

  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), m4 = new THREE.Matrix4();
  const halfW = ARENA_W / 2 - 30, halfH = ARENA_H / 2 - 30;

  for (let i = 0; i < loopCount; i++) {
    pos.set((Math.random()*2-1)*halfW, 0.2, (Math.random()*2-1)*halfH);
    quat.setFromEuler(new THREE.Euler(-Math.PI/2, Math.random()*Math.PI*2, 0));
    const s = 0.7 + Math.random()*0.8; scl.set(s,s,s);
    m4.compose(pos, quat, scl);
    loopMesh.setMatrixAt(i, m4);
    loopMesh.setColorAt(i, new THREE.Color(pick()));
  }
  loopMesh.instanceMatrix.needsUpdate = true;
  loopMesh.instanceColor.needsUpdate = true;

  for (let i = 0; i < strandCount; i++) {
    pos.set((Math.random()*2-1)*halfW, 0.25, (Math.random()*2-1)*halfH);
    quat.setFromEuler(new THREE.Euler(0, Math.random()*Math.PI*2, Math.PI/2));
    const len = 0.7 + Math.random()*1.6; scl.set(1, len, 1);
    m4.compose(pos, quat, scl);
    strandMesh.setMatrixAt(i, m4);
    strandMesh.setColorAt(i, new THREE.Color(pick()));
  }
  strandMesh.instanceMatrix.needsUpdate = true;
  strandMesh.instanceColor.needsUpdate = true;
})();

/* ---------------- Territory Fabric (tiles) ---------------- */
const tileGeom = new THREE.PlaneGeometry(58, 58);
tileGeom.rotateX(-Math.PI/2);
const redMat  = new THREE.MeshStandardMaterial({ color: 0xff6a6a, roughness: 0.9, metalness: 0.05, transparent: true, opacity: 0.35 });
const blueMat = new THREE.MeshStandardMaterial({ color: 0x6aa9ff, roughness: 0.9, metalness: 0.05, transparent: true, opacity: 0.35 });

const MAX_TILES = ((ARENA_W / 60) * (ARENA_H / 60) + 200) | 0;
const redMesh  = new THREE.InstancedMesh(tileGeom, redMat,  MAX_TILES);
const blueMesh = new THREE.InstancedMesh(tileGeom, blueMat, MAX_TILES);
redMesh.count = 0; blueMesh.count = 0;
scene.add(redMesh, blueMesh);

const redIndex  = new Map();
const blueIndex = new Map();
const m4 = new THREE.Matrix4();

function cellKey(c,r){ return `${c},${r}`; }
function cellCenter(c,r){
  return new THREE.Vector3(
    c*60 - ARENA_W/2 + 30,
    0.08,
    r*60 - ARENA_H/2 + 30
  );
}
function setTile(mesh, map, c, r){
  const key = cellKey(c,r);
  if (map.has(key)) return;
  const i = mesh.count++;
  const pos = cellCenter(c,r);
  m4.makeTranslation(pos.x, pos.y, pos.z);
  mesh.setMatrixAt(i, m4);
  map.set(key, i);
  mesh.instanceMatrix.needsUpdate = true;
}
function clearTile(mesh, map, c, r){
  const key = cellKey(c,r);
  const i = map.get(key);
  if (i === undefined) return;
  const last = mesh.count - 1;
  if (i !== last) {
    const tmp = new THREE.Matrix4();
    mesh.getMatrixAt(last, tmp);
    mesh.setMatrixAt(i, tmp);
    for (const [k, idx] of map) { if (idx === last){ map.set(k, i); break; } }
  }
  mesh.count = Math.max(0, mesh.count - 1);
  map.delete(key);
  mesh.instanceMatrix.needsUpdate = true;
}

/* ---------------- Labels & Player Groups ---------------- */
function makeLabelCanvas(text) {
  const cnv = document.createElement("canvas");
  const ctx = cnv.getContext("2d");
  const font = 28;
  ctx.font = `${font}px "Segoe UI", Arial`;
  const w = Math.ceil(ctx.measureText(text).width + 20);
  const h = font + 12;
  cnv.width = w; cnv.height = h;
  ctx.font = `${font}px "Segoe UI", Arial`;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#eee";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 10, h / 2);
  const tex = new THREE.CanvasTexture(cnv);
  tex.minFilter = THREE.LinearFilter;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
}

const meGroup = new THREE.Group();
scene.add(meGroup);
let meSphere = null;
const otherMeshes = new Map();
const meTrail = new Trail(scene, 0xeeeeee, 150, 0.35, 0.25);
const otherTrails = new Map();

/* ---------------- Input & Send ---------------- */
const keys = {};
window.addEventListener("keydown", (e) => {
  if (/input|textarea/i.test(e.target.tagName)) return;
  keys[e.key.toLowerCase()] = true;
});
window.addEventListener("keyup",   (e) => { keys[e.key.toLowerCase()] = false; });

function sendInput() {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0; forward.normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), forward).normalize();

  let x = 0, z = 0;
  if (keys["w"] || keys["arrowup"])    { x += forward.x; z += forward.z; }
  if (keys["s"] || keys["arrowdown"])  { x -= forward.x; z -= forward.z; }
  if (keys["d"] || keys["arrowright"]) { x += right.x;   z += right.z;   }
  if (keys["a"] || keys["arrowleft"])  { x -= right.x;   z -= right.z;   }

  const mag = Math.hypot(x, z);
  if (mag > 0) { x /= mag; z /= mag; }

  socket.emit("move3d", { dx: x, dz: z });
}
setInterval(sendInput, 1000 / 30);

/* ---------------- Network handlers ---------------- */
socket.on("territoryUpdate", (cells) => {
  for (const { c, r, team, level } of cells) {
    if (team === "red" && level > 0) {
      setTile(redMesh, redIndex, c, r);
      clearTile(blueMesh, blueIndex, c, r);
    } else if (team === "blue" && level > 0) {
      setTile(blueMesh, blueIndex, c, r);
      clearTile(redMesh, redIndex, c, r);
    } else {
      clearTile(redMesh, redIndex, c, r);
      clearTile(blueMesh, blueIndex, c, r);
    }
  }
});
socket.on("teamScore", (t) => {
  const title = document.querySelector("#leaderboard h3");
  if (title) title.textContent = `🏆 Leaderboard  —  🔴 ${t.red}  |  🔵 ${t.blue}`;
});

socket.on("state3d", (snapshot) => {
  waitDiv.style.display = "none";
  updateLeaderboard(snapshot);

  // Local player
  const mine = snapshot.find(p => p.id === socket.id);
  if (mine) {
    if (!meSphere) {
      const geom = new THREE.SphereGeometry(6, 24, 18);
      const mat = new THREE.MeshStandardMaterial({ color: mine.color || 0x66ccff, metalness: 0.1, roughness: 0.6 });
      meSphere = new THREE.Mesh(geom, mat);
      meGroup.add(meSphere);
      controls.target.set(mine.x, 6, mine.z);
    }
    meGroup.position.set(mine.x, mine.y, mine.z);
    meTrail.addPoint(mine.x, mine.y, mine.z);
    controls.target.lerp(new THREE.Vector3(mine.x, mine.y, mine.z), 0.2);
  }

  // Others
  const seen = new Set();
  if (mine) seen.add(mine.id);

  for (const p of snapshot) {
    if (p.id === socket.id) continue;
    seen.add(p.id);

    if (!otherMeshes.has(p.id)) {
      const group = new THREE.Group();
      const geom = new THREE.SphereGeometry(6, 24, 18);
      const mat = new THREE.MeshStandardMaterial({ color: p.color || 0xffaa00, metalness: 0.1, roughness: 0.6 });
      const mesh = new THREE.Mesh(geom, mat);
      const label = makeLabelCanvas(p.name || "?");
      label.position.set(0, 12, 0);
      group.add(mesh, label);
      scene.add(group);
      otherMeshes.set(p.id, { group, mesh, label });
    }
    const entry = otherMeshes.get(p.id);
    entry.group.position.set(p.x, p.y, p.z);

    if (!otherTrails.has(p.id)) {
      const color = new THREE.Color(p.color || 0xffaa00).offsetHSL(0, -0.2, -0.1).getHex();
      otherTrails.set(p.id, new Trail(scene, color, 90, 0.28, 0.22));
    }
    otherTrails.get(p.id).addPoint(p.x, p.y, p.z);
  }

  // Cleanup
  for (const [id, obj] of otherMeshes) {
    if (!seen.has(id)) {
      scene.remove(obj.group);
      otherMeshes.delete(id);
      const tr = otherTrails.get(id);
      if (tr) {
        scene.remove(tr.mesh);
        tr.mesh.geometry.dispose();
        tr.mesh.material.dispose();
        otherTrails.delete(id);
      }
    }
  }
});

/* ---------------- Render Loop ---------------- */
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
