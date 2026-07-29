const { connectHost, connectPlayer } = require('./helpers');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const host = await connectHost();
  const { code } = await new Promise(r => host.emit('host:create', r));

  const players = ['Alice', 'Bob', 'Chloé'].map(() => connectPlayer());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const ids = [];
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: 'P' + i }, r));
    ids.push(res.playerId);
  }

  let activateData = null;
  host.on('game:activate', d => { if (d.type === 'quiplash') activateData = d; });

  // Minuteur court mais au-dessus du plancher de sécurité (10s/question minimum, voulu) :
  // avec 3 joueurs et 2 réponses/joueur -> 3 duels, max 2 questions assignées par joueur.
  host.emit('host:startParty', {
    code, playlist: ['quiplash'],
    config: { quiplash: { packNames: ['Classique'], answersPerPlayer: 2, answerSecondsPerQuestion: 10, voteSecondsPerQuestion: 10 } }
  });
  await wait(300);
  console.log('phase initiale :', activateData.phase);
  const answerDeadline = activateData.deadline;
  const expectedAnswerSeconds = Math.round((answerDeadline - Date.now()) / 1000);
  console.log('durée du chrono réponse (max assigné x 10s) :', expectedAnswerSeconds, 's');

  console.log('--- on attend que le minuteur EXPIRE tout seul (personne ne répond) ---');
  await wait((expectedAnswerSeconds + 3) * 1000);
  console.log('phase après expiration du minuteur réponse :', activateData.phase);
  if (activateData.phase !== 'voting') throw new Error('Le minuteur n\'a pas forcé le passage automatique au vote !');

  const totalQuestions = activateData.total;
  console.log('nombre de questions à voter :', totalQuestions);

  console.log('\n--- test du bouton host "Passer maintenant" : doit avancer question par question, pas tout terminer d\'un coup ---');
  let finishedData = null;
  host.on('game:finished', d => { finishedData = d; });

  const firstIndex = activateData.index;
  host.emit('host:action', { code, action: 'skipPhase' });
  await wait(300);
  console.log('index après 1 skip :', activateData.index, '(attendu :', firstIndex, 'toujours, le temps de la pause de révélation)');

  // Laisse le temps à la pause de révélation (~4s) puis avance jusqu'à la fin en sautant chaque question
  for (let i = 0; i < totalQuestions + 2 && !finishedData; i++) {
    await wait(4200);
    if (!finishedData) host.emit('host:action', { code, action: 'skipPhase' });
  }
  await wait(300);
  console.log('game:finished reçu après avoir sauté toutes les questions ?', !!finishedData);
  if (!finishedData) throw new Error('skipPhase répété n\'a pas permis de terminer la partie !');

  console.log('\nTEST MINUTEUR + SKIP RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
