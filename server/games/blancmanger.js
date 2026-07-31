const { loadPacks, shuffle } = require('../content');
const { endMiniGame } = require('../hub');
const { clearTimer, scheduleTimer } = require('../timerUtil');

const HAND_SIZE = 7;

function packCards(packNames) {
  const packs = loadPacks('blancmanger');
  const filtered = packNames && packNames.length ? packs.filter(p => packNames.includes(p.name)) : packs;
  const source = filtered.length ? filtered : packs;
  let blackCards = [], whiteCards = [];
  source.forEach(p => { blackCards.push(...(p.data.blackCards || [])); whiteCards.push(...(p.data.whiteCards || [])); });
  return { blackCards, whiteCards };
}

function refillDeck(gs, kind) {
  const source = kind === 'black' ? gs.blackPool : gs.whitePool;
  gs[kind === 'black' ? 'blackDeck' : 'whiteDeck'] = shuffle(source.length ? source : ['(paquet vide)']);
}

function drawBlack(gs) {
  if (!gs.blackDeck.length) refillDeck(gs, 'black');
  return gs.blackDeck.pop();
}

function drawWhite(gs, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!gs.whiteDeck.length) refillDeck(gs, 'white');
    out.push(gs.whiteDeck.pop());
  }
  return out;
}

function start(room, io, config = {}) {
  const { blackCards, whiteCards } = packCards(config.packNames);
  const order = shuffle(room.connectedPlayerIds());
  const gs = {
    order, judgeIndex: 0, round: 1, totalRounds: config.rounds || order.length,
    submitSeconds: Math.max(15, config.submitSeconds || 45),
    judgeSeconds: Math.max(10, config.judgeSeconds || 30),
    blackPool: blackCards, whitePool: whiteCards,
    blackDeck: shuffle(blackCards), whiteDeck: shuffle(whiteCards),
    hands: new Map(), submissions: {}, phase: 'submit', timer: null
  };
  order.forEach(id => gs.hands.set(id, drawWhite(gs, HAND_SIZE)));
  room.gameState = gs;
  startRound(room, io);
}

function startRound(room, io) {
  const gs = room.gameState;
  gs.judge = gs.order[gs.judgeIndex % gs.order.length];
  gs.submissions = {};
  gs.phase = 'submit';
  gs.blackCard = drawBlack(gs);
  gs.deadline = Date.now() + gs.submitSeconds * 1000;

  gs.order.forEach(id => {
    room.sendPrivate(io, id, { type: 'blancmanger', role: id === gs.judge ? 'judge' : 'player', hand: gs.hands.get(id) });
  });
  room.activate(io, {
    type: 'blancmanger', phase: 'submit', round: gs.round, total: gs.totalRounds,
    judgeId: gs.judge, judgeName: room.players.get(gs.judge)?.name, blackCard: gs.blackCard, deadline: gs.deadline
  });
  scheduleTimer(gs, gs.submitSeconds * 1000, () => autoSubmitRemaining(room, io));
}

function autoSubmitRemaining(room, io) {
  const gs = room.gameState;
  if (gs.phase !== 'submit') return;
  gs.order.forEach(id => {
    if (id === gs.judge || gs.submissions[id] !== undefined) return;
    const hand = gs.hands.get(id);
    if (hand.length) submitCard(room, io, id, hand[0], false);
  });
  moveToJudge(room, io, true);
}

function submitCard(room, io, playerId, cardText, checkReady = true) {
  const gs = room.gameState;
  gs.submissions[playerId] = cardText;
  gs.hands.set(playerId, gs.hands.get(playerId).filter(c => c !== cardText));
  if (checkReady) {
    const received = Object.keys(gs.submissions).length;
    const expected = gs.order.length - 1;
    io.to(room.hostRoom()).emit('game:update', { type: 'blancmanger', kind: 'submitProgress', received, expected });
    moveToJudge(room, io, false);
  }
}

function moveToJudge(room, io, force) {
  const gs = room.gameState;
  if (gs.phase !== 'submit') return;
  const received = Object.keys(gs.submissions).length;
  const expected = gs.order.length - 1;
  if (received >= expected || force) {
    clearTimer(gs);
    gs.phase = 'judge';
    gs.voteOrder = shuffle(Object.entries(gs.submissions)); // [[ownerId, cardText], ...]
    gs.deadline = Date.now() + gs.judgeSeconds * 1000;
    room.activate(io, {
      type: 'blancmanger', phase: 'judge', blackCard: gs.blackCard,
      cards: gs.voteOrder.map(([, text]) => text),
      judgeId: gs.judge, judgeName: room.players.get(gs.judge)?.name, deadline: gs.deadline
    });
    scheduleTimer(gs, gs.judgeSeconds * 1000, () => autoJudge(room, io));
  }
}

function autoJudge(room, io) {
  const gs = room.gameState;
  if (gs.phase !== 'judge' || !gs.voteOrder.length) return;
  const [, cardText] = gs.voteOrder[Math.floor(Math.random() * gs.voteOrder.length)];
  resolveRound(room, io, cardText);
}

function onPlayerAction(room, io, playerId, action, payload) {
  const gs = room.gameState;
  if (action === 'submitCard' && gs.phase === 'submit' && playerId !== gs.judge) {
    if (gs.submissions[playerId] !== undefined) return;
    submitCard(room, io, playerId, payload.cardText);
  } else if (action === 'judgePick' && gs.phase === 'judge' && playerId === gs.judge) {
    resolveRound(room, io, payload.cardText);
  }
}

function resolveRound(room, io, winningText) {
  const gs = room.gameState;
  if (gs.phase !== 'judge') return;
  clearTimer(gs);
  const entry = gs.voteOrder.find(([, text]) => text === winningText);
  const winnerId = entry ? entry[0] : null;
  if (winnerId) room.addScore(winnerId, 100);

  // Renouvelle les mains de tout le monde (sauf le juge, qui n'a pas joué de carte)
  gs.order.forEach(id => {
    if (id === gs.judge) return;
    const hand = gs.hands.get(id);
    if (hand.length < HAND_SIZE) hand.push(...drawWhite(gs, HAND_SIZE - hand.length));
  });

  gs.phase = 'reveal';
  room.reveal(io, {
    type: 'blancmanger', blackCard: gs.blackCard,
    winnerName: winnerId ? room.players.get(winnerId)?.name : null,
    winningCard: winningText,
    cards: gs.voteOrder.map(([ownerId, text]) => ({ ownerName: room.players.get(ownerId)?.name, text, isWinner: ownerId === winnerId })),
    scores: room.leaderboard()
  });
}

function onHostAction(room, io, socket, action) {
  const gs = room.gameState;
  if (action === 'next') {
    gs.judgeIndex++;
    if (gs.round < gs.totalRounds) {
      gs.round++;
      startRound(room, io);
    } else {
      endMiniGame(room, io);
    }
  } else if (action === 'skipPhase') {
    if (gs.phase === 'submit') autoSubmitRemaining(room, io);
    else if (gs.phase === 'judge') autoJudge(room, io);
  }
}

module.exports = { start, onPlayerAction, onHostAction };
