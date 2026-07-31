const { shuffle } = require('../content');
const { endMiniGame } = require('../hub');
const { clearTimer, scheduleTimer } = require('../timerUtil');

const HAND_SIZE = 6;

function draw(room, n) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(room.nextId());
  return arr;
}

function start(room, io, config = {}) {
  const order = shuffle(room.connectedPlayerIds());
  const hands = new Map();
  order.forEach(id => hands.set(id, draw(room, HAND_SIZE)));
  room.gameState = {
    order, hands, storytellerIndex: 0, round: 1, totalRounds: order.length, timer: null,
    clueSeconds: Math.max(15, config.clueSeconds || 60),
    chooseSeconds: Math.max(10, config.chooseSeconds || 30),
    voteSeconds: Math.max(10, config.voteSeconds || 30)
  };
  startRound(room, io);
}

function startRound(room, io) {
  const gs = room.gameState;
  const storyteller = gs.order[gs.storytellerIndex];
  gs.storyteller = storyteller;
  gs.clue = null;
  gs.submissions = {};
  gs.votes = {};
  gs.phase = 'clue';
  gs.deadline = Date.now() + gs.clueSeconds * 1000;

  gs.order.forEach(id => {
    room.sendPrivate(io, id, {
      type: 'dixit',
      role: id === storyteller ? 'storyteller' : 'guesser',
      hand: gs.hands.get(id)
    });
  });

  room.activate(io, {
    type: 'dixit', phase: 'clue', round: gs.round, total: gs.totalRounds,
    storytellerId: storyteller, storytellerName: room.players.get(storyteller)?.name,
    deadline: gs.deadline
  });
  scheduleTimer(gs, gs.clueSeconds * 1000, () => autoSubmitClue(room, io));
}

function autoSubmitClue(room, io) {
  const gs = room.gameState;
  if (gs.phase !== 'clue' || gs.submissions[gs.storyteller] !== undefined) return;
  const hand = gs.hands.get(gs.storyteller);
  submitClue(room, io, gs.storyteller, { clue: '(temps écoulé)', cardId: hand[0] });
}

function submitClue(room, io, playerId, payload) {
  const gs = room.gameState;
  gs.clue = (payload.clue || '...').slice(0, 80);
  gs.submissions[playerId] = payload.cardId;
  gs.hands.set(playerId, gs.hands.get(playerId).filter(c => c !== payload.cardId));
  gs.phase = 'choose';
  gs.deadline = Date.now() + gs.chooseSeconds * 1000;
  room.activate(io, { type: 'dixit', phase: 'choose', clue: gs.clue, storytellerName: room.players.get(gs.storyteller)?.name, storytellerId: gs.storyteller, deadline: gs.deadline });
  scheduleTimer(gs, gs.chooseSeconds * 1000, () => autoSubmitChoices(room, io));
}

function autoSubmitChoices(room, io) {
  const gs = room.gameState;
  if (gs.phase !== 'choose') return;
  gs.order.forEach(id => {
    if (id === gs.storyteller || gs.submissions[id] !== undefined) return;
    const hand = gs.hands.get(id);
    if (hand.length) submitCard(room, io, id, hand[0], false);
  });
  moveToVoteIfReady(room, io, true);
}

function submitCard(room, io, playerId, cardId, checkReady = true) {
  const gs = room.gameState;
  gs.submissions[playerId] = cardId;
  gs.hands.set(playerId, gs.hands.get(playerId).filter(c => c !== cardId));
  if (checkReady) {
    const received = Object.keys(gs.submissions).length;
    io.to(room.hostRoom()).emit('game:update', { type: 'dixit', kind: 'chooseProgress', received, expected: gs.order.length });
    moveToVoteIfReady(room, io, false);
  }
}

function moveToVoteIfReady(room, io, force) {
  const gs = room.gameState;
  if (gs.phase !== 'choose') return;
  const received = Object.keys(gs.submissions).length;
  if (received >= gs.order.length || force) {
    clearTimer(gs);
    gs.phase = 'vote';
    gs.voteOrder = shuffle(Object.entries(gs.submissions));
    gs.deadline = Date.now() + gs.voteSeconds * 1000;
    room.activate(io, {
      type: 'dixit', phase: 'vote', clue: gs.clue,
      cards: gs.voteOrder.map(([, cardId]) => cardId),
      storytellerId: gs.storyteller, deadline: gs.deadline
    });
    scheduleTimer(gs, gs.voteSeconds * 1000, () => resolveRound(room, io));
  }
}

