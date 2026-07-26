const { loadPacks, shuffle } = require('../content');
const { endMiniGame } = require('../hub');

function pickPair(packNames) {
  const packs = loadPacks('undercover');
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  let pairs = [];
  (filtered.length ? filtered : packs).forEach(p => pairs.push(...(p.data.pairs || [])));
  return pairs[Math.floor(Math.random() * pairs.length)] || ['Plage', 'Désert'];
}

function assignRoles(room, gs) {
  const ids = shuffle(room.connectedPlayerIds());
  const n = ids.length;
  const undercoverCount = n >= 8 ? 2 : 1;
  const mrWhiteCount = n >= 5 ? 1 : 0;
  const roles = new Map();
  let i = 0;
  for (let k = 0; k < undercoverCount; k++) roles.set(ids[i++], 'undercover');
  for (let k = 0; k < mrWhiteCount; k++) roles.set(ids[i++], 'mrwhite');
  for (; i < n; i++) roles.set(ids[i], 'civilian');
  gs.roles = roles;
}

function startClueRound(room, io) {
  const gs = room.gameState;
  gs.alive = gs.alive || room.connectedPlayerIds();
  gs.turnOrder = shuffle(gs.alive);
  gs.turnIndex = 0;
  gs.phase = 'CLUES';
  gs.votes = {};
  io.to(room.code).emit('game:activate', {
    type: 'undercover', phase: 'clues', round: gs.round,
    turnOrder: gs.turnOrder.map(id => ({ id, name: room.players.get(id)?.name })),
    currentPlayerId: gs.turnOrder[0]
  });
}

function start(room, io, config = {}) {
  const [civilianWord, undercoverWord] = pickPair(config.packNames);
  const gs = { round: 1, civilianWord, undercoverWord };
  room.gameState = gs;
  assignRoles(room, gs);
  gs.alive = room.connectedPlayerIds();

  gs.roles.forEach((role, id) => {
    let payload;
    if (role === 'civilian') payload = { role: 'civilian', word: civilianWord };
    else if (role === 'undercover') payload = { role: 'undercover', word: undercoverWord };
    else payload = { role: 'mrwhite', word: null };
    io.to(id).emit('game:privateData', { type: 'undercover', ...payload });
  });

  startClueRound(room, io);
}

function onHostAction(room, io, socket, action) {
  const gs = room.gameState;
  if (action === 'nextTurn') {
    gs.turnIndex++;
    if (gs.turnIndex < gs.turnOrder.length) {
      io.to(room.code).emit('game:update', { type: 'undercover', kind: 'turn', currentPlayerId: gs.turnOrder[gs.turnIndex] });
    } else {
      gs.phase = 'VOTING';
      io.to(room.code).emit('game:activate', {
        type: 'undercover', phase: 'voting',
        candidates: gs.alive.map(id => ({ id, name: room.players.get(id)?.name }))
      });
    }
  } else if (action === 'continue') {
    // après une révélation d'élimination sans fin de partie
    gs.round++;
    startClueRound(room, io);
  } else if (action === 'finish') {
    endMiniGame(room, io);
  }
}

function onPlayerAction(room, io, socket, action, payload) {
  const gs = room.gameState;
  if (action === 'vote') {
    if (!gs.alive.includes(socket.id)) return;
    if (payload.target === socket.id) return;
    gs.votes[socket.id] = payload.target;
    io.to(room.hostSocketId).emit('game:update', { type: 'undercover', kind: 'voteProgress', received: Object.keys(gs.votes).length, expected: gs.alive.length });
    if (Object.keys(gs.votes).length >= gs.alive.length) {
      resolveVote(room, io);
    }
  }
}

function resolveVote(room, io) {
  const gs = room.gameState;
  const tally = {};
  gs.alive.forEach(id => tally[id] = 0);
  Object.values(gs.votes).forEach(t => { if (tally[t] !== undefined) tally[t]++; });
  const max = Math.max(...Object.values(tally));
  const topVoted = Object.keys(tally).filter(id => tally[id] === max);
  const eliminated = topVoted.length === 1 ? topVoted[0] : null; // égalité = personne n'est éliminé

  if (eliminated) {
    gs.alive = gs.alive.filter(id => id !== eliminated);
  }

  const eliminatedRole = eliminated ? gs.roles.get(eliminated) : null;
  const civiliansLeft = gs.alive.filter(id => gs.roles.get(id) === 'civilian').length;
  const badLeft = gs.alive.filter(id => gs.roles.get(id) !== 'civilian').length;

  let gameOver = false, winner = null;
  if (badLeft === 0) { gameOver = true; winner = 'civilians'; }
  else if (badLeft >= civiliansLeft) { gameOver = true; winner = 'undercover'; }

  if (gameOver) {
    room.playerList().forEach(p => {
      const role = gs.roles.get(p.id);
      const isBad = role === 'undercover' || role === 'mrwhite';
      if ((winner === 'civilians' && role === 'civilian') || (winner === 'undercover' && isBad)) {
        room.addScore(p.id, 300);
      }
    });
  }

  io.to(room.code).emit('game:reveal', {
    type: 'undercover',
    eliminatedId: eliminated,
    eliminatedName: eliminated ? room.players.get(eliminated)?.name : null,
    eliminatedRole,
    tie: !eliminated,
    civilianWord: gs.civilianWord,
    undercoverWord: gs.undercoverWord,
    gameOver, winner,
    scores: room.leaderboard()
  });
}

module.exports = { start, onPlayerAction, onHostAction };
