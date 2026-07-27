const { loadPacks, pick } = require('../content');
const { endMiniGame } = require('../hub');

function pickQuestions(packNames, n) {
  const packs = loadPacks('quizduel');
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  let questions = [];
  (filtered.length ? filtered : packs).forEach(p => questions.push(...(p.data.questions || [])));
  return pick(questions, Math.min(n, questions.length));
}

function start(room, io, config = {}) {
  const gs = {
    questions: pickQuestions(config.packNames, config.rounds || 8),
    index: 0,
    answers: {},
    roundActive: false,
    startTime: 0
  };
  room.gameState = gs;
  startQuestion(room, io);
}

function startQuestion(room, io) {
  const gs = room.gameState;
  const q = gs.questions[gs.index];
  gs.answers = {};
  gs.roundActive = true;
  gs.startTime = Date.now();
  room.activate(io, {
    type: 'quizduel', index: gs.index, total: gs.questions.length,
    question: q.q, choices: q.choices
  });
}

function onPlayerAction(room, io, playerId, action, payload) {
  const gs = room.gameState;
  if (action === 'answer' && gs.roundActive) {
    if (gs.answers[playerId] !== undefined) return;
    gs.answers[playerId] = { choice: payload.choice, time: Date.now() - gs.startTime };
    const received = Object.keys(gs.answers).length;
    const expected = room.connectedPlayerIds().length;
    io.to(room.hostRoom()).emit('game:update', { type: 'quizduel', kind: 'progress', received, expected });
    if (received >= expected) {
      gs.roundActive = false;
      io.to(room.code).emit('game:update', { type: 'quizduel', kind: 'allAnswered' });
    }
  }
}

function onHostAction(room, io, socket, action) {
  const gs = room.gameState;
  if (action === 'reveal') {
    gs.roundActive = false;
    const q = gs.questions[gs.index];
    const results = room.playerList().map(p => {
      const a = gs.answers[p.id];
      const correct = a && a.choice === q.correct;
      let points = 0;
      if (correct) points = 100 + Math.max(0, 100 - Math.floor(a.time / 100));
      if (points) room.addScore(p.id, points);
      return { id: p.id, name: p.name, choice: a ? a.choice : null, correct: !!correct, points };
    });
    room.reveal(io, { type: 'quizduel', correct: q.correct, results, scores: room.leaderboard() });
  } else if (action === 'next') {
    gs.index++;
    if (gs.index < gs.questions.length) startQuestion(room, io);
    else endMiniGame(room, io);
  }
}

module.exports = { start, onPlayerAction, onHostAction };