function onPlayerAction(room, io, playerId, action, payload) {
  const gs = room.gameState;
  if (action === 'submitClue' && gs.phase === 'clue' && playerId === gs.storyteller) {
    submitClue(room, io, playerId, payload);
  } else if (action === 'submitCard' && gs.phase === 'choose' && playerId !== gs.storyteller) {
    if (gs.submissions[playerId] !== undefined) return;
    submitCard(room, io, playerId, payload.cardId);
  } else if (action === 'vote' && gs.phase === 'vote' && playerId !== gs.storyteller) {
    if (gs.votes[playerId] !== undefined) return;
    if (gs.submissions[playerId] === payload.cardId) return; // pas de vote pour sa propre carte
    gs.votes[playerId] = payload.cardId;
    const received = Object.keys(gs.votes).length;
    const expected = gs.order.length - 1;
    io.to(room.hostRoom()).emit('game:update', { type: 'dixit', kind: 'voteProgress', received, expected });
    if (received >= expected) resolveRound(room, io);
  }
}

function resolveRound(room, io) {
  const gs = room.gameState;
  if (gs.phase !== 'vote') return;
  clearTimer(gs);
  const storytellerCard = gs.submissions[gs.storyteller];
  const voteCounts = {};
  gs.voteOrder.forEach(([ownerId]) => voteCounts[ownerId] = 0);
  const voterNamesByOwner = {};
  gs.voteOrder.forEach(([ownerId]) => voterNamesByOwner[ownerId] = []);

  Object.entries(gs.votes).forEach(([voterId, cardId]) => {
    const [ownerId] = gs.voteOrder.find(([, cid]) => cid === cardId) || [];
    if (ownerId !== undefined) {
      voteCounts[ownerId]++;
      voterNamesByOwner[ownerId].push(room.players.get(voterId)?.name);
    }
  });

  const correctVoters = Object.entries(gs.votes).filter(([, cardId]) => cardId === storytellerCard).map(([v]) => v);
  const totalVoters = Object.keys(gs.votes).length; // basé sur les votes réellement reçus (un minuteur a pu couper court)

  if (totalVoters === 0 || correctVoters.length === 0 || correctVoters.length === totalVoters) {
    gs.order.filter(id => id !== gs.storyteller).forEach(id => room.addScore(id, 2));
  } else {
    room.addScore(gs.storyteller, 3);
    correctVoters.forEach(id => room.addScore(id, 3));
    gs.voteOrder.forEach(([ownerId]) => {
      if (ownerId !== gs.storyteller) room.addScore(ownerId, voteCounts[ownerId]);
    });
  }

  // Renouvelle les mains
  gs.order.forEach(id => gs.hands.get(id).push(...draw(room, HAND_SIZE - gs.hands.get(id).length)));

  const cards = gs.voteOrder.map(([ownerId, cardId]) => ({
    cardId, ownerId, ownerName: room.players.get(ownerId)?.name,
    isStorytellerCard: cardId === storytellerCard,
    voters: voterNamesByOwner[ownerId]
  }));

  gs.phase = 'reveal';
  room.reveal(io, { type: 'dixit', clue: gs.clue, cards, scores: room.leaderboard() });
}

function onHostAction(room, io, socket, action) {
  const gs = room.gameState;
  if (action === 'next') {
    gs.storytellerIndex++;
    if (gs.storytellerIndex < gs.order.length) {
      gs.round++;
      startRound(room, io);
    } else {
      endMiniGame(room, io);
    }
  } else if (action === 'skipPhase') {
    if (gs.phase === 'clue') autoSubmitClue(room, io);
    else if (gs.phase === 'choose') autoSubmitChoices(room, io);
    else if (gs.phase === 'vote') resolveRound(room, io);
  }
}

module.exports = { start, onPlayerAction, onHostAction };
