const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

const players = {};
const speed = 3;

io.on("connection", socket => {
  console.log("Player connected:", socket.id);

socket.on("join", ({ name, color, team }) => {
  players[socket.id] = {
    x: Math.random() * 800 + 100,
    y: Math.random() * 600 + 100,
    color,
    team,
    name,
    score: 0,
    trail: []
  };
});


socket.on("move", ({ dx, dy }) => {
  const p = players[socket.id];
  if (!p) return;

  p.x += dx * speed;
  p.y += dy * speed;

  // Add to trail
  p.trail.push({ x: p.x, y: p.y });
  if (p.trail.length > 60) p.trail.shift();

  // Loop detection: simple self-intersection
  if (p.trail.length > 20) {
    const head = p.trail[p.trail.length - 1];
    for (let i = 0; i < p.trail.length - 10; i++) {
      const point = p.trail[i];
      const d = Math.hypot(point.x - head.x, point.y - head.y);
      if (d < 10) {
        p.score += 1;
        p.trail = []; // reset trail after loop
        break;
      }
    }
  }
});

  socket.on("chat", (msg) => {
    io.emit("chat", { id: socket.id, text: msg });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
  });
});

setInterval(() => {
  io.emit("update", players);

  // Send top 10 for leaderboard
  const topPlayers = Object.values(players)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => ({ name: p.name, score: p.score }));

  io.emit("leaderboard", topPlayers);
}, 1000 / 30);

// ✅ Start the server — THIS WAS MISSING
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
