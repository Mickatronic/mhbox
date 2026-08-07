const socket = io();
const app = document.getElementById('app');
let roomCode = null;
let myId = null;
let myName = null;

const SESSION_KEY = 'partyclash_player_session'; // {code, playerId, playerToken, name}
let myToken = null;

function playerAction(action, payload) {
  socket.emit('player:action', { code: roomCode, action, payload: payload || {} });
}

function saveSession() { localStorage.setItem(SESSION_KEY, JSON.stringify({ code: roomCode, playerId: myId, playerToken: myToken, name: myName })); }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

// ============================================================
// JOIN / LOBBY / RECONNEXION
// ============================================================

// Toute (re)connexion du socket — chargement initial, refresh de page, ou coupure
// réseau reconnectée automatiquement par Socket.IO — retente de se rattacher à la
// partie en cours avant de proposer l'écran de saisie du code.
socket.on('connect', () => attemptResume());

function updateUrl(code, name) {
  const url = new URL(location.href);
  url.searchParams.set('code', code);
  url.searchParams.set('name', name);
  history.replaceState(null, '', url.toString());
}

function doJoin(code, name) {
  socket.emit('player:join', { code, name }, (res) => {
    if (res.error) return renderJoin(res.error, code, name);
    roomCode = res.code; myId = res.playerId; myToken = res.playerToken; myName = name;
    saveSession();
    updateUrl(res.code, name);
    renderWaiting('En attente que l\'hôte lance la partie…', '⏳');
  });
}

function attemptResume() {
  const params = new URLSearchParams(location.search);
  const prefillCode = (params.get('code') || '').toUpperCase();
  const prefillName = params.get('name') || '';
  const session = loadSession();

  if (!session || !session.playerId) {
    // Un lien de partage contenant déjà le code ET le pseudo permet de rejoindre directement.
    if (prefillCode && prefillName) { doJoin(prefillCode, prefillName); return; }
    renderJoin(null, prefillCode, prefillName);
    return;
  }
  renderWaiting('Reconnexion en cours…', '🔄');
  socket.emit('player:reconnect', session, (res) => {
    if (!res || res.error) { clearSession(); renderJoin(res && res.error, prefillCode || session.code, prefillName || session.name); return; }
    roomCode = session.code; myId = session.playerId; myToken = session.playerToken; myName = res.name;
    updateUrl(session.code, res.name);
    if (res.phase === 'LOBBY') renderWaiting('En attente que l\'hôte lance la partie…', '⏳');
    // Pour les autres phases, le serveur repousse automatiquement (resyncTo) l'écran
    // adéquat (game:activate / game:privateData / game:reveal / game:finished / party:end),
    // les handlers déjà branchés plus bas s'occupent de l'affichage.
  });
}

function renderJoin(error, prefillCode, prefillName) {
  app.innerHTML = `
    <div class="logo title-font">PARTY CLASH</div>
    <div class="card">
      <input type="text" id="code" placeholder="CODE DE LA PARTIE" maxlength="4" autocapitalize="characters" value="${prefillCode || ''}">
      <input type="text" id="name" placeholder="Ton pseudo" maxlength="16" value="${prefillName || ''}">
      <button id="joinBtn" class="green">Rejoindre 🎮</button>
      ${error ? `<p class="error-msg">${error}</p>` : ''}
    </div>`;
  document.getElementById('joinBtn').onclick = () => {
    const code = document.getElementById('code').value.trim().toUpperCase();
    const name = document.getElementById('name').value.trim();
    if (!code || !name) return renderJoin('Entre un code et un pseudo !', code, name);
    doJoin(code, name);
  };
  if (document.getElementById('name')) {
    document.getElementById('name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('joinBtn').click(); });
  }
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
  clearSession();
  history.replaceState(null, '', location.pathname);
  const rank = scores.findIndex(p => p.id === myId) + 1;
  const me = scores.find(p => p.id === myId);
  app.innerHTML = `
    <div class="logo title-font">FIN DE SOIRÉE</div>
    <div class="card">
      <div style="font-size:3rem">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎉'}</div>
      <p style="font-size:1.3rem">Tu termines <b>${rank}${rank === 1 ? 'er' : 'ème'}</b> avec <b>${me ? me.score : 0}</b> points !</p>
      <button onclick="location.href = location.pathname" class="secondary">Rejouer</button>
    </div>`;
});

