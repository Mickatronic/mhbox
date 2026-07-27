function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // 6h d'inactivité -> nettoyage

class Room {
  constructor(code, hostToken) {
    this.code = code;
    this.hostToken = hostToken;       // secret pour la reconnexion de l'hôte
    this.players = new Map();         // playerId (stable) -> {id, name, score, connected, token}
    this.phase = 'LOBBY';             // LOBBY | PLAYING | INTERMISSION | ENDED
    this.playlist = [];
    this.playlistIndex = -1;
    this.activeGameType = null;
    this.gameState = {};              // état interne propre au module de jeu actif
    this.idCounter = 0;

    // --- Cache pour la reconnexion (host & joueurs) : on rejoue simplement
    // le dernier événement pertinent au lieu de reconstruire un état complexe. ---
    this.lastActivate = null;         // dernier game:activate envoyé à la salle
    this.lastReveal = null;           // dernier game:reveal (s'il est postérieur au dernier activate)
    this.lastFinished = null;         // dernier game:finished (fin de mini-jeu, écran intermédiaire)
    this.lastPartyEnd = null;         // payload de fin de soirée
    this.lastPrivateData = new Map(); // playerId -> dernier game:privateData envoyé (prompt, main, mot...)

    this.lastActivityAt = Date.now();
  }

  touch() { this.lastActivityAt = Date.now(); }
  nextId() { return ++this.idCounter; }
  hostRoom() { return `host:${this.code}`; }

  addPlayer(playerId, name, token) {
    this.players.set(playerId, { id: playerId, name, score: 0, connected: true, token });
  }
  removePlayer(playerId) {
    const p = this.players.get(playerId);
    if (p) p.connected = false;
  }
  connectedPlayerIds() {
    return [...this.players.values()].filter(p => p.connected).map(p => p.id);
  }
  playerList() {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }));
  }
  leaderboard() { return this.playerList().sort((a, b) => b.score - a.score); }
  addScore(playerId, points) { const p = this.players.get(playerId); if (p) p.score += points; }

  // --- Émissions "mémorisées" pour permettre une reconnexion propre ---
  activate(io, payload) {
    this.touch();
    this.lastActivate = payload;
    this.lastReveal = null;
    io.to(this.code).emit('game:activate', payload);
  }
  reveal(io, payload) {
    this.touch();
    this.lastReveal = payload;
    io.to(this.code).emit('game:reveal', payload);
  }
  sendPrivate(io, playerId, payload) {
    this.lastPrivateData.set(playerId, payload);
    io.to(playerId).emit('game:privateData', payload);
  }

  // Rejoue l'état courant vers UN socket qui vient de se (re)connecter
  resyncTo(io, socketId, playerId) {
    io.to(socketId).emit('room:players', this.playerList());
    if (this.phase === 'PLAYING') {
      if (this.lastActivate) io.to(socketId).emit('game:activate', this.lastActivate);
      if (this.lastReveal) io.to(socketId).emit('game:reveal', this.lastReveal);
    } else if (this.phase === 'INTERMISSION' && this.lastFinished) {
      io.to(socketId).emit('game:finished', this.lastFinished);
    } else if (this.phase === 'ENDED' && this.lastPartyEnd) {
      io.to(socketId).emit('party:end', this.lastPartyEnd);
    }
    if (playerId && this.lastPrivateData.has(playerId)) {
      io.to(socketId).emit('game:privateData', this.lastPrivateData.get(playerId));
    }
  }
}

class GameManager {
  constructor() {
    this.rooms = new Map();
    setInterval(() => this._cleanup(), 15 * 60 * 1000).unref();
  }
  createRoom(hostToken) {
    let code;
    do { code = makeCode(); } while (this.rooms.has(code));
    const room = new Room(code, hostToken);
    this.rooms.set(code, room);
    return room;
  }
  get(code) { return this.rooms.get((code || '').toUpperCase()); }
  delete(code) { this.rooms.delete(code); }
  _cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivityAt > ROOM_TTL_MS) this.rooms.delete(code);
    }
  }
}

module.exports = { Room, GameManager };
