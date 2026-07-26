const socket = io();
const app = document.getElementById('app');
let roomCode = null;
let myId = null;
let myName = null;

function playerAction(action, payload) {
  socket.emit('player:action', { code: roomCode, action, payload: payload || {} });
}

// ============================================================
// JOIN / LOBBY
// ============================================================
function renderJoin(error) {
  app.innerHTML = `
    <div class="logo title-font">PARTY CLASH</div>
    <div class="card">
      <input type="text" id="code" placeholder="CODE DE LA PARTIE" maxlength="4" autocapitalize="characters">
      <input type="text" id="name" placeholder="Ton pseudo" maxlength="16">
      <button id="joinBtn" class="green">Rejoindre 🎮</button>
      ${error ? `<p class="error-msg">${error}</p>` : ''}
    </div>`;
  document.getElementById('joinBtn').onclick = () => {
    const code = document.getElementById('code').value.trim().toUpperCase();
    const name = document.getElementById('name').value.trim();
    if (!code || !name) return renderJoin('Entre un code et un pseudo !');
    socket.emit('player:join', { code, name }, (res) => {
      if (res.error) return renderJoin(res.error);
      roomCode = res.code; myId = res.id; myName = name;
      renderWaiting('En attente que l\'hôte lance la partie…', '⏳');
    });
  };
}

function renderWaiting(msg, emoji) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <p style="font-size:1.25rem">${msg}</p>
      <div style="font-size:2.5rem;margin-top:10px">${emoji || '👀'}</div>
    </div>`;
}

socket.on('game:finished', () => renderWaiting('Manche terminée ! Regarde l\'écran pour les scores…', '🏆'));
socket.on('party:end', ({ scores }) => {
  const rank = scores.findIndex(p => p.id === myId) + 1;
  const me = scores.find(p => p.id === myId);
  app.innerHTML = `
    <div class="logo title-font">FIN DE SOIRÉE</div>
    <div class="card">
      <div style="font-size:3rem">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎉'}</div>
      <p style="font-size:1.3rem">Tu termines <b>${rank}${rank === 1 ? 'er' : 'ème'}</b> avec <b>${me ? me.score : 0}</b> points !</p>
      <button onclick="location.reload()" class="secondary">Rejouer</button>
    </div>`;
});

// ============================================================
// DISPATCH générique
// ============================================================
socket.on('game:activate', (data) => {
  ({ quiplash: pQuiplashActivate, undercover: pUndercoverActivate, quizduel: pQuizduelActivate,
     headsup: pHeadsupActivate, drawchain: pDrawchainActivate, dixit: pDixitActivate }[data.type] || (() => {}))(data);
});
socket.on('game:privateData', (data) => {
  ({ quiplash: pQuiplashPrivate, undercover: pUndercoverPrivate, headsup: pHeadsupPrivate,
     drawchain: pDrawchainPrivate, dixit: pDixitPrivate }[data.type] || (() => {}))(data);
});
socket.on('game:update', (data) => {
  ({ headsup: pHeadsupUpdate }[data.type] || (() => {}))(data);
});
socket.on('game:reveal', (data) => {
  ({ quiplash: pQuiplashReveal, undercover: pUndercoverReveal, quizduel: pQuizduelReveal,
     dixit: pDixitReveal }[data.type] || (() => {}))(data);
});

// ============================================================
// QUIPLASH
// ============================================================
let qpHasAnswered = false, qpHasVoted = false;

function pQuiplashActivate(data) {
  qpHasVoted = false;
  if (data.phase === 'answering') {
    qpHasAnswered = false;
    if (data.final) renderAnswerBox(data.prompt, 'quiplash');
    else renderWaiting('Attends ton prompt…', '✍️');
  } else if (data.phase === 'voting' || data.phase === 'votingFinal') {
    renderVoteChoice(data.prompt, data.options);
  }
}
function pQuiplashPrivate(data) {
  if (data.kind === 'prompt' && !qpHasAnswered) renderAnswerBox(data.prompt, 'quiplash');
}
function pQuiplashReveal(data) {
  const mine = data.results.find(r => r.id === myId);
  renderWaiting(mine ? `Ta réponse a eu ${mine.votes} vote(s) ! 🎉` : 'Résultats en cours…', '🎉');
}

function renderAnswerBox(prompt, actionType) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <div class="prompt-box">${prompt}</div>
      <textarea id="ans" placeholder="Ta réponse la plus drôle…" maxlength="120"></textarea>
      <button id="sendBtn" class="green">Envoyer ✍️</button>
    </div>`;
  document.getElementById('sendBtn').onclick = () => {
    const text = document.getElementById('ans').value.trim();
    if (!text) return;
    playerAction('answer', { text });
    qpHasAnswered = true;
    renderWaiting('Réponse envoyée ! En attente des autres…', '👀');
  };
}