// ============================================================
// DISPATCH générique
// ============================================================
socket.on('game:activate', (data) => {
  ({ quiplash: pQuiplashActivate, undercover: pUndercoverActivate, quizduel: pQuizduelActivate,
     headsup: pHeadsupActivate, drawchain: pDrawchainActivate, dixit: pDixitActivate,
     timesup: pTimesupActivate, blancmanger: pBlancmangerActivate }[data.type] || (() => {}))(data);
});
socket.on('game:privateData', (data) => {
  ({ quiplash: pQuiplashPrivate, undercover: pUndercoverPrivate, headsup: pHeadsupPrivate,
     drawchain: pDrawchainPrivate, dixit: pDixitPrivate, timesup: pTimesupPrivate,
     blancmanger: pBlancmangerPrivate }[data.type] || (() => {}))(data);
});
socket.on('game:update', (data) => {
  ({ headsup: pHeadsupUpdate, timesup: pTimesupUpdate }[data.type] || (() => {}))(data);
});
socket.on('game:reveal', (data) => {
  ({ quiplash: pQuiplashReveal, undercover: pUndercoverReveal, quizduel: pQuizduelReveal,
     dixit: pDixitReveal, blancmanger: pBlancmangerReveal }[data.type] || (() => {}))(data);
});

// ============================================================
// QUIPLASH — réponses en lot (à son rythme) puis vote synchrone (une question
// à la fois, en même temps que tout le monde, minuteur par question)
// ============================================================
let qpTimerInterval = null;
let qpItems = [];    // lot de réponses courant
let qpIndex = 0;
let qpVoted = false; // a-t-on déjà voté sur la question de vote en cours ?

function startQpTimer(deadline, onExpire) {
  clearInterval(qpTimerInterval);
  function tick() {
    const el = document.getElementById('qpPlayerTimer');
    const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    if (el) {
      const m = Math.floor(remaining / 60), s = remaining % 60;
      el.textContent = `${m}:${String(s).padStart(2, '0')}`;
      el.classList.toggle('low', remaining <= 15);
    }
    if (remaining <= 0) { clearInterval(qpTimerInterval); if (onExpire) onExpire(); }
  }
  tick();
  qpTimerInterval = setInterval(tick, 1000);
}

function pQuiplashActivate(data) {
  if (data.phase === 'answering') {
    // Le lot personnel arrive juste après via game:privateData et prend le relais.
    renderWaiting('Prépare-toi à répondre à tes duels…', '✍️');
  } else if (data.phase === 'voting') {
    qpVoted = false;
    const iAmAuthor = data.authors.includes(myId);
    renderQpVoteQuestion(data, iAmAuthor);
  }
}

function pQuiplashPrivate(data) {
  if (data.kind === 'answerBatch') {
    qpItems = data.items;
    qpIndex = qpItems.findIndex(it => !it.answered);
    if (qpIndex === -1) { renderQpWaitingDone(data.deadline, 'réponses'); return; }
    renderQpAnswerStep(data.deadline);
  } else if (data.kind === 'votingState') {
    // Reconnexion en pleine phase de vote : on sait si on a déjà voté ou si on est auteur.
    qpVoted = data.alreadyVoted;
    if (data.isAuthor || data.alreadyVoted) {
      renderWaiting(data.isAuthor ? 'C\'est ta réponse, tu ne votes pas ici 👀' : 'Vote envoyé ! En attente…', '👀');
    }
  }
}

