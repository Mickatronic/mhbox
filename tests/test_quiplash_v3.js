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
  const answerBatches = {};
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    ids.push(res.playerId);
    players[i].on('game:privateData', d => { if (d.type === 'quiplash' && d.kind === 'answerBatch') answerBatches[res.playerId] = d; });
  }

  let activateData = null;
  host.on('game:activate', d => { if (d.type === 'quiplash') activateData = d; });

  host.emit('host:startParty', {
    code, playlist: ['quiplash'],
    config: { quiplash: { packNames: ['Classique'], answersPerPlayer: 3, answerSecondsPerQuestion: 10, voteSecondsPerQuestion: 10 } }
  });
  await wait(300);
  console.log('phase de démarrage :', activateData.phase, '- total duels:', activateData.totalMatchups);

  console.log('\n--- Phase réponses (en lot, à son rythme) ---');
  for (const id of ids) {
    const items = answerBatches[id].items;
    const sock = players[ids.indexOf(id)];
    for (const item of items) {
      sock.emit('player:action', { code, action: 'answer', payload: { matchupIndex: item.matchupIndex, text: 'Blague ' + id.slice(0, 4) } });
      await wait(30);
    }
  }
  await wait(300);
  console.log('phase après toutes les réponses :', activateData.phase);
  if (activateData.phase !== 'voting') throw new Error('Devrait être passé en vote !');
  console.log('question de vote 1/', activateData.total, '- prompt visible pour tous :', !!activateData.prompt);

  let revealCount = 0;
  let finishedData = null;
  host.on('game:reveal', d => { if (d.type === 'quiplash') revealCount++; });
  host.on('game:finished', d => { finishedData = d; });

  const totalQuestions = activateData.total;
  for (let q = 0; q < totalQuestions; q++) {
    const current = activateData;
    console.log(`\n-- Question ${current.index + 1}/${current.total} --`);
    const authors = current.authors;

    authors.forEach(a => players[ids.indexOf(a)].emit('player:action', { code, action: 'vote', payload: { matchupIndex: current.index, choice: authors[0] } }));

    const voters = ids.filter(id => !authors.includes(id));
    voters.forEach(id => players[ids.indexOf(id)].emit('player:action', { code, action: 'vote', payload: { matchupIndex: current.index, choice: authors[0] } }));

    await wait(300);
    if (q < totalQuestions - 1) {
      let guard = 0;
      while (activateData.index === current.index && guard < 60) { await wait(100); guard++; }
    }
  }

  await wait(4500); // laisse le temps à la pause de révélation (~4s) après la dernière question
  console.log('\nnombre de révélations reçues (devrait être', totalQuestions, ') :', revealCount);
  console.log('game:finished reçu après la dernière question ?', !!finishedData);
  if (revealCount !== totalQuestions) throw new Error(`Nombre de reveals incorrect : ${revealCount} au lieu de ${totalQuestions}`);
  if (!finishedData) throw new Error('La partie devrait être terminée après la dernière question votée !');

  console.log('\nTEST QUIPLASH VOTE SYNCHRONE RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
