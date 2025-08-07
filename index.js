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

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log("Server on http://localhost:"+PORT));
