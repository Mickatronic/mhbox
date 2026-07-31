const { loadPacks, shuffle } = require('../content');
const { endMiniGame } = require('../hub');
const { clearTimer, scheduleTimer } = require('../timerUtil');

const ROUND_LABELS = {
  describe: 'Manche 1 — Décris librement',
  oneword: 'Manche 2 — Un seul mot',
  mime: 'Manche 3 — Mime uniquement (silence !)'
};

// Réutilise le même pack de contenu que Tête en l'air (noms/personnalités à deviner) :
// les deux jeux partagent la même banque de mots, gérable depuis /admin.
function packNamesList(packNames) {
  const packs = loadPacks('headsup');
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  let names = [];
  (filtered.length ? filtered : packs).forEach(p => names.push(...(p.data.names || [])));
  return names;
}

function start(room, io, config = {}) {
  const allowExtraNames = config.allowExtraNames !== false;
  const enabledRounds = (Array.isArray(config.enabledRounds) && config.enabledRounds.length)
    ? config.enabledRounds.filter(r => ROUND_LABELS[r])
    : ['describe', 'oneword', 'mime'];

  const gs = {
    packNames: config.packNames || null,
    allowExtraNames,
    timerSeconds: Math.max(15, config.timerSeconds || 60),
    controllerMode: config.controllerMode === 'single' ? 'single' : 'perPlayer',
    wordCount: Math.max(6, config.wordCount || 16),
    enabledRounds,
    roundIdx: 0,
    submitted: new Set(),
    extraNames: [],
    masterDeck: [],
    pool: [],
    teams: [],
    currentTeamIdx: 0,
    controllerPlayerId: null,
    currentWord: null,
    turnCorrectCount: 0,
    timer: null
  };
  room.gameState = gs;
  room.activate(io, { type: 'timesup', phase: allowExtraNames ? 'collect' : 'teams' });
  if (!allowExtraNames) setupTeams(room, io);
}

function onPlayerAction(room, io, playerId, action, payload) {
  const gs = room.gameState;
  if (action === 'submitNames') {
    if (!gs.allowExtraNames || gs.submitted.has(playerId)) return;
    gs.submitted.add(playerId);
    (payload.names || []).slice(0, 2).forEach(n => { if (n && n.trim()) gs.extraNames.push(n.trim()); });
    io.to(room.hostRoom()).emit('game:update', { type: 'timesup', kind: 'collectProgress', received: gs.submitted.size, expected: room.connectedPlayerIds().length });
  } else if (action === 'markResult') {
    const team = gs.teams[gs.currentTeamIdx];
    if (!team) return;
    const describerId = describerFor(room, team);
    if (playerId !== describerId) return; // seul le joueur qui décrit actuellement peut valider
    applyResult(room, io, payload.result);
  }
}

function setupTeams(room, io) {
  const gs = room.gameState;
  const ids = shuffle(room.connectedPlayerIds());
  const teamA = [], teamB = [];
  ids.forEach((id, i) => (i % 2 === 0 ? teamA : teamB).push(id));
  gs.teams = [
    { id: 'A', name: 'Équipe 1', memberIds: teamA, score: 0, turnPos: 0 },
    { id: 'B', name: 'Équipe 2', memberIds: teamB, score: 0, turnPos: 0 }
  ];
  gs.controllerPlayerId = ids[0] || null;
  broadcastTeams(room, io, 'teams');
}

function broadcastTeams(room, io, phase) {
  const gs = room.gameState;
  room.activate(io, {
    type: 'timesup', phase,
    teams: gs.teams.map(t => ({ id: t.id, name: t.name, score: t.score, members: t.memberIds.map(id => room.players.get(id)?.name) })),
    controllerMode: gs.controllerMode,
    controllerName: gs.controllerPlayerId ? room.players.get(gs.controllerPlayerId)?.name : null
  });
}

function buildDeck(room) {
  const gs = room.gameState;
  const all = shuffle([...packNamesList(gs.packNames), ...gs.extraNames]);
  gs.masterDeck = all.slice(0, Math.min(gs.wordCount, all.length));
  if (!gs.masterDeck.length) gs.masterDeck = ['Mystère'];
}

function startRound(room, io) {
  const gs = room.gameState;
  gs.pool = shuffle([...gs.masterDeck]);
  gs.currentTeamIdx = 0;
  const roundType = gs.enabledRounds[gs.roundIdx];
  room.activate(io, {
    type: 'timesup', phase: 'roundIntro',
    roundType, roundLabel: ROUND_LABELS[roundType],
    roundIndex: gs.roundIdx, totalRounds: gs.enabledRounds.length,
    teams: gs.teams.map(t => ({ id: t.id, name: t.name, score: t.score }))
  });
}

function describerFor(room, team) {
  const gs = room.gameState;
  if (gs.controllerMode === 'single') return gs.controllerPlayerId;
  if (!team.memberIds.length) return null;
  return team.memberIds[team.turnPos % team.memberIds.length];
}

