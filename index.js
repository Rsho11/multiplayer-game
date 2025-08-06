const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use("/models", express.static("public/models"));

// In-memory player state
const players = {};

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);
  // spawn at origin
  players[socket.id] = { x: 0, y: 0, z: 0 };

  socket.emit("currentPlayers", { players, you: socket.id });
  socket.broadcast.emit("newPlayer", { id: socket.id, ...players[socket.id] });

  socket.on("move", (pos) => {
    players[socket.id] = pos;
    socket.broadcast.emit("playerMoved", { id: socket.id, ...pos });
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