function pQuiplashReveal(data) {
  clearInterval(qpTimerInterval);
  const mine = data.results.find(r => r.id === myId);
  renderWaiting(mine ? `Ta réponse a eu ${mine.votes} vote(s) ! 🎉` : 'Résultats en cours…', '🎉');
}

function renderQpWaitingDone(deadline, label) {
  clearInterval(qpTimerInterval);
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <p style="font-size:1.25rem">✅ Tous tes ${label} sont envoyés !</p>
      <p class="hint">En attente des autres joueurs ou de la fin du chrono…</p>
      <div class="timer-ring" id="qpPlayerTimer">--:--</div>
    </div>`;
  if (deadline) startQpTimer(deadline);
}

function renderQpAnswerStep(deadline) {
  const total = qpItems.length;
  const item = qpItems[qpIndex];
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <p class="hint">Question ${qpIndex + 1} / ${total}</p>
      <div class="timer-ring" id="qpPlayerTimer">--:--</div>
      <div class="prompt-box">${item.prompt}</div>
      <textarea id="ans" placeholder="Ta réponse la plus drôle…" maxlength="120"></textarea>
      <button id="sendBtn" class="green">Envoyer ✍️</button>
    </div>`;
  startQpTimer(deadline, () => renderQpWaitingDone(deadline, 'réponses'));
  document.getElementById('sendBtn').onclick = () => {
    const text = document.getElementById('ans').value.trim();
    if (!text) return;
    playerAction('answer', { matchupIndex: item.matchupIndex, text });
    item.answered = true;
    const nextIndex = qpItems.findIndex((it, i) => i > qpIndex && !it.answered);
    if (nextIndex === -1) { renderQpWaitingDone(deadline, 'réponses'); return; }
    qpIndex = nextIndex;
    renderQpAnswerStep(deadline);
  };
}

function renderQpVoteQuestion(data, iAmAuthor) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <p class="hint">Question ${data.index + 1} / ${data.total}</p>
      <div class="timer-ring" id="qpPlayerTimer">--:--</div>
      <div class="prompt-box">${data.prompt}</div>
      ${iAmAuthor ? '<p class="hint">C\'est ta réponse, tu ne votes pas ici 👀</p>' : '<p class="hint">Quelle réponse est la plus drôle ?</p>'}
      <div id="opts"></div>
    </div>`;
  startQpTimer(data.deadline);
  if (iAmAuthor) return;
  const wrap = document.getElementById('opts');
  data.options.forEach(o => {
    const div = document.createElement('div');
    div.className = 'answer-card';
    div.style.margin = '12px auto'; div.style.maxWidth = '100%';
    div.textContent = o.text;
    div.onclick = () => {
      if (qpVoted) return;
      qpVoted = true;
      [...wrap.children].forEach(c => c.classList.add('disabled'));
      div.classList.add('chosen');
      playerAction('vote', { matchupIndex: data.index, choice: o.id });
      setTimeout(() => renderWaiting('Vote envoyé ! En attente des autres…', '👀'), 300);
    };
    wrap.appendChild(div);
  });
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
let qzMyTeamId = null;

function pQuizduelActivate(data) {
  if (data.phase === 'teams') {
    const myTeam = data.teams.find(t => t.members.includes(myName));
    qzMyTeamId = myTeam ? myTeam.id : null;
    renderWaiting(myTeam ? `Tu es dans "${myTeam.name}" ! En attente du lancement…` : 'En attente du lancement…', '👥');
  } else if (data.phase === 'draft') {
    renderQzDraft(data);
  } else if (data.phase === 'pick') {
    const canPick = data.teamMode ? data.pickerTeamId === qzMyTeamId : data.pickerId === myId;
    if (canPick) renderQzPick(data);
    else renderWaiting(`${data.teamMode ? data.pickerTeamName : data.pickerName} choisit un thème…`, '🤔');
  } else if (data.phase === 'question') {
    renderQzQuestion(data);
  } else if (data.phase === 'results') {
    const mine = data.gains.find(g => g.id === myId);
    const myTeam = data.teams && data.teams.find(t => t.id === qzMyTeamId);
    let msg = mine ? `Total : ${mine.total} pts${mine.gained ? ` (+${mine.gained})` : ''}` : 'Résultats de la manche';
    if (myTeam) msg += ` — ${myTeam.name} : ${myTeam.score} pts`;
    renderWaiting(msg, '📊');
  }
}

function renderQzDraft(data) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <p style="font-size:1.15rem">Choisis ${data.themesPerPlayer} thème(s) que tu aimerais jouer :</p>
      <div id="qzThemeList"></div>
      <button id="qzSendThemesBtn" class="green" disabled>Valider</button>
    </div>`;
  const wrap = document.getElementById('qzThemeList');
  const selected = new Set();
  const btn = document.getElementById('qzSendThemesBtn');
  data.allThemes.forEach(theme => {
    const div = document.createElement('div');
    div.className = 'answer-card';
    div.style.margin = '8px auto'; div.style.maxWidth = '100%'; div.style.fontSize = '1rem';
    div.textContent = theme;
    div.onclick = () => {
      if (selected.has(theme)) { selected.delete(theme); div.classList.remove('chosen'); }
      else {
        if (selected.size >= data.themesPerPlayer) return;
        selected.add(theme); div.classList.add('chosen');
      }
      btn.disabled = selected.size === 0;
      btn.textContent = `Valider (${selected.size}/${data.themesPerPlayer})`;
    };
    wrap.appendChild(div);
  });
  btn.onclick = () => {
    playerAction('pickThemes', { themes: [...selected] });
    renderWaiting('Choix envoyé ! En attente des autres…', '👀');
  };
}

