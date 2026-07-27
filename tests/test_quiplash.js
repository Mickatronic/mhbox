const { connectHost } = require('./helpers');
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
function connect() { return io(URL, { transports: ['websocket'] }); }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const host = await connectHost();
  const code = await new Promise(r => host.emit('host:create', (res) => r(res.code)));
  console.log('code', code);

  const names = ['Alice', 'Bob', 'Chloé', 'Dan'];
  const players = names.map(() => connect());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const ids = [];
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    ids.push(res.playerId);
  }
  console.log('joined', ids.length);

  let state = null; // dernier game:activate
  let finished = false;
  let ended = false;
  host.on('game:activate', d => { if (d.type === 'quiplash') state = d; });
  host.on('game:finished', () => { finished = true; });
  host.on('party:end', () => { ended = true; });

  host.emit('host:startParty', { code, playlist: ['quiplash'], config: { quiplash: { packNames: ['Classique'] } } });
  await wait(200);

  let guard = 0;
  while (!finished && guard < 60) {
    guard++;
    await wait(80);
    if (!state) continue;
    if (state.phase === 'answering') {
      if (state.final) {
        players.forEach(p => p.emit('player:action', { code, action: 'answer', payload: { text: 'réponse finale' } }));
      } else {
        players.forEach(p => p.emit('player:action', { code, action: 'answer', payload: { text: 'réponse' } }));
      }
      await wait(150);
      host.emit('host:action', { code, action: state.final ? 'startVotingFinal' : 'startVoting' });
      state = null;
    } else if (state.phase === 'voting') {
      const authors = state.authors;
      players.forEach((p, i) => { if (!authors.includes(ids[i])) p.emit('player:action', { code, action: 'vote', payload: { choice: authors[0] } }); });
      await wait(150);
      host.emit('host:action', { code, action: 'reveal' });
      await wait(150);
      host.emit('host:action', { code, action: 'next' });
      state = null;
    } else if (state.phase === 'votingFinal') {
      players.forEach((p, i) => p.emit('player:action', { code, action: 'vote', payload: { choice: state.options.find(o => o.id !== ids[i]).id } }));
      await wait(150);
      host.emit('host:action', { code, action: 'revealFinal' });
      await wait(150);
      host.emit('host:action', { code, action: 'finish' });
      state = null;
    }
  }
  console.log('quiplash finished after', guard, 'iterations ->', finished);

  host.emit('host:action', { code, action: 'hub:next' });
  await wait(300);
  console.log('party ended ->', ended);
  process.exit(finished && ended ? 0 : 1);
}
main().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
