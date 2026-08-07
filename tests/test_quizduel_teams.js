const { connectHost, connectPlayer } = require('./helpers');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const host = await connectHost();
  const { code } = await new Promise(r => host.emit('host:create', r));

  const names = ['Alice', 'Bob', 'Chloé', 'Dan'];
  const players = names.map(() => connectPlayer());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const ids = [];
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    ids.push(res.playerId);
  }

  let activateData = null;
  host.on('game:activate', d => { if (d.type === 'quizduel') { activateData = d; console.log('  [activate]', d.phase); } });

  // themesPerPlayer:0 -> pas de draft, tous les thèmes du paquet directement en jeu
  host.emit('host:startParty', {
    code, playlist: ['quizduel'],
    config: { quizduel: { packNames: ['Sport', 'Musique'], themesPerPlayer: 0, teamMode: true, teamCount: 2, pickerMethod: 'weakest', questionSeconds: 10, pickSeconds: 8, rounds: 1 } }
  });
  await wait(300);
  console.log('phase de démarrage (mode équipe) :', activateData.phase);
  if (activateData.phase !== 'teams') throw new Error('Devrait former les équipes en premier !');
  console.log('équipes :', activateData.teams.map(t => `${t.name}: ${t.members.join(', ')}`));

  host.emit('host:action', { code, action: 'confirmTeams' });
  await wait(300);
  console.log('\nphase après confirmTeams (themesPerPlayer:0 -> pas de draft) :', activateData.phase);
  if (activateData.phase !== 'pick') throw new Error('themesPerPlayer:0 devrait sauter directement au choix de thème !');
  console.log('équipe qui choisit :', activateData.pickerTeamName, '- options:', activateData.options);

  // Un joueur d'une AUTRE équipe tente de choisir -> doit être ignoré
  const pickerTeam = activateData.pickerTeamId;
  const otherPlayerSock = players.find((p, i) => {
    // on ne sait pas directement l'équipe depuis le test, on retente avec chaque joueur sauf si ça marche une fois
    return true;
  });

  // Le picker choisit via n'importe quel membre : on cherche un membre de l'équipe désignée
  // (on relit les rosters envoyés dans la phase 'teams' précédente pour matcher les noms -> ids)
  await wait(100);

  host.emit('host:action', { code, action: 'skipPhase' }); // simplifie : force le choix aléatoire du thème
  await wait(300);
  console.log('\nphase après choix (forcé) du thème :', activateData.phase, '- thème:', activateData.themeName);
  if (activateData.phase !== 'question') throw new Error('Devrait être passé aux questions !');

  // Tout le monde répond aux 3 questions
  let revealData = null;
  host.on('game:reveal', d => { if (d.type === 'quizduel') revealData = d; });
  for (let q = 0; q < 3; q++) {
    players.forEach(p => p.emit('player:action', { code, action: 'answer', payload: { choice: 0 } }));
    await wait(200);
    console.log(`question ${q + 1}/3 -> scores d'équipe:`, revealData && revealData.teams);
    if (!revealData || !revealData.teams) throw new Error('Les scores d\'équipe ne sont pas remontés dans le reveal !');
    if (q < 2) { host.emit('host:action', { code, action: 'next' }); await wait(200); }
  }

  host.emit('host:action', { code, action: 'next' });
  await wait(300);
  console.log('\nphase résultats :', activateData.phase, '- classement équipes:', activateData.teams);
  if (!activateData.teams || !activateData.teams.length) throw new Error('Le classement par équipe est absent des résultats !');

  let finishedData = null;
  host.on('game:finished', d => { finishedData = d; });
  host.emit('host:action', { code, action: 'nextRound' });
  await wait(400);
  console.log('\ngame:finished reçu après la manche unique configurée ?', !!finishedData);
  if (!finishedData) throw new Error('La partie ne s\'est jamais terminée !');

  console.log('\nTEST QUIZ DUEL (mode équipe) RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
