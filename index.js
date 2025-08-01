// index.js
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

const players = new Map(); // id -> player
const ARENA = { w: 1200, h: 800 };      // X [-w/2,+w/2], Z [-h/2,+h/2]
const TICK_HZ = 60;
const DT = 1 / TICK_HZ;
const ACCEL = 90 * DT;      // acceleration per tick toward input dir
const FRICTION = 0.90;      // velocity decay per tick (sliding)
const MAX_SPEED = 300 * DT; // clamp speed per tick

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("join", ({ name, color }) => {
    // random spawn inside arena
    const x = (Math.random() - 0.5) * (ARENA.w - 100);
    const z = (Math.random() - 0.5) * (ARENA.h - 100);

    // random initial direction so they move right away
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1]
    ];
    const [dx, dz] = dirs[Math.floor(Math.random() * dirs.length)];

    players.set(socket.id, {
      id: socket.id,
      name: String(name || "Player").slice(0, 16),
      color: color || "#66ccff",
      x, y: 2, z,
      vx: dx * (MAX_SPEED * 0.75),
      vz: dz * (MAX_SPEED * 0.75),
      inDx: dx, inDz: dz,        // last input direction
      inputActive: true,         // whether to accelerate this tick
      score: 0,
    });
  });

  // client sends input direction in world space (XZ), normalized or 0
  socket.on("move3d", ({ dx, dz }) => {
    const p = players.get(socket.id);
    if (!p) return;

    // if there is input, update the desired dir; otherwise keep last dir (slide)
    if (typeof dx === "number" && typeof dz === "number") {
      const mag = Math.hypot(dx, dz);
      if (mag > 0.0001) {
        p.inDx = dx / mag;
        p.inDz = dz / mag;
        p.inputActive = true;
      } else {
        p.inputActive = false; // no new acceleration; friction will apply
      }
    }
  });

  socket.on("chat", (msg) => {
    const p = players.get(socket.id);
    io.emit("chat", { id: socket.id, name: p?.name || "?", text: String(msg).slice(0, 200) });
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
  });
});

// physics + broadcast
setInterval(() => {
  for (const p of players.values()) {
    // accelerate toward input dir only if active
    if (p.inputActive) {
      p.vx += p.inDx * ACCEL;
      p.vz += p.inDz * ACCEL;
    }

    // clamp speed
    const speed = Math.hypot(p.vx, p.vz);
    if (speed > MAX_SPEED) {
      const s = MAX_SPEED / speed;
      p.vx *= s; p.vz *= s;
    }

    // integrate
    p.x += p.vx;
    p.z += p.vz;

    // friction for sliding feel
    p.vx *= FRICTION;
    p.vz *= FRICTION;

    // collide with arena bounds (simple bounce & slide)
    const halfW = ARENA.w / 2, halfH = ARENA.h / 2;

    if (p.x < -halfW) { p.x = -halfW; p.vx = Math.abs(p.vx) * 0.4; }
    if (p.x >  halfW) { p.x =  halfW; p.vx = -Math.abs(p.vx) * 0.4; }
    if (p.z < -halfH) { p.z = -halfH; p.vz = Math.abs(p.vz) * 0.4; }
    if (p.z >  halfH) { p.z =  halfH; p.vz = -Math.abs(p.vz) * 0.4; }
  }

  // broadcast a compact snapshot
  const snapshot = [];
  for (const p of players.values()) {
    snapshot.push({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, score: p.score });
  }
  io.emit("state3d", snapshot);
}, 1000 / TICK_HZ);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`✅ 3D server running on port ${PORT}`);
});