function startTurn(room, io) {
  const gs = room.gameState;
  const team = gs.teams[gs.currentTeamIdx];
  const describerId = describerFor(room, team);
  gs.turnCorrectCount = 0;
  gs.deadline = Date.now() + gs.timerSeconds * 1000;
  const roundType = gs.enabledRounds[gs.roundIdx];

  room.activate(io, {
    type: 'timesup', phase: 'turn',
    teamId: team.id, teamName: team.name,
    describerName: describerId ? room.players.get(describerId)?.name : null,
    controllerMode: gs.controllerMode,
    roundType, roundLabel: ROUND_LABELS[roundType],
    roundIndex: gs.roundIdx, totalRounds: gs.enabledRounds.length,
    deadline: gs.deadline,
    teams: gs.teams.map(t => ({ id: t.id, name: t.name, score: t.score })),
    remaining: gs.pool.length
  });

  if (describerId) drawWord(room, io, describerId);
  scheduleTimer(gs, gs.timerSeconds * 1000, () => endTurn(room, io));
}

function drawWord(room, io, describerId) {
  const gs = room.gameState;
  if (gs.pool.length === 0) { endRoundNow(room, io); return; }
  gs.currentWord = gs.pool.pop();
  room.sendPrivate(io, describerId, { type: 'timesup', word: gs.currentWord, remaining: gs.pool.length });
}

function applyResult(room, io, result) {
  const gs = room.gameState;
  const team = gs.teams[gs.currentTeamIdx];
  if (result === 'correct') {
    team.score += 10;
    team.memberIds.forEach(id => room.addScore(id, 10));
    gs.turnCorrectCount++;
  } else {
    gs.pool.unshift(gs.currentWord); // repasse en fin de pioche
  }
  io.to(room.code).emit('game:update', {
    type: 'timesup', kind: 'scoreUpdate', result, lastWord: gs.currentWord,
    turnCorrectCount: gs.turnCorrectCount, teamScore: team.score, remaining: gs.pool.length
  });
  const describerId = describerFor(room, team);
  if (describerId) drawWord(room, io, describerId);
}

function endTurn(room, io) {
  const gs = room.gameState;
  clearTimer(gs);
  const team = gs.teams[gs.currentTeamIdx];
  // Rotation du décrivant au sein de l'équipe (mode "chacun son tour")
  if (gs.controllerMode === 'perPlayer' && team.memberIds.length) team.turnPos++;

  io.to(room.code).emit('game:update', {
    type: 'timesup', kind: 'turnEnded',
    teamId: team.id, teamName: team.name, turnCorrectCount: gs.turnCorrectCount, teamScore: team.score
  });

  if (gs.pool.length === 0) { proceedAfterRound(room, io); return; }
  gs.currentTeamIdx = (gs.currentTeamIdx + 1) % gs.teams.length;
  startTurn(room, io);
}

function endRoundNow(room, io) {
  // Le paquet a été entièrement deviné avant la fin du chrono de ce tour.
  const gs = room.gameState;
  clearTimer(gs);
  const team = gs.teams[gs.currentTeamIdx];
  io.to(room.code).emit('game:update', {
    type: 'timesup', kind: 'turnEnded',
    teamId: team.id, teamName: team.name, turnCorrectCount: gs.turnCorrectCount, teamScore: team.score
  });
  proceedAfterRound(room, io);
}

function proceedAfterRound(room, io) {
  const gs = room.gameState;
  gs.roundIdx++;
  if (gs.roundIdx < gs.enabledRounds.length) {
    startRound(room, io);
  } else {
    endMiniGame(room, io, { recap: { teams: gs.teams.map(t => ({ name: t.name, score: t.score })) } });
  }
}

function onHostAction(room, io, socket, action, payload) {
  const gs = room.gameState;
  if (action === 'startTeams') {
    setupTeams(room, io);
  } else if (action === 'reshuffleTeams') {
    setupTeams(room, io);
  } else if (action === 'setController' && gs.controllerMode === 'single') {
    if (room.players.has(payload.playerId)) gs.controllerPlayerId = payload.playerId;
    broadcastTeams(room, io, 'teams');
  } else if (action === 'startGame') {
    buildDeck(room, io);
    startRound(room, io);
  } else if (action === 'beginTurn') {
    startTurn(room, io);
  } else if (action === 'skipPhase') {
    endTurn(room, io);
  } else if (action === 'finish') {
    endMiniGame(room, io, { recap: { teams: gs.teams.map(t => ({ name: t.name, score: t.score })) } });
  }
}

// Reconnexion : le décrivant (ou le contrôleur unique) retrouve son mot en cours.
function getPrivateResync(room, playerId) {
  const gs = room.gameState;
  if (!gs || !gs.teams.length) return null;
  const team = gs.teams[gs.currentTeamIdx];
  if (!team) return null;
  const describerId = describerFor(room, team);
  if (describerId === playerId && gs.currentWord) {
    return { type: 'timesup', word: gs.currentWord, remaining: gs.pool.length };
  }
  return null;
}

module.exports = { start, onPlayerAction, onHostAction, getPrivateResync };
