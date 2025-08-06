// public/script-3d-esm.js
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.155.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/loaders/FBXLoader.js";
import { SkeletonUtils } from "https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/utils/SkeletonUtils.js";

const fbxLoader = new FBXLoader();
let baseModel = null;
let modelLoaded = false;
let pendingSnapshot = null;
const modelPromise = new Promise((resolve, reject) => {
  fbxLoader.load(
    "/models/User.fbx",
    (fbx) => {
      baseModel = fbx;
      modelLoaded = true;
      resolve(fbx);
    },
    undefined,
    (err) => reject(err)
  );
});

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
let myColor = "#ffffff";

const stored = JSON.parse(localStorage.getItem("playerInfo") || "null");
if (stored && Date.now() - stored.created < 30 * 24 * 60 * 60 * 1000) {
  myName = stored.name;
  myColor = stored.color;
  document.getElementById("nameModal").style.display = "none";
  socket.emit("join", { name: myName, color: myColor });
} else {
  const rand = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  document.getElementById("colorInput").value = rand;
}

document.getElementById("startGame").onclick = () => {
  myName = document.getElementById("nameInput").value.trim();
  myColor = document.getElementById("colorInput").value;
  if (!myName) return alert("Please enter your name!");
  document.getElementById("nameModal").style.display = "none";
  localStorage.setItem("playerInfo", JSON.stringify({ name: myName, color: myColor, created: Date.now() }));
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
socket.on("chat", ({ id, name, text }) => {
  const div = document.createElement("div");
  div.innerHTML = `<strong>${name}:</strong> ${text}`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  showChatBubble(id, text);
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

// Arena + Yarn decor + territory tile code stays exactly as in your version
// [KEEP YOUR ORIGINAL DECOR/TILE CODE HERE UNCHANGED — omitted here for brevity but included in your file]

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
  return { sprite: new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })), width: w, height: h };
}

const meGroup = new THREE.Group();
scene.add(meGroup);
let meModel = null;
const otherMeshes = new Map();
const meTrail = new Trail(scene, 0xeeeeee, 150, 0.35, 0.25);
const otherTrails = new Map();
const chatBubbles = new Map();

function showChatBubble(id, text) {
  const target = id === socket.id ? meGroup : otherMeshes.get(id)?.group;
  if (!target) return;
  const existing = chatBubbles.get(id);
  if (existing) {
    target.remove(existing.sprite);
    clearTimeout(existing.timeout);
  }
  const { sprite, width, height } = makeLabelCanvas(text);
  sprite.scale.set(width * 0.015, height * 0.015, 1);
  sprite.position.set(0, 18, 0);
  target.add(sprite);
  const timeout = setTimeout(() => {
    target.remove(sprite);
    chatBubbles.delete(id);
  }, 3000);
  chatBubbles.set(id, { sprite, timeout });
}

/* ---------------- Network handlers ---------------- */
function processSnapshot(snapshot) {
  const seen = new Set();

  snapshot.forEach((p) => {
    seen.add(p.id);

    if (p.id === socket.id) {
      if (!meModel && baseModel) {
        meModel = SkeletonUtils.clone(baseModel);
        meModel.traverse(child => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              color: p.color || 0x66ccff,
              roughness: 0.6,
              metalness: 0.1,
              skinning: true,
            });
          }
        });
        meModel.scale.set(0.12, 0.12, 0.12);

        const { sprite, width, height } = makeLabelCanvas(p.name || myName || "?");
        sprite.scale.set(width * 0.02, height * 0.02, 1);
        sprite.position.set(0, 12, 0);
        meModel.add(sprite);

        meGroup.add(meModel);
        controls.target.set(p.x, 6, p.z);
      }

      meGroup.position.set(p.x, p.y, p.z);
      meTrail.addPoint(p.x, p.y, p.z);
      controls.target.lerp(new THREE.Vector3(p.x, p.y, p.z), 0.2);
    } else {
      if (!otherMeshes.has(p.id) && baseModel) {
        const group = new THREE.Group();
        const model = SkeletonUtils.clone(baseModel);
        model.traverse(child => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              color: p.color || 0xffaa00,
              roughness: 0.6,
              metalness: 0.1,
              skinning: true,
            });
          }
        });
        model.scale.set(0.12, 0.12, 0.12);
        group.add(model);

        const { sprite, width, height } = makeLabelCanvas(p.name || "?");
        sprite.scale.set(width * 0.02, height * 0.02, 1);
        sprite.position.set(0, 12, 0);
        group.add(sprite);

        otherMeshes.set(p.id, { group, model, label: sprite });
        scene.add(group);
      }

      const obj = otherMeshes.get(p.id);
      if (obj) obj.group.position.set(p.x, p.y, p.z);
    }
  });

  // Cleanup removed players
  for (const [id, obj] of otherMeshes) {
    if (!seen.has(id)) {
      scene.remove(obj.group);
      otherMeshes.delete(id);
    }
  }
}

socket.on("state3d", (snapshot) => {
  waitDiv.style.display = "none";
  updateLeaderboard(snapshot);

  if (!modelLoaded) {
    pendingSnapshot = snapshot;
    return;
  }

  processSnapshot(snapshot);
});

modelPromise.then(() => {
  if (pendingSnapshot) {
    processSnapshot(pendingSnapshot);
    pendingSnapshot = null;
  }
}).catch((err) => console.error("Failed to load model", err));

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
