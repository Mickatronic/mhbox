const { connectHost, connectPlayer } = require('./helpers');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const host = await connectHost();
  const { code } = await new Promise(r => host.emit('host:create', r));
  console.log('code', code);

  const names = ['Alice', 'Bob', 'Chloé', 'Dan'];
  const players = names.map(() => connectPlayer());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const ids = [];
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    ids.push(res.playerId);
  }

  let activateData = null;
  let myWord = null;
  let lastUpdate = null;
  host.on('game:activate', d => { if (d.type === 'timesup') { activateData = d; console.log('  [activate]', JSON.stringify(d)); } });
  host.on('game:update', d => { if (d.type === 'timesup') { lastUpdate = d; console.log('  [update]', JSON.stringify(d)); } });
  players.forEach(p => p.on('game:privateData', d => { if (d.type === 'timesup') myWord = { socket: p, data: d }; }));

  // --- Test 1 : allowExtraNames désactivé -> pas de phase collect, équipes directement ---
  host.emit('host:startParty', {
    code, playlist: ['timesup'],
    config: { timesup: { allowExtraNames: false, timerSeconds: 15, controllerMode: 'perPlayer', enabledRounds: ['describe', 'oneword'], wordCount: 8 } }
  });
  await wait(300);
  console.log('phase de démarrage (allowExtraNames:false) :', activateData.phase, '- attendu: teams');
  if (activateData.phase !== 'teams') throw new Error('Devrait sauter direct aux équipes !');
  console.log('équipes formées :', activateData.teams.map(t => `${t.name}: ${t.members.join(', ')}`));

  host.emit('host:action', { code, action: 'startGame' });
  await wait(200);
  console.log('phase après startGame :', activateData.phase, '- manche:', activateData.roundLabel);
  if (activateData.phase !== 'roundIntro') throw new Error('Devrait être roundIntro !');

  host.emit('host:action', { code, action: 'beginTurn' });
  await wait(200);
  console.log('phase après beginTurn :', activateData.phase, '- équipe:', activateData.teamName, '- décrivant:', activateData.describerName);
  if (activateData.phase !== 'turn') throw new Error('Devrait être en tour !');

  // Le décrivant tape "correct" plusieurs fois
  const describerSock = players[names.indexOf(activateData.describerName)];
  console.log('le décrivant a-t-il reçu un mot en privé ?', !!myWord);
  for (let i = 0; i < 3; i++) {
    describerSock.emit('player:action', { code, action: 'markResult', payload: { result: 'correct' } });
    await wait(80);
  }
  console.log('score équipe après 3 bonnes réponses (via game:update) :', lastUpdate && lastUpdate.teamScore, '(attendu: 30)');
  if (!lastUpdate || lastUpdate.teamScore !== 30) throw new Error('Le score ne correspond pas aux 3 bonnes réponses !');

  // Un joueur d'une AUTRE équipe tente de valider -> doit être ignoré
  const otherPlayer = players.find((p, i) => names[i] !== activateData.describerName);
  otherPlayer.emit('player:action', { code, action: 'markResult', payload: { result: 'correct' } });
  await wait(150);
  if (lastUpdate.teamScore !== 30) throw new Error('Un joueur hors-tour a réussi à valider une réponse !');
  console.log('un joueur hors-tour ne peut pas valider ✅');

  console.log('\n--- on laisse le minuteur expirer (15s, plancher de sécurité) pour vérifier le passage automatique ---');
  const teamBefore = activateData.teamName;
  await wait(16000);
  console.log('équipe après expiration du minuteur :', activateData.teamName, '(devrait être différente de', teamBefore, ')');
  if (activateData.teamName === teamBefore) throw new Error('Le minuteur n\'a pas fait passer à l\'équipe suivante !');

  console.log('\n--- on force le passage jusqu\'à la fin de la partie via skipPhase répétés ---');
  let finishedData = null;
  host.on('game:finished', d => { finishedData = d; });
  for (let i = 0; i < 20 && !finishedData; i++) {
    if (activateData.phase === 'turn') host.emit('host:action', { code, action: 'skipPhase' });
    else if (activateData.phase === 'roundIntro') host.emit('host:action', { code, action: 'beginTurn' });
    await wait(200);
  }
  console.log('game:finished reçu ?', !!finishedData);
  console.log('récap équipes :', finishedData && finishedData.recap && finishedData.recap.teams);
  if (!finishedData) throw new Error('La partie ne s\'est jamais terminée !');

  console.log('\nTEST TIME\'S UP RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
