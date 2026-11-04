const { loadPacks, shuffle } = require('../content');
const { endMiniGame } = require('../hub');
const { clearTimer, scheduleTimer } = require('../timerUtil');

const ROUND_LABELS = {
  describe: 'Manche 1 — Décris librement',
  oneword: 'Manche 2 — Un seul mot',
  mime: 'Manche 3 — Mime uniquement (silence !)'
};

// Manches où les mots interdits ont un sens (au mime on ne parle pas).
const FORBIDDEN_ROUNDS = ['describe', 'oneword'];

// Pénalité (points d'équipe) quand le décrivant prononce un mot interdit.
const TABOO_PENALTY = 5;

/**
 * Une carte = { word, forbidden: [] }.
 * Sources :
 *  - server/content/timesup/*.json : { "cards": [ { "word": "...", "forbidden": ["...", ...] } ] }
 *    (une carte peut aussi être une simple chaîne, sans mot interdit)
 *  - server/content/headsup/*.json : { "names": ["...", ...] } (paquets partagés avec Tête en l'air)
 */
function normalizeCard(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const word = raw.trim();
    return word ? { word, forbidden: [] } : null;
  }
  const word = String(raw.word || '').trim();
  if (!word) return null;
  const forbidden = Array.isArray(raw.forbidden)
    ? raw.forbidden.map(f => String(f || '').trim()).filter(Boolean)
    : [];
  return { word, forbidden };
}

// Texte libre proposé par un joueur : "Climatisation : refroidir, ventiler"
function parseExtraName(text) {
  const s = String(text || '').trim().slice(0, 120);
  if (!s) return null;
  const idx = s.indexOf(':');
  if (idx === -1) return { word: s.slice(0, 40), forbidden: [] };
  const word = s.slice(0, idx).trim().slice(0, 40);
  const forbidden = s.slice(idx + 1).split(',').map(f => f.trim().slice(0, 30)).filter(Boolean).slice(0, 6);
  return word ? { word, forbidden } : null;
}

function allPacks() {
  const own = loadPacks('timesup').map(p => ({ name: p.name, tags: p.data.tags || [], cards: p.data.cards || [] }));
  const shared = loadPacks('headsup').map(p => ({ name: p.name, tags: p.data.tags || [], cards: p.data.names || [] }));
  return [...own, ...shared];
}

function packCards(packNames) {
  const packs = allPacks();
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  const cards = [];
  (filtered.length ? filtered : packs).forEach(p => p.cards.forEach(c => { const n = normalizeCard(c); if (n) cards.push(n); }));
  return cards;
}

// Partie "sur un seul écran" : l'hôte saisit les noms, aucun téléphone n'est nécessaire.
function parseLocalPlayers(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[,\n]/);
  return [...new Set(list.map(n => String(n || '').trim().slice(0, 16)).filter(Boolean))].slice(0, 20);
}

function start(room, io, config = {}) {
  // localPlayers présent (même vide) = partie sur un seul écran, sans téléphones.
  const local = Array.isArray(config.localPlayers) || typeof config.localPlayers === 'string';
  const localNames = local ? parseLocalPlayers(config.localPlayers) : [];
  while (local && localNames.length < 2) localNames.push('Joueur ' + (localNames.length + 1));
  const allowExtraNames = !local && config.allowExtraNames !== false;
  const enabledRounds = (Array.isArray(config.enabledRounds) && config.enabledRounds.filter(r => ROUND_LABELS[r]).length)
    ? config.enabledRounds.filter(r => ROUND_LABELS[r])
    : ['describe', 'oneword', 'mime'];

  const gs = {
    phase: allowExtraNames ? 'collect' : 'teams',
    packNames: config.packNames || null,
    allowExtraNames,
    showForbidden: config.showForbidden !== false,
    timerSeconds: Math.max(15, Number(config.timerSeconds) || 120), // 2 minutes par tour par défaut
    coop: !!config.coop, // tout le monde ensemble, sans équipes
    local,
    localNames: Object.fromEntries(localNames.map((n, i) => ['local:' + i, n])),
    noScore: !!config.forFun, // "pour du beurre" : on compte les mots trouvés, pas de points
    controllerMode: local ? 'local' : (config.controllerMode === 'single' ? 'single' : 'perPlayer'),
    wordCount: Math.max(6, Number(config.wordCount) || 16),
    enabledRounds,
    roundIdx: 0,
    submitted: new Set(),
    extraNames: [],
    masterDeck: [],
    pool: [],
    teams: [],
    currentTeamIdx: 0,
    controllerPlayerId: null,
    currentCard: null,
    cardSeq: 0,
    turnCorrectCount: 0,
    deadline: null,
    timer: null
  };
  room.gameState = gs;
  if (allowExtraNames) act(room, io, { type: 'timesup', phase: 'collect' });
  else setupTeams(room, io);
}

