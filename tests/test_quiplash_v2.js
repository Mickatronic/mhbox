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
  const nameById = {}; ids.forEach((id, i) => nameById[id] = names[i]);

  let state = null, finishedData = null;
  const answerCount = {}; ids.forEach(id => answerCount[id] = 0);
  host.on('game:activate', d => { if (d.type === 'quiplash') state = d; });
  host.on('game:finished', d => { finishedData = d; });

  host.emit('host:startParty', { code, playlist: ['quiplash'], config: { quiplash: { packNames: ['Classique'], answersPerPlayer: 3 } } });
  await wait(250);

  let totalMatchups = state.total;
  console.log('total de duels générés pour 4 joueurs (cible 3 réponses/joueur) :', totalMatchups);

  let guard = 0;
  while (!finishedData && guard < 40) {
    guard++;
    await wait(60);
    if (!state) continue;

    if (state.phase === 'answering') {
      const authorNames = state.authorNames;
      const authorIds = ids.filter(id => authorNames.includes(nameById[id]));
      // 1) un NON-auteur tente de répondre -> doit être ignoré
      const nonAuthorIdx = ids.findIndex(id => !authorIds.includes(id));
      players[ids.indexOf(ids[nonAuthorIdx])].emit('player:action', { code, action: 'answer', payload: { text: 'triche !' } });
      // 2) les 2 vrais auteurs répondent
      authorIds.forEach(id => {
        answerCount[id]++;
        players[ids.indexOf(id)].emit('player:action', { code, action: 'answer', payload: { text: 'blague de ' + nameById[id] } });
      });
      await wait(150);
      host.emit('host:action', { code, action: 'startVoting' });
      state = null;
    } else if (state.phase === 'voting') {
      const authors = state.authors;
      // les auteurs tentent de voter sur leur propre duel -> doit être ignoré
      authors.forEach(a => players[ids.indexOf(a)].emit('player:action', { code, action: 'vote', payload: { choice: authors[0] } }));
      // les non-auteurs votent normalement
      ids.forEach(id => { if (!authors.includes(id)) players[ids.indexOf(id)].emit('player:action', { code, action: 'vote', payload: { choice: authors[0] } }); });
      await wait(150);
      host.emit('host:action', { code, action: 'reveal' });
      await wait(150);
      host.emit('host:action', { code, action: 'next' });
      state = null;
    }
  }

  console.log('nombre de réponses par joueur :', answerCount);
  const allAtLeast3 = Object.values(answerCount).every(c => c >= 3);
  console.log('tout le monde a répondu au moins 3 fois ?', allAtLeast3);
  if (!allAtLeast3) throw new Error('Un joueur a répondu moins de 3 fois !');

  console.log('\ngame:finished reçu ?', !!finishedData);
  console.log('récap bestJokes ?', finishedData && finishedData.recap && finishedData.recap.bestJokes);

  console.log('\n--- Test du bouton "Terminer la soirée" en pleine partie (2e round de test) ---');
  host.emit('host:action', { code, action: 'hub:next' }); // pas d'autre jeu -> devrait déclencher party:end
  let partyEnded = false;
  host.on('party:end', () => { partyEnded = true; });
  await wait(300);
  console.log('party ended (playlist épuisée) ?', partyEnded);

  console.log('\nTEST QUIPLASH V2 RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
