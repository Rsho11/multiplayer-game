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
  };
});


  socket.on("move", ({ dx, dy }) => {
    const p = players[socket.id];
    if (!p) return;
    p.x += dx * speed;
    p.y += dy * speed;
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
}, 1000 / 30);

// ✅ Start the server — THIS WAS MISSING
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