function teamsSummary(gs) {
  return gs.teams.map(t => ({ id: t.id, name: t.name, score: t.score, found: t.found || 0 }));
}

function nameOf(room, id) {
  const gs = room.gameState;
  if (gs && gs.localNames && gs.localNames[id]) return gs.localNames[id];
  return room.players.get(id)?.name;
}

// L'écran hôte affiche la carte quand on joue avec un seul appareil (partie locale ou manette unique).
function hostSeesCard(gs) { return gs.local || gs.controllerMode === 'single'; }

function act(room, io, payload) {
  const gs = room.gameState;
  room.activate(io, { ...payload, noScore: gs.noScore, local: gs.local, hostSeesCard: hostSeesCard(gs) });
}

function onPlayerAction(room, io, playerId, action, payload) {
  const gs = room.gameState;
  if (!gs) return;
  if (action === 'submitNames') {
    if (gs.phase !== 'collect' || !gs.allowExtraNames || gs.submitted.has(playerId)) return;
    gs.submitted.add(playerId);
    (Array.isArray(payload.names) ? payload.names : []).slice(0, 2).forEach(n => {
      const card = parseExtraName(n);
      if (card) gs.extraNames.push(card);
    });
    io.to(room.hostRoom()).emit('game:update', { type: 'timesup', kind: 'collectProgress', received: gs.submitted.size, expected: room.connectedPlayerIds().length });
  } else if (action === 'markResult') {
    if (gs.phase !== 'turn' || !gs.currentCard) return;
    const team = gs.teams[gs.currentTeamIdx];
    if (!team || playerId !== describerFor(room, team)) return; // seul le décrivant valide
    // Anti double-tap : si le téléphone indique la carte concernée, elle doit être la carte en cours.
    if (payload.cardId != null && payload.cardId !== gs.currentCard.id) return;
    applyResult(room, io, payload.result);
  } else if (action === 'ready') {
    // Le décrivant lance lui-même son tour depuis son téléphone (pratique sans projecteur).
    if (gs.phase !== 'turnReady' && gs.phase !== 'roundIntro') return;
    const team = gs.teams[gs.currentTeamIdx];
    if (!team || playerId !== describerFor(room, team)) return;
    startTurn(room, io);
  }
}

function setupTeams(room, io) {
  const gs = room.gameState;
  const ids = shuffle(gs.local ? Object.keys(gs.localNames) : room.connectedPlayerIds());
  if (gs.coop || ids.length < 4) {
    // 2 ou 3 joueurs : une seule équipe en coopératif, chacun décrit à son tour pour les autres.
    gs.teams = [{ id: 'A', name: 'Tout le monde', memberIds: ids, score: 0, found: 0, turnPos: 0 }];
  } else {
    const teamA = [], teamB = [];
    ids.forEach((id, i) => (i % 2 === 0 ? teamA : teamB).push(id));
    gs.teams = [
      { id: 'A', name: 'Équipe 1', memberIds: teamA, score: 0, found: 0, turnPos: 0 },
      { id: 'B', name: 'Équipe 2', memberIds: teamB, score: 0, found: 0, turnPos: 0 }
    ];
  }
  gs.controllerPlayerId = ids[0] || null;
  gs.phase = 'teams';
  broadcastTeams(room, io);
}