function renderVoteChoice(prompt, options) {
  const iAmAuthor = options.some(o => o.id === myId);
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <div class="prompt-box">${prompt}</div>
      ${iAmAuthor ? '<p class="hint">C\'est ta réponse, tu ne votes pas ici 👀</p>' : '<p class="hint">Quelle réponse est la plus drôle ?</p>'}
      <div id="opts"></div>
    </div>`;
  const wrap = document.getElementById('opts');
  options.forEach(o => {
    const div = document.createElement('div');
    div.className = 'answer-card' + (iAmAuthor ? ' disabled' : '');
    div.style.margin = '12px auto'; div.style.maxWidth = '100%';
    div.textContent = o.text;
    if (!iAmAuthor) {
      div.onclick = () => {
        if (qpHasVoted) return;
        qpHasVoted = true;
        [...wrap.children].forEach(c => c.classList.add('disabled'));
        div.classList.add('chosen');
        playerAction('vote', { choice: o.id });
        setTimeout(() => renderWaiting('Vote envoyé ! En attente…', '👀'), 350);
      };
    }
    wrap.appendChild(div);
  });
  if (iAmAuthor) setTimeout(() => renderWaiting('En attente des votes des autres…', '👀'), 250);
}

// ============================================================
// UNDERCOVER
// ============================================================
let ucMyRole = null;

function pUndercoverPrivate(data) {
  ucMyRole = data.role;
  const roleLabel = data.role === 'civilian' ? '🙂 Tu es un CIVIL' : data.role === 'undercover' ? '🕵️ Tu es UNDERCOVER (mot différent, fonds-toi dans la masse !)' : '🎭 Tu es MR. WHITE (tu n\'as aucun mot, bluffe !)';
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <p style="font-size:1.1rem">${roleLabel}</p>
      ${data.word ? `<div class="big-word">${data.word}</div>` : '<p class="hint">Écoute les autres pour deviner le mot…</p>'}
      <p class="hint">Ne le dis pas à voix haute ! Donne juste un indice quand c'est ton tour.</p>
    </div>`;
}

function pUndercoverActivate(data) {
  if (data.phase === 'voting') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      <div class="card">
        <p style="font-size:1.2rem">🗳️ Qui penses-tu être l'imposteur ?</p>
        <div id="ucOpts"></div>
      </div>`;
    const wrap = document.getElementById('ucOpts');
    let voted = false;
    data.candidates.forEach(c => {
      if (c.id === myId) return;
      const div = document.createElement('div');
      div.className = 'answer-card';
      div.style.margin = '10px auto'; div.style.maxWidth = '100%';
      div.textContent = c.name;
      div.onclick = () => {
        if (voted) return;
        voted = true;
        [...wrap.children].forEach(el => el.classList.add('disabled'));
        div.classList.add('chosen');
        playerAction('vote', { target: c.id });
        setTimeout(() => renderWaiting('Vote envoyé ! En attente…', '👀'), 300);
      };
      wrap.appendChild(div);
    });
  } else if (data.phase === 'clues') {
    const isMe = data.currentPlayerId === myId;
    renderWaiting(isMe ? '🎤 C\'est ton tour ! Donne un indice à voix haute.' : `En attente… c'est au tour de ${data.turnOrder.find(p => p.id === data.currentPlayerId)?.name || '...'}`, isMe ? '🎤' : '🕵️');
  }
}

function pUndercoverReveal(data) {
  const stillIn = data.eliminatedId !== myId;
  renderWaiting(data.gameOver
    ? (data.winner === 'civilians' ? '🏆 Les civils ont gagné !' : '🕵️ Les imposteurs ont gagné !')
    : (stillIn ? 'Manche suivante, regarde l\'écran !' : 'Tu as été éliminé(e), continue de regarder le jeu !'), '👀');
}

