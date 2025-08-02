// index.js — 3D knitting: Blueprint Crafting + Territory Weaving
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

/* ---------- Arena + Physics ---------- */
const ARENA = { w: 2400, h: 1600 };   // bigger map
const TICK_HZ = 60;
const DT = 1 / TICK_HZ;
const ACCEL = 90 * DT;
const FRICTION = 0.90;
const MAX_SPEED = 300 * DT;

/* ---------- Territory Grid ---------- */
const CELL = 60;                                    // size of a tile on the floor
const COLS = Math.floor(ARENA.w / CELL);
const ROWS = Math.floor(ARENA.h / CELL);
// grid[r][c] = { team: 'red'|'blue'|null, level: 0..n }
const grid = Array.from({ length: ROWS }, () =>
  Array.from({ length: COLS }, () => ({ team: null, level: 0 }))
);
// team scores (territory & craft)
const teamScore = { red: 0, blue: 0 };

/* ---------- Players ---------- */
const players = new Map(); // id -> player

/* ---------- Blueprints ---------- */
const BLUEPRINTS = (() => {
  const TWO_PI = Math.PI * 2;
  const N = 64;
  const unitCircle = Array.from({ length: N }, (_, i) => {
    const t = (i / N) * TWO_PI;
    return { x: Math.cos(t), z: Math.sin(t) };
  });
  const unitPoly = (sides) => {
    return Array.from({ length: N }, (_, i) => {
      const t = (i / N) * TWO_PI;
      // snap to nearest polygon vertex arc
      const seg = Math.round((i / N) * sides) % sides;
      const a = (seg / sides) * TWO_PI;
      return { x: Math.cos(a), z: Math.sin(a) };
    });
  };
  return {
    circle:  { poly: unitCircle, baseScore: 60, product: "Bubble" },
    triangle:{ poly: unitPoly(3), baseScore: 40, product: "SpikePad" },
    square:  { poly: unitPoly(4), baseScore: 50, product: "Wall" },
  };
})();

