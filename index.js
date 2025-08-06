const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static("public"));
app.use("/models", express.static("public/models"));

// id -> { x,y,z, name, color }
const players = {};

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // Client will send name & color before we add them to the world
  socket.on("register", ({ name, color }) => {
    players[socket.id] = { x: 0, y: 0, z: 0, name, color };

    // Send the roster to newcomer
    socket.emit("currentPlayers", { players, you: socket.id });

    // Tell others about the join
    socket.broadcast.emit("newPlayer", { id: socket.id, ...players[socket.id] });
  });

  socket.on("move", (pos) => {
    const p = players[socket.id];
    if (!p) return; // ignore until registered
    players[socket.id] = { ...p, ...pos };
    socket.broadcast.emit("playerMoved", { id: socket.id, ...players[socket.id] });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
