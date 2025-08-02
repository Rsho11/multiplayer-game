// public/script-3d.js
const socket = io();
console.log("[client] script-3d.js loaded");

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
console.log("[client] three.js scene created");

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
waitDiv.textContent = "Waiting for server state…";
document.body.appendChild(waitDiv);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000);
camera.position.set(0, 140, 260);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.target.set(0, 6, 0);
controls.minDistance = 90;
controls.maxDistance = 360;
controls.minPolarAngle = 0.2 * Math.PI;
controls.maxPolarAngle = 0.49 * Math.PI;

// brighter lights so floor is clearly visible
{
  const amb = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(amb);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x333344, 0.6);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(200, 400, 200);
  scene.add(dir);
}

// arena floor + border walls (high-contrast)
const ARENA_W = 1200, ARENA_H = 800;
{
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9, metalness: 0.0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, ARENA_H), floorMat);
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

  const grid = new THREE.GridHelper(ARENA_W, 40, 0x444444, 0x2a2a2a);
  grid.position.y = 0.05;
  scene.add(grid);
}


// ---- Territory fabric tiles (per team) ----
const tileGeom = new THREE.PlaneGeometry(58, 58);
tileGeom.rotateX(-Math.PI/2);
const redMat  = new THREE.MeshStandardMaterial({ color: 0xff6a6a, roughness: 0.9, metalness: 0.05, transparent: true, opacity: 0.35 });
const blueMat = new THREE.MeshStandardMaterial({ color: 0x6aa9ff, roughness: 0.9, metalness: 0.05, transparent: true, opacity: 0.35 });

const MAX_TILES = (ARENA_W / 60) * (ARENA_H / 60) + 200;
const redMesh  = new THREE.InstancedMesh(tileGeom, redMat,  MAX_TILES|0);
const blueMesh = new THREE.InstancedMesh(tileGeom, blueMat, MAX_TILES|0);
redMesh.count = 0; blueMesh.count = 0;
scene.add(redMesh, blueMesh);

// map cell "r,c" -> instance index for quick updates
const redIndex  = new Map();
const blueIndex = new Map();

function cellKey(c,r){ return `${c},${r}`; }
function cellCenter(c,r){
  return new THREE.Vector3(
    c*60 - ARENA_W/2 + 30,
    0.05,
    r*60 - ARENA_H/2 + 30
  );
}
const m4 = new THREE.Matrix4();
function setTile(mesh, map, c, r){
  const key = cellKey(c,r);
  if (map.has(key)) return; // already placed
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
  // swap-remove last
  const last = mesh.count - 1;
  if (i !== last) {
    const tmp = new THREE.Matrix4();
    mesh.getMatrixAt(last, tmp);
    mesh.setMatrixAt(i, tmp);
    // update map for moved instance
    for (const [k, idx] of map) {
      if (idx === last){ map.set(k, i); break; }
    }
  }
  mesh.count = Math.max(0, mesh.count - 1);
  map.delete(key);
  mesh.instanceMatrix.needsUpdate = true;
}


// fallback origin marker (so you see *something* even before snapshots)
{
  const cross = new THREE.AxesHelper(20);
  cross.position.set(0, 1, 0);
  scene.add(cross);
}

const meGroup = new THREE.Group();
scene.add(meGroup);
let meSphere = null;
const otherMeshes = new Map(); // id -> {group, mesh, label}

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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(w * 0.2, h * 0.2, 1);
  return sprite;
}

// ====== Input: WASD relative to camera ======
const keys = {};
window.addEventListener("keydown", (e) => {
  if (/input|textarea/i.test(e.target.tagName)) return;
  keys[e.key.toLowerCase()] = true;
});
window.addEventListener("keyup",   (e) => { keys[e.key.toLowerCase()] = false; });

function sendInput() {
  // camera-based forward/right on XZ plane
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
let lastCount = 0;
socket.on("state3d", (snapshot) => {
  waitDiv.style.display = "none";
  lastCount = snapshot.length;
  // console.log("[client] state3d players:", snapshot.length);
  updateLeaderboard(snapshot);

  const mine = snapshot.find(p => p.id === socket.id);
  if (mine && !meSphere) {
    const geom = new THREE.SphereGeometry(6, 24, 18);
    const mat = new THREE.MeshStandardMaterial({ color: mine.color || 0x66ccff, metalness: 0.1, roughness: 0.6 });
    meSphere = new THREE.Mesh(geom, mat);
    meGroup.add(meSphere);
    controls.target.set(mine.x, 6, mine.z);
    console.log("[client] created local sphere");
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

  // remove missing players
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
console.log("[client] render loop started");

// handle resize
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
