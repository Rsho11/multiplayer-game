// public/script-3d-esm.js
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.155.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/controls/OrbitControls.js";

const socket = io(); // If deploying on a different origin, use: io(window.location.origin, { transports: ["websocket"] })
console.log("[client] script-3d-esm.js loaded");

// ====== UI (name + chat) ======
let myName = "";
const startBtn = document.getElementById("startGame");
startBtn.onclick = () => {
  myName = document.getElementById("nameInput").value.trim();
  if (!myName) return alert("Please enter your name!");
  document.getElementById("nameModal").style.display = "none";
  const myColor = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  console.log("[client] join ->", myName, myColor);
  socket.emit("join", { name: myName, color: myColor });
};

// chat
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

// leaderboard
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

// ====== Three.js scene ======
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x131313);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// waiting overlay
const waitDiv = document.createElement("div");
waitDiv.style.position = "fixed";
waitDiv.style.top = "50%";
waitDiv.style.left = "50%";
waitDiv.style.transform = "translate(-50%, -50%)";
waitDiv.style.color = "#ddd";
waitDiv.style.font = "16px Segoe UI, sans-serif";
waitDiv.style.padding = "8px 12px";
waitDiv.style.background = "rgba(0,0,0,0.5)";
waitDiv.style.border = "1px solid #444";
waitDiv.style.borderRadius = "8px";
waitDiv.style.zIndex = "4";
waitDiv.textContent = "Waiting for server state...";
document.body.appendChild(waitDiv);

// camera + orbit controls
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000);
camera.position.set(0, 140, 260);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.target.set(0, 6, 0);
controls.minDistance = 90;
controls.maxDistance = 360;
controls.minPolarAngle = 0.2 * Math.PI;
controls.maxPolarAngle = 0.49 * Math.PI;

// brighter lights so floor is visible
{
  const amb = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(amb);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x333344, 0.6);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(200, 400, 200);
  scene.add(dir);
}

// arena floor + borders
const ARENA_W = 4048, ARENA_H = 4048;
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

  grid.position.y = 0.05;
}

// fallback origin marker

const meGroup = new THREE.Group();
scene.add(meGroup);
let meSphere = null;
const otherMeshes = new Map(); // id -> {group, mesh, label}


// --- Fabric "yarn" décor on the floor (fast instancing) ---
(function addYarnDecor() {
  // Palette of soft yarn tones
  const palette = [0xD9747A, 0x6AA9FF, 0x9EE09E, 0xE7C77A, 0xCE98F7, 0xF2A65A, 0x84DCC6];

  // Helper to pick a palette color
  const pickColor = () => palette[(Math.random() * palette.length) | 0];

  // 1) Loops of thread (thin torus lying on the floor)
  const loopCount = 300;                         // adjust density here
  const loopGeom  = new THREE.TorusGeometry(6, 0.35, 8, 24); // radius, tube, radial/tubular segments
  const loopMat   = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  const loopMesh  = new THREE.InstancedMesh(loopGeom, loopMat, loopCount);
  loopMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(loopMesh);

  // 2) Short strands (thin cylinders laid sideways)
  const strandCount = 300;
  const strandGeom = new THREE.CylinderGeometry(0.2, 0.2, 8, 8);
  const strandMat  = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  const strandMesh = new THREE.InstancedMesh(strandGeom, strandMat, strandCount);
  strandMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(strandMesh);

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const m4 = new THREE.Matrix4();

  // scatter helper
  const halfW = ARENA_W / 2 - 30;   // keep a little margin from walls
  const halfH = ARENA_H / 2 - 30;

  // place loops
  for (let i = 0; i < loopCount; i++) {
    pos.set(
      (Math.random() * 2 - 1) * halfW,
      0.2,
      (Math.random() * 2 - 1) * halfH
    );
    // random yaw
    const yaw = Math.random() * Math.PI * 2;
    quat.setFromEuler(new THREE.Euler(-Math.PI/2, yaw, 0)); // lay flat on floor then rotate around Y
    // slight size variance
    const s = 0.7 + Math.random() * 0.8;
    scale.set(s, s, s);
    m4.compose(pos, quat, scale);
    loopMesh.setMatrixAt(i, m4);
    loopMesh.setColorAt(i, new THREE.Color(pickColor()));
  }
  loopMesh.instanceColor.needsUpdate = true;
  loopMesh.instanceMatrix.needsUpdate = true;

  // place strands
  for (let i = 0; i < strandCount; i++) {
    pos.set(
      (Math.random() * 2 - 1) * halfW,
      0.25,
      (Math.random() * 2 - 1) * halfH
    );
    // lay on floor, random yaw
    const yaw = Math.random() * Math.PI * 2;
    quat.setFromEuler(new THREE.Euler(0, yaw, Math.PI/2)); // rotate cylinder sideways
    // random length scaling
    const len = 0.7 + Math.random() * 1.6;
    scale.set(1, len, 1);
    m4.compose(pos, quat, scale);
    strandMesh.setMatrixAt(i, m4);
    strandMesh.setColorAt(i, new THREE.Color(pickColor()));
  }
  strandMesh.instanceColor.needsUpdate = true;
  strandMesh.instanceMatrix.needsUpdate = true;
})();


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

// ====== Input: WASD relative to camera ======
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

// ====== Networking: apply server snapshot ======
socket.on("state3d", (snapshot) => {
  waitDiv.style.display = "none";
  updateLeaderboard(snapshot);

  const mine = snapshot.find(p => p.id === socket.id);
  if (mine && !meSphere) {
    const geom = new THREE.SphereGeometry(6, 24, 18);
    const mat = new THREE.MeshStandardMaterial({ color: mine.color || 0x66ccff, metalness: 0.1, roughness: 0.6 });
    meSphere = new THREE.Mesh(geom, mat);
    meGroup.add(meSphere);
    controls.target.set(mine.x, 6, mine.z);
  }

  const seen = new Set();
  for (const p of snapshot) {
    if (p.id === socket.id) {
      if (meSphere) {
        meGroup.position.set(p.x, p.y, p.z);
        controls.target.lerp(new THREE.Vector3(p.x, p.y, p.z), 0.2);
      }
      continue;
    }
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
  }

  // remove stale
  for (const [id, obj] of otherMeshes) {
    if (!seen.has(id)) {
      scene.remove(obj.group);
      otherMeshes.delete(id);
    }
  }
});

// ====== Render loop ======
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// resize
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
