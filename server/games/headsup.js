const { loadPacks, shuffle } = require('../content');
const { endMiniGame } = require('../hub');

function packNamesList(packNames) {
  const packs = loadPacks('headsup');
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  let names = [];
  (filtered.length ? filtered : packs).forEach(p => names.push(...(p.data.names || [])));
  return names;
}

function start(room, io, config = {}) {
  const allowExtraNames = config.allowExtraNames !== false; // activé par défaut
  const gs = {
    phase: allowExtraNames ? 'COLLECT' : 'READY',
    packNames: config.packNames || null,
    allowExtraNames,
    timerSeconds: Math.max(10, config.timerSeconds || 45),
    submitted: new Set(),
    extraNames: [],
    pool: [],
    used: [],
    turnOrder: [],
    turnIndex: -1,
    currentName: null,
    correctCount: 0
  };
  room.gameState = gs;
  room.activate(io, { type: 'headsup', phase: allowExtraNames ? 'collect' : 'ready' });
}

function onPlayerAction(room, io, playerId, action, payload) {
  const gs = room.gameState;
  if (action === 'submitNames') {
    if (!gs.allowExtraNames || gs.submitted.has(playerId)) return;
    gs.submitted.add(playerId);
    (payload.names || []).slice(0, 2).forEach(n => { if (n && n.trim()) gs.extraNames.push(n.trim()); });
    io.to(room.hostRoom()).emit('game:update', { type: 'headsup', kind: 'collectProgress', received: gs.submitted.size, expected: room.connectedPlayerIds().length });
  }
}

function drawNextName(room, io) {
  const gs = room.gameState;
  if (gs.pool.length === 0) {
    gs.pool = shuffle(gs.used.length ? gs.used : [...packNamesList(gs.packNames), ...gs.extraNames]);
    gs.used = [];
  }
  gs.currentName = gs.pool.pop();
  gs.used.push(gs.currentName);
  room.sendPrivate(io, gs.turnOrder[gs.turnIndex], { type: 'headsup', word: gs.currentName });
}

function startTurn(room, io) {
  const gs = room.gameState;
  gs.correctCount = 0;
  const currentPlayerId = gs.turnOrder[gs.turnIndex];
  room.activate(io, {
    type: 'headsup', phase: 'turn',
    currentPlayerId, currentPlayerName: room.players.get(currentPlayerId)?.name,
    duration: gs.timerSeconds
  });
  drawNextName(room, io);
}

function onHostAction(room, io, socket, action, payload) {
  const gs = room.gameState;
  if (action === 'startTurns') {
    gs.pool = shuffle([...packNamesList(gs.packNames), ...gs.extraNames]);
    gs.turnOrder = shuffle(room.connectedPlayerIds());
    gs.turnIndex = 0;
    startTurn(room, io);
  } else if (action === 'markResult') {
    if (payload.result === 'correct') { gs.correctCount++; }
    io.to(room.code).emit('game:update', { type: 'headsup', kind: 'scoreUpdate', correctCount: gs.correctCount, lastWord: gs.currentName, result: payload.result });
    drawNextName(room, io);
  } else if (action === 'endTurn') {
    const currentPlayerId = gs.turnOrder[gs.turnIndex];
    room.addScore(currentPlayerId, gs.correctCount * 10);
    io.to(room.code).emit('game:update', { type: 'headsup', kind: 'turnEnded', playerName: room.players.get(currentPlayerId)?.name, correctCount: gs.correctCount, scores: room.leaderboard() });
    gs.turnIndex++;
    if (gs.turnIndex < gs.turnOrder.length) {
      startTurn(room, io);
    } else {
      endMiniGame(room, io);
    }
  }
}

module.exports = { start, onPlayerAction, onHostAction };
