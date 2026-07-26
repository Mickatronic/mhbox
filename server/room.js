function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

class Room {
  constructor(code, hostSocketId) {
    this.code = code;
    this.hostSocketId = hostSocketId;
    this.players = new Map(); // socketId -> {id, name, score, connected}
    this.phase = 'LOBBY';     // LOBBY | PLAYING | INTERMISSION | ENDED
    this.playlist = [];       // ex: ['quiplash','undercover']
    this.playlistIndex = -1;
    this.activeGameType = null;
    this.gameState = {};      // état interne propre au module de jeu actif
    this.idCounter = 0;       // compteur générique (utile pour cartes Dixit, etc.)
  }

  nextId() { return ++this.idCounter; }

  addPlayer(socketId, name) {
    this.players.set(socketId, { id: socketId, name, score: 0, connected: true });
  }

  removePlayer(socketId) {
    if (this.players.has(socketId)) this.players.get(socketId).connected = false;
  }

  connectedPlayerIds() {
    return [...this.players.values()].filter(p => p.connected).map(p => p.id);
  }

  playerList() {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }));
  }

  leaderboard() {
    return this.playerList().sort((a, b) => b.score - a.score);
  }

  addScore(playerId, points) {
    const p = this.players.get(playerId);
    if (p) p.score += points;
  }
}

class GameManager {
  constructor() { this.rooms = new Map(); }
  createRoom(hostSocketId) {
    let code;
    do { code = makeCode(); } while (this.rooms.has(code));
    const room = new Room(code, hostSocketId);
    this.rooms.set(code, room);
    return room;
  }
  get(code) { return this.rooms.get((code || '').toUpperCase()); }
  delete(code) { this.rooms.delete(code); }
}

module.exports = { Room, GameManager };
