const { loadPacks, shuffle, pick } = require('../content');
const { endMiniGame } = require('../hub');

function packPrompts(packNames) {
  const packs = loadPacks('quiplash');
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  let prompts = [];
  (filtered.length ? filtered : packs).forEach(p => prompts.push(...(p.data.prompts || [])));
  return prompts;
}

// Génère la file de duels : chaque duel oppose 2 joueurs sur un même prompt,
// tous les autres joueurs connectés votent (jamais les 2 auteurs du duel).
// L'algorithme équilibre les duels pour que CHAQUE joueur réponde au moins
// `target` fois, quel que soit le nombre de joueurs.
function generateSchedule(room, target) {
  const ids = room.connectedPlayerIds();
  if (ids.length < 3) return []; // il faut au moins 2 auteurs + 1 votant
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

function start(room, io, config = {}) {
  const target = Math.max(2, config.answersPerPlayer || 3);
  const gs = {
    packNames: config.packNames || null,
    usedPrompts: new Set(),
    matchups: generateSchedule(room, target),
    currentMatchupIndex: 0,
    history: [] // pour le récap final ("meilleures blagues")
  };
  assignPrompts(room, gs);
  room.gameState = gs;
  if (!gs.matchups.length) {
    // Pas assez de joueurs connectés pour lancer un duel (garde-fou)
    endMiniGame(room, io, { recap: { bestJokes: [] } });
    return;
  }
  sendAnswering(room, io);
}

function assignPrompts(room, gs) {
  const all = packPrompts(gs.packNames);
  const n = gs.matchups.length;
  let pool = shuffle(all);
  gs.matchups.forEach((m, i) => {
    if (i > 0 && i % pool.length === 0) pool = shuffle(all); // recycle si le paquet est plus petit que le nombre de duels
    m.prompt = pool[i % pool.length] || 'Décris ta soirée idéale';
  });
}

function currentMatchup(room) { return room.gameState.matchups[room.gameState.currentMatchupIndex]; }

function sendAnswering(room, io) {
  const gs = room.gameState;
  const m = currentMatchup(room);
  room.activate(io, {
    type: 'quiplash', phase: 'answering',
    index: gs.currentMatchupIndex, total: gs.matchups.length,
    authorNames: m.authors.map(a => room.players.get(a)?.name)
  });
  m.authors.forEach(a => {
    room.sendPrivate(io, a, { type: 'quiplash', kind: 'prompt', prompt: m.prompt });
  });
}

function progressBroadcast(room, io) {
  const m = currentMatchup(room);
  const received = Object.keys(m.answers).length;
  io.to(room.hostRoom()).emit('game:update', { type: 'quiplash', kind: 'progress', received, expected: 2 });
  if (received >= 2) io.to(room.code).emit('game:update', { type: 'quiplash', kind: 'allAnswered' });
}

function sendVoting(room, io) {
  const gs = room.gameState;
  const m = currentMatchup(room);
  room.activate(io, {
    type: 'quiplash', phase: 'voting',
    index: gs.currentMatchupIndex, total: gs.matchups.length, prompt: m.prompt,
    options: [
      { id: m.authors[0], text: m.answers[m.authors[0]] || '(pas de réponse)' },
      { id: m.authors[1], text: m.answers[m.authors[1]] || '(pas de réponse)' }
    ],
    authors: m.authors
  });
}

function voteProgress(room, io) {
  const m = currentMatchup(room);
  const expected = room.connectedPlayerIds().filter(id => !m.authors.includes(id)).length;
  const received = Object.keys(m.votes).length;
  io.to(room.hostRoom()).emit('game:update', { type: 'quiplash', kind: 'voteProgress', received, expected });
  if (expected > 0 && received >= expected) io.to(room.code).emit('game:update', { type: 'quiplash', kind: 'allVoted' });
}

function onPlayerAction(room, io, playerId, action, payload) {
  const gs = room.gameState;
  const m = currentMatchup(room);
  if (!m) return;
  if (action === 'answer') {
    if (!m.authors.includes(playerId) || m.answers[playerId] !== undefined) return;
    m.answers[playerId] = (payload.text || '').slice(0, 120);
    progressBroadcast(room, io);
  } else if (action === 'vote') {
    if (m.authors.includes(playerId) || m.votes[playerId] !== undefined) return; // les auteurs ne votent jamais sur leur propre duel
    m.votes[playerId] = payload.choice;
    voteProgress(room, io);
  }
}

function onHostAction(room, io, socket, action) {
  const gs = room.gameState;
  const m = currentMatchup(room);
  if (action === 'startVoting') {
    sendVoting(room, io);
  } else if (action === 'reveal') {
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
  } else if (action === 'next') {
    gs.currentMatchupIndex++;
    if (gs.currentMatchupIndex < gs.matchups.length) {
      sendAnswering(room, io);
    } else {
      finishGame(room, io);
    }
  } else if (action === 'finish') {
    finishGame(room, io);
  }
}

function finishGame(room, io) {
  const gs = room.gameState;
  const allEntries = [];
  gs.history.forEach(h => h.entries.forEach(e => allEntries.push({ ...e, prompt: h.prompt })));
  const bestJokes = allEntries
    .filter(e => e.votes > 0 && e.text)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 5);
  endMiniGame(room, io, { recap: { bestJokes } });
}

module.exports = { start, onPlayerAction, onHostAction };
