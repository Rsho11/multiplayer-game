const socket = io();
let canvas = document.querySelector("canvas");
let ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let players = {};
let me = null;
let trails = {};
let myName = "";
let myColor = "#" + Math.floor(Math.random() * 16777215).toString(16);
let team = Math.random() < 0.5 ? 'red' : 'blue';
let keys = {};

// 🚪 Start game after name input
document.getElementById("startGame").onclick = () => {
  myName = document.getElementById("nameInput").value.trim();
  if (myName.length < 1) return alert("Please enter your name!");
  document.getElementById("nameModal").style.display = "none";
  socket.emit("join", { name: myName, color: myColor, team });
};

window.addEventListener("keydown", e => keys[e.key] = true);
window.addEventListener("keyup", e => keys[e.key] = false);

socket.on("update", serverPlayers => {
  players = serverPlayers;
  me = players[socket.id];

  for (let id in players) {
    if (!trails[id]) trails[id] = [];
    trails[id].push({ x: players[id].x, y: players[id].y });
    if (trails[id].length > 50) trails[id].shift();
  }
});

// 🧵 Chat
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const messages = document.getElementById("messages");

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (msg) {
    socket.emit("chat", msg);
    chatInput.value = "";
  }
});

socket.on("chat", ({ id, text }) => {
  const div = document.createElement("div");
  const name = players[id]?.name || "Unknown";
  div.innerHTML = `<strong>${name}:</strong> ${text}`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
});

// 🚶 Movement
function sendInput() {
  let dx = 0, dy = 0;
  if (keys["w"]) dy = -1;
  if (keys["s"]) dy = 1;
  if (keys["a"]) dx = -1;
  if (keys["d"]) dx = 1;
  socket.emit("move", { dx, dy });
}
setInterval(sendInput, 1000 / 30);

// 🎨 Draw players + trails + names
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

    // name tag
    ctx.fillStyle = "#ccc";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.name || "?", p.x, p.y - 12);
  }

  requestAnimationFrame(draw);
}
draw();


const leaderboardList = document.getElementById("leaderboardList");

socket.on("leaderboard", (topPlayers) => {
  leaderboardList.innerHTML = "";
  topPlayers.forEach((p, i) => {
    const li = document.createElement("li");
    li.textContent = `#${i + 1} ${p.name}: ${p.score}`;
    leaderboardList.appendChild(li);
  });
});
