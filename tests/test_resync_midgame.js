const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function hostLoginCookie(password) {
  const res = await fetch(URL + '/api/host/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const setCookie = res.headers.get('set-cookie');
  return setCookie.split(';')[0];
}
function connectWithCookie(cookie) { return io(URL, { transports: ['websocket'], extraHeaders: cookie ? { Cookie: cookie } : {} }); }

async function main() {
  const cookie = await hostLoginCookie('changeme123');
  const host = connectWithCookie(cookie);
  await new Promise(r => host.on('connect', r));
  const { code, hostToken } = await new Promise(r => host.emit('host:create', r));
  console.log('code', code);

  const names = ['Alice', 'Bob', 'Chloé', 'Dan'];
  const players = names.map(() => io(URL, { transports: ['websocket'] }));
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const creds = [];
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    creds.push(res);
  }

  let state = null;
  host.on('game:activate', d => { if (d.type === 'quiplash') state = d; });
  host.emit('host:startParty', { code, playlist: ['quiplash'], config: { quiplash: { packNames: ['Classique'] } } });
  await wait(250);

  // Tout le monde répond
  players.forEach(p => p.emit('player:action', { code, action: 'answer', payload: { text: 'x' } }));
  await wait(250);
  host.emit('host:action', { code, action: 'startVoting' });
  await wait(250);
  console.log('phase avant coupure:', state.phase, 'index', state.index);

  console.log('\n--- COUPURE BRUTALE DE L\'HÔTE PENDANT LA PHASE DE VOTE ---');
  host.disconnect();
  await wait(200);

  const host2 = connectWithCookie(cookie);
  let resyncedState = null;
  host2.on('game:activate', d => { if (d.type === 'quiplash') resyncedState = d; });
  await new Promise(r => host2.on('connect', r));
  const reconnectRes = await new Promise(r => host2.emit('host:reconnect', { code, hostToken }, r));
  await wait(300);
  console.log('host:reconnect ack:', reconnectRes);
  console.log('état resynchronisé automatiquement ->', resyncedState && resyncedState.phase, 'index', resyncedState && resyncedState.index);

  if (!resyncedState || resyncedState.phase !== 'voting') {
    throw new Error('La resynchronisation a échoué : la phase de vote n\'a pas été retransmise !');
  }

  console.log('\n--- un JOUEUR se coupe aussi pendant cette phase de vote, puis revote après reconnexion ---');
  const authors = state.authors;
  const voterIdx = creds.findIndex((c, i) => !authors.includes(c.playerId));
  players[voterIdx].disconnect();
  await wait(200);
  const reconnectedPlayer = io(URL, { transports: ['websocket'] });
  await new Promise(r => reconnectedPlayer.on('connect', r));
  const pReconnect = await new Promise(r => reconnectedPlayer.emit('player:reconnect', { code, playerId: creds[voterIdx].playerId, playerToken: creds[voterIdx].playerToken }, r));
  console.log('reconnexion joueur pendant le vote ->', pReconnect);
  reconnectedPlayer.emit('player:action', { code, action: 'vote', payload: { choice: authors[0] } });
  await wait(200);

  console.log('\nTEST DE RESYNC EN PLEINE PARTIE RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
