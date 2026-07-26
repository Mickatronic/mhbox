const { loadPacks, shuffle, pick } = require('../content');
const { endMiniGame } = require('../hub');

function packPrompts(packNames) {
  const packs = loadPacks('quiplash');
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  let prompts = [];
  (filtered.length ? filtered : packs).forEach(p => prompts.push(...(p.data.prompts || [])));
  return prompts;
}

function start(room, io, config = {}) {
  const gs = {
    round: 1,
    totalRounds: 3,
    packNames: config.packNames || null,
    usedPrompts: new Set(),
    matchups: [],
    currentMatchupIndex: 0,
    finalPrompt: null,
    finalAnswers: {},
    finalVotes: {}
  };
  room.gameState = gs;
  startRegularRound(room, io);
}

function pickPrompts(room, n) {
  const gs = room.gameState;
  const all = packPrompts(gs.packNames).filter(p => !gs.usedPrompts.has(p));
  const pool = all.length >= n ? all : packPrompts(gs.packNames);
  const chosen = pick(pool, n);
  chosen.forEach(p => gs.usedPrompts.add(p));
  return chosen;
}

function startRegularRound(room, io) {
  const gs = room.gameState;
  const ids = shuffle(room.connectedPlayerIds());
  const pairs = [];
  for (let i = 0; i < ids.length; i += 2) {
    if (ids[i + 1] !== undefined) pairs.push([ids[i], ids[i + 1]]);
    else pairs.push([ids[i], ids[0]]);
  }
  const prompts = pickPrompts(room, pairs.length);
  gs.matchups = pairs.map((pair, i) => ({
    id: `${gs.round}-${i}`, prompt: prompts[i] || 'Décris ta soirée idéale',
    authors: pair, answers: {}, votes: {}
  }));
  gs.currentMatchupIndex = 0;

  io.to(room.code).emit('game:activate', { type: 'quiplash', phase: 'answering', round: gs.round, total: gs.totalRounds, final: false });
  gs.matchups.forEach(m => m.authors.forEach(a => {
    io.to(a).emit('game:privateData', { type: 'quiplash', kind: 'prompt', prompt: m.prompt });
  }));
}

function startFinalRound(room, io) {
  const gs = room.gameState;
  gs.round = 3;
  gs.finalPrompt = pickPrompts(room, 1)[0] || 'Le meilleur moyen de finir cette soirée';
  gs.finalAnswers = {};
  gs.finalVotes = {};
  io.to(room.code).emit('game:activate', { type: 'quiplash', phase: 'answering', round: 3, total: gs.totalRounds, final: true, prompt: gs.finalPrompt });
}

function progressBroadcast(room, io) {
  const gs = room.gameState;
  let received, expected;
  if (gs.round === 3) {
    received = Object.keys(gs.finalAnswers).length;
    expected = room.connectedPlayerIds().length;
  } else {
    received = gs.matchups.reduce((n, m) => n + Object.keys(m.answers).length, 0);
    expected = gs.matchups.length * 2;
  }
  io.to(room.hostSocketId).emit('game:update', { type: 'quiplash', kind: 'progress', received, expected });
  if (received >= expected) io.to(room.code).emit('game:update', { type: 'quiplash', kind: 'allAnswered' });
}

function currentMatchup(room) { return room.gameState.matchups[room.gameState.currentMatchupIndex]; }

function sendMatchup(room, io) {
  const gs = room.gameState;
  const m = currentMatchup(room);
  io.to(room.code).emit('game:activate', {
    type: 'quiplash', phase: 'voting',
    index: gs.currentMatchupIndex, total: gs.matchups.length, prompt: m.prompt,
    options: [
      { id: m.authors[0], text: m.answers[m.authors[0]] || '(pas de réponse)' },
      { id: m.authors[1], text: m.answers[m.authors[1]] || '(pas de réponse)' }
    ],
    authors: m.authors
  });
}

function sendFinalMatchup(room, io) {
  const gs = room.gameState;
  const options = shuffle(room.playerList()).map(p => ({ id: p.id, text: gs.finalAnswers[p.id] || '(pas de réponse)' }));
  io.to(room.code).emit('game:activate', { type: 'quiplash', phase: 'votingFinal', prompt: gs.finalPrompt, options });
}

function voteProgress(room, io) {
  const gs = room.gameState;
  let received, expected;
  if (gs.round === 3) {
    received = Object.keys(gs.finalVotes).length;
    expected = room.connectedPlayerIds().length;
  } else {
    const m = currentMatchup(room);
    received = Object.keys(m.votes).length;
    expected = room.connectedPlayerIds().filter(id => !m.authors.includes(id)).length;
  }
  io.to(room.hostSocketId).emit('game:update', { type: 'quiplash', kind: 'voteProgress', received, expected });
  if (received >= expected) io.to(room.code).emit('game:update', { type: 'quiplash', kind: 'allVoted' });
}

function onPlayerAction(room, io, socket, action, payload) {
  const gs = room.gameState;
  if (action === 'answer') {
    if (gs.round === 3) {
      gs.finalAnswers[socket.id] = (payload.text || '').slice(0, 120);
    } else {
      const m = gs.matchups.find(m => m.authors.includes(socket.id) && m.answers[socket.id] === undefined);
      if (m) m.answers[socket.id] = (payload.text || '').slice(0, 120);
    }
    progressBroadcast(room, io);
  } else if (action === 'vote') {
    if (gs.round === 3) {
      if (payload.choice !== socket.id) gs.finalVotes[socket.id] = payload.choice;
    } else {
      const m = currentMatchup(room);
      if (!m.authors.includes(socket.id)) m.votes[socket.id] = payload.choice;
    }
    voteProgress(room, io);
  }
}

function onHostAction(room, io, socket, action, payload) {
  const gs = room.gameState;
  if (action === 'startVoting') {
    gs.currentMatchupIndex = 0;
    sendMatchup(room, io);
  } else if (action === 'reveal') {
    const m = currentMatchup(room);
    const tally = { [m.authors[0]]: 0, [m.authors[1]]: 0 };
    Object.values(m.votes).forEach(c => { if (tally[c] !== undefined) tally[c]++; });
    m.authors.forEach(a => room.addScore(a, tally[a] * 100));
    io.to(room.code).emit('game:reveal', {
      type: 'quiplash',
      results: m.authors.map(a => ({ id: a, name: room.players.get(a)?.name, votes: tally[a] })),
      scores: room.leaderboard()
    });
  } else if (action === 'next') {
    gs.currentMatchupIndex++;
    if (gs.currentMatchupIndex < gs.matchups.length) {
      sendMatchup(room, io);
    } else if (gs.round < 2) {
      gs.round++;
      startRegularRound(room, io);
    } else {
      startFinalRound(room, io);
    }
  } else if (action === 'startVotingFinal') {
    sendFinalMatchup(room, io);
  } else if (action === 'revealFinal') {
    const tally = {};
    room.connectedPlayerIds().forEach(id => tally[id] = 0);
    Object.values(gs.finalVotes).forEach(c => { if (tally[c] !== undefined) tally[c]++; });
    Object.entries(tally).forEach(([id, count]) => room.addScore(id, count * 200));
    io.to(room.code).emit('game:reveal', {
      type: 'quiplash', final: true,
      results: room.playerList().map(p => ({ id: p.id, name: p.name, votes: tally[p.id] || 0 })),
      scores: room.leaderboard()
    });
  } else if (action === 'finish') {
    endMiniGame(room, io);
  }
}

module.exports = { start, onPlayerAction, onHostAction };
