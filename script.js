const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// up to 10 slots; each entry either null or { id, x, y, color, name }
let slots = Array(10).fill(null);
// remember which slot we occupy
let mySlotIndex = null;
let myName = '';

// same positions as server (must match server's slotPositions)
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

// Ask for a name on page load
function askForName() {
  let name = prompt('Enter your name:');
  if (!name || !name.trim()) {
    name = `Player${Math.floor(Math.random() * 1000)}`;
  }
  myName = name.trim();
  socket.emit('setName', myName);
}
askForName();

socket.on('serverFull', () => {
  alert('Server is full – try again later!');
});

socket.on('currentSlots', (serverSlots) => {
  slots = serverSlots;
  // find our slot index
  slots.forEach((slot, i) => {
    if (slot && slot.id === socket.id) {
      mySlotIndex = i;
    }
  });
  updatePlayerCount();
  drawSlots();
});

socket.on('slotUpdate', (serverSlots) => {
  slots = serverSlots;
  drawSlots();
  updatePlayerCount();
});

socket.on('playerJoined', ({ name }) => {
  addChatMessage(`[${new Date().toLocaleTimeString()}] ${name} joined the game`);
});

socket.on('playerLeft', ({ name }) => {
  addChatMessage(`[${new Date().toLocaleTimeString()}] ${name} left the game`);
});

socket.on('chat message', ({ name, message }) => {
  addChatMessage(`${name}: ${message}`);
});

// typing indicator
const typingStatus = {};
socket.on('typing', ({ id, isTyping }) => {
  typingStatus[id] = isTyping;
  updateTypingIndicator();
});

function updatePlayerCount() {
  document.getElementById('playerCount').textContent =
    'Players: ' + slots.filter((s) => s !== null).length;
}

function drawSlots() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  slots.forEach((slot, i) => {
    const pos = slotPositions[i];
    if (slot) {
      ctx.fillStyle = slot.color;
      ctx.beginPath();
      ctx.arc(slot.x, slot.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'black';
      const w = ctx.measureText(slot.name).width;
      ctx.fillText(slot.name, slot.x - w / 2, slot.y - 15);
    } else {
      ctx.fillStyle = '#CCCCCC';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'gray';
      ctx.fillText('undefined', pos.x - 20, pos.y - 15);
    }
  });
}

// movement control
const keys = {};
document.addEventListener('keydown', (e) => {
  keys[e.key] = true;
});
document.addEventListener('keyup', (e) => {
  keys[e.key] = false;
});

function gameLoop() {
  if (mySlotIndex !== null) {
    const me = slots[mySlotIndex];
    if (me) {
      let moved = false;
      if (keys['ArrowUp'] && me.y > 10) {
        me.y -= 2;
        moved = true;
      }
      if (keys['ArrowDown'] && me.y < canvas.height - 10) {
        me.y += 2;
        moved = true;
      }
      if (keys['ArrowLeft'] && me.x > 10) {
        me.x -= 2;
        moved = true;
      }
      if (keys['ArrowRight'] && me.x < canvas.width - 10) {
        me.x += 2;
        moved = true;
      }
      if (moved) {
        socket.emit('movement', { x: me.x, y: me.y });
        drawSlots();
      }
    }
  }
  requestAnimationFrame(gameLoop);
}
gameLoop();

// chat
const messageInput = document.getElementById('messageInput');
let typingTimeout;
function handleTyping() {
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', false);
  }, 1000);
}
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const msg = messageInput.value.trim();
    if (msg) {
      socket.emit('chat message', msg);
      messageInput.value = '';
      socket.emit('typing', false);
    }
  } else {
    handleTyping();
  }
});
messageInput.addEventListener('keyup', handleTyping);

function updateTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  const ids = Object.keys(typingStatus).filter((id) => typingStatus[id]);
  const names = ids.map((id) => {
    const slot = slots.find((s) => s && s.id === id);
    return slot ? slot.name : 'Someone';
  });
  if (names.length > 0) {
    indicator.textContent =
      names.join(', ') + (names.length > 1 ? ' are' : ' is') + ' typing…';
  } else {
    indicator.textContent = '';
  }
}

// add message to chat box
function addChatMessage(text) {
  const messagesDiv = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'message';
  div.textContent = text;
  messagesDiv.appendChild(div);
  while (messagesDiv.childNodes.length > 50) {
    messagesDiv.removeChild(messagesDiv.firstChild);
  }
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// change name
document.getElementById('changeNameButton').addEventListener('click', () => {
  const newName = prompt('Enter new name:', myName);
  if (newName && newName.trim()) {
    myName = newName.trim();
    socket.emit('setName', myName);
  }
});
