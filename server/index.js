const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GameManager } = require('./room');
const { loadPacks } = require('./content');
const { registry } = require('./games');
const { startNextGame } = require('./hub');
const adminRouter = require('./admin');
const hostAuth = require('./hostAuth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const games = new GameManager();

app.use('/api/admin', adminRouter);
app.use('/api/host', hostAuth.router);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'host', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'player', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html')));

app.get('/api/games', (req, res) => {
  const list = Object.entries(registry).map(([type, entry]) => ({ type, label: entry.label, desc: entry.desc, minPlayers: entry.minPlayers }));
  res.json(list);
});

app.get('/api/packs/:gameType', (req, res) => {
  res.json(loadPacks(req.params.gameType).map(p => ({ name: p.name, tags: p.data.tags || [] })));
});

function broadcastPlayers(room) {
  io.to(room.code).emit('room:players', room.playerList());
}

// Vérifie l'auth hôte une fois à la connexion du socket (cookie posé par /api/host/login)
io.use((socket, next) => {
  socket.data.isHostAuthed = hostAuth.isAuthenticatedFromCookieHeader(socket.handshake.headers.cookie);
  next();
});

io.on('connection', (socket) => {
  // --- HOST ---
  socket.on('host:create', (cb) => {
    if (!socket.data.isHostAuthed) return cb && cb({ error: 'Non authentifié.' });
    const hostToken = crypto.randomBytes(24).toString('hex');
    const room = games.createRoom(hostToken);
    socket.join(room.code);
    socket.join(room.hostRoom());
    socket.data.roomCode = room.code;
    socket.data.isHost = true;
    cb && cb({ code: room.code, hostToken });
  });

  socket.on('host:reconnect', ({ code, hostToken }, cb) => {
    if (!socket.data.isHostAuthed) return cb && cb({ error: 'Non authentifié.' });
    const room = games.get(code);
    if (!room || room.hostToken !== hostToken) return cb && cb({ error: 'Salon introuvable ou expiré.' });
    socket.join(room.code);
    socket.join(room.hostRoom());
    socket.data.roomCode = room.code;
    socket.data.isHost = true;
    room.touch();
    room.resyncTo(io, socket.id, null);
    cb && cb({ ok: true, code: room.code, phase: room.phase });
  });

  socket.on('host:startParty', ({ code, playlist, config }) => {
    const room = games.get(code);
    if (!room || !socket.data.isHost || socket.data.roomCode !== code) return;
    room.playlist = playlist && playlist.length ? playlist : ['quiplash'];
    room.playlistIndex = -1;
    startNextGame(room, io, config || {});
  });

  // Action générique host -> délègue au module du jeu actif, sauf actions de hub
  socket.on('host:action', ({ code, action, payload }) => {
    const room = games.get(code);
    if (!room || !socket.data.isHost || socket.data.roomCode !== code) return;
    room.touch();
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
    const playerId = crypto.randomUUID();
    const playerToken = crypto.randomBytes(16).toString('hex');
    room.addPlayer(playerId, (name || 'Joueur').slice(0, 16), playerToken);
    socket.join(room.code);
    socket.join(playerId);
    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;
    room.touch();
    cb && cb({ ok: true, code: room.code, playerId, playerToken });
    broadcastPlayers(room);
  });

  socket.on('player:reconnect', ({ code, playerId, playerToken }, cb) => {
    const room = games.get(code);
    const player = room && room.players.get(playerId);
    if (!room || !player || player.token !== playerToken) return cb && cb({ error: 'Session expirée, rejoins avec le code.' });
    player.connected = true;
    socket.join(room.code);
    socket.join(playerId);
    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;
    room.touch();
    room.resyncTo(io, socket.id, playerId);
    cb && cb({ ok: true, name: player.name, phase: room.phase });
    broadcastPlayers(room);
  });

  socket.on('player:action', ({ code, action, payload }) => {
    const room = games.get(code);
    const playerId = socket.data.playerId;
    if (!room || !playerId || socket.data.roomCode !== code) return;
    room.touch();
    const entry = registry[room.activeGameType];
    if (entry) entry.mod.onPlayerAction(room, io, playerId, action, payload || {});
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = games.get(code);
    if (!room) return;
    if (socket.data.isHost) return; // le salon reste vivant, l'hôte peut se reconnecter avec son token
    if (socket.data.playerId) {
      room.removePlayer(socket.data.playerId);
      broadcastPlayers(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Party Clash lancé sur le port ${PORT}`));