function broadcastTeams(room, io) {
  const gs = room.gameState;
  act(room, io, {
    type: 'timesup', phase: 'teams',
    teams: gs.teams.map(t => ({ id: t.id, name: t.name, score: t.score, members: t.memberIds.map(id => nameOf(room, id)) })),
    controllerMode: gs.controllerMode,
    controllerName: gs.controllerPlayerId ? nameOf(room, gs.controllerPlayerId) : null,
    players: room.connectedPlayerIds().map(id => ({ id, name: room.players.get(id)?.name }))
  });
}

function buildDeck(room) {
  const gs = room.gameState;
  // Dédoublonnage par mot (insensible à la casse) : un mot proposé par un joueur
  // qui existe déjà dans le paquet ne doit pas apparaître deux fois.
  const seen = new Set();
  const extras = shuffle(gs.extraNames);
  const fromPacks = shuffle(packCards(gs.packNames));
  const unique = [];
  // Les noms proposés par les joueurs sont prioritaires (ils les attendent !)
  [...extras, ...fromPacks].forEach(c => {
    const key = c.word.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(c);
  });
  gs.masterDeck = shuffle(unique.slice(0, Math.min(gs.wordCount, unique.length)));
  if (!gs.masterDeck.length) gs.masterDeck = [{ word: 'Mystère', forbidden: [] }];
}

function currentRoundType(gs) { return gs.enabledRounds[gs.roundIdx]; }

function startRound(room, io) {
  const gs = room.gameState;
  gs.pool = shuffle(gs.masterDeck.map(c => ({ ...c })));
  gs.phase = 'roundIntro';
  gs.currentCard = null;
  const roundType = currentRoundType(gs);
  const team = gs.teams[gs.currentTeamIdx];
  const describerId = team ? describerFor(room, team) : null;
  act(room, io, {
    type: 'timesup', phase: 'roundIntro',
    roundType, roundLabel: ROUND_LABELS[roundType],
    roundIndex: gs.roundIdx, totalRounds: gs.enabledRounds.length,
    teams: teamsSummary(gs),
    teamId: team && team.id, teamName: team && team.name,
    describerId, describerName: describerId ? nameOf(room, describerId) : null,
    controllerMode: gs.controllerMode,
    showForbidden: gs.showForbidden && FORBIDDEN_ROUNDS.includes(roundType)
  });
}

// Joueur qui décrit pour l'équipe : en mode "chacun son tour", on saute les joueurs déconnectés.
function describerFor(room, team) {
  const gs = room.gameState;
  if (gs.controllerMode === 'single') return gs.controllerPlayerId;
  if (!team.memberIds.length) return null;
  const n = team.memberIds.length;
  if (gs.local) return team.memberIds[team.turnPos % n]; // joueurs saisis par l'hôte : toujours "présents"
  for (let k = 0; k < n; k++) {
    const id = team.memberIds[(team.turnPos + k) % n];
    const p = room.players.get(id);
    if (p && p.connected) {
      if (k > 0) team.turnPos += k; // on fige le choix pour toute la durée du tour
      return id;
    }
  }
  return team.memberIds[team.turnPos % n];
}

function announceTurnReady(room, io) {
  const gs = room.gameState;
  const team = gs.teams[gs.currentTeamIdx];
  const describerId = describerFor(room, team);
  const roundType = currentRoundType(gs);
  gs.phase = 'turnReady';
  gs.currentCard = null;
  act(room, io, {
    type: 'timesup', phase: 'turnReady',
    teamId: team.id, teamName: team.name,
    describerId, describerName: describerId ? nameOf(room, describerId) : null,
    controllerMode: gs.controllerMode,
    roundType, roundLabel: ROUND_LABELS[roundType],
    roundIndex: gs.roundIdx, totalRounds: gs.enabledRounds.length,
    teams: teamsSummary(gs),
    remaining: gs.pool.length,
    showForbidden: gs.showForbidden && FORBIDDEN_ROUNDS.includes(roundType)
  });
}

