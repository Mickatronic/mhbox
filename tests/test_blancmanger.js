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
  const hands = {};
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    ids.push(res.playerId);
    players[i].on('game:privateData', d => { if (d.type === 'blancmanger') hands[res.playerId] = d; });
  }

  let activateData = null;
  let revealData = null;
  host.on('game:activate', d => { if (d.type === 'blancmanger') activateData = d; });
  host.on('game:reveal', d => { if (d.type === 'blancmanger') revealData = d; });

  host.emit('host:startParty', {
    code, playlist: ['blancmanger'],
    config: { blancmanger: { packNames: ['Classique'], rounds: 4, submitSeconds: 15, judgeSeconds: 15 } }
  });
  await wait(300);
  console.log('phase de démarrage :', activateData.phase, '- carte noire :', activateData.blackCard);
  console.log('juge désigné :', activateData.judgeName);

  const judgeId = activateData.judgeId;
  const judgeIdx = ids.indexOf(judgeId);
  console.log('le juge a-t-il bien reçu son rôle ?', hands[judgeId] && hands[judgeId].role);

  // Le juge tente de soumettre une carte -> doit être ignoré (il ne joue pas ce tour)
  players[judgeIdx].emit('player:action', { code, action: 'submitCard', payload: { cardText: hands[judgeId].hand[0] } });
  await wait(150);
  console.log('phase après tentative de triche du juge (doit rester "submit") :', activateData.phase);
  if (activateData.phase !== 'submit') throw new Error('Le juge a réussi à soumettre une carte alors qu\'il ne devrait pas pouvoir !');

  // Tous les non-juges soumettent leur première carte
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === judgeId) continue;
    players[i].emit('player:action', { code, action: 'submitCard', payload: { cardText: hands[ids[i]].hand[0] } });
    await wait(60);
  }
  await wait(300);
  console.log('\nphase après toutes les soumissions :', activateData.phase, '- cartes proposées au juge :', activateData.cards.length);
  if (activateData.phase !== 'judge') throw new Error('Devrait être passé en phase de jugement !');

  // Un non-juge tente de choisir le gagnant -> doit être ignoré
  const nonJudgeIdx = ids.findIndex(id => id !== judgeId);
  players[nonJudgeIdx].emit('player:action', { code, action: 'judgePick', payload: { cardText: activateData.cards[0] } });
  await wait(150);
  console.log('un non-juge ne peut pas choisir le gagnant ?', !revealData);
  if (revealData) throw new Error('Un non-juge a réussi à désigner le gagnant !');

  // Le juge choisit la carte gagnante
  players[judgeIdx].emit('player:action', { code, action: 'judgePick', payload: { cardText: activateData.cards[0] } });
  await wait(300);
  console.log('reveal reçu ?', !!revealData, '- gagnant :', revealData && revealData.winnerName);
  console.log('scores :', revealData && revealData.scores);
  if (!revealData || !revealData.winnerName) throw new Error('La révélation n\'a pas fonctionné !');

  // Passe aux manches suivantes jusqu'à la fin (4 manches configurées)
  let finishedData = null;
  host.on('game:finished', d => { finishedData = d; });
  for (let r = 0; r < 4 && !finishedData; r++) {
    host.emit('host:action', { code, action: 'next' });
    await wait(250);
    if (finishedData) break;
    const nj = ids.filter(id => id !== activateData.judgeId);
    nj.forEach(id => {
      const sock = players[ids.indexOf(id)];
      const hand = hands[id] && hands[id].hand;
      if (hand && hand.length) sock.emit('player:action', { code, action: 'submitCard', payload: { cardText: hand[0] } });
    });
    await wait(250);
    if (activateData.phase === 'judge') {
      const jSock = players[ids.indexOf(activateData.judgeId)];
      jSock.emit('player:action', { code, action: 'judgePick', payload: { cardText: activateData.cards[0] } });
      await wait(250);
    }
  }
  console.log('\ngame:finished reçu après les 4 manches ?', !!finishedData);
  if (!finishedData) throw new Error('La partie ne s\'est jamais terminée après le nombre de manches configuré !');

  console.log('\nTEST BLANC-MANGER COCO RÉUSSI ✅');
  process.exit(0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
