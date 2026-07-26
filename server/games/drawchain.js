const { loadPacks, shuffle, pick } = require('../content');
const { endMiniGame } = require('../hub');

function packWords(packNames, n) {
  const packs = loadPacks('drawchain');
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  let words = [];
  (filtered.length ? filtered : packs).forEach(p => words.push(...(p.data.words || [])));
  return pick(words, n);
}

function bookIndexFor(j, pass, P) { return ((j - pass) % P + P) % P; }

function start(room, io, config = {}) {
  const order = shuffle(room.connectedPlayerIds());
  const P = order.length;
  const words = packWords(config.packNames, P);
  const books = order.map((ownerId, i) => ({
    ownerId,
    entries: [{ type: 'word', by: ownerId, content: words[i] || 'Mystère' }]
  }));
  room.gameState = { order, P, books, pass: 1, pending: {} };
  startPass(room, io);
}

function startPass(room, io) {
  const gs = room.gameState;
  gs.pending = {};
  const taskType = gs.pass % 2 === 1 ? 'draw' : 'guess';
  gs.order.forEach((playerId, j) => {
    const bookIdx = bookIndexFor(j, gs.pass, gs.P);
    const prev = gs.books[bookIdx].entries[gs.pass - 1];
    io.to(playerId).emit('game:privateData', {
      type: 'drawchain', taskType, input: prev.content, inputType: prev.type
    });
  });
  io.to(room.code).emit('game:activate', { type: 'drawchain', phase: 'working', taskType, pass: gs.pass, total: gs.P - 1 });
}

function onPlayerAction(room, io, socket, action, payload) {
  const gs = room.gameState;
  if (action === 'submit') {
    if (gs.pending[socket.id] !== undefined) return;
    gs.pending[socket.id] = payload.content;
    const received = Object.keys(gs.pending).length;
    io.to(room.hostSocketId).emit('game:update', { type: 'drawchain', kind: 'progress', received, expected: gs.P });
    if (received >= gs.P) applyPass(room, io);
  }
}

function applyPass(room, io) {
  const gs = room.gameState;
  const taskType = gs.pass % 2 === 1 ? 'draw' : 'guess';
  gs.order.forEach((playerId, j) => {
    const bookIdx = bookIndexFor(j, gs.pass, gs.P);
    gs.books[bookIdx].entries.push({ type: taskType, by: playerId, content: gs.pending[playerId] });
  });
  gs.pass++;
  if (gs.pass <= gs.P - 1) {
    startPass(room, io);
  } else {
    revealAll(room, io);
  }
}

function revealAll(room, io) {
  const gs = room.gameState;
  const books = gs.books.map(b => ({
    ownerName: room.players.get(b.ownerId)?.name,
    entries: b.entries.map(e => ({ type: e.type, by: room.players.get(e.by)?.name, content: e.content }))
  }));
  // Points de participation + bonus si le mot final se rapproche du mot de départ
  gs.order.forEach(id => room.addScore(id, 50));
  books.forEach(b => {
    const original = (b.entries[0].content || '').trim().toLowerCase();
    const last = b.entries[b.entries.length - 1];
    if (last.type === 'guess' && (last.content || '').trim().toLowerCase() === original) {
      gs.order.forEach(id => room.addScore(id, 10)); // petit bonus collectif
    }
  });
  io.to(room.code).emit('game:reveal', { type: 'drawchain', books, scores: room.leaderboard() });
}

function onHostAction(room, io, socket, action) {
  if (action === 'finish') endMiniGame(room, io);
}

module.exports = { start, onPlayerAction, onHostAction };
