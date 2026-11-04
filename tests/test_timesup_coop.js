// Time's Up : lancement sans aucun joueur connecté, coopération forcée à 4 joueurs, chrono 2 min par défaut.
const { connectHost, connectPlayer } = require('./helpers');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error(m); };

async function main() {
  // 1) Aucun téléphone, aucun prénom saisi
  const host = await connectHost();
  const { code } = await new Promise(r => host.emit('host:create', r));
  let act = null;
  host.on('game:activate', d => { if (d.type === 'timesup') act = d; });
  host.emit('host:startParty', { code, playlist: ['timesup'], config: { timesup: { localPlayers: [] } } });
  await wait(200);
  assert(act && act.phase === 'teams' && act.local, 'la partie doit démarrer sans aucun joueur connecté');
  assert(act.teams[0].members.join() !== '' && act.teams[0].members.length === 2, 'joueurs par défaut attendus');
  console.log('sans téléphone :', act.teams.map(t => t.members));
  host.emit('host:action', { code, action: 'startGame' }); await wait(100);
  host.emit('host:action', { code, action: 'beginTurn' }); await wait(100);
  assert(act.phase === 'turn' && act.duration === 120, `chrono de 2 minutes par défaut (obtenu ${act.duration})`);
  assert(act.deadline - Date.now() > 115000, 'échéance à ~2 min');
  host.emit('host:action', { code, action: 'hub:end' });

  // 2) 4 téléphones + coopération : une seule équipe
  const host2 = await connectHost();
  const { code: code2 } = await new Promise(r => host2.emit('host:create', r));
  const ps = [0, 1, 2, 3].map(() => connectPlayer());
  await Promise.all(ps.map(p => new Promise(r => p.on('connect', r))));
  for (const [i, p] of ps.entries()) await new Promise(r => p.emit('player:join', { code: code2, name: 'P' + i }, r));
  let act2 = null;
  host2.on('game:activate', d => { if (d.type === 'timesup') act2 = d; });
  host2.emit('host:startParty', { code: code2, playlist: ['timesup'], config: { timesup: { allowExtraNames: false, coop: true } } });
  await wait(200);
  assert(act2.teams.length === 1 && act2.teams[0].members.length === 4, 'coopération : une seule équipe de 4');
  console.log('coopération :', act2.teams[0].name, act2.teams[0].members);
  host2.emit('host:action', { code: code2, action: 'hub:end' });

  console.log('\nTEST TIME\'S UP COOPÉRATION + SANS JOUEURS RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
