const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Serve static files
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const MAX_SLOTS = 10;
const slotPositions = [
  { x: 100, y: 100 },
  { x: 250, y: 100 },
  { x: 400, y: 100 },
  { x: 550, y: 100 },
  { x: 700, y: 100 },
  { x: 100, y: 300 },
  { x: 250, y: 300 },
  { x: 400, y: 300 },
  { x: 550, y: 300 },
  { x: 700, y: 300 },
];
// Slots array: null means free, otherwise contains player info
const slots = Array(MAX_SLOTS).fill(null);
// Map socket.id -> slot index
const playerSlot = {};

function getRandomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

io.on('connection', (socket) => {
  // find a free slot
  const freeIndex = slots.findIndex((s) => s === null);
  if (freeIndex === -1) {
    socket.emit('serverFull');
    socket.disconnect(true);
    return;
  }
  const color = getRandomColor();
  const defaultName = `Player ${socket.id.slice(0, 4)}`;
  const slotData = {
    id: socket.id,
    x: slotPositions[freeIndex].x,
    y: slotPositions[freeIndex].y,
    color,
    name: defaultName,
  };
  slots[freeIndex] = slotData;
  playerSlot[socket.id] = freeIndex;
  // send current slots to the new client
  socket.emit('currentSlots', slots);
  // broadcast updated slots
  io.emit('slotUpdate', slots);

  socket.on('setName', (name) => {
    const idx = playerSlot[socket.id];
    if (idx !== undefined && slots[idx]) {
      slots[idx].name = name;
      io.emit('slotUpdate', slots);
      io.emit('playerJoined', { name });
    }
  });

  socket.on('movement', ({ x, y }) => {
    const idx = playerSlot[socket.id];
    if (idx !== undefined && slots[idx]) {
      slots[idx].x = x;
      slots[idx].y = y;
      socket.broadcast.emit('slotUpdate', slots);
    }
  });

  socket.on('chat message', (msg) => {
    const idx = playerSlot[socket.id];
    if (idx !== undefined && slots[idx]) {
      io.emit('chat message', { name: slots[idx].name, message: msg });
    }
  });

  socket.on('typing', (isTyping) => {
    const idx = playerSlot[socket.id];
    if (idx !== undefined && slots[idx]) {
      socket.broadcast.emit('typing', { id: slots[idx].id, isTyping });
    }
  });

  socket.on('disconnect', () => {
    const idx = playerSlot[socket.id];
    if (idx !== undefined && slots[idx]) {
      const leavingName = slots[idx].name;
      slots[idx] = null;
      delete playerSlot[socket.id];
      io.emit('playerLeft', { name: leavingName });
      io.emit('slotUpdate', slots);
    }
  });
});

// serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
