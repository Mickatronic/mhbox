const { connectHost, connectPlayer } = require('./helpers');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const host = await connectHost();
  const { code, hostToken } = await new Promise(r => host.emit('host:create', r));
  console.log('code', code);

  const names = ['Alice', 'Bob', 'Chloé', 'Dan'];
  const players = names.map(() => connectPlayer());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const creds = [];
  const answerBatches = {};
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    creds.push(res);
    players[i].on('game:privateData', d => { if (d.type === 'quiplash' && d.kind === 'answerBatch') answerBatches[res.playerId] = d; });
  }

  let state = null;
  host.on('game:activate', d => { if (d.type === 'quiplash') state = d; });
  host.emit('host:startParty', {
    code, playlist: ['quiplash'],
    config: { quiplash: { packNames: ['Classique'], answersPerPlayer: 1, answerSecondsPerQuestion: 30, voteSecondsPerQuestion: 30 } }
  });
  await wait(300);

  // Tout le monde répond à son unique question assignée (answersPerPlayer:1 -> vote direct après)
  for (const [playerId, batch] of Object.entries(answerBatches)) {
    const sock = players[creds.findIndex(c => c.playerId === playerId)];
    batch.items.forEach(item => sock.emit('player:action', { code, action: 'answer', payload: { matchupIndex: item.matchupIndex, text: 'x' } }));
  }
  await wait(300);
  console.log('phase avant coupure:', state.phase, 'index', state.index);
  if (state.phase !== 'voting') throw new Error('Devrait être en phase de vote !');

  console.log('\n--- COUPURE BRUTALE DE L\'HÔTE PENDANT LA PHASE DE VOTE ---');
  host.disconnect();
  await wait(200);

  const host2 = await connectHost();
  let resyncedState = null;
  host2.on('game:activate', d => { if (d.type === 'quiplash') resyncedState = d; });
  const reconnectRes = await new Promise(r => host2.emit('host:reconnect', { code, hostToken }, r));
  await wait(300);
  console.log('host:reconnect ack:', reconnectRes);
  console.log('état resynchronisé automatiquement ->', resyncedState && resyncedState.phase, 'index', resyncedState && resyncedState.index);

  if (!resyncedState || resyncedState.phase !== 'voting') {
    throw new Error('La resynchronisation a échoué : la phase de vote n\'a pas été retransmise !');
  }

  console.log('\n--- un JOUEUR se coupe aussi pendant cette phase de vote, puis revote après reconnexion ---');
  const authors = state.authors;
  const voterIdx = creds.findIndex(c => !authors.includes(c.playerId));
  players[voterIdx].disconnect();
  await wait(200);
  const reconnectedPlayer = connectPlayer();
  await new Promise(r => reconnectedPlayer.on('connect', r));
  const pReconnect = await new Promise(r => reconnectedPlayer.emit('player:reconnect', { code, playerId: creds[voterIdx].playerId, playerToken: creds[voterIdx].playerToken }, r));
  console.log('reconnexion joueur pendant le vote ->', pReconnect);
  reconnectedPlayer.emit('player:action', { code, action: 'vote', payload: { matchupIndex: resyncedState.index, choice: authors[0] } });
  await wait(200);

  console.log('\nTEST DE RESYNC EN PLEINE PARTIE RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
