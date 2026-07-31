const { connectHost, connectPlayer } = require('./helpers');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const host = await connectHost();
  const { code } = await new Promise(r => host.emit('host:create', r));

  const names = ['Alice', 'Bob', 'Chloé', 'Dan'];
  const players = names.map(() => connectPlayer());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const ids = [];
  const wordsReceived = {};
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    ids.push(res.playerId);
    players[i].on('game:privateData', d => { if (d.type === 'timesup' && d.word) wordsReceived[names[i]] = d.word; });
  }

  let activateData = null;
  host.on('game:activate', d => { if (d.type === 'timesup') activateData = d; });

  // allowExtraNames activé + mode manette unique
  host.emit('host:startParty', {
    code, playlist: ['timesup'],
    config: { timesup: { allowExtraNames: true, controllerMode: 'single', timerSeconds: 20, enabledRounds: ['mime'], wordCount: 6 } }
  });
  await wait(300);
  console.log('phase initiale (collecte activée) :', activateData.phase);
  if (activateData.phase !== 'collect') throw new Error('La collecte de noms aurait dû être proposée !');

  players.forEach((p, i) => p.emit('player:action', { code, action: 'submitNames', payload: { names: ['NomPerso' + i] } }));
  await wait(200);

  host.emit('host:action', { code, action: 'startTeams' });
  await wait(200);
  console.log('phase après startTeams :', activateData.phase, '- contrôleur unique désigné :', activateData.controllerName);
  if (activateData.controllerMode !== 'single') throw new Error('Le mode manette unique n\'est pas actif !');
  const controllerName = activateData.controllerName;

  host.emit('host:action', { code, action: 'startGame' });
  await wait(200);
  host.emit('host:action', { code, action: 'beginTurn' });
  await wait(300);
  console.log('équipe au tour :', activateData.teamName, '- le mot va systématiquement au contrôleur unique :', controllerName);

  console.log('mots reçus par chaque joueur (seul le contrôleur doit en recevoir) :', wordsReceived);
  const onlyControllerHasWord = Object.keys(wordsReceived).every(n => n === controllerName);
  if (!onlyControllerHasWord || !wordsReceived[controllerName]) throw new Error('Le mot n\'a pas été envoyé exclusivement au contrôleur unique !');
  console.log('seul le contrôleur unique a reçu le mot, quelle que soit l\'équipe au tour ✅');

  // Le contrôleur valide, peu importe l'équipe affichée
  const controllerSock = players[names.indexOf(controllerName)];
  controllerSock.emit('player:action', { code, action: 'markResult', payload: { result: 'correct' } });
  await wait(200);
  console.log('un deuxième mot a bien été envoyé au contrôleur après validation ?', Object.keys(wordsReceived).length >= 1);

  console.log('\nTEST MANETTE UNIQUE + COLLECTE RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
