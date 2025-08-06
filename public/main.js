const socket = io();

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

camera.position.z = 5;

let cubes = {};

function createCube(color = 0x00ff00) {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial({ color });
    return new THREE.Mesh(geometry, material);
}

socket.on("currentPlayers", (players) => {
    for (let id in players) {
        const cube = createCube(id === socket.id ? 0x0000ff : 0xff0000);
        cube.position.set(players[id].x, players[id].y, players[id].z);
        scene.add(cube);
        cubes[id] = cube;
    }
});

socket.on("newPlayer", (player) => {
    const cube = createCube(0xff0000);
    cube.position.set(player.x, player.y, player.z);
    scene.add(cube);
    cubes[player.id] = cube;
});

socket.on("playerMoved", (player) => {
    if (cubes[player.id]) {
        cubes[player.id].position.set(player.x, player.y, player.z);
    }
});

socket.on("removePlayer", (id) => {
    if (cubes[id]) {
        scene.remove(cubes[id]);
        delete cubes[id];
    }
});

// Movement
document.addEventListener("keydown", (event) => {
    let cube = cubes[socket.id];
    if (!cube) return;
    if (event.key === "w") cube.position.z -= 0.1;
    if (event.key === "s") cube.position.z += 0.1;
    if (event.key === "a") cube.position.x -= 0.1;
    if (event.key === "d") cube.position.x += 0.1;
    socket.emit("move", { x: cube.position.x, y: cube.position.y, z: cube.position.z });
});

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();
