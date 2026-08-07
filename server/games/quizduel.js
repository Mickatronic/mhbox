const { loadPacks, shuffle } = require('../content');
const { endMiniGame } = require('../hub');
const { clearTimer, scheduleTimer } = require('../timerUtil');

// Chaque paquet de contenu Quiz Duel = un THÈME jouable.
function loadThemes(packNames) {
  const packs = loadPacks('quizduel');
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  const source = filtered.length ? filtered : packs;
  return source.map(p => ({ name: p.name, questions: p.data.questions || [] })).filter(t => t.questions.length);
}

function formTeams(room, teamCount) {
  const ids = shuffle(room.connectedPlayerIds());
  const n = Math.max(2, Math.min(teamCount, ids.length || 2));
  const teams = Array.from({ length: n }, (_, i) => ({ id: 'T' + i, name: `Équipe ${i + 1}`, memberIds: [], score: 0 }));
  ids.forEach((id, i) => teams[i % n].memberIds.push(id));
  return teams;
}

function start(room, io, config = {}) {
  const themesPerPlayer = config.themesPerPlayer === undefined ? 3 : Math.max(0, parseInt(config.themesPerPlayer, 10) || 0);
  const teamMode = !!config.teamMode;
  const gs = {
    themes: loadThemes(config.packNames),
    themesPerPlayer,
    pickerMethod: ['random', 'roundrobin', 'weakest', 'strongest'].includes(config.pickerMethod) ? config.pickerMethod : 'random',
    questionSeconds: Math.max(5, config.questionSeconds || 20),
    pickSeconds: Math.max(5, config.pickSeconds || 15),
    draftSeconds: Math.max(10, config.draftSeconds || 30),
    totalRounds: Math.max(1, config.rounds || room.connectedPlayerIds().length),
    round: 0,
    sessionScores: new Map(),
    turnOrder: shuffle(room.connectedPlayerIds()),
    turnIndex: -1,
    themePool: [],
    usedThemes: new Set(),
    usedQuestions: new Map(),
    playerPicks: new Map(),
    submitted: new Set(),
    teamMode,
    teamCount: Math.max(2, config.teamCount || 2),
    teams: [],
    teamTurnIndex: -1,
    teamSubmitted: new Set(),
    teamPicks: new Map(),
    phase: null,
    timer: null
  };
  room.connectedPlayerIds().forEach(id => gs.sessionScores.set(id, 0));
  room.gameState = gs;

  if (!gs.themes.length) { endMiniGame(room, io); return; }

  if (teamMode) {
    gs.teams = formTeams(room, gs.teamCount);
    broadcastTeams(room, io);
  } else if (gs.themesPerPlayer === 0) {
    gs.themePool = gs.themes.map(t => t.name);
    startPickTurn(room, io);
  } else {
    startDraft(room, io);
  }
}

// --- Formation des équipes (mode équipe uniquement) ---
function broadcastTeams(room, io) {
  const gs = room.gameState;
  gs.phase = 'teams';
  room.activate(io, {
    type: 'quizduel', phase: 'teams',
    teams: gs.teams.map(t => ({ id: t.id, name: t.name, members: t.memberIds.map(id => room.players.get(id)?.name) }))
  });
}

function teamOf(gs, playerId) {
  return gs.teams.find(t => t.memberIds.includes(playerId));
}

// --- Tour 1 : chaque joueur (ou équipe) choisit ses thèmes préférés ---
function startDraft(room, io) {
  const gs = room.gameState;
  if (gs.themesPerPlayer === 0) {
    gs.themePool = gs.themes.map(t => t.name);
    startPickTurn(room, io);
    return;
  }
  gs.phase = 'draft';
  gs.deadline = Date.now() + gs.draftSeconds * 1000;
  room.activate(io, {
    type: 'quizduel', phase: 'draft', themesPerPlayer: gs.themesPerPlayer,
    allThemes: gs.themes.map(t => t.name), deadline: gs.deadline,
    teamMode: gs.teamMode
  });
  scheduleTimer(gs, gs.draftSeconds * 1000, () => finishDraft(room, io));
}

function onDraftPick(room, io, playerId, payload) {
  const gs = room.gameState;
  const picks = Array.isArray(payload.themes)
    ? payload.themes.filter(t => gs.themes.some(th => th.name === t)).slice(0, gs.themesPerPlayer)
    : [];

  if (gs.teamMode) {
    const team = teamOf(gs, playerId);
    if (!team || gs.teamSubmitted.has(team.id)) return;
    gs.teamSubmitted.add(team.id);
    gs.teamPicks.set(team.id, picks);
    const received = gs.teamSubmitted.size, expected = gs.teams.length;
    io.to(room.hostRoom()).emit('game:update', { type: 'quizduel', kind: 'draftProgress', received, expected });
    if (received >= expected) finishDraft(room, io);
  } else {
    if (gs.submitted.has(playerId)) return;
    gs.submitted.add(playerId);
    gs.playerPicks.set(playerId, picks);
    const received = gs.submitted.size, expected = room.connectedPlayerIds().length;
    io.to(room.hostRoom()).emit('game:update', { type: 'quizduel', kind: 'draftProgress', received, expected });
    if (received >= expected) finishDraft(room, io);
  }
}

