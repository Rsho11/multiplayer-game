
const socket = io();
let myId = null;
let myPlayer = null;
let players = {};

const waitingRoom = document.getElementById('waitingRoom');
const canvas = document.getElementById('spiralCanvas');
const ctx = canvas.getContext('2d');
const playerList = document.getElementById('playerList');
const messages = document.getElementById('messages');
const chatInput = document.getElementById('chatInput');

function renderPlayers() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const id in players) {
    const p = players[id];
    if (p.currentRoom === 'SpiralStaircase') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.position.x, p.position.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name, p.position.x - 15, p.position.y - 15);
    }
  }
}

function gameLoop() {
  if (myPlayer && myPlayer.currentRoom === 'SpiralStaircase') {
    let moved = false;
    const pos = { ...myPlayer.position };
    if (keys['ArrowUp']) { pos.y -= 2; moved = true; }
    if (keys['ArrowDown']) { pos.y += 2; moved = true; }
    if (keys['ArrowLeft']) { pos.x -= 2; moved = true; }
    if (keys['ArrowRight']) { pos.x += 2; moved = true; }
    if (moved) {
      myPlayer.position = pos;
      socket.emit('move', pos);
      renderPlayers();
    }
  }
  requestAnimationFrame(gameLoop);
}
const keys = {};
document.addEventListener('keydown', e => keys[e.key] = true);
document.addEventListener('keyup', e => keys[e.key] = false);

socket.on('init', ({ id, player, players: all }) => {
  myId = id;
  myPlayer = player;
  players = all;
  updatePlayerList();
});

socket.on('playerJoined', ({ id, player }) => {
  players[id] = player;
  updatePlayerList();
});

socket.on('playerLeft', ({ id }) => {
  delete players[id];
  updatePlayerList();
});

socket.on('nameUpdated', ({ id, name }) => {
  if (players[id]) players[id].name = name;
  updatePlayerList();
});

socket.on('playerMoved', ({ id, position }) => {
  if (players[id]) players[id].position = position;
});

socket.on('chat message', ({ name, message }) => {
  const div = document.createElement('div');
  div.textContent = `${name}: ${message}`;
  messages.appendChild(div);
});

socket.on('roomChanged', ({ id, room, player }) => {
  players[id] = player;
  if (id === myId) {
    myPlayer = player;
    if (room === 'SpiralStaircase') {
      waitingRoom.style.display = 'none';
      canvas.style.display = 'block';
    } else {
      waitingRoom.style.display = 'block';
      canvas.style.display = 'none';
    }
  }
});

document.getElementById('changeName').onclick = () => {
  const newName = prompt('Enter your new name:', myPlayer.name);
  if (newName) socket.emit('setName', newName);
};

document.getElementById('enterDream').onclick = () => {
  socket.emit('enterDream');
};

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const msg = chatInput.value.trim();
    if (msg) {
      socket.emit('chat message', msg);
      chatInput.value = '';
    }
  }
});

gameLoop();
