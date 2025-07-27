const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// Directory to store player save files
const SAVE_DIR = path.join(__dirname, 'saves');
// Ensure the save directory exists
if (!fs.existsSync(SAVE_DIR)) {
  fs.mkdirSync(SAVE_DIR);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static assets from the public folder
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Generate a random hex colour for a player.
 */
function randomColor() {
  const letters = '0123456789ABCDEF';
  let colour = '#';
  for (let i = 0; i < 6; i++) {
    colour += letters[Math.floor(Math.random() * 16)];
  }
  return colour;
}

/**
 * Load a player's saved state from disk.
 * Returns null if no save file exists.
 * @param {string} id The socket id to load.
 */
function loadSave(id) {
  const file = path.join(SAVE_DIR, `${id}.json`);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file));
    } catch (err) {
      console.error('Error parsing save file', err);
      return null;
    }
  }
  return null;
}

/**
 * Persist a player's state to disk.
 * @param {string} id The socket id to save.
 * @param {Object} data The player data to persist.
 */
function savePlayer(id, data) {
  const file = path.join(SAVE_DIR, `${id}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save player', err);
  }
}

// In-memory registry of connected players
const players = {};

/**
 * Get a list of players in a particular room.
 * @param {string} room The room name (WaitingRoom or OpenField).
 */
function getPlayersInRoom(room) {
  const list = {};
  Object.keys(players).forEach((id) => {
    if (players[id].currentRoom === room) {
      list[id] = players[id];
    }
  });
  return list;
}

io.on('connection', (socket) => {
  // Attempt to load existing save or create a new one
  let save = loadSave(socket.id);
  if (!save) {
    save = {
      name: `Dreamer-${socket.id.substring(0, 4)}`,
      color: randomColor(),
      position: { x: 150, y: 150 },
      abilities: [],
      visited: ['WaitingRoom'],
      currentRoom: 'WaitingRoom'
    };
    savePlayer(socket.id, save);
  }
  // Register the player in memory
  players[socket.id] = save;

  // Notify the connecting client of their state and peers in the same room
  socket.emit('init', {
    id: socket.id,
    player: save,
    players: getPlayersInRoom(save.currentRoom)
  });
  // Notify other clients about the new player
  socket.broadcast.emit('playerJoined', { id: socket.id, player: save });

  // Handle name updates
  socket.on('setName', (name) => {
    if (typeof name === 'string' && name.trim().length > 0) {
      players[socket.id].name = name.trim();
      savePlayer(socket.id, players[socket.id]);
      io.emit('nameUpdated', { id: socket.id, name: players[socket.id].name });
    }
  });

  // Handle chat messages
  socket.on('chat message', (msg) => {
    const text = String(msg || '').trim();
    if (text.length === 0) return;
    io.emit('chat message', {
      id: socket.id,
      name: players[socket.id].name,
      message: text,
      room: players[socket.id].currentRoom
    });
  });

  // Typing indicator broadcasting
  socket.on('typing', (isTyping) => {
    socket.broadcast.emit('typing', { id: socket.id, isTyping });
  });

  // Movement handling
  socket.on('move', (pos) => {
    if (!players[socket.id]) return;
    // Limit positions to canvas bounds (0-800 for x, 0-600 for y)
    const x = Math.max(10, Math.min(790, pos.x));
    const y = Math.max(10, Math.min(590, pos.y));
    players[socket.id].position = { x, y };
    socket.broadcast.emit('playerMoved', {
      id: socket.id,
      position: { x, y },
      room: players[socket.id].currentRoom
    });
  });

  // Player entering dream
  socket.on('enterDream', () => {
    if (!players[socket.id]) return;
    const p = players[socket.id];
    p.currentRoom = 'OpenField';
    if (!p.visited.includes('OpenField')) {
      p.visited.push('OpenField');
    }
    if (!p.abilities.includes('dreamSight')) {
      p.abilities.push('dreamSight');
    }
    savePlayer(socket.id, p);
    // Notify this player that they've entered the dream (client will change page)
    socket.emit('enteredDream', p);
    // Inform others of room change
    io.emit('roomChanged', { id: socket.id, room: 'OpenField', player: p });
  });

  // Unlocking a new ability in the dream
  socket.on('abilityUnlocked', (ability) => {
    if (!players[socket.id]) return;
    const abil = String(ability || '').trim();
    if (abil.length === 0) return;
    const p = players[socket.id];
    if (!p.abilities.includes(abil)) {
      p.abilities.push(abil);
      savePlayer(socket.id, p);
    }
    // Send updated abilities list back to player
    socket.emit('abilitiesUpdated', p.abilities);
  });

  // Changing rooms manually (if needed)
  socket.on('changeRoom', (room) => {
    if (!players[socket.id]) return;
    players[socket.id].currentRoom = room;
    if (!players[socket.id].visited.includes(room)) {
      players[socket.id].visited.push(room);
    }
    savePlayer(socket.id, players[socket.id]);
    socket.emit('roomChanged', { id: socket.id, room, player: players[socket.id] });
    socket.broadcast.emit('roomChanged', { id: socket.id, room, player: players[socket.id] });
  });

  // Handle disconnections
  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', { id: socket.id });
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Knitting in the Dark server running on port ${PORT}`);
});
