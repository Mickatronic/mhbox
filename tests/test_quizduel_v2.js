const { connectHost, connectPlayer } = require('./helpers');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const host = await connectHost();
  const { code } = await new Promise(r => host.emit('host:create', r));
  console.log('code', code);

  const names = ['Alice', 'Bob', 'Chloé'];
  const players = names.map(() => connectPlayer());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const ids = [];
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    ids.push(res.playerId);
  }

  let activateData = null;
  host.on('game:activate', d => { if (d.type === 'quizduel') { activateData = d; console.log('  [activate]', d.phase, JSON.stringify(d).slice(0, 150)); } });

  host.emit('host:startParty', {
    code, playlist: ['quizduel'],
    config: { quizduel: { packNames: ['7e art (cinema et films)', 'Sport', 'Musique', 'Histoire de l\'art'], themesPerPlayer: 2, pickerMethod: 'roundrobin', questionSeconds: 10, pickSeconds: 8, draftSeconds: 8, rounds: 2 } }
  });
  await wait(300);
  console.log('phase de démarrage :', activateData.phase, '- thèmes disponibles :', activateData.allThemes);
  if (activateData.phase !== 'draft') throw new Error('Devrait être en phase de draft !');

  // --- Tour 1 : chaque joueur choisit 2 thèmes ---
  players.forEach((p, i) => p.emit('player:action', { code, action: 'pickThemes', payload: { themes: activateData.allThemes.slice(i, i + 2) } }));
  await wait(300);
  console.log('\nphase après draft :', activateData.phase, '- proposition :', activateData.options, '- picker:', activateData.pickerName);
  if (activateData.phase !== 'pick') throw new Error('Devrait être en phase de choix de thème !');
  if (activateData.options.length < 1) throw new Error('Aucun thème proposé !');

  // Un joueur qui n'est pas le picker tente de choisir -> doit être ignoré
  const nonPicker = players[ids.indexOf(activateData.pickerId) === 0 ? 1 : 0];
  nonPicker.emit('player:action', { code, action: 'chooseTheme', payload: { theme: activateData.options[0] } });
  await wait(150);
  if (activateData.phase !== 'pick') throw new Error('Un non-picker a réussi à choisir le thème !');
  console.log('un non-picker ne peut pas choisir le thème ✅');

  // Le vrai picker choisit
  const pickerSock = players[ids.indexOf(activateData.pickerId)];
  pickerSock.emit('player:action', { code, action: 'chooseTheme', payload: { theme: activateData.options[0] } });
  await wait(300);
  console.log('\nphase après choix du thème :', activateData.phase, '- thème:', activateData.themeName, '- question 1/', activateData.totalQuestions);
  if (activateData.phase !== 'question') throw new Error('Devrait être en phase de question !');

  // --- Tour 3 : 3 questions, tout le monde répond ---
  let revealCount = 0;
  host.on('game:reveal', d => { if (d.type === 'quizduel') revealCount++; });
  for (let q = 0; q < 3; q++) {
    players.forEach(p => p.emit('player:action', { code, action: 'answer', payload: { choice: 0 } }));
    await wait(200);
    if (q < 2) {
      host.emit('host:action', { code, action: 'next' });
      await wait(200);
    }
  }
  console.log('\nnombre de questions révélées :', revealCount, '(attendu: 3)');
  if (revealCount !== 3) throw new Error('Le nombre de questions révélées est incorrect !');

  // --- Tour 4 : résultats de la manche ---
  host.emit('host:action', { code, action: 'next' });
  await wait(300);
  console.log('phase après la 3e question :', activateData.phase, '- classement:', activateData.gains && activateData.gains.map(g => `${g.name}:${g.total}`));
  if (activateData.phase !== 'results') throw new Error('Devrait afficher les résultats de la manche !');

  // --- Tour 5 : manche suivante (round 2 configuré) ---
  host.emit('host:action', { code, action: 'nextRound' });
  await wait(300);
  console.log('\nphase de la manche 2 :', activateData.phase, '- round', activateData.round, '/', activateData.totalRounds);
  if (activateData.round !== 2) throw new Error('Le compteur de manches ne progresse pas correctement !');

  let finishedData = null;
  host.on('game:finished', d => { finishedData = d; });

  // On finit vite la manche 2 (skip)
  host.emit('host:action', { code, action: 'skipPhase' }); // force le choix du thème
  await wait(300);
  for (let q = 0; q < 3 && !finishedData; q++) {
    host.emit('host:action', { code, action: 'skipPhase' }); // force la révélation de la question
    await wait(200);
    host.emit('host:action', { code, action: 'next' });
    await wait(200);
  }
  host.emit('host:action', { code, action: 'nextRound' });
  await wait(300);
  console.log('\ngame:finished reçu après les 2 manches configurées ?', !!finishedData);
  if (!finishedData) throw new Error('La partie ne s\'est jamais terminée après le nombre de manches configuré !');

  console.log('\nTEST QUIZ DUEL (mode individuel) RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