function renderQzPick(data) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <p style="font-size:1.15rem">🎯 C'est à ${data.teamMode ? 'ton équipe' : 'toi'} de choisir le thème :</p>
      <div id="qzPickList"></div>
    </div>`;
  const wrap = document.getElementById('qzPickList');
  let chosen = false;
  data.options.forEach(theme => {
    const div = document.createElement('div');
    div.className = 'answer-card';
    div.style.margin = '10px auto'; div.style.maxWidth = '100%';
    div.textContent = theme;
    div.onclick = () => {
      if (chosen) return;
      chosen = true;
      playerAction('chooseTheme', { theme });
      renderWaiting('Thème envoyé !', '👀');
    };
    wrap.appendChild(div);
  });
}

function renderQzQuestion(data) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <p class="hint">${data.themeName} — Question ${data.questionIndex + 1}/${data.totalQuestions}</p>
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
  if (data.phase === 'ready') {
    renderWaiting('L\'hôte va lancer les tours…', '⏳');
  } else if (data.phase === 'collect') {
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

// ============================================================
// TIME'S UP
// ============================================================
let tuTimerInterval = null;
function startTuTimer(deadline) {
  clearInterval(tuTimerInterval);
  function tick() {
    const el = document.getElementById('tuPlayerTimer');
    if (!el) { clearInterval(tuTimerInterval); return; }
    const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const m = Math.floor(remaining / 60), s = remaining % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('low', remaining <= 10);
  }
  tick();
  tuTimerInterval = setInterval(tick, 1000);
}

function pTimesupActivate(data) {
  if (data.phase === 'collect') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      <div class="card">
        <p style="font-size:1.15rem">Propose 1 à 2 noms/personnages à deviner pendant la partie !</p>
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
  } else if (data.phase === 'teams') {
    const myTeam = data.teams.find(t => t.members.includes(myName));
    renderWaiting(myTeam ? `Tu es dans "${myTeam.name}" ! En attente du lancement…` : 'En attente du lancement…', '👥');
  } else if (data.phase === 'roundIntro') {
    renderWaiting(data.roundLabel, '🎬');
  } else if (data.phase === 'turn') {
    const isMyTurn = data.controllerMode === 'perPlayer' ? data.describerName === myName : false;
    if (!isMyTurn) {
      renderWaiting(`Au tour de ${data.teamName}${data.controllerMode === 'perPlayer' ? ' (' + data.describerName + ')' : ''} — aide à deviner à l'oral !`, '🗣️');
    }
    // Si c'est mon tour (ou mode manette unique et je suis le contrôleur), game:privateData prend le relais.
  }
}

