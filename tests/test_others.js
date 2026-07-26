const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
function connect() { return io(URL, { transports: ['websocket'] }); }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function setupRoom(names) {
  const host = connect();
  await new Promise(r => host.on('connect', r));
  const code = await new Promise(r => host.emit('host:create', (res) => r(res.code)));
  const players = names.map(() => connect());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const ids = [];
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    ids.push(res.id);
  }
  return { host, players, ids, code };
}

async function testQuizduel() {
  console.log('\n=== QUIZ DUEL ===');
  const { host, players, ids, code } = await setupRoom(['Alice', 'Bob', 'Chloé']);
  let activated = null, revealed = null, finished = false;
  host.on('game:activate', d => { if (d.type === 'quizduel') activated = d; });
  host.on('game:reveal', d => { if (d.type === 'quizduel') revealed = d; });
  host.on('game:finished', () => finished = true);
  host.emit('host:startParty', { code, playlist: ['quizduel'], config: { quizduel: { rounds: 2, packNames: ['Culture générale'] } } });
  await wait(250);
  console.log('activated?', !!activated, activated && activated.question);
  players.forEach(p => p.emit('player:action', { code, action: 'answer', payload: { choice: 0 } }));
  await wait(200);
  host.emit('host:action', { code, action: 'reveal' });
  await wait(200);
  console.log('revealed?', !!revealed);
  host.emit('host:action', { code, action: 'next' });
  await wait(200);
  players.forEach(p => p.emit('player:action', { code, action: 'answer', payload: { choice: 1 } }));
  await wait(200);
  host.emit('host:action', { code, action: 'reveal' });
  await wait(200);
  host.emit('host:action', { code, action: 'next' }); // devrait finir (2 questions demandées)
  await wait(200);
  console.log('finished?', finished);
}

async function testHeadsup() {
  console.log('\n=== TÊTE EN L\'AIR ===');
  const { host, players, ids, code } = await setupRoom(['Alice', 'Bob', 'Chloé']);
  let activated = null;
  host.on('game:activate', d => { if (d.type === 'headsup') activated = d; });
  players[0].on('game:privateData', d => { if (d.type === 'headsup') console.log('mot reçu par le joueur en tour:', d.word); });
  host.emit('host:startParty', { code, playlist: ['headsup'], config: {} });
  await wait(200);
  console.log('phase collect?', activated && activated.phase);
  players.forEach(p => p.emit('player:action', { code, action: 'submitNames', payload: { names: ['Testeur Un', 'Testeur Deux'] } }));
  await wait(200);
  host.emit('host:action', { code, action: 'startTurns' });
  await wait(200);
  console.log('phase turn?', activated && activated.phase, activated && activated.currentPlayerName);
  host.emit('host:action', { code, action: 'markResult', payload: { result: 'correct' } });
  await wait(150);
  host.emit('host:action', { code, action: 'endTurn' });
  await wait(200);
  console.log('après endTurn, activated:', activated && activated.phase, activated && activated.currentPlayerName);
}

async function testDrawchain() {
  console.log('\n=== DESSINE & PASSE ===');
  const { host, players, ids, code } = await setupRoom(['Alice', 'Bob', 'Chloé']);
  let activated = null, revealed = null;
  const tasks = {};
  players.forEach((p, i) => p.on('game:privateData', d => { if (d.type === 'drawchain') tasks[ids[i]] = d; }));
  host.on('game:activate', d => { if (d.type === 'drawchain') activated = d; });
  host.on('game:reveal', d => { if (d.type === 'drawchain') revealed = d; });
  host.emit('host:startParty', { code, playlist: ['drawchain'], config: {} });
  await wait(250);
  console.log('pass 1 (draw)?', activated && activated.taskType, 'tasks reçues:', Object.keys(tasks).length);
  players.forEach(p => p.emit('player:action', { code, action: 'submit', payload: { content: 'data:image/png;base64,FAKE' } }));
  await wait(250);
  console.log('pass 2 (guess)?', activated && activated.taskType, activated && activated.pass);
  players.forEach(p => p.emit('player:action', { code, action: 'submit', payload: { content: 'ma supposition' } }));
  await wait(250);
  console.log('reveal reçu?', !!revealed, revealed && revealed.books.length);
}

async function testDixit() {
  console.log('\n=== CONTEUR ===');
  const { host, players, ids, code } = await setupRoom(['Alice', 'Bob', 'Chloé']);
  const hands = {};
  players.forEach((p, i) => p.on('game:privateData', d => { if (d.type === 'dixit') hands[ids[i]] = d; }));
  let activated = null, revealed = null;
  host.on('game:activate', d => { if (d.type === 'dixit') activated = d; });
  host.on('game:reveal', d => { if (d.type === 'dixit') revealed = d; });
  host.emit('host:startParty', { code, playlist: ['dixit'], config: {} });
  await wait(250);
  console.log('storyteller:', activated && activated.storytellerName, 'mains reçues:', Object.keys(hands).length);
  const storytellerId = activated.storytellerId;
  const storytellerIdx = ids.indexOf(storytellerId);
  const storytellerHand = hands[storytellerId].hand;
  players[storytellerIdx].emit('player:action', { code, action: 'submitClue', payload: { clue: 'un indice test', cardId: storytellerHand[0] } });
  await wait(200);
  console.log('phase choose?', activated && activated.phase);
  players.forEach((p, i) => {
    if (i === storytellerIdx) return;
    p.emit('player:action', { code, action: 'submitCard', payload: { cardId: hands[ids[i]].hand[0] } });
  });
  await wait(200);
  console.log('phase vote?', activated && activated.phase, 'cartes:', activated && activated.cards);
  players.forEach((p, i) => {
    if (i === storytellerIdx) return;
    const myCard = hands[ids[i]].hand[0];
    const otherCard = activated.cards.find(c => c !== myCard);
    p.emit('player:action', { code, action: 'vote', payload: { cardId: otherCard } });
  });
  await wait(250);
  console.log('reveal reçu?', !!revealed, revealed && revealed.cards.length, 'scores:', revealed && revealed.scores);
}

async function main() {
  await testQuizduel();
  await testHeadsup();
  await testDrawchain();
  await testDixit();
  console.log('\nTOUS LES SMOKE TESTS TERMINÉS SANS CRASH');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