function startTurn(room, io) {
  const gs = room.gameState;
  const team = gs.teams[gs.currentTeamIdx];
  if (!team) return;
  const describerId = describerFor(room, team);
  gs.turnCorrectCount = 0;
  gs.deadline = Date.now() + gs.timerSeconds * 1000;
  gs.phase = 'turn';
  const roundType = currentRoundType(gs);

  act(room, io, {
    type: 'timesup', phase: 'turn',
    teamId: team.id, teamName: team.name,
    describerId, describerName: describerId ? nameOf(room, describerId) : null,
    controllerMode: gs.controllerMode,
    roundType, roundLabel: ROUND_LABELS[roundType],
    roundIndex: gs.roundIdx, totalRounds: gs.enabledRounds.length,
    deadline: gs.deadline,
    duration: gs.timerSeconds,
    teams: teamsSummary(gs),
    remaining: gs.pool.length,
    showForbidden: gs.showForbidden && FORBIDDEN_ROUNDS.includes(roundType)
  });

  scheduleTimer(gs, gs.timerSeconds * 1000, () => endTurn(room, io));
  if (describerId) drawWord(room, io, describerId);
}

function privatePayload(gs) {
  const roundType = currentRoundType(gs);
  const showForbidden = gs.showForbidden && FORBIDDEN_ROUNDS.includes(roundType);
  return {
    type: 'timesup',
    cardId: gs.currentCard.id,
    word: gs.currentCard.word,
    forbidden: showForbidden ? gs.currentCard.forbidden : [],
    roundType,
    remaining: gs.pool.length,
    deadline: gs.deadline,
    duration: gs.timerSeconds
  };
}

function drawWord(room, io, describerId) {
  const gs = room.gameState;
  if (gs.pool.length === 0) { endRoundNow(room, io); return; }
  const card = gs.pool.pop();
  gs.currentCard = { ...card, id: ++gs.cardSeq };
  if (!gs.local) room.sendPrivate(io, describerId, privatePayload(gs));
  if (hostSeesCard(gs)) {
    const team = gs.teams[gs.currentTeamIdx];
    room.reveal(io, { ...privatePayload(gs), kind: 'card', describerName: nameOf(room, describerId), teamName: team && team.name });
  }
}

function applyResult(room, io, result) {
  const gs = room.gameState;
  const team = gs.teams[gs.currentTeamIdx];
  const card = gs.currentCard;
  if (result === 'correct') {
    if (!gs.noScore) {
      team.score += 10;
      team.memberIds.forEach(id => room.addScore(id, 10));
    }
    team.found = (team.found || 0) + 1;
    gs.turnCorrectCount++;
  } else if (result === 'taboo') {
    // Mot interdit prononcé : pénalité (sauf pour du beurre) et la carte repart dans la pioche
    if (!gs.noScore) {
      team.score -= TABOO_PENALTY;
      team.memberIds.forEach(id => room.addScore(id, -TABOO_PENALTY));
    }
    gs.pool.unshift({ word: card.word, forbidden: card.forbidden });
    result = 'taboo';
  } else {
    result = 'skip';
    gs.pool.unshift({ word: card.word, forbidden: card.forbidden }); // repasse en fin de pioche
  }
  gs.currentCard = null;
  io.to(room.code).emit('game:update', {
    type: 'timesup', kind: 'scoreUpdate', result, lastWord: card.word,
    lastForbidden: card.forbidden,
    turnCorrectCount: gs.turnCorrectCount, teamScore: team.score, remaining: gs.pool.length,
    teams: teamsSummary(gs)
  });
  const describerId = describerFor(room, team);
  if (describerId) drawWord(room, io, describerId);
}

