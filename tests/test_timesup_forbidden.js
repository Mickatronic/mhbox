// Time's Up : paquet "Data center" avec mots interdits, bouton "mot interdit",
// anti double-validation (cardId), carte non devinée remise dans la pioche,
// lancement du tour depuis le téléphone du décrivant.
const { connectHost, connectPlayer } = require('./helpers');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function main() {
  const packs = await (await fetch('http://localhost:3000/api/packs/timesup')).json();
  console.log('paquets Time\'s Up :', packs.map(p => p.name));
  assert(packs.some(p => p.name === 'Data center'), 'Le paquet Data center doit être proposé');
  assert(packs.some(p => p.name === 'Célébrités & Personnages'), 'Les paquets de Tête en l\'air restent disponibles');

  const host = await connectHost();
  const { code } = await new Promise(r => host.emit('host:create', r));
  const names = ['Alice', 'Bob', 'Chloé', 'Dan'];
  const players = names.map(() => connectPlayer());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const ids = [];
  const priv = {};
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    ids.push(res.playerId);
    players[i].on('game:privateData', d => { if (d.type === 'timesup') priv[names[i]] = d; });
  }
  let act = null, upd = null, finished = null;
  host.on('game:activate', d => { if (d.type === 'timesup') act = d; });
  host.on('game:update', d => { if (d.type === 'timesup') upd = d; });
  host.on('game:finished', d => { finished = d; });

  host.emit('host:startParty', {
    code, playlist: ['timesup'],
    config: { timesup: { allowExtraNames: true, packNames: ['Data center'], timerSeconds: 15, wordCount: 6, enabledRounds: ['describe', 'mime'] } }
  });
  await wait(200);
  assert(act.phase === 'collect', 'collecte attendue');
  players[0].emit('player:action', { code, action: 'submitNames', payload: { names: ['Baie de stockage : armoire, disques'] } });
  await wait(100);
  host.emit('host:action', { code, action: 'startTeams' });
  await wait(150);
  host.emit('host:action', { code, action: 'startGame' });
  await wait(150);
  assert(act.phase === 'roundIntro' && act.showForbidden === true, 'manche 1 avec mots interdits');

  // Un joueur qui n'est pas le décrivant ne peut pas lancer le tour
  const describerIdx = ids.indexOf(act.describerId);
  const other = players[(describerIdx + 1) % 4];
  other.emit('player:action', { code, action: 'ready' });
  await wait(150);
  assert(act.phase === 'roundIntro', 'un autre joueur ne doit pas pouvoir lancer le tour');

  // Le décrivant lance le tour depuis son téléphone
  players[describerIdx].emit('player:action', { code, action: 'ready' });
  await wait(200);
  assert(act.phase === 'turn', 'le décrivant doit pouvoir lancer le tour');
  const card = priv[names[describerIdx]];
  console.log('carte reçue :', card.word, '— interdits :', card.forbidden);
  assert(card.deadline, 'le téléphone doit recevoir l\'échéance du chrono');
  assert(Array.isArray(card.forbidden) && card.forbidden.length > 0, 'les mots interdits doivent être envoyés en manche 1');

  // Mot interdit prononcé : -5 et la carte repart dans la pioche
  const remainingBefore = card.remaining;
  players[describerIdx].emit('player:action', { code, action: 'markResult', payload: { result: 'taboo', cardId: card.cardId } });
  await wait(150);
  assert(upd.kind === 'scoreUpdate' && upd.result === 'taboo' && upd.teamScore === -5, 'pénalité de 5 points attendue');
  const card2 = priv[names[describerIdx]];
  assert(card2.cardId !== card.cardId && card2.remaining === remainingBefore, 'la carte taboue retourne dans la pioche');

  // Double-tap : un 2e "correct" avec l'ancien cardId est ignoré
  players[describerIdx].emit('player:action', { code, action: 'markResult', payload: { result: 'correct', cardId: card2.cardId } });
  players[describerIdx].emit('player:action', { code, action: 'markResult', payload: { result: 'correct', cardId: card2.cardId } });
  await wait(200);
  assert(upd.teamScore === 5, `double validation ignorée (score attendu 5, obtenu ${upd.teamScore})`);

  // Fin du tour avec une carte en main : elle doit revenir dans la pioche (6 - 1 trouvée = 5)
  host.emit('host:action', { code, action: 'skipPhase' });
  await wait(200);
  assert(act.phase === 'turnReady', 'pause entre deux tours attendue');
  assert(act.remaining === 5, `la carte en main doit revenir dans la pioche (attendu 5, obtenu ${act.remaining})`);

  // On termine la manche 1 puis on vérifie la manche mime : pas de mots interdits
  for (let i = 0; i < 40 && !(act.phase === 'roundIntro' && act.roundType === 'mime'); i++) {
    if (act.phase === 'turnReady' || act.phase === 'roundIntro') { host.emit('host:action', { code, action: 'beginTurn' }); await wait(120); }
    if (act.phase === 'turn') {
      const d = priv[act.describerName];
      players[ids.indexOf(act.describerId)].emit('player:action', { code, action: 'markResult', payload: { result: 'correct', cardId: d && d.cardId } });
      await wait(80);
    }
  }
  assert(act.roundType === 'mime' && act.showForbidden === false, 'pas de mots interdits au mime');
  host.emit('host:action', { code, action: 'beginTurn' });
  await wait(150);
  assert((priv[act.describerName].forbidden || []).length === 0, 'aucun mot interdit envoyé au mime');

  // "Terminer la soirée" en plein tour : le minuteur ne doit plus relancer d'écran
  let activateAfterEnd = false;
  host.emit('host:action', { code, action: 'hub:end' });
  await wait(100);
  host.on('game:activate', () => { activateAfterEnd = true; });
  await wait(16000);
  assert(!activateAfterEnd, 'le minuteur du jeu a relancé un écran après la fin de la soirée');

  console.log('\nTEST TIME\'S UP MOTS INTERDITS RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
