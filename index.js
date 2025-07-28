
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// In-memory player store
let players = {};

io.on('connection', (socket) => {
  const defaultPlayer = {
    id: socket.id,
    name: 'Dreamer',
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    currentRoom: 'WaitingRoom',
    position: { x: 200, y: 200 },
    abilities: []
  };
  players[socket.id] = defaultPlayer;

  socket.emit('init', { id: socket.id, player: defaultPlayer, players });

  socket.broadcast.emit('playerJoined', { id: socket.id, player: defaultPlayer });

  socket.on('setName', (name) => {
    if (players[socket.id]) {
      players[socket.id].name = name;
      io.emit('nameUpdated', { id: socket.id, name });
    }
  });

  socket.on('move', (position) => {
    if (players[socket.id]) {
      players[socket.id].position = position;
      io.emit('playerMoved', { id: socket.id, position });
    }
  });

  socket.on('chat message', (msg) => {
    const player = players[socket.id];
    if (player) {
      io.emit('chat message', { name: player.name, message: msg, room: player.currentRoom });
    }
  });

  socket.on('typing', (isTyping) => {
    io.emit('typing', { id: socket.id, isTyping });
  });

  socket.on('enterDream', () => {
    if (players[socket.id]) {
      players[socket.id].currentRoom = 'SpiralStaircase';
      io.emit('roomChanged', { id: socket.id, room: 'SpiralStaircase', player: players[socket.id] });
    }
  });

  socket.on('changeRoom', (room) => {
    if (players[socket.id]) {
      players[socket.id].currentRoom = room;
      io.emit('roomChanged', { id: socket.id, room, player: players[socket.id] });
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', { id: socket.id });
  });
});

server.listen(PORT, () => console.log(`Knitting in the Dark server running on port ${PORT}`));
