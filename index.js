const socket = io();
let canvas = document.querySelector("canvas");
let ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let players = {};
let me = null;
let trails = {}; // playerId => array of {x, y}
let myColor = "#" + Math.floor(Math.random()*16777215).toString(16);
let team = Math.random() < 0.5 ? 'red' : 'blue';

let keys = {};
window.addEventListener("keydown", e => keys[e.key] = true);
window.addEventListener("keyup", e => keys[e.key] = false);

socket.emit("join", { color: myColor, team });

socket.on("update", serverPlayers => {
  players = serverPlayers;

  for (let id in players) {
    if (!trails[id]) trails[id] = [];
    trails[id].push({ x: players[id].x, y: players[id].y });
    if (trails[id].length > 50) trails[id].shift();
  }

  me = players[socket.id];
});

function sendInput() {
  let dx = 0, dy = 0;
  if (keys["w"]) dy = -1;
  if (keys["s"]) dy = 1;
  if (keys["a"]) dx = -1;
  if (keys["d"]) dx = 1;
  socket.emit("move", { dx, dy });
}
setInterval(sendInput, 1000 / 30);

function draw() {
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let id in trails) {
    const color = players[id]?.color || "#999";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < trails[id].length; i++) {
      const p = trails[id][i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  for (let id in players) {
    const p = players[id];
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(draw);
}
draw();
