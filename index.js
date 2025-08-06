const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use("/models", express.static("public/models"));

const players = {}; // id -> { x,y,z, name, color }

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // wait for client to send name & color before adding them
  socket.on("register", ({ name, color }) => {
    players[socket.id] = { x: 0, y: 0, z: 0, name, color };

    // send current roster to the newcomer
    socket.emit("currentPlayers", { players, you: socket.id });

    // tell others about the new player
    socket.broadcast.emit("newPlayer", { id: socket.id, ...players[socket.id] });
  });

  socket.on("move", (pos) => {
    const p = players[socket.id];
    if (!p) return;
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
