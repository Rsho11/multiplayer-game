// public/script-3d.js
const socket = io();

// ====== UI (name + chat) ======
let myName = "";
const startBtn = document.getElementById("startGame");
startBtn.onclick = () => {
  myName = document.getElementById("nameInput").value.trim();
  if (!myName) return alert("Please enter your name!");
  document.getElementById("nameModal").style.display = "none";
  const myColor = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
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
scene.background = new THREE.Color(0x111111);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// camera + orbit controls (3rd person)
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 80, 160);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.target.set(0, 2, 0);         // look at player height
controls.minDistance = 60;
controls.maxDistance = 220;
controls.minPolarAngle = 0.25 * Math.PI;
controls.maxPolarAngle = 0.49 * Math.PI;

// lights
{
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.8);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(100, 200, 100);
  scene.add(dir);
}

// arena floor + border walls
const ARENA_W = 1200, ARENA_H = 800;
{
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_W, ARENA_H, 1, 1),
    new THREE.MeshPhongMaterial({ color: 0x151515 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  const borderMat = new THREE.MeshPhongMaterial({ color: 0x404040 });
  const wallH = 12, wallT = 2;

  const wallNorth = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W, wallH, wallT), borderMat);
  wallNorth.position.set(0, wallH/2, -ARENA_H/2);
  const wallSouth = wallNorth.clone(); wallSouth.position.z = ARENA_H/2;

  const wallWest  = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, ARENA_H), borderMat);
  wallWest.position.set(-ARENA_W/2, wallH/2, 0);
  const wallEast  = wallWest.clone(); wallEast.position.x = ARENA_W/2;

  scene.add(wallNorth, wallSouth, wallWest, wallEast);

  // subtle grid lines
  const grid = new THREE.GridHelper(ARENA_W, 60, 0x2b2b2b, 0x2b2b2b);
  scene.add(grid);
}

// helpers for player meshes
const meGroup = new THREE.Group(); // local player (camera targets this)
scene.add(meGroup);
let meSphere = null;

const otherMeshes = new Map(); // id -> {group, mesh, label}

// make a text sprite for names
function makeLabelCanvas(text) {
  const cnv = document.createElement("canvas");
  const ctx = cnv.getContext("2d");
  const font = 28;
  ctx.font = `${font}px "Segoe UI", Arial`;
  const w = ctx.measureText(text).width + 20;
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
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w * 0.2, h * 0.2, 1);
  return sprite;
}

// ====== Input: WASD relative to camera ======
const keys = {};
window.addEventListener("keydown", (e) => { if (!/input|textarea/i.test(e.target.tagName)) keys[e.key.toLowerCase()] = true; });
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

  // normalize
  const mag = Math.hypot(x, z);
  if (mag > 0) { x /= mag; z /= mag; }

  socket.emit("move3d", { dx: x, dz: z });
}
setInterval(sendInput, 1000 / 30);

// ====== Networking: apply server snapshot ======
let lastSnapshot = [];
socket.on("state3d", (snapshot) => {
  lastSnapshot = snapshot;
  updateLeaderboard(snapshot);

  // ensure my mesh exists
  const mine = snapshot.find(p => p.id === socket.id);
  if (mine && !meSphere) {
    const geom = new THREE.SphereGeometry(6, 24, 18);
    const mat = new THREE.MeshStandardMaterial({ color: mine.color || 0x66ccff, metalness: 0.1, roughness: 0.6 });
    meSphere = new THREE.Mesh(geom, mat);
    meGroup.add(meSphere);

    // camera target follows me
    controls.target.set(mine.x, 2, mine.z);
  }

  // create/update others
  const seen = new Set();
  for (const p of snapshot) {
    if (p.id === socket.id) {
      if (meSphere) {
        meGroup.position.set(p.x, p.y, p.z);
        controls.target.lerp(new THREE.Vector3(p.x, p.y, p.z), 0.25);
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
      obj.group.traverse((o)=>{ if (o.material?.map) o.material.map.dispose(); o.material?.dispose?.(); o.geometry?.dispose?.(); });
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

// handle resize
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
