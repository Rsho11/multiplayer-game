import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/FBXLoader.js';

let scene = new THREE.Scene();
let camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
let renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Light
const ambient = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(5, 10, 7.5);
scene.add(dirLight);

// Floor
const floorGeo = new THREE.PlaneGeometry(20, 20);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.name = "floor";
scene.add(floor);

// Walls (simple building)
const wallMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
const wallGeo = new THREE.BoxGeometry(20, 3, 0.2);
let wall1 = new THREE.Mesh(wallGeo, wallMat);
wall1.position.set(0, 1.5, -10);
scene.add(wall1);

let wall2 = wall1.clone();
wall2.position.set(0, 1.5, 10);
scene.add(wall2);

let wall3 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 20), wallMat);
wall3.position.set(-10, 1.5, 0);
scene.add(wall3);

let wall4 = wall3.clone();
wall4.position.set(10, 1.5, 0);
scene.add(wall4);

// FBX Model
let mixer;
let character;
const loader = new FBXLoader();
loader.load('/models/User.fbx', (fbx) => {
  character = fbx;
  character.scale.set(0.01, 0.01, 0.01);
  scene.add(character);
  character.position.set(0, 0, 0);
});

camera.position.set(0, 5, 10);
camera.lookAt(0, 0, 0);

// Click to move
let targetPosition = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('click', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects([floor]);
  if (intersects.length > 0) {
    targetPosition = intersects[0].point.clone();
    targetPosition.y = 0;
  }
});

function animate() {
  requestAnimationFrame(animate);
  if (character && targetPosition) {
    const dir = new THREE.Vector3().subVectors(targetPosition, character.position);
    const dist = dir.length();
    if (dist > 0.05) {
      dir.normalize();
      character.position.add(dir.multiplyScalar(0.05));
    }
  }
  renderer.render(scene, camera);
}
animate();
