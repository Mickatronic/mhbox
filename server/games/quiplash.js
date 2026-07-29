const { loadPacks, shuffle, pick } = require('../content');
const { endMiniGame } = require('../hub');

const REVEAL_PAUSE_MS = 4000; // pause d'affichage des résultats avant la question suivante

function packPrompts(packNames) {
  const packs = loadPacks('quiplash');
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  let prompts = [];
  (filtered.length ? filtered : packs).forEach(p => prompts.push(...(p.data.prompts || [])));
  return prompts;
}

// Génère la file de duels : chaque duel oppose 2 joueurs sur un même prompt.
// Équilibré pour que CHAQUE joueur réponde au moins `target` fois, quel que
// soit le nombre de joueurs, sans jamais opposer trop souvent les 2 mêmes.
function generateSchedule(room, target) {
  const ids = room.connectedPlayerIds();
  if (ids.length < 3) return [];
  const count = {};
  ids.forEach(id => count[id] = 0);
  const matchups = [];
  let lastPair = null;
  let guard = 0;

  while (ids.some(id => count[id] < target) && guard < 1000) {
    guard++;
    const sorted = shuffle(ids).sort((a, b) => count[a] - count[b]);
    const a = sorted[0];
    let b = sorted.find(x => x !== a && !(lastPair && lastPair.includes(a) && lastPair.includes(x)));
    if (!b) b = sorted.find(x => x !== a);
    if (!b) break;
    matchups.push({ authors: [a, b], answers: {}, votes: {} });
    count[a]++; count[b]++;
    lastPair = [a, b];
  }
  return matchups;
}

function assignPrompts(matchups, packNames) {
  const all = packPrompts(packNames);
  const pool = shuffle(all.length ? all : ['Décris ta soirée idéale']);
  matchups.forEach((m, i) => { m.prompt = pool[i % pool.length]; });
}

function clearTimer(gs) { if (gs.timer) { clearTimeout(gs.timer); gs.timer = null; } }
function scheduleTransition(gs, ms, fn) { clearTimer(gs); gs.timer = setTimeout(fn, ms); }

function start(room, io, config = {}) {
  const target = Math.max(2, config.answersPerPlayer || 3);
  const answerSecondsPerQuestion = Math.max(10, config.answerSecondsPerQuestion || 60);
  const voteSecondsPerQuestion = Math.max(5, config.voteSecondsPerQuestion || 20);

  const matchups = generateSchedule(room, target);
  if (!matchups.length) {
    endMiniGame(room, io, { recap: { bestJokes: [] } });
    return;
  }
  assignPrompts(matchups, config.packNames || null);

  const assignments = new Map(); // playerId -> [matchupIndex,...] à RÉPONDRE
  room.connectedPlayerIds().forEach(id => assignments.set(id, []));
  matchups.forEach((m, idx) => {
    m.authors.forEach(a => assignments.get(a) && assignments.get(a).push(idx));
  });
  const maxAssigned = Math.max(1, ...[...assignments.values()].map(a => a.length));

  room.gameState = {
    matchups, assignments,
    answerSecondsPerQuestion, voteSecondsPerQuestion,
    answerSeconds: maxAssigned * answerSecondsPerQuestion,
    votingIndex: 0,
    phase: 'answering',
    timer: null,
    history: []
  };
  beginAnswering(room, io);
}

// ============================================================
// PHASE 1 : RÉPONSES — en parallèle, chacun son lot, à son rythme
// ============================================================
function beginAnswering(room, io) {
  const gs = room.gameState;
  gs.phase = 'answering';
  gs.answerDeadline = Date.now() + gs.answerSeconds * 1000;

  room.activate(io, { type: 'quiplash', phase: 'answering', totalMatchups: gs.matchups.length, deadline: gs.answerDeadline });
  gs.assignments.forEach((indices, playerId) => sendAnswerBatch(room, io, playerId));
  broadcastAnswerProgress(room, io);
  scheduleTransition(gs, gs.answerSeconds * 1000, () => beginVotingSequence(room, io));
}

function sendAnswerBatch(room, io, playerId) {
  const gs = room.gameState;
  const indices = gs.assignments.get(playerId) || [];
  room.sendPrivate(io, playerId, {
    type: 'quiplash', kind: 'answerBatch', deadline: gs.answerDeadline,
    items: indices.map(idx => ({ matchupIndex: idx, prompt: gs.matchups[idx].prompt, answered: gs.matchups[idx].answers[playerId] !== undefined }))
  });
}

function broadcastAnswerProgress(room, io) {
  const gs = room.gameState;
  const table = room.playerList().map(p => ({
    id: p.id, name: p.name,
    done: (gs.assignments.get(p.id) || []).filter(idx => gs.matchups[idx].answers[p.id] !== undefined).length,
    total: (gs.assignments.get(p.id) || []).length
  }));
  io.to(room.code).emit('game:update', { type: 'quiplash', kind: 'answerProgress', table });
}

function allAnswersIn(gs) {
  return gs.matchups.every(m => m.authors.every(a => m.answers[a] !== undefined));
}

// ============================================================
// PHASE 2 : VOTES — synchrone, une question à la fois, affichée à l'écran.
// Seuls les 2 auteurs de LA question en cours ne votent pas ; tous les
// autres joueurs connectés votent en même temps, avec un minuteur par question.
// ============================================================
function beginVotingSequence(room, io) {
  const gs = room.gameState;
  clearTimer(gs);
  gs.phase = 'voting';
  gs.votingIndex = 0;
  sendVotingQuestion(room, io);
}