function finishDraft(room, io) {
  const gs = room.gameState;
  if (gs.phase !== 'draft') return;
  clearTimer(gs);
  const union = new Set();
  if (gs.teamMode) gs.teamPicks.forEach(list => list.forEach(t => union.add(t)));
  else gs.playerPicks.forEach(list => list.forEach(t => union.add(t)));
  gs.themePool = union.size ? [...union] : gs.themes.map(t => t.name);
  startPickTurn(room, io);
}

// --- Tour 2 / 5 : désignation de qui (joueur ou équipe) choisit le thème ---
function pickerFor(room, gs) {
  if (gs.teamMode) {
    const teams = gs.teams;
    if (!teams.length) return null;
    if (gs.pickerMethod === 'roundrobin') {
      gs.teamTurnIndex = (gs.teamTurnIndex + 1) % teams.length;
      return teams[gs.teamTurnIndex].id;
    }
    if (gs.pickerMethod === 'weakest' || gs.pickerMethod === 'strongest') {
      const sorted = [...teams].sort((a, b) => a.score - b.score);
      return gs.pickerMethod === 'weakest' ? sorted[0].id : sorted[sorted.length - 1].id;
    }
    return teams[Math.floor(Math.random() * teams.length)].id;
  }
  const ids = room.connectedPlayerIds();
  if (!ids.length) return null;
  if (gs.pickerMethod === 'roundrobin') {
    let guard = 0;
    do {
      gs.turnIndex = (gs.turnIndex + 1) % gs.turnOrder.length;
      guard++;
    } while (!ids.includes(gs.turnOrder[gs.turnIndex]) && guard <= gs.turnOrder.length);
    return ids.includes(gs.turnOrder[gs.turnIndex]) ? gs.turnOrder[gs.turnIndex] : ids[0];
  }
  if (gs.pickerMethod === 'weakest' || gs.pickerMethod === 'strongest') {
    const sorted = [...ids].sort((a, b) => (gs.sessionScores.get(a) || 0) - (gs.sessionScores.get(b) || 0));
    return gs.pickerMethod === 'weakest' ? sorted[0] : sorted[sorted.length - 1];
  }
  return ids[Math.floor(Math.random() * ids.length)];
}

function proposeThemes(gs) {
  let available = gs.themePool.filter(t => !gs.usedThemes.has(t));
  if (available.length < 3) { gs.usedThemes.clear(); available = [...gs.themePool]; }
  return shuffle(available).slice(0, Math.min(3, available.length));
}

function startPickTurn(room, io) {
  const gs = room.gameState;
  gs.round++;
  if (gs.round > gs.totalRounds) { endMiniGame(room, io); return; }
  gs.phase = 'pick';
  gs.proposedThemes = proposeThemes(gs);
  gs.deadline = Date.now() + gs.pickSeconds * 1000;

  const picker = pickerFor(room, gs);
  const payload = {
    type: 'quizduel', phase: 'pick', round: gs.round, totalRounds: gs.totalRounds,
    pickerMethod: gs.pickerMethod, options: gs.proposedThemes, deadline: gs.deadline, teamMode: gs.teamMode
  };
  if (gs.teamMode) {
    gs.pickerTeamId = picker;
    const team = gs.teams.find(t => t.id === picker);
    payload.pickerTeamId = picker;
    payload.pickerTeamName = team?.name;
  } else {
    gs.pickerId = picker;
    payload.pickerId = picker;
    payload.pickerName = room.players.get(picker)?.name;
  }
  room.activate(io, payload);

  scheduleTimer(gs, gs.pickSeconds * 1000, () => {
    if (gs.phase === 'pick' && gs.proposedThemes.length) {
      chooseTheme(room, io, gs.proposedThemes[Math.floor(Math.random() * gs.proposedThemes.length)]);
    }
  });
}

function chooseTheme(room, io, themeName) {
  const gs = room.gameState;
  if (gs.phase !== 'pick') return;
  clearTimer(gs);
  gs.chosenTheme = themeName;
  gs.usedThemes.add(themeName);
  const theme = gs.themes.find(t => t.name === themeName);
  const used = gs.usedQuestions.get(themeName) || new Set();
  let pool = theme.questions.map((q, i) => i).filter(i => !used.has(i));
  if (pool.length < 3) { used.clear(); pool = theme.questions.map((q, i) => i); }
  const chosenIdx = shuffle(pool).slice(0, Math.min(3, pool.length));
  chosenIdx.forEach(i => used.add(i));
  gs.usedQuestions.set(themeName, used);
  gs.currentQuestions = chosenIdx.map(i => theme.questions[i]);
  gs.questionIndex = 0;
  gs.roundStartScores = new Map(gs.sessionScores);
  startQuestion(room, io);
}

