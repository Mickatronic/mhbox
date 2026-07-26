const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
function connect() { return io(URL, { transports: ['websocket'] }); }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const host = connect();
  await new Promise(r => host.on('connect', r));
  const code = await new Promise(r => host.emit('host:create', (res) => r(res.code)));
  console.log('code', code);

  const names = ['Alice', 'Bob', 'Chloé', 'Dan', 'Eve'];
  const players = names.map(() => connect());
  await Promise.all(players.map(p => new Promise(r => p.on('connect', r))));
  const ids = [];
  for (let i = 0; i < players.length; i++) {
    const res = await new Promise(r => players[i].emit('player:join', { code, name: names[i] }, r));
    ids.push(res.id);
  }
  console.log('joined', ids.length);

  const roles = {};
  players.forEach((p, i) => p.on('game:privateData', d => { if (d.type === 'undercover') roles[ids[i]] = d.role; }));

  let state = null, finished = false, ended = false, lastReveal = null;
  host.on('game:activate', d => { if (d.type === 'undercover') state = d; });
  host.on('game:reveal', d => { if (d.type === 'undercover') lastReveal = d; });
  host.on('game:finished', () => { finished = true; });
  host.on('party:end', () => { ended = true; });

  host.emit('host:startParty', { code, playlist: ['undercover'], config: {} });
  await wait(250);
  console.log('roles assigned:', roles);

  let guard = 0;
  while (!finished && guard < 60) {
    guard++;
    await wait(80);
    console.log('iter', guard, 'state phase:', state && state.phase, 'reveal?', !!lastReveal);
    if (!state && !lastReveal) continue;

    if (state && state.phase === 'clues' && state.turnOrder) {
      // avance tous les tours d'un coup
      const nTurns = state.turnOrder.length;
      state = null;
      for (let k = 0; k < nTurns; k++) {
        host.emit('host:action', { code, action: 'nextTurn' });
        await wait(60);
      }
    } else if (state && state.phase === 'voting' && state.candidates) {
      const candidates = state.candidates.map(c => c.id);
      players.forEach((p, i) => {
        if (!candidates.includes(ids[i])) return;
        const target = candidates.find(c => c !== ids[i]);
        p.emit('player:action', { code, action: 'vote', payload: { target } });
      });
      await wait(200);
      state = null;
    }

    if (lastReveal) {
      console.log('reveal:', lastReveal.eliminatedName, lastReveal.eliminatedRole, 'tie:', lastReveal.tie, 'gameOver:', lastReveal.gameOver, lastReveal.winner);
      if (lastReveal.gameOver) {
        host.emit('host:action', { code, action: 'finish' });
      } else {
        host.emit('host:action', { code, action: 'continue' });
      }
      lastReveal = null;
    }
  }
  console.log('undercover finished after', guard, 'iterations ->', finished);
  host.emit('host:action', { code, action: 'hub:next' });
  await wait(300);
  console.log('party ended ->', ended);
  process.exit(finished && ended ? 0 : 1);
}
main().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