function finishTurnBookkeeping(room, io) {
  const gs = room.gameState;
  clearTimer(gs);
  const team = gs.teams[gs.currentTeamIdx];
  // Carte en main non devinée quand le temps est écoulé : elle retourne dans la pioche.
  if (gs.currentCard) {
    gs.pool.unshift({ word: gs.currentCard.word, forbidden: gs.currentCard.forbidden });
    gs.currentCard = null;
  }
  // Évite qu'un joueur qui se reconnecte entre deux tours revoie l'ancienne carte.
  room.lastPrivateData.clear();
  // Rotation du décrivant au sein de l'équipe (mode "chacun son tour")
  if (gs.controllerMode !== 'single' && team.memberIds.length) team.turnPos++;
  io.to(room.code).emit('game:update', {
    type: 'timesup', kind: 'turnEnded',
    teamId: team.id, teamName: team.name, turnCorrectCount: gs.turnCorrectCount, teamScore: team.score
  });
  // L'équipe suivante commencera le prochain tour (ou la prochaine manche)
  gs.currentTeamIdx = (gs.currentTeamIdx + 1) % gs.teams.length;
}

function endTurn(room, io) {
  const gs = room.gameState;
  if (gs.phase !== 'turn') return;
  finishTurnBookkeeping(room, io);
  if (gs.pool.length === 0) { proceedAfterRound(room, io); return; }
  announceTurnReady(room, io);
}

function endRoundNow(room, io) {
  // Le paquet a été entièrement deviné avant la fin du chrono de ce tour.
  const gs = room.gameState;
  finishTurnBookkeeping(room, io);
  proceedAfterRound(room, io);
}

function finishGame(room, io) {
  const gs = room.gameState;
  clearTimer(gs);
  gs.phase = 'done';
  endMiniGame(room, io, { recap: { noScore: gs.noScore, teams: gs.teams.map(t => ({ name: t.name, score: t.score, found: t.found || 0 })) } });
}

function proceedAfterRound(room, io) {
  const gs = room.gameState;
  gs.roundIdx++;
  if (gs.roundIdx < gs.enabledRounds.length) startRound(room, io);
  else finishGame(room, io);
}

function onHostAction(room, io, socket, action, payload) {
  const gs = room.gameState;
  if (!gs) return;
  if (action === 'startTeams' || action === 'reshuffleTeams') {
    if (gs.phase !== 'collect' && gs.phase !== 'teams') return;
    setupTeams(room, io);
  } else if (action === 'setController') {
    if (gs.phase !== 'teams' || gs.controllerMode !== 'single') return;
    if (room.players.has(payload.playerId)) gs.controllerPlayerId = payload.playerId;
    broadcastTeams(room, io);
  } else if (action === 'startGame') {
    if (gs.phase !== 'teams') return;
    buildDeck(room);
    gs.currentTeamIdx = 0;
    startRound(room, io);
  } else if (action === 'beginTurn') {
    if (gs.phase !== 'roundIntro' && gs.phase !== 'turnReady') return;
    startTurn(room, io);
  } else if (action === 'hostMark') {
    // Validation depuis l'écran hôte (partie locale / manette unique)
    if (gs.phase !== 'turn' || !gs.currentCard || !hostSeesCard(gs)) return;
    if (payload.cardId != null && payload.cardId !== gs.currentCard.id) return;
    applyResult(room, io, payload.result);
  } else if (action === 'skipPhase') {
    endTurn(room, io);
  } else if (action === 'finish') {
    finishGame(room, io);
  }
}

// Reconnexion : le décrivant (ou le contrôleur unique) retrouve son mot en cours.
function getPrivateResync(room, playerId) {
  const gs = room.gameState;
  if (!gs || !gs.teams || !gs.teams.length || gs.phase !== 'turn') return null;
  const team = gs.teams[gs.currentTeamIdx];
  if (!team) return null;
  if (describerFor(room, team) === playerId && gs.currentCard) return privatePayload(gs);
  return null;
}

module.exports = { start, onPlayerAction, onHostAction, getPrivateResync, normalizeCard, parseExtraName, allPacks };
