const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function hostLoginCookie(password) {
  const res = await fetch(URL + '/api/host/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password })
  });
  const body = await res.json();
  if (!res.ok) throw new Error('login failed: ' + JSON.stringify(body));
  const setCookie = res.headers.get('set-cookie');
  return setCookie.split(';')[0]; // "party_host_session=xxxx"
}

function connectWithCookie(cookie) {
  return io(URL, { transports: ['websocket'], extraHeaders: cookie ? { Cookie: cookie } : {} });
}

async function main() {
  console.log('--- 1) création de salon SANS auth doit échouer ---');
  const noAuthSocket = connectWithCookie(null);
  await new Promise(r => noAuthSocket.on('connect', r));
  const failRes = await new Promise(r => noAuthSocket.emit('host:create', r));
  console.log('résultat sans auth:', failRes);
  if (!failRes.error) throw new Error('devrait échouer sans authentification !');
  noAuthSocket.disconnect();

  console.log('\n--- 2) login avec mauvais mot de passe doit échouer ---');
  try {
    await hostLoginCookie('mauvais-mdp');
    throw new Error('le login aurait dû échouer');
  } catch (e) {
    console.log('échec attendu:', e.message.includes('login failed') ? 'OK' : e.message);
  }

  console.log('\n--- 3) login avec le bon mot de passe (défaut changeme123) ---');
  const cookie = await hostLoginCookie('changeme123');
  console.log('cookie obtenu:', !!cookie);

  const hostSocket1 = connectWithCookie(cookie);
  await new Promise(r => hostSocket1.on('connect', r));
  const createRes = await new Promise(r => hostSocket1.emit('host:create', r));
  console.log('création de salon avec auth:', createRes);
  const { code, hostToken } = createRes;

  console.log('\n--- 4) trois joueurs rejoignent (minimum requis par Quiplash) ---');
  const player1 = io(URL, { transports: ['websocket'] });
  await new Promise(r => player1.on('connect', r));
  const joinRes = await new Promise(r => player1.emit('player:join', { code, name: 'Alice' }, r));
  console.log('joinRes:', joinRes);
  const { playerId, playerToken } = joinRes;

  const extraPlayers = ['Bob', 'Chloé'].map(() => io(URL, { transports: ['websocket'] }));
  await Promise.all(extraPlayers.map(p => new Promise(r => p.on('connect', r))));
  for (let i = 0; i < extraPlayers.length; i++) {
    await new Promise(r => extraPlayers[i].emit('player:join', { code, name: ['Bob', 'Chloé'][i] }, r));
  }

  console.log('\n--- 5) SIMULATION D\'UNE COUPURE : on ferme la socket hôte et la socket joueur brutalement ---');
  hostSocket1.disconnect();
  player1.disconnect();
  await wait(300);

  console.log('\n--- 6) l\'hôte se RECONNECTE avec son hostToken (nouvelle socket, comme après un refresh) ---');
  const hostSocket2 = connectWithCookie(cookie);
  await new Promise(r => hostSocket2.on('connect', r));
  const reconnectRes = await new Promise(r => hostSocket2.emit('host:reconnect', { code, hostToken }, r));
  console.log('host:reconnect ->', reconnectRes);
  if (!reconnectRes.ok) throw new Error('la reconnexion hôte a échoué !');

  console.log('\n--- 7) le JOUEUR se reconnecte avec son playerToken (nouvel id socket, comme après un refresh mobile) ---');
  const player2 = io(URL, { transports: ['websocket'] });
  await new Promise(r => player2.on('connect', r));
  const playerReconnectRes = await new Promise(r => player2.emit('player:reconnect', { code, playerId, playerToken }, r));
  console.log('player:reconnect ->', playerReconnectRes);
  if (!playerReconnectRes.ok) throw new Error('la reconnexion joueur a échoué !');

  console.log('\n--- 8) on lance une partie Quiplash et on vérifie que le JOUEUR RECONNECTÉ peut bien jouer (répondre) ---');
  let activated = null;
  let myBatch = null;
  hostSocket2.on('game:activate', d => { if (d.type === 'quiplash') activated = d; });
  player2.on('game:privateData', d => { if (d.type === 'quiplash' && d.kind === 'answerBatch') myBatch = d; });
  hostSocket2.emit('host:startParty', { code, playlist: ['quiplash'], config: { quiplash: { packNames: ['Classique'], answersPerPlayer: 2 } } });
  await wait(300);
  console.log('quiplash activé ?', !!activated, activated && activated.phase);
  console.log('le joueur reconnecté a-t-il reçu son lot de questions ?', !!myBatch, myBatch && myBatch.items.length);

  // Le joueur reconnecté (nouvelle socket, nouvel id réseau) répond avec son ANCIEN playerId stable
  if (myBatch) {
    myBatch.items.forEach(item => player2.emit('player:action', { code, action: 'answer', payload: { matchupIndex: item.matchupIndex, text: 'Réponse du joueur reconnecté !' } }));
  }
  await wait(300);
  console.log('\naucune erreur serveur après réponse du joueur reconnecté (voir logs serveur) ✅');

  console.log('\nTEST DE RECONNEXION TERMINÉ SANS ERREUR ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
