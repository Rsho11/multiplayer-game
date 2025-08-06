import * as THREE from 'https://unpkg.com/three@0.159.0/build/three.module.js';
import { FBXLoader } from 'https://unpkg.com/three@0.159.0/examples/jsm/loaders/FBXLoader.js';

const socket = io();

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(0, 10, 10);
scene.add(light);

camera.position.set(0, 3, 8);

let players = {};
const loader = new FBXLoader();

function loadPlayerModel(id, position, isLocal) {
    loader.load("/models/player.fbx", (object) => {
        object.scale.set(0.01, 0.01, 0.01);
        object.position.set(position.x, position.y, position.z);
        scene.add(object);
        players[id] = object;

        if (isLocal) {
            document.addEventListener("keydown", (event) => {
                if (!players[socket.id]) return;
                if (event.key === "w") object.position.z -= 0.1;
                if (event.key === "s") object.position.z += 0.1;
                if (event.key === "a") object.position.x -= 0.1;
                if (event.key === "d") object.position.x += 0.1;
                socket.emit("move", {
                    x: object.position.x,
                    y: object.position.y,
                    z: object.position.z
                });
            });
        }
    });
}

socket.on("currentPlayers", (data) => {
    for (let id in data) {
        loadPlayerModel(id, data[id], id === socket.id);
    }
});

socket.on("newPlayer", (player) => {
    loadPlayerModel(player.id, player, false);
});

socket.on("playerMoved", (player) => {
    if (players[player.id]) {
        players[player.id].position.set(player.x, player.y, player.z);
    }
});

socket.on("removePlayer", (id) => {
    if (players[id]) {
        scene.remove(players[id]);
        delete players[id];
    }
});

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();
