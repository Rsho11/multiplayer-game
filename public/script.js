
const socket = io();
let myId = null;
let myPlayer = null;
const players = {};
const keys = {};
let typingTimeout = null;

// DOM Elements
const playerList = document.getElementById('playerList');
const playerCount = document.getElementById('playerCount');
const abilitiesList = document.getElementById('abilitiesList');
const messages = document.getElementById('messages');
const typingIndicator = document.getElementById('typingIndicator');
const changeNameBtn = document.getElementById('changeNameButton');
const enterDreamBtn = document.getElementById('enterDreamButton');
const exitDreamBtn = document.getElementById('exitDreamButton');
const messageInput = document.getElementById('messageInput');
const dreamView = document.getElementById('dreamFieldView');
const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas ? gameCanvas.getContext('2d') : null;

// Init
socket.on('init', (data) => {
  myId = data.id;
  myPlayer = data.player;
  Object.assign(players, data.players);
  players[myId] = myPlayer;
  updatePlayerList();
  updateAbilitiesList();
  addChatMessage(`[SYSTEM] Welcome, ${myPlayer.name}!`);
  drawPlayers();
});

// Player joins/leaves
socket.on('playerJoined', ({ id, player }) => {
  players[id] = player;
  updatePlayerList();
  addChatMessage(`[SYSTEM] ${player.name} joined the ${player.currentRoom}.`);
});

socket.on('playerLeft', ({ id }) => {
  if (players[id]) {
    addChatMessage(`[SYSTEM] ${players[id].name} left.`);
    delete players[id];
    updatePlayerList();
    drawPlayers();
  }
});

// Player movement
socket.on('playerMoved', ({ id, position }) => {
  if (players[id]) {
    players[id].position = position;
    drawPlayers();
  }
});

// Name and room changes
socket.on('nameUpdated', ({ id, name }) => {
  if (players[id]) {
    players[id].name = name;
    updatePlayerList();
  }
});

socket.on('roomChanged', ({ id, room, player }) => {
  players[id] = player;
  if (id === myId) {
    myPlayer = player;
    if (room === 'OpenField') {
      enterDreamView();
    } else {
      exitDreamView();
    }
  }
  updatePlayerList();
  drawPlayers();
});

// Abilities
socket.on('abilitiesUpdated', (abilities) => {
  if (myPlayer) {
    myPlayer.abilities = abilities;
    updateAbilitiesList();
  }
});

// Chat
socket.on('chat message', ({ name, message, room }) => {
  if (!myPlayer || room !== myPlayer.currentRoom) return;
  addChatMessage(`${name}: ${message}`);
});

socket.on('typing', ({ id, isTyping }) => {
  if (players[id]) {
    players[id].typing = isTyping;
    updateTypingIndicator();
  }
});

// UI Updates
function updatePlayerList() {
  if (!playerList) return;
  playerList.innerHTML = '';
  const visible = Object.values(players).filter(p => p.currentRoom === myPlayer.currentRoom);
  visible.forEach(p => {
    const li = document.createElement('li');
    li.style.color = p.color;
    li.textContent = p.name;
    playerList.appendChild(li);
  });
  if (playerCount) playerCount.textContent = visible.length;
}

function updateAbilitiesList() {
  if (!abilitiesList || !myPlayer) return;
  abilitiesList.innerHTML = '';
  myPlayer.abilities.forEach(abil => {
    const li = document.createElement('li');
    li.textContent = abil;
    abilitiesList.appendChild(li);
  });
}

function addChatMessage(msg) {
  if (!messages) return;
  const div = document.createElement('div');
  div.textContent = msg;
  messages.appendChild(div);
  if (messages.childNodes.length > 100) messages.removeChild(messages.firstChild);
  messages.scrollTop = messages.scrollHeight;
}

function updateTypingIndicator() {
  if (!typingIndicator) return;
  const names = Object.values(players)
    .filter(p => p.typing && p.currentRoom === myPlayer.currentRoom)
    .map(p => p.name);
  typingIndicator.textContent = names.length ? `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing...` : '';
}

// View toggles
function enterDreamView() {
  document.getElementById('container').style.display = 'none';
  dreamView.style.display = 'block';
}

function exitDreamView() {
  dreamView.style.display = 'none';
  document.getElementById('container').style.display = 'flex';
}

// Events
if (changeNameBtn) {
  changeNameBtn.onclick = () => {
    const newName = prompt('Enter new name:', myPlayer.name);
    if (newName) socket.emit('setName', newName.trim());
  };
}

if (enterDreamBtn) {
  enterDreamBtn.onclick = () => socket.emit('enterDream');
}

if (exitDreamBtn) {
  exitDreamBtn.onclick = () => socket.emit('changeRoom', 'WaitingRoom');
}

if (messageInput) {
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = messageInput.value.trim();
      if (!text) return;
      if (myPlayer.currentRoom === 'OpenField' && !myPlayer.abilities.includes(text)) {
        socket.emit('abilityUnlocked', text);
      }
      socket.emit('chat message', text);
      messageInput.value = '';
      socket.emit('typing', false);
    } else {
      socket.emit('typing', true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => socket.emit('typing', false), 1000);
    }
  });
}

// Canvas movement
document.addEventListener('keydown', (e) => keys[e.key] = true);
document.addEventListener('keyup', (e) => keys[e.key] = false);

function drawPlayers() {
  if (!ctx || !myPlayer) return;
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  Object.values(players).forEach(p => {
    if (p.currentRoom !== myPlayer.currentRoom) return;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.position.x, p.position.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name, p.position.x - 20, p.position.y - 15);
  });
}

function gameLoop() {
  if (myPlayer && myPlayer.currentRoom === 'OpenField') {
    let moved = false;
    const pos = { ...myPlayer.position };
    if (keys['ArrowUp']) { pos.y -= 2; moved = true; }
    if (keys['ArrowDown']) { pos.y += 2; moved = true; }
    if (keys['ArrowLeft']) { pos.x -= 2; moved = true; }
    if (keys['ArrowRight']) { pos.x += 2; moved = true; }
    if (moved) {
      myPlayer.position = pos;
      socket.emit('move', pos);
      drawPlayers();
    }
  }
  requestAnimationFrame(gameLoop);
}
gameLoop();