// ============================================================
// QUIZ DUEL
// ============================================================
function pQuizduelActivate(data) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <div class="prompt-box">${data.question}</div>
      <div id="qzOpts"></div>
    </div>`;
  const wrap = document.getElementById('qzOpts');
  let answered = false;
  data.choices.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'answer-card';
    div.style.margin = '10px auto'; div.style.maxWidth = '100%';
    div.textContent = `${String.fromCharCode(65 + i)}. ${c}`;
    div.onclick = () => {
      if (answered) return;
      answered = true;
      [...wrap.children].forEach(el => el.classList.add('disabled'));
      div.classList.add('chosen');
      playerAction('answer', { choice: i });
      setTimeout(() => renderWaiting('Réponse envoyée ! En attente…', '⚡'), 300);
    };
    wrap.appendChild(div);
  });
}
function pQuizduelReveal(data) {
  const mine = data.results.find(r => r.id === myId);
  renderWaiting(mine ? (mine.correct ? `✅ Bonne réponse ! +${mine.points} pts` : '❌ Mauvaise réponse !') : 'Résultats…', mine && mine.correct ? '🎉' : '👀');
}

// ============================================================
// TÊTE EN L'AIR (Heads Up)
// ============================================================
function pHeadsupActivate(data) {
  if (data.phase === 'collect') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      <div class="card">
        <p style="font-size:1.15rem">Propose 1 à 2 noms (célébrités, persos, potes...) qui seront devinés pendant le jeu !</p>
        <div class="name-input-row"><input type="text" id="n1" placeholder="Nom 1" maxlength="40"></div>
        <div class="name-input-row"><input type="text" id="n2" placeholder="Nom 2 (optionnel)" maxlength="40"></div>
        <button id="sendNamesBtn" class="green">Envoyer</button>
      </div>`;
    document.getElementById('sendNamesBtn').onclick = () => {
      const n1 = document.getElementById('n1').value.trim();
      const n2 = document.getElementById('n2').value.trim();
      playerAction('submitNames', { names: [n1, n2].filter(Boolean) });
      renderWaiting('Merci ! En attente des autres…', '📝');
    };
  } else if (data.phase === 'turn') {
    if (data.currentPlayerId === myId) {
      renderWaiting('Tiens ton téléphone sur ton front, écran vers les autres ! Ne regarde pas 👀', '🤳');
    } else {
      renderWaiting(`Aide ${data.currentPlayerName} à deviner à l'oral !`, '🗣️');
    }
  }
}
function pHeadsupPrivate(data) {
  app.innerHTML = `
    <div id="app-huword" style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--pink)">
      <div class="big-word" style="font-size:4rem">${data.word}</div>
    </div>`;
}
function pHeadsupUpdate(data) {
  if (data.kind === 'turnEnded') renderWaiting('Tour terminé ! Regarde l\'écran pour les scores.', '🏁');
}

// ============================================================
// DESSINE & PASSE (Telestrations)
// ============================================================
function pDrawchainActivate() {
  renderWaiting('Regarde ta tâche…', '🎨');
}
function pDrawchainPrivate(data) {
  if (data.taskType === 'draw') renderDrawTask(data.input, data.inputType);
  else renderGuessTask(data.input);
}

function renderDrawTask(word) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <div class="prompt-box">🎨 Dessine : ${word}</div>
      <canvas id="dcCanvas" class="draw-canvas" width="500" height="500"></canvas>
      <div class="draw-toolbar">
        <button id="dcClear" class="secondary">🧹 Effacer</button>
        <button id="dcSend" class="green">Envoyer ✅</button>
      </div>
    </div>`;
  setupCanvas();
}

function renderGuessTask(imgData) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <p class="hint">Devine ce que ce dessin représente :</p>
      <img src="${imgData}" style="width:100%;border-radius:14px;background:white;margin:10px 0">
      <input type="text" id="dcGuess" placeholder="Ta réponse…" maxlength="40">
      <button id="dcGuessSend" class="green">Envoyer ✅</button>
    </div>`;
  document.getElementById('dcGuessSend').onclick = () => {
    const text = document.getElementById('dcGuess').value.trim();
    if (!text) return;
    playerAction('submit', { content: text });
    renderWaiting('Réponse envoyée ! En attente des autres…', '👀');
  };
}