/* ---------- Geometry Utils ---------- */
function areaShoelace(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a.x * b.z - b.x * a.z;
  }
  return 0.5 * s;
}
function perimeter(pts) {
  let p = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    p += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return p;
}
function rdpSimplify(pts, eps) {
  if (pts.length <= 2) return pts.slice();
  const dmaxIdx = (() => {
    let maxD = -1, idx = -1;
    const start = pts[0], end = pts[pts.length - 1];
    const vx = end.x - start.x, vz = end.z - start.z;
    const len2 = vx * vx + vz * vz || 1e-6;
    for (let i = 1; i < pts.length - 1; i++) {
      const px = pts[i].x - start.x, pz = pts[i].z - start.z;
      const t = Math.max(0, Math.min(1, (px * vx + pz * vz) / len2));
      const qx = start.x + t * vx, qz = start.z + t * vz;
      const d = Math.hypot(pts[i].x - qx, pts[i].z - qz);
      if (d > maxD) { maxD = d; idx = i; }
    }
    return { maxD, idx };
  })();
  if (rdpSimplify.cache === undefined) rdpSimplify.cache = {};
  const { maxD, idx } = dmaxIdx;
  if (maxD > eps) {
    const left = rdpSimplify(pts.slice(0, idx + 1), eps);
    const right = rdpSimplify(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  } else {
    return [pts[0], pts[pts.length - 1]];
  }
}
function resample(pts, N) {
  // resample polyline (closed) to N points by cumulative length
  const closed = pts[0] !== pts[pts.length - 1];
  const arr = closed ? pts.concat([pts[0]]) : pts.slice();
  const d = [0];
  for (let i = 1; i < arr.length; i++) {
    d[i] = d[i - 1] + Math.hypot(arr[i].x - arr[i - 1].x, arr[i].z - arr[i - 1].z);
  }
  const L = d[d.length - 1] || 1e-6;
  const out = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * L;
    let j = 1;
    while (j < d.length && d[j] < t) j++;
    const t0 = d[j - 1], t1 = d[j];
    const a = arr[j - 1], b = arr[j] || arr[0];
    const u = (t - t0) / Math.max(1e-6, t1 - t0);
    out.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u });
  }
  return out;
}
function normalizeLoop(pts) {
  // center to centroid, scale to unit RMS radius
  const n = pts.length;
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p.x; cz += p.z; }
  cx /= n; cz /= n;
  const centered = pts.map(p => ({ x: p.x - cx, z: p.z - cz }));
  let r2 = 0;
  for (const p of centered) r2 += p.x * p.x + p.z * p.z;
  const s = Math.sqrt(r2 / n) || 1;
  return centered.map(p => ({ x: p.x / s, z: p.z / s }));
}
function avgPointDist(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.hypot(a[i].x - b[i].x, a[i].z - b[i].z);
  return s / n;
}
function pointInPoly(x, z, poly) {
  // ray casting on XZ
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    const intersect = ((zi > z) !== (zj > z)) &&
                      (x < (xj - xi) * (z - zi) / (zj - zi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function cellsInPolygon(poly) {
  // returns list of {c,r} cells whose center lies inside poly
  const res = [];
  const halfW = ARENA.w / 2;
  const halfH = ARENA.h / 2;
  for (let r = 0; r < ROWS; r++) {
    const z = r * CELL - halfH + CELL / 2;
    for (let c = 0; c < COLS; c++) {
      const x = c * CELL - halfW + CELL / 2;
      if (pointInPoly(x, z, poly)) res.push({ c, r });
    }
  }
  return res;
}

/* ---------- Territory updates ---------- */
function claimCells(cells, team, strength = 1) {
  const changed = [];
  for (const { c, r } of cells) {
    const cell = grid[r]?.[c];
    if (!cell) continue;
    if (cell.team === team) {
      cell.level = Math.min(cell.level + strength, 5);
    } else {
      // if enemy owned, reduce; else claim
      if (cell.team && cell.team !== team && cell.level > 0) {
        cell.level -= strength;
        if (cell.level <= 0) { cell.team = null; cell.level = 0; }
      } else {
        cell.team = team;
        cell.level = strength;
      }
    }
    changed.push({ c, r, team: cell.team, level: cell.level });
  }
  if (changed.length) {
    io.emit("territoryUpdate", changed);
  }
}

/* ---------- Crafting from a closed loop ---------- */
function tryCraft(loop, p) {
  // basic filters
  const simple = rdpSimplify(loop, 3.0);
  const A = Math.abs(areaShoelace(simple));
  const P = perimeter(simple);
  if (A < 1200 || P < 180) return; // ignore tiny/scribble

  // normalize + compare to blueprints
  const N = 64;
  const r = resample(simple, N);
  const norm = normalizeLoop(r);

  let best = null;
  for (const [name, bp] of Object.entries(BLUEPRINTS)) {
    const d = avgPointDist(norm, bp.poly);
    if (!best || d < best.d) best = { name, bp, d };
  }

  if (best && best.d < 0.20) {
    // score
    const sizeMul = Math.sqrt(A) / 70;
    const styleMul = Math.min(1.6, 1.0 / (best.d + 0.05));
    const score = Math.round(best.bp.baseScore * sizeMul * styleMul);
    p.score += score;

    // claim territory inside the loop
    const claimed = cellsInPolygon(simple);
    claimCells(claimed, teamOf(p), 2);

    // (optional) spawn object at centroid
    const cx = simple.reduce((s,q)=>s+q.x,0)/simple.length;
    const cz = simple.reduce((s,q)=>s+q.z,0)/simple.length;
    // could store crafted objects and emit; minimal MVP omits for now.

    // reset trail to encourage new craft
    p.trail = [];
  }
}
const teamOf = (p) => (p.team === "red" ? "red" : "blue");

/* ---------- Socket + Game Loop ---------- */
io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("join", ({ name, color }) => {
    const x = (Math.random() - 0.5) * (ARENA.w - 200);
    const z = (Math.random() - 0.5) * (ARENA.h - 200);
    const dirs = [ [1,0],[-1,0],[0,1],[0,-1] ];
    const [dx, dz] = dirs[(Math.random() * dirs.length) | 0];
    const team = Math.random() < 0.5 ? "red" : "blue";

    players.set(socket.id, {
      id: socket.id,
      name: String(name||"Player").slice(0,16),
      color: color || "#66ccff",
      team,
      x, y: 2, z,
      vx: dx * (MAX_SPEED * 0.75),
      vz: dz * (MAX_SPEED * 0.75),
      inDx: dx, inDz: dz,
      inputActive: true,
      score: 0,
      trail: [],
      trailTick: 0,
    });

    // send initial grid snapshot (compact) — only non-empty cells
    const initCells = [];
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
      const cell = grid[r][c];
      if (cell.team) initCells.push({ c, r, team: cell.team, level: cell.level });
    }
    if (initCells.length) socket.emit("territoryUpdate", initCells);
  });

  socket.on("move3d", ({ dx, dz }) => {
    const p = players.get(socket.id);
    if (!p) return;
    const mag = Math.hypot(dx, dz);
    if (mag > 0.0001) {
      p.inDx = dx / mag; p.inDz = dz / mag;
      p.inputActive = true;
    } else {
      p.inputActive = false;
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

// physics + broadcast (60 Hz)
setInterval(() => {
  const halfW = ARENA.w / 2, halfH = ARENA.h / 2;

  for (const p of players.values()) {
    if (p.inputActive) {
      p.vx += p.inDx * ACCEL;
      p.vz += p.inDz * ACCEL;
    }
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > MAX_SPEED) { const s = MAX_SPEED / sp; p.vx *= s; p.vz *= s; }

    p.x += p.vx; p.z += p.vz;
    p.vx *= FRICTION; p.vz *= FRICTION;

    if (p.x < -halfW) { p.x = -halfW; p.vx = Math.abs(p.vx)*0.4; }
    if (p.x >  halfW) { p.x =  halfW; p.vx = -Math.abs(p.vx)*0.4; }
    if (p.z < -halfH) { p.z = -halfH; p.vz = Math.abs(p.vz)*0.4; }
    if (p.z >  halfH) { p.z =  halfH; p.vz = -Math.abs(p.vz)*0.4; }

    // sample trail every 3 ticks
    if ((p.trailTick = (p.trailTick + 1) % 3) === 0) {
      p.trail.push({ x: p.x, z: p.z });
      if (p.trail.length > 400) p.trail.shift();
      // try close if long enough
      if (p.trail.length > 40) {
        const head = p.trail[p.trail.length - 1];
        for (let i = 0; i < p.trail.length - 30; i++) {
          const q = p.trail[i];
          if (Math.hypot(head.x - q.x, head.z - q.z) < 18) {
            const loop = p.trail.slice(i, p.trail.length);
            tryCraft(loop, p);
            break;
          }
        }
      }
    }
  }

  // emit players snapshot
  const snapshot = [];
  for (const p of players.values()) {
    snapshot.push({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, score: p.score, team: p.team });
  }
  io.emit("state3d", snapshot);
}, 1000 / TICK_HZ);

// territory passive scoring / decay (1 Hz)
setInterval(() => {
  let redCells = 0, blueCells = 0;
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    const cell = grid[r][c];
    if (cell.team === "red" && cell.level>0) redCells++;
    if (cell.team === "blue" && cell.level>0) blueCells++;
  }
  teamScore.red += Math.round(redCells * 0.02);
  teamScore.blue += Math.round(blueCells * 0.02);
  io.emit("teamScore", teamScore);
}, 1000);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`✅ 3D server (knitting) on port ${PORT}`);
});