// --- Tour 3 : 3 questions du thème choisi, tout le monde répond ---
function startQuestion(room, io) {
  const gs = room.gameState;
  gs.phase = 'question';
  const q = gs.currentQuestions[gs.questionIndex];
  gs.answers = {};
  gs.roundActive = true;
  gs.startTime = Date.now();
  gs.deadline = gs.startTime + gs.questionSeconds * 1000;
  room.activate(io, {
    type: 'quizduel', phase: 'question',
    themeName: gs.chosenTheme, questionIndex: gs.questionIndex, totalQuestions: gs.currentQuestions.length,
    round: gs.round, totalRounds: gs.totalRounds,
    question: q.q, choices: q.choices, deadline: gs.deadline
  });
  scheduleTimer(gs, gs.questionSeconds * 1000, () => revealQuestion(room, io));
}

function revealQuestion(room, io) {
  const gs = room.gameState;
  if (!gs.roundActive) return;
  clearTimer(gs);
  gs.roundActive = false;
  const q = gs.currentQuestions[gs.questionIndex];
  const results = room.playerList().map(p => {
    const a = gs.answers[p.id];
    const correct = a && a.choice === q.correct;
    let points = 0;
    if (correct) points = 100 + Math.max(0, 100 - Math.floor(a.time / 100));
    if (points) {
      room.addScore(p.id, points);
      gs.sessionScores.set(p.id, (gs.sessionScores.get(p.id) || 0) + points);
      if (gs.teamMode) { const team = teamOf(gs, p.id); if (team) team.score += points; }
    }
    return { id: p.id, name: p.name, choice: a ? a.choice : null, correct: !!correct, points };
  });
  room.reveal(io, {
    type: 'quizduel', correct: q.correct, results, scores: room.leaderboard(),
    questionIndex: gs.questionIndex, totalQuestions: gs.currentQuestions.length,
    teams: gs.teamMode ? gs.teams.map(t => ({ id: t.id, name: t.name, score: t.score })) : null
  });
}

// --- Tour 4 : résultats globaux de la manche ---
function showRoundResults(room, io) {
  const gs = room.gameState;
  gs.phase = 'results';
  const gains = room.playerList()
    .map(p => ({
      id: p.id, name: p.name,
      gained: (gs.sessionScores.get(p.id) || 0) - (gs.roundStartScores.get(p.id) || 0),
      total: p.score
    }))
    .sort((a, b) => b.total - a.total);
  const teamStandings = gs.teamMode ? [...gs.teams].sort((a, b) => b.score - a.score).map(t => ({ id: t.id, name: t.name, score: t.score })) : null;
  room.activate(io, {
    type: 'quizduel', phase: 'results', themeName: gs.chosenTheme, round: gs.round, totalRounds: gs.totalRounds,
    gains, teams: teamStandings
  });
}

function onPlayerAction(room, io, playerId, action, payload) {
  const gs = room.gameState;
  if (!gs) return;
  if (action === 'pickThemes' && gs.phase === 'draft') {
    onDraftPick(room, io, playerId, payload);
  } else if (action === 'chooseTheme' && gs.phase === 'pick') {
    if (gs.teamMode) {
      const team = teamOf(gs, playerId);
      if (!team || team.id !== gs.pickerTeamId) return;
    } else if (playerId !== gs.pickerId) return;
    if (!gs.proposedThemes.includes(payload.theme)) return;
    chooseTheme(room, io, payload.theme);
  } else if (action === 'answer' && gs.phase === 'question' && gs.roundActive) {
    if (gs.answers[playerId] !== undefined) return;
    gs.answers[playerId] = { choice: payload.choice, time: Date.now() - gs.startTime };
    const received = Object.keys(gs.answers).length, expected = room.connectedPlayerIds().length;
    io.to(room.hostRoom()).emit('game:update', { type: 'quizduel', kind: 'progress', received, expected });
    if (received >= expected) revealQuestion(room, io);
  }
}

function onHostAction(room, io, socket, action) {
  const gs = room.gameState;
  if (!gs) return;
  if (action === 'reshuffleTeams' && gs.teamMode && gs.phase === 'teams') {
    gs.teams = formTeams(room, gs.teamCount);
    broadcastTeams(room, io);
  } else if (action === 'confirmTeams' && gs.teamMode && gs.phase === 'teams') {
    startDraft(room, io);
  } else if (action === 'skipPhase') {
    if (gs.phase === 'draft') finishDraft(room, io);
    else if (gs.phase === 'pick' && gs.proposedThemes.length) chooseTheme(room, io, gs.proposedThemes[Math.floor(Math.random() * gs.proposedThemes.length)]);
    else if (gs.phase === 'question') revealQuestion(room, io);
  } else if (action === 'next') {
    gs.questionIndex++;
    if (gs.questionIndex < gs.currentQuestions.length) startQuestion(room, io);
    else showRoundResults(room, io);
  } else if (action === 'nextRound') {
    startPickTurn(room, io);
  }
}

module.exports = { start, onPlayerAction, onHostAction };
