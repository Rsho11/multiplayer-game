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
    // Pick a random starting direction
    const angles = [ [1, 0], [-1, 0], [0, 1], [0, -1] ];
    const [dx, dy] = angles[Math.floor(Math.random() * angles.length)];

    players[socket.id] = {
      x: Math.random() * 800 + 100,
      y: Math.random() * 600 + 100,
      dx,
      dy,
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

    // Only update direction — position is handled in the main loop
    if (dx !== 0 || dy !== 0) {
      p.dx = dx;
      p.dy = dy;
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
  for (let id in players) {
    const p = players[id];
    if (!p) continue;

    // Move player
    p.x += p.dx * speed;
    p.y += p.dy * speed;

    // Clamp to game area
    p.x = Math.max(0, Math.min(p.x, 1920));
    p.y = Math.max(0, Math.min(p.y, 1080));

    // Save trail
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 60) p.trail.shift();

    // Check for loop (only when moving)
    if ((p.dx !== 0 || p.dy !== 0) && p.trail.length > 20) {
      const head = p.trail[p.trail.length - 1];
      for (let i = 0; i < p.trail.length - 10; i++) {
        const point = p.trail[i];
        const d = Math.hypot(point.x - head.x, point.y - head.y);
        if (d < 10) {
          p.score += 1;
          p.trail = [];
          break;
        }
      }
    }
  }

  io.emit("update", players);

  const topPlayers = Object.values(players)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => ({ name: p.name, score: p.score }));

  io.emit("leaderboard", topPlayers);
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