function pTimesupPrivate(data) {
  app.innerHTML = `
    <div id="app-tuword" style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--pink);gap:14px">
      <div class="timer-ring" id="tuPlayerTimer">--:--</div>
      <div class="big-word" style="font-size:3rem;text-align:center;padding:0 20px">${data.word}</div>
      <p class="hint">${data.remaining} mot(s) restant(s)</p>
      <div class="matchup">
        <button class="green" id="tuCorrect">✅ Trouvé !</button>
        <button class="secondary" id="tuSkip">⏭️ Passer</button>
      </div>
    </div>`;
  if (data.deadline) startTuTimer(data.deadline);
  document.getElementById('tuCorrect').onclick = () => playerAction('markResult', { result: 'correct' });
  document.getElementById('tuSkip').onclick = () => playerAction('markResult', { result: 'skip' });
}

function pTimesupUpdate(data) {
  if (data.kind === 'turnEnded') {
    clearInterval(tuTimerInterval);
    renderWaiting(`Tour de ${data.teamName} terminé (${data.turnCorrectCount} trouvé(s)) !`, '🏁');
  }
}

// ============================================================
// BLANC-MANGER COCO
// ============================================================
let bmHand = [], bmRole = null;

function pBlancmangerPrivate(data) {
  bmHand = data.hand;
  bmRole = data.role;
}

function pBlancmangerActivate(data) {
  if (data.phase === 'submit') {
    if (bmRole === 'judge' || data.judgeId === myId) {
      renderWaiting('Tu es le juge ce tour-ci ! En attente des cartes des autres…', '🎙️');
    } else {
      renderBmSubmit(data.blackCard);
    }
  } else if (data.phase === 'judge') {
    if (data.judgeId === myId) {
      renderBmJudge(data.blackCard, data.cards);
    } else {
      renderWaiting(`${data.judgeName} choisit la carte la plus drôle…`, '🤔');
    }
  }
}

function renderBmSubmit(blackCard) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <div class="prompt-box">${blackCard}</div>
      <p class="hint">Choisis la carte la plus drôle dans ta main :</p>
      <div id="bmHandList"></div>
    </div>`;
  const wrap = document.getElementById('bmHandList');
  let chosen = false;
  bmHand.forEach(cardText => {
    const div = document.createElement('div');
    div.className = 'answer-card';
    div.style.margin = '10px auto'; div.style.maxWidth = '100%';
    div.textContent = cardText;
    div.onclick = () => {
      if (chosen) return;
      chosen = true;
      playerAction('submitCard', { cardText });
      renderWaiting('Carte envoyée ! En attente des autres…', '👀');
    };
    wrap.appendChild(div);
  });
}

function renderBmJudge(blackCard, cards) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    <div class="card">
      <div class="prompt-box">${blackCard}</div>
      <p class="hint">🎙️ Choisis la carte la plus drôle :</p>
      <div id="bmJudgeList"></div>
    </div>`;
  const wrap = document.getElementById('bmJudgeList');
  let chosen = false;
  cards.forEach(cardText => {
    const div = document.createElement('div');
    div.className = 'answer-card';
    div.style.margin = '10px auto'; div.style.maxWidth = '100%';
    div.textContent = cardText;
    div.onclick = () => {
      if (chosen) return;
      chosen = true;
      playerAction('judgePick', { cardText });
      renderWaiting('Choix envoyé !', '👀');
    };
    wrap.appendChild(div);
  });
}

function pBlancmangerReveal(data) {
  const won = data.winnerName === myName;
  renderWaiting(won ? '🏆 Ta carte a gagné cette manche !' : `${data.winnerName} remporte la manche.`, won ? '🎉' : '👀');
}