function setupCanvas() {
  const canvas = document.getElementById('dcCanvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.strokeStyle = '#241a4b';
  let drawing = false, lastX = 0, lastY = 0;

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - rect.left) * (canvas.width / rect.width), y: (t.clientY - rect.top) * (canvas.height / rect.height) };
  }
  function start(e) { drawing = true; const p = pos(e); lastX = p.x; lastY = p.y; e.preventDefault(); }
  function move(e) {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke();
    lastX = p.x; lastY = p.y; e.preventDefault();
  }
  function end() { drawing = false; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  document.getElementById('dcClear').onclick = () => { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); };
  document.getElementById('dcSend').onclick = () => {
    playerAction('submit', { content: canvas.toDataURL('image/png') });
    renderWaiting('Dessin envoyé ! En attente des autres…', '👀');
  };
}

// ============================================================
// CONTEUR (Dixit-like)
// ============================================================
let dxHand = [], dxRole = null;

function pDixitPrivate(data) {
  dxHand = data.hand; dxRole = data.role;
}

function dxCardEl(id, onClick) {
  const div = document.createElement('div');
  div.className = 'game-card';
  div.innerHTML = PartyCards.cardSVG(id, 140);
  if (onClick) div.onclick = () => onClick(id, div);
  return div;
}

function pDixitActivate(data) {
  if (data.phase === 'clue') {
    if (dxRole === 'storyteller' || data.storytellerId === myId) {
      renderDixitClueForm();
    } else {
      renderWaiting(`${data.storytellerName} raconte une histoire… attends l'indice !`, '🎙️');
    }
  } else if (data.phase === 'choose') {
    if (data.storytellerId === myId) {
      renderWaiting('En attente que les autres choisissent leur carte…', '👀');
    } else {
      renderDixitChooseCard(data.clue);
    }
  } else if (data.phase === 'vote') {
    if (data.storytellerId === myId) {
      renderWaiting('En attente des votes…', '👀');
    } else {
      renderDixitVote(data.clue, data.cards);
    }
  }
}

function renderDixitClueForm() {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <p style="font-size:1.15rem">🎙️ Choisis une carte et donne un indice (mot, phrase, chanson…) qui l'évoque sans être trop évident !</p>
      <input type="text" id="dxClue" placeholder="Ton indice…" maxlength="80">
      <div class="card-grid" id="dxHandGrid"></div>
    </div>`;
  const grid = document.getElementById('dxHandGrid');
  let selected = null;
  dxHand.forEach(id => {
    const el = dxCardEl(id, (cid, div) => {
      if (selected) selected.el.classList.remove('selected');
      selected = { id: cid, el: div };
      div.classList.add('selected');
    });
    grid.appendChild(el);
  });
  const btn = document.createElement('button');
  btn.className = 'green'; btn.textContent = 'Valider mon indice ✅';
  btn.onclick = () => {
    const clue = document.getElementById('dxClue').value.trim();
    if (!clue || !selected) return;
    playerAction('submitClue', { clue, cardId: selected.id });
    renderWaiting('Indice envoyé ! Les autres choisissent leur carte…', '👀');
  };
  document.querySelector('.card').appendChild(btn);
}

function renderDixitChooseCard(clue) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <div class="prompt-box">💭 "${clue}"</div>
      <p class="hint">Choisis la carte de ta main qui correspond le mieux :</p>
      <div class="card-grid" id="dxChooseGrid"></div>
    </div>`;
  const grid = document.getElementById('dxChooseGrid');
  let chosen = false;
  dxHand.forEach(id => {
    const el = dxCardEl(id, (cid) => {
      if (chosen) return;
      chosen = true;
      playerAction('submitCard', { cardId: cid });
      renderWaiting('Carte envoyée ! En attente des autres…', '👀');
    });
    grid.appendChild(el);
  });
}

function renderDixitVote(clue, cards) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <div class="prompt-box">💭 "${clue}"</div>
      <p class="hint">Vote pour la carte du conteur (pas la tienne !) :</p>
      <div class="card-grid" id="dxVoteGrid"></div>
    </div>`;
  const grid = document.getElementById('dxVoteGrid');
  let voted = false;
  cards.forEach(id => {
    const el = dxCardEl(id, (cid, div) => {
      if (voted) return;
      voted = true;
      [...grid.children].forEach(c => c.classList.add('disabled'));
      div.classList.add('selected');
      playerAction('vote', { cardId: cid });
      setTimeout(() => renderWaiting('Vote envoyé ! En attente…', '👀'), 300);
    });
    grid.appendChild(el);
  });
}

function pDixitReveal(data) {
  const mine = data.cards.find(c => c.ownerId === myId);
  renderWaiting(mine ? `Ta carte a reçu ${mine.voters.length} vote(s) !` : 'Résultats en cours…', '🃏');
}

renderJoin();
