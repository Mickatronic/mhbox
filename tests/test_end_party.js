const { connectHost, connectPlayer } = require('./helpers');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const host = await connectHost();
  const { code } = await new Promise(r => host.emit('host:create', r));

  const players = ['Alice', 'Bob', 'Chloé'].map(() => connectPlayer());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  for (let i = 0; i < players.length; i++) {
    await new Promise(r => players[i].emit('player:join', { code, name: 'P' + i }, r));
  }

  let activated = false, partyEnded = null;
  host.on('game:activate', () => { activated = true; });
  host.on('party:end', (d) => { partyEnded = d; });

  host.emit('host:startParty', { code, playlist: ['quiplash'], config: { quiplash: { packNames: ['Classique'] } } });
  await wait(250);
  console.log('partie bien démarrée (en plein duel) ?', activated);

  console.log('--- Clic sur "Terminer la soirée" EN PLEIN MILIEU du jeu (pas à la fin) ---');
  host.emit('host:action', { code, action: 'hub:end' });
  await wait(250);
  console.log('party:end reçu immédiatement, sans finir les duels restants ?', !!partyEnded, partyEnded);

  if (!partyEnded) throw new Error('hub:end n\'a pas mis fin à la soirée immédiatement !');
  console.log('\nTEST "TERMINER LA SOIRÉE" RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
