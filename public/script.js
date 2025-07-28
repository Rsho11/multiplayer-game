
const socket = io();
let playerData = {};

socket.on('loadPlayer', (data) => {
    playerData = data;
    document.getElementById('status').innerText = 
        `Welcome back, ${data.name}. Abilities: ${data.abilities.join(', ') || 'None'}`;
});

document.getElementById('enterDream').addEventListener('click', () => {
    const newAbility = 'dreamSight';
    if (!playerData.abilities.includes(newAbility)) {
        playerData.abilities.push(newAbility);
        playerData.visited.push('OpenField');
    }
    socket.emit('updatePlayer', playerData);
    alert('You entered the Open Field and gained the "dreamSight" ability!');
});
