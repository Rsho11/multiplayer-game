const express   = require("express");
const http      = require("http");
const { Server } = require("socket.io");
const { OAuth2Client } = require("google-auth-library");  // NEW

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "410563389240-cj67c6dalqbg1d7dllba097327gs23pa.apps.googleusercontent.com";
const oauth = new OAuth2Client(GOOGLE_CLIENT_ID);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use("/models", express.static("public/models"));

// player store: id -> { x,y,z, name, color, isGuest, google: {sub,name,picture} }
const players = {};
const friends = {}; // id -> Set of friend ids

io.on("connection", (socket) => {

  // ---- 1. Guest path ------------------------------------------------
  socket.on("registerGuest", ({ name, color }) => {
    players[socket.id] = { x:0,y:0,z:0, name, color, isGuest:true };
    socket.emit("currentPlayers", { players, you: socket.id });
    socket.broadcast.emit("newPlayer", { id: socket.id, ...players[socket.id] });
  });

  // ---- 2. Google path ----------------------------------------------
  socket.on("googleLogin", async ({ idToken, name, color }) => {
    try {
      const ticket = await oauth.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload(); // {sub,email,name,picture}
      players[socket.id] = {
        x:0,y:0,z:0,
        name, color,
        isGuest:false,
        google: { sub: payload.sub, name: payload.name, picture: payload.picture }
      };
      socket.emit("currentPlayers", { players, you: socket.id });
      socket.broadcast.emit("newPlayer", { id: socket.id, ...players[socket.id] });
    } catch (err) {
      console.error("Bad Google token", err);
      socket.emit("googleError", "Login failed");
    }
  });

  // ---- movement + chat (unchanged) ---------------------------------
  socket.on("move", (pos) => {
    const p = players[socket.id]; if (!p) return;
    players[socket.id] = { ...p, ...pos };
    socket.broadcast.emit("playerMoved", { id: socket.id, ...players[socket.id] });
  });

  socket.on("chat", (txt) => {
    const p = players[socket.id]; if (!p) return;
    io.emit("chat", { id: socket.id, text: String(txt||"").slice(0,160) });
  });

  socket.on("typing", (flag) => {
    socket.broadcast.emit("typing", { id: socket.id, typing: !!flag });
  });

  socket.on("friendRequest", ({ to }) => {
    const me = players[socket.id];
    const target = players[to];
    if (!me || me.isGuest || !target || target.isGuest) return;
    io.to(to).emit("friendRequest", { from: socket.id, name: me.name });
  });

  socket.on("friendAccept", ({ from }) => {
    const me = players[socket.id];
    const other = players[from];
    if (!me || me.isGuest || !other || other.isGuest) return;
    friends[socket.id] = friends[socket.id] || new Set();
    friends[from] = friends[from] || new Set();
    friends[socket.id].add(from);
    friends[from].add(socket.id);
    io.to(socket.id).emit("friendAccepted", { id: from, name: other?.name });
    io.to(from).emit("friendAccepted", { id: socket.id, name: me?.name });
  });

  socket.on("privateChat", ({ to, text }) => {
    if (friends[socket.id]?.has(to)) {
      const msg = String(text||"").slice(0,160);
      io.to(to).emit("privateChat", { id: socket.id, text: msg });
      socket.emit("privateChat", { id: socket.id, text: msg });
    }
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    delete friends[socket.id];
    Object.values(friends).forEach((set) => set.delete(socket.id));
    io.emit("removePlayer", socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log("Server on http://localhost:"+PORT));
