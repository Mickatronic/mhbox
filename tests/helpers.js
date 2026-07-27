const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

async function hostLoginCookie(password) {
  const res = await fetch(URL + '/api/host/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password || 'changeme123' }) });
  if (!res.ok) throw new Error('host login failed');
  return res.headers.get('set-cookie').split(';')[0];
}

async function connectHost() {
  const cookie = await hostLoginCookie();
  const socket = io(URL, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  await new Promise(r => socket.on('connect', r));
  return socket;
}

function connectPlayer() { return io(URL, { transports: ['websocket'] }); }

module.exports = { URL, hostLoginCookie, connectHost, connectPlayer };
