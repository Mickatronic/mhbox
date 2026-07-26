const { shuffle } = require('../content');
const { endMiniGame } = require('../hub');

const HAND_SIZE = 6;

function draw(room, n) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(room.nextId());
  return arr;
}

function start(room, io) {
  const order = shuffle(room.connectedPlayerIds());
  const hands = new Map();
  order.forEach(id => hands.set(id, draw(room, HAND_SIZE)));
  room.gameState = { order, hands, storytellerIndex: 0, round: 1, totalRounds: order.length };
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

  gs.order.forEach(id => {
    io.to(id).emit('game:privateData', {
      type: 'dixit',
      role: id === storyteller ? 'storyteller' : 'guesser',
      hand: gs.hands.get(id)
    });
  });

  io.to(room.code).emit('game:activate', {
    type: 'dixit', phase: 'clue', round: gs.round, total: gs.totalRounds,
    storytellerId: storyteller, storytellerName: room.players.get(storyteller)?.name
  });
}

function onPlayerAction(room, io, socket, action, payload) {
  const gs = room.gameState;
  if (action === 'submitClue' && gs.phase === 'clue' && socket.id === gs.storyteller) {
    gs.clue = (payload.clue || '...').slice(0, 80);
    gs.submissions[socket.id] = payload.cardId;
    gs.hands.set(socket.id, gs.hands.get(socket.id).filter(c => c !== payload.cardId));
    gs.phase = 'choose';
    io.to(room.code).emit('game:activate', { type: 'dixit', phase: 'choose', clue: gs.clue, storytellerName: room.players.get(gs.storyteller)?.name, storytellerId: gs.storyteller });
  } else if (action === 'submitCard' && gs.phase === 'choose' && socket.id !== gs.storyteller) {
    if (gs.submissions[socket.id] !== undefined) return;
    gs.submissions[socket.id] = payload.cardId;
    gs.hands.set(socket.id, gs.hands.get(socket.id).filter(c => c !== payload.cardId));
    const received = Object.keys(gs.submissions).length;
    const expected = gs.order.length; // storyteller + others
    io.to(room.hostSocketId).emit('game:update', { type: 'dixit', kind: 'chooseProgress', received, expected });
    if (received >= expected) {
      gs.phase = 'vote';
      gs.voteOrder = shuffle(Object.entries(gs.submissions)); // [[ownerId, cardId], ...]
      io.to(room.code).emit('game:activate', {
        type: 'dixit', phase: 'vote', clue: gs.clue,
        cards: gs.voteOrder.map(([, cardId]) => cardId),
        storytellerId: gs.storyteller
      });
    }
  } else if (action === 'vote' && gs.phase === 'vote' && socket.id !== gs.storyteller) {
    if (gs.votes[socket.id] !== undefined) return;
    if (gs.submissions[socket.id] === payload.cardId) return; // pas de vote pour sa propre carte
    gs.votes[socket.id] = payload.cardId;
    const received = Object.keys(gs.votes).length;
    const expected = gs.order.length - 1;
    io.to(room.hostSocketId).emit('game:update', { type: 'dixit', kind: 'voteProgress', received, expected });
    if (received >= expected) resolveRound(room, io);
  }
}

function resolveRound(room, io) {
  const gs = room.gameState;
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
  const totalVoters = gs.order.length - 1;

  if (correctVoters.length === 0 || correctVoters.length === totalVoters) {
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
  io.to(room.code).emit('game:reveal', { type: 'dixit', clue: gs.clue, cards, scores: room.leaderboard() });
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
  }
}

module.exports = { start, onPlayerAction, onHostAction };
