// Time's Up sur un seul écran : joueurs saisis par l'hôte (2 suffisent), pour du beurre,
// carte + mots interdits envoyés à l'écran hôte, validation depuis l'hôte.
const { connectHost, connectPlayer } = require('./helpers');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error(m); };

async function main() {
  const host = await connectHost();
  const { code } = await new Promise(r => host.emit('host:create', r));
  let act = null, card = null, upd = null, finished = null;
  host.on('game:activate', d => { if (d.type === 'timesup') act = d; });
  host.on('game:reveal', d => { if (d.type === 'timesup' && d.kind === 'card') card = d; });
  host.on('game:update', d => { if (d.type === 'timesup') upd = d; });
  host.on('game:finished', d => { finished = d; });

  // Aucun téléphone connecté : 2 joueurs saisis par l'hôte
  host.emit('host:startParty', { code, playlist: ['timesup'], config: { timesup: {
    localPlayers: ['Mickaël', 'Julie'], forFun: true, packNames: ['Réseau'], wordCount: 6, timerSeconds: 30, enabledRounds: ['describe', 'mime']
  } } });
  await wait(200);
  assert(act.phase === 'teams' && act.local && act.noScore, 'partie locale pour du beurre attendue');
  assert(act.teams.length === 1 && act.teams[0].members.length === 2, 'à 2 joueurs : une seule équipe coopérative');
  console.log('équipe :', act.teams[0].name, act.teams[0].members);

  host.emit('host:action', { code, action: 'startGame' }); await wait(150);
  host.emit('host:action', { code, action: 'beginTurn' }); await wait(150);
  assert(act.phase === 'turn' && act.hostSeesCard, 'tour en cours, carte visible côté hôte');
  assert(card && card.word && card.forbidden.length, 'l\'hôte doit recevoir la carte et ses mots interdits');
  console.log('carte sur l\'écran hôte :', card.word, card.forbidden, '— décrit par', card.describerName);
  const first = act.describerName;

  host.emit('host:action', { code, action: 'hostMark', payload: { result: 'taboo', cardId: card.cardId } }); await wait(100);
  assert(upd.result === 'taboo' && upd.teamScore === 0, 'pour du beurre : pas de pénalité');
  host.emit('host:action', { code, action: 'hostMark', payload: { result: 'correct', cardId: card.cardId } }); await wait(100);
  assert(upd.turnCorrectCount === 1 && upd.teamScore === 0 && upd.teams[0].found === 1, 'mot trouvé compté, sans points');

  host.emit('host:action', { code, action: 'skipPhase' }); await wait(150);
  assert(act.phase === 'turnReady' && act.describerName !== first, 'le décrivant change à chaque tour');

  for (let i = 0; i < 60 && !finished; i++) {
    if (act.phase === 'turnReady' || act.phase === 'roundIntro') host.emit('host:action', { code, action: 'beginTurn' });
    else if (act.phase === 'turn' && card) host.emit('host:action', { code, action: 'hostMark', payload: { result: 'correct', cardId: card.cardId } });
    await wait(60);
  }
  assert(finished && finished.recap.noScore && finished.recap.teams[0].found === 12, 'fin de partie : 6 mots x 2 manches trouvés');
  console.log('récap :', finished.recap);

  // Mode manette unique avec téléphones : l'hôte voit aussi la carte
  const host2 = await connectHost();
  const { code: code2 } = await new Promise(r => host2.emit('host:create', r));
  const ps = [connectPlayer(), connectPlayer()];
  await Promise.all(ps.map(p => new Promise(r => p.on('connect', r))));
  for (const [i, p] of ps.entries()) await new Promise(r => p.emit('player:join', { code: code2, name: 'J' + i }, r));
  let card2 = null, act2 = null;
  host2.on('game:reveal', d => { if (d.type === 'timesup') card2 = d; });
  host2.on('game:activate', d => { if (d.type === 'timesup') act2 = d; });
  host2.emit('host:startParty', { code: code2, playlist: ['timesup'], config: { timesup: { allowExtraNames: false, controllerMode: 'single', packNames: ['Linux & administration'] } } });
  await wait(150);
  host2.emit('host:action', { code: code2, action: 'startGame' }); await wait(100);
  host2.emit('host:action', { code: code2, action: 'beginTurn' }); await wait(150);
  assert(act2.phase === 'turn' && card2 && card2.word, 'manette unique : la carte doit aussi s\'afficher sur l\'hôte');
  console.log('manette unique, carte sur l\'hôte :', card2.word);
  host2.emit('host:action', { code: code2, action: 'hub:end' });

  console.log('\nTEST TIME\'S UP SUR UN SEUL ÉCRAN RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
