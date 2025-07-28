/*
 * Shared client logic for Knitting in the Dark.
 * Handles lobby (index.html) and dream field (field.html) pages.
 */

const socket = io();

// Track our own player id and state
let myId = null;
let myPlayer = null;

// Map of all players (by id) in the same room
const players = {};

// Keep track of typing status timer
let typingTimeout;

// Utility to determine if we're on the lobby page
function isLobby() {
  return document.body.classList.contains('lobby');
}

// Utility to determine if we're on the dream field page
function isField() {
  return document.body.classList.contains('field');
}

// UI update: populate list of players
function updatePlayerList() {
  const list = document.getElementById('playerList');
  if (!list) return;
  list.innerHTML = '';
  Object.keys(players).forEach((id) => {
    const p = players[id];
    const li = document.createElement('li');
    li.style.color = p.color;
    li.textContent = p.name;
    list.appendChild(li);
  });
  const count = document.getElementById('playerCount');
  if (count) {
    count.textContent = Object.keys(players).length.toString();
  }
}

// UI update: show our abilities
function updateAbilitiesList() {
  const ul = document.getElementById('abilitiesList');
  if (!ul || !myPlayer) return;
  ul.innerHTML = '';
  myPlayer.abilities.forEach((abil) => {
    const li = document.createElement('li');
    li.textContent = abil;
    ul.appendChild(li);
  });
}

// Chat helper: append a message to the messages div
function addChatMessage(text) {
  const container = document.getElementById('messages');
  if (!container) return;
  const div = document.createElement('div');
  div.textContent = text;
  container.appendChild(div);
  // Limit to last 100 messages
  while (container.childNodes.length > 100) {
    container.removeChild(container.firstChild);
  }
  container.scrollTop = container.scrollHeight;
}

// Typing indicator update
const typingPlayers = {};
function updateTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (!indicator) return;
  const names = Object.keys(typingPlayers)
    .filter((id) => typingPlayers[id] && players[id])
    .map((id) => players[id].name);
  if (names.length > 0) {
    indicator.textContent = `${names.join(', ')} ${
      names.length > 1 ? 'are' : 'is'
    } typing...`;
  } else {
    indicator.textContent = '';
  }
}

// Draw players on canvas for dream field
function drawPlayers() {
  if (!isField()) return;
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  Object.keys(players).forEach((id) => {
    const p = players[id];
    // Only draw players in our room
    if (p.currentRoom !== myPlayer.currentRoom) return;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.position.x, p.position.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px sans-serif';
    ctx.fillText(p.name, p.position.x - ctx.measureText(p.name).width / 2, p.position.y - 15);
  });
}

// Movement handling (field page)
const keys = {};
function handleMovementLoop() {
  if (isField() && myPlayer) {
    let moved = false;
    const pos = { ...myPlayer.position };
    if (keys['ArrowUp']) {
      pos.y -= 2;
      moved = true;
    }
    if (keys['ArrowDown']) {
      pos.y += 2;
      moved = true;
    }
    if (keys['ArrowLeft']) {
      pos.x -= 2;
      moved = true;
    }
    if (keys['ArrowRight']) {
      pos.x += 2;
      moved = true;
    }
    if (moved) {
      myPlayer.position = pos;
      socket.emit('move', pos);
      drawPlayers();
    }
  }
  requestAnimationFrame(handleMovementLoop);
}
requestAnimationFrame(handleMovementLoop);

// Event: socket initialisation
socket.on('init', (data) => {
  myId = data.id;
  myPlayer = data.player;
  Object.assign(players, data.players);
  players[myId] = myPlayer;
  updatePlayerList();
  updateAbilitiesList();
  addChatMessage(`[SYSTEM] Welcome, ${myPlayer.name}!`);
  if (isField()) {
    drawPlayers();
  }
});

// New player joined
socket.on('playerJoined', ({ id, player }) => {
  players[id] = player;
  updatePlayerList();
  addChatMessage(`[SYSTEM] ${player.name} joined the ${player.currentRoom}.`);
});

// Player left
socket.on('playerLeft', ({ id }) => {
  if (players[id]) {
    addChatMessage(`[SYSTEM] ${players[id].name} left.`);
    delete players[id];
    updatePlayerList();
    drawPlayers();
  }
});

// Player moved
socket.on('playerMoved', ({ id, position, room }) => {
  if (players[id]) {
    players[id].position = position;
    drawPlayers();
  }
});

// Name update
socket.on('nameUpdated', ({ id, name }) => {
  if (players[id]) {
    players[id].name = name;
    updatePlayerList();
    drawPlayers();
  }
});

// Room change
socket.on('roomChanged', ({ id, room, player }) => {
  if (players[id]) {
    players[id] = player;
    if (id === myId) {
      myPlayer = player;
      if (room === 'OpenField' && !isField()) {
        window.location.href = 'field.html';
      } else if (room === 'WaitingRoom' && !isLobby()) {
        window.location.href = 'index.html';
      }
    } else {
      updatePlayerList();
      drawPlayers();
    }
  }
});

// Entered dream (server instructs client to go to dream page)
socket.on('enteredDream', (playerData) => {
  myPlayer = playerData;
  // Immediately redirect to dream level page
  window.location.href = 'field.html';
});

// Abilities updated (when unlocking new ability)
socket.on('abilitiesUpdated', (abilities) => {
  if (myPlayer) {
    myPlayer.abilities = abilities;
    updateAbilitiesList();
  }
});

// Chat message
socket.on('chat message', ({ name, message, room }) => {
  // Display messages only from players in our room
  if (room && myPlayer && myPlayer.currentRoom !== room) return;
  addChatMessage(`${name}: ${message}`);
});

// Typing indicator from others
socket.on('typing', ({ id, isTyping }) => {
  typingPlayers[id] = isTyping;
  updateTypingIndicator();
});

// Chat input handling
const messageInput = document.getElementById('messageInput');
if (messageInput) {
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = messageInput.value.trim();
      if (text) {
        // In the dream field, treat unrecognised words as abilities to unlock
        if (isField() && !myPlayer.abilities.includes(text)) {
          socket.emit('abilityUnlocked', text);
        }
        socket.emit('chat message', text);
        messageInput.value = '';
        socket.emit('typing', false);
      }
    } else {
      // Start typing indicator
      socket.emit('typing', true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        socket.emit('typing', false);
      }, 1000);
    }
  });
}

// Name change button (only in lobby)
const changeNameBtn = document.getElementById('changeNameButton');
if (changeNameBtn) {
  changeNameBtn.addEventListener('click', () => {
    const newName = prompt('Enter new name:', myPlayer ? myPlayer.name : '');
    if (newName && newName.trim()) {
      socket.emit('setName', newName.trim());
    }
  });
}

// Enter Dream button
const enterDreamBtn = document.getElementById('enterDreamButton');
if (enterDreamBtn) {
  enterDreamBtn.addEventListener('click', () => {
    socket.emit('enterDream');
  });
}

// Exit Dream button
const exitDreamBtn = document.getElementById('exitDreamButton');
if (exitDreamBtn) {
  exitDreamBtn.addEventListener('click', () => {
    socket.emit('changeRoom', 'WaitingRoom');
  });
}

// Movement listeners for field
document.addEventListener('keydown', (e) => {
  keys[e.key] = true;
});
document.addEventListener('keyup', (e) => {
  keys[e.key] = false;
});