function expectedVoters(room, m) {
  return room.connectedPlayerIds().filter(id => !m.authors.includes(id));
}

function sendVotingQuestion(room, io) {
  const gs = room.gameState;
  const m = gs.matchups[gs.votingIndex];
  gs.voteDeadline = Date.now() + gs.voteSecondsPerQuestion * 1000;

  room.activate(io, {
    type: 'quiplash', phase: 'voting',
    index: gs.votingIndex, total: gs.matchups.length,
    prompt: m.prompt,
    options: [
      { id: m.authors[0], text: m.answers[m.authors[0]] || '(pas de réponse)' },
      { id: m.authors[1], text: m.answers[m.authors[1]] || '(pas de réponse)' }
    ],
    authors: m.authors,
    deadline: gs.voteDeadline
  });

  if (expectedVoters(room, m).length === 0) {
    // Personne pour voter sur ce duel (tous les autres joueurs sont déconnectés) -> on avance direct
    revealAndAdvance(room, io);
    return;
  }
  scheduleTransition(gs, gs.voteSecondsPerQuestion * 1000, () => revealAndAdvance(room, io));
}

function onPlayerActionVote(room, io, playerId, payload) {
  const gs = room.gameState;
  const m = gs.matchups[gs.votingIndex];
  if (!m || m.authors.includes(playerId) || m.votes[playerId] !== undefined) return;
  if (!m.authors.includes(payload.choice)) return;
  m.votes[playerId] = payload.choice;

  const expected = expectedVoters(room, m);
  const received = expected.filter(id => m.votes[id] !== undefined).length;
  io.to(room.hostRoom()).emit('game:update', { type: 'quiplash', kind: 'voteProgress', received, expected: expected.length });
  if (received >= expected.length) revealAndAdvance(room, io);
}

function revealAndAdvance(room, io) {
  const gs = room.gameState;
  clearTimer(gs);
  const m = gs.matchups[gs.votingIndex];
  if (m.revealed) return; // garde-fou anti double-déclenchement (minuteur + tous ont voté en même temps)
  m.revealed = true;

  const tally = { [m.authors[0]]: 0, [m.authors[1]]: 0 };
  Object.values(m.votes).forEach(c => { if (tally[c] !== undefined) tally[c]++; });
  m.authors.forEach(a => room.addScore(a, tally[a] * 100));
  gs.history.push({
    prompt: m.prompt,
    entries: m.authors.map(a => ({ authorId: a, name: room.players.get(a)?.name, text: m.answers[a] || '', votes: tally[a] }))
  });

  room.reveal(io, {
    type: 'quiplash',
    results: m.authors.map(a => ({ id: a, name: room.players.get(a)?.name, votes: tally[a] })),
    scores: room.leaderboard()
  });

  gs.timer = setTimeout(() => {
    gs.votingIndex++;
    if (gs.votingIndex < gs.matchups.length) sendVotingQuestion(room, io);
    else finishGame(room, io);
  }, REVEAL_PAUSE_MS);
}

// ============================================================
function onPlayerAction(room, io, playerId, action, payload) {
  const gs = room.gameState;
  if (!gs) return;

  if (action === 'answer' && gs.phase === 'answering') {
    const m = gs.matchups[payload.matchupIndex];
    if (!m || !m.authors.includes(playerId) || m.answers[playerId] !== undefined) return;
    m.answers[playerId] = (payload.text || '').slice(0, 120);
    broadcastAnswerProgress(room, io);
    if (allAnswersIn(gs)) beginVotingSequence(room, io);
  } else if (action === 'vote' && gs.phase === 'voting') {
    onPlayerActionVote(room, io, playerId, payload);
  }
}

function onHostAction(room, io, socket, action) {
  const gs = room.gameState;
  if (!gs) return;
  if (action === 'skipPhase') {
    if (gs.phase === 'answering') beginVotingSequence(room, io);
    else if (gs.phase === 'voting') revealAndAdvance(room, io);
  }
}

function finishGame(room, io) {
  const gs = room.gameState;
  clearTimer(gs);
  const allEntries = [];
  gs.history.forEach(h => h.entries.forEach(e => allEntries.push({ ...e, prompt: h.prompt })));
  const bestJokes = allEntries.filter(e => e.votes > 0 && e.text).sort((a, b) => b.votes - a.votes).slice(0, 5);
  endMiniGame(room, io, { recap: { bestJokes } });
}

// Fournit un état privé RECALCULÉ lors d'une reconnexion (pour la phase de
// réponses, qui est privée par joueur). Pour la phase de vote, l'événement
// public rejoué par room.resyncTo() (dernier game:activate) suffit puisqu'il
// est partagé par tout le monde ; on ajoute juste si CE joueur a déjà voté.
function getPrivateResync(room, playerId) {
  const gs = room.gameState;
  if (!gs) return null;
  if (gs.phase === 'answering') {
    const indices = gs.assignments.get(playerId) || [];
    return {
      type: 'quiplash', kind: 'answerBatch', deadline: gs.answerDeadline,
      items: indices.map(idx => ({ matchupIndex: idx, prompt: gs.matchups[idx].prompt, answered: gs.matchups[idx].answers[playerId] !== undefined }))
    };
  } else if (gs.phase === 'voting') {
    const m = gs.matchups[gs.votingIndex];
    return { type: 'quiplash', kind: 'votingState', alreadyVoted: !!(m && m.votes[playerId] !== undefined), isAuthor: !!(m && m.authors.includes(playerId)) };
  }
  return null;
}

module.exports = { start, onPlayerAction, onHostAction, getPrivateResync };
