
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const SAVE_DIR = path.join(__dirname, 'saves');
if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR);

app.use(express.static(path.join(__dirname, 'public')));

const players = {};

io.on('connection', (socket) => {
  const id = socket.id;
  const saveFile = path.join(SAVE_DIR, `${id}.json`);
  let player = {
    name: `Dreamer-${id.slice(0, 4)}`,
    color: getRandomColor(),
    abilities: [],
    visited: [],
    position: { x: 100, y: 100 },
    currentRoom: 'WaitingRoom'
  };

  if (fs.existsSync(saveFile)) {
    player = JSON.parse(fs.readFileSync(saveFile));
  }

  players[id] = player;

  socket.emit('init', { id, player, players });
  socket.broadcast.emit('playerJoined', { id, player });

  socket.on('setName', (name) => {
    players[id].name = name;
    io.emit('nameUpdated', { id, name });
  });

  socket.on('move', (pos) => {
    players[id].position = pos;
    io.emit('playerMoved', { id, position: pos, room: players[id].currentRoom });
  });

  socket.on('chat message', (message) => {
    io.emit('chat message', { name: players[id].name, message, room: players[id].currentRoom });
  });

  socket.on('typing', (isTyping) => {
    socket.broadcast.emit('typing', { id, isTyping });
  });

  socket.on('enterDream', () => {
    if (!players[id].visited.includes('OpenField')) {
      players[id].visited.push('OpenField');
    }
    if (!players[id].abilities.includes('dreamSight')) {
      players[id].abilities.push('dreamSight');
    }
    players[id].currentRoom = 'OpenField';
    socket.emit('enteredDream', players[id]);
    io.emit('roomChanged', { id, room: 'OpenField', player: players[id] });
    savePlayer(id);
  });

  socket.on('changeRoom', (room) => {
    players[id].currentRoom = room;
    io.emit('roomChanged', { id, room, player: players[id] });
    savePlayer(id);
  });

  socket.on('abilityUnlocked', (ability) => {
    if (!players[id].abilities.includes(ability)) {
      players[id].abilities.push(ability);
      socket.emit('abilitiesUpdated', players[id].abilities);
      savePlayer(id);
    }
  });

  socket.on('disconnect', () => {
    delete players[id];
    io.emit('playerLeft', { id });
  });
});

function savePlayer(id) {
  const savePath = path.join(SAVE_DIR, `${id}.json`);
  fs.writeFileSync(savePath, JSON.stringify(players[id]));
}

function getRandomColor() {
  const letters = '0123456789ABCDEF';
  return '#' + Array.from({ length: 6 }).map(() => letters[Math.floor(Math.random() * 16)]).join('');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Knitting in the Dark running on port ${PORT}`));
