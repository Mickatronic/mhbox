const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GameManager } = require('./room');
const { loadPacks } = require('./content');
const { registry } = require('./games');
const { startNextGame } = require('./hub');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const games = new GameManager();

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'host', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'player', 'index.html')));

app.get('/api/games', (req, res) => {
  const list = Object.entries(registry).map(([type, entry]) => ({ type, label: entry.label, desc: entry.desc, minPlayers: entry.minPlayers }));
  res.json(list);
});

app.get('/api/packs/:gameType', (req, res) => {
  res.json(loadPacks(req.params.gameType).map(p => p.name));
});

function broadcastPlayers(room) {
  io.to(room.code).emit('room:players', room.playerList());
}

io.on('connection', (socket) => {
  // --- HOST ---
  socket.on('host:create', (cb) => {
    const room = games.createRoom(socket.id);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.isHost = true;
    cb && cb({ code: room.code });
  });

  socket.on('host:startParty', ({ code, playlist, config }) => {
    const room = games.get(code);
    if (!room || socket.id !== room.hostSocketId) return;
    room.playlist = playlist && playlist.length ? playlist : ['quiplash'];
    room.playlistIndex = -1;
    startNextGame(room, io, config || {});
  });

  // Action générique host -> délègue au module du jeu actif, sauf actions de hub
  socket.on('host:action', ({ code, action, payload }) => {
    const room = games.get(code);
    if (!room || socket.id !== room.hostSocketId) return;
    if (action === 'hub:next') {
      startNextGame(room, io, {});
      return;
    }
    const entry = registry[room.activeGameType];
    if (entry) entry.mod.onHostAction(room, io, socket, action, payload || {});
  });

  // --- PLAYERS ---
  socket.on('player:join', ({ code, name }, cb) => {
    const room = games.get(code);
    if (!room) return cb && cb({ error: 'Code de partie introuvable.' });
    if (room.phase !== 'LOBBY') return cb && cb({ error: 'La partie a déjà commencé.' });
    if (room.players.size >= 10) return cb && cb({ error: 'Salon complet (10 joueurs max).' });
    room.addPlayer(socket.id, (name || 'Joueur').slice(0, 16));
    socket.join(room.code);
    socket.data.roomCode = room.code;
    cb && cb({ ok: true, code: room.code, id: socket.id });
    broadcastPlayers(room);
  });

  socket.on('player:action', ({ code, action, payload }) => {
    const room = games.get(code);
    if (!room) return;
    const entry = registry[room.activeGameType];
    if (entry) entry.mod.onPlayerAction(room, io, socket, action, payload || {});
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = games.get(code);
    if (!room) return;
    if (socket.id === room.hostSocketId) return; // on garde le salon vivant si l'écran host se recharge
    room.removePlayer(socket.id);
    broadcastPlayers(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Party Clash lancé sur le port ${PORT}`));
