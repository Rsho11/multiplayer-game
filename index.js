
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SAVE_PATH = path.join(__dirname, 'saves');
if (!fs.existsSync(SAVE_PATH)) fs.mkdirSync(SAVE_PATH);

app.use(express.static(path.join(__dirname, 'public')));

let players = {};

io.on('connection', (socket) => {
    const id = socket.id;
    const saveFile = path.join(SAVE_PATH, `${id}.json`);
    players[id] = { name: 'Dreamer', abilities: [], visited: [] };

    if (fs.existsSync(saveFile)) {
        players[id] = JSON.parse(fs.readFileSync(saveFile));
    }

    socket.emit('loadPlayer', players[id]);

    socket.on('updatePlayer', (data) => {
        players[id] = data;
        fs.writeFileSync(saveFile, JSON.stringify(data));
    });

    socket.on('disconnect', () => {
        delete players[id];
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Knitting in the Dark running on port ${PORT}`));
