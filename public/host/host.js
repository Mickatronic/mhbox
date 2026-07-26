const socket = io();
const app = document.getElementById('app');
let roomCode = null;
let players = [];
let availableGames = [];
let selectedGames = [];
let packsCache = {};        // gameType -> [names]
let selectedPacks = {};     // gameType -> [names]
let activeGameType = null;

function hostAction(action, payload) {
  socket.emit('host:action', { code: roomCode, action, payload: payload || {} });
}

function confetti(n = 60) {
  const colors = ['#ff2d78', '#ffd23f', '#06d6a0', '#3a86ff'];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDuration = (2 + Math.random() * 1.5) + 's';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }
}

// ============================================================
// HUB : création du salon + sélection des mini-jeux + lobby
// ============================================================

function boot() {
  socket.emit('host:create', ({ code }) => {
    roomCode = code;
    fetch('/api/games').then(r => r.json()).then(list => {
      availableGames = list;
      renderLobby();
    });
  });
}

function toggleGame(type) {
  const i = selectedGames.indexOf(type);
  if (i >= 0) selectedGames.splice(i, 1);
  else selectedGames.push(type);
  if (selectedGames.includes(type) && !packsCache[type] && type !== 'dixit') {
    fetch('/api/packs/' + type).then(r => r.json()).then(names => {
      packsCache[type] = names;
      selectedPacks[type] = [...names];
      renderLobby();
    });
  } else {
    renderLobby();
  }
}

function renderLobby() {
  const tiles = availableGames.map(g => `
    <div class="game-tile ${selectedGames.includes(g.type) ? 'selected' : ''}" onclick="toggleGame('${g.type}')">
      <div class="gt-title">${g.label}</div>
      <div class="gt-desc">${g.desc}</div>
    </div>`).join('');

  const packsHtml = selectedGames.filter(t => packsCache[t] && packsCache[t].length > 1).map(t => {
    const game = availableGames.find(g => g.type === t);
    const boxes = packsCache[t].map(name => {
      const checked = (selectedPacks[t] || []).includes(name) ? 'checked' : '';
      const cid = 'pk_' + t + '_' + name.replace(/\W/g, '_');
      return `<label class="pill" style="display:block;cursor:pointer;text-align:left">
        <input type="checkbox" id="${cid}" ${checked} onchange="togglePack('${t}','${name.replace(/'/g, "\\'")}')" style="margin-right:8px">${name}
      </label>`;
    }).join('');
    return `<div style="margin-top:10px"><b>${game.label} — paquets :</b>${boxes}</div>`;
  }).join('');

  app.innerHTML = `
    <div class="logo title-font">PARTY CLASH</div>
    <div class="card wide">
      <p>Rejoignez sur votre téléphone :</p>
      <p style="font-size:1.2rem"><b>${location.origin}</b></p>
      <div class="code-box">${roomCode}</div>
      <div class="player-grid" id="players"></div>
      <hr style="opacity:.2;margin:20px 0">
      <p><b>Choisis un ou plusieurs mini-jeux (dans l'ordre de clic) :</b></p>
      <div class="game-picker">${tiles}</div>
      ${packsHtml}
      <button id="startBtn" class="green" style="margin-top:20px">Lancer la soirée 🎉</button>
    </div>`;
  renderPlayers();
  document.getElementById('startBtn').onclick = startParty;
}

function togglePack(type, name) {
  selectedPacks[type] = selectedPacks[type] || [];
  const i = selectedPacks[type].indexOf(name);
  if (i >= 0) selectedPacks[type].splice(i, 1);
  else selectedPacks[type].push(name);
}

function renderPlayers() {
  const el = document.getElementById('players');
  if (!el) return;
  el.innerHTML = players.map(p => `<div class="player-chip">${p.name}</div>`).join('');
  const btn = document.getElementById('startBtn');
  if (btn) {
    const ok = players.length >= 2 && selectedGames.length > 0;
    btn.disabled = !ok;
    btn.textContent = !ok ? (selectedGames.length === 0 ? 'Choisis au moins 1 jeu' : 'Il faut au moins 2 joueurs') : `Lancer la soirée (${players.length} joueurs)`;
  }
}

function startParty() {
  if (players.length < 2 || selectedGames.length === 0) return;
  const config = {};
  selectedGames.forEach(t => { if (selectedPacks[t]) config[t] = { packNames: selectedPacks[t] }; });
  socket.emit('host:startParty', { code: roomCode, playlist: selectedGames, config });
}

socket.on('room:players', (list) => { players = list; renderPlayers(); });

// ============================================================
// TRANSITIONS : fin de mini-jeu / fin de soirée
// ============================================================

function scorePills(scores) {
  return scores.map(p => `<div class="pill">${p.name}: ${p.score} pts</div>`).join('');
}

socket.on('game:finished', ({ scores }) => {
  confetti(30);
  app.innerHTML = `
    <div class="logo small title-font">SCORES</div>
    <div class="card wide">
      <div class="player-grid">${scorePills(scores)}</div>
      <button id="nextGameBtn" class="yellow" style="margin-top:20px">Jeu suivant ▶</button>
    </div>`;
  document.getElementById('nextGameBtn').onclick = () => hostAction('hub:next');
});

socket.on('party:end', ({ scores }) => {
  confetti(120);
  const podium = scores.slice(0, 3);
  const [p1, p2, p3] = podium;
  app.innerHTML = `
    <div class="logo title-font">🏆 RÉSULTATS 🏆</div>
    <div class="card wide">
      <div class="podium">
        ${p2 ? `<div class="podium-step p2">🥈<br>${p2.name}<br>${p2.score}</div>` : ''}
        ${p1 ? `<div class="podium-step p1">🥇<br>${p1.name}<br>${p1.score}</div>` : ''}
        ${p3 ? `<div class="podium-step p3">🥉<br>${p3.name}<br>${p3.score}</div>` : ''}
      </div>
      <div class="player-grid" style="margin-top:24px">${scorePills(scores)}</div>
      <button onclick="location.reload()" class="secondary">🔁 Nouvelle soirée</button>
    </div>`;
});

// ============================================================
// DISPATCH générique
// ============================================================

socket.on('game:activate', (data) => {
  activeGameType = data.type;
  ({
    quiplash: renderQuiplash,
    undercover: renderUndercover,
    quizduel: renderQuizduel,
    headsup: renderHeadsup,
    drawchain: renderDrawchain,
    dixit: renderDixit
  }[data.type] || (() => {}))(data);
});

socket.on('game:update', (data) => {
  ({
    quiplash: updateQuiplash,
    undercover: updateUndercover,
    quizduel: updateQuizduel,
    headsup: updateHeadsup,
    drawchain: updateDrawchain,
    dixit: updateDixit
  }[data.type] || (() => {}))(data);
});

socket.on('game:reveal', (data) => {
  ({
    quiplash: revealQuiplash,
    undercover: revealUndercover,
    quizduel: revealQuizduel,
    drawchain: revealDrawchain,
    dixit: revealDixit
  }[data.type] || (() => {}))(data);
});

function roundBadge(text) { return `<div class="round-badge">${text}</div>`; }

// ============================================================
// QUIPLASH
// ============================================================
let qpFinal = false;

function renderQuiplash(data) {
  qpFinal = !!data.final;
  if (data.phase === 'answering') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge(data.final ? 'MANCHE FINALE — QUIPLASH' : `Quiplash — Manche ${data.round} / ${data.total}`)}
      <div class="card wide">
        ${data.final ? `<div class="prompt-box">${data.prompt}</div>` : ''}
        <p style="font-size:1.3rem">✍️ Tout le monde répond en secret sur son téléphone…</p>
        <div class="progress-wrap"><div class="progress-bar" id="prog"></div></div>
        <p class="hint" id="progText">0 / 0 réponses reçues</p>
      </div>`;
  } else if (data.phase === 'voting') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge(`Duel ${data.index + 1} / ${data.total}`)}
      <div class="card wide">
        <div class="prompt-box">${data.prompt}</div>
        <div class="matchup">
          <div class="answer-card" data-i="0">${data.options[0].text}<div class="votes-bar" id="bar0"></div></div>
          <div class="vs">VS</div>
          <div class="answer-card" data-i="1">${data.options[1].text}<div class="votes-bar" id="bar1"></div></div>
        </div>
        <p class="hint">📱 Votez sur vos téléphones (les auteurs ne votent pas) !</p>
        <div class="progress-wrap"><div class="progress-bar" id="vprog"></div></div>
        <p class="hint" id="vProgText"></p>
      </div>`;
  } else if (data.phase === 'votingFinal') {
    const cards = data.options.map((o, i) => `<div class="answer-card" data-i="${i}" style="width:240px">${o.text}<div class="votes-bar" id="bar${i}"></div></div>`).join('');
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge('MANCHE FINALE')}
      <div class="card wide">
        <div class="prompt-box">${data.prompt}</div>
        <div class="matchup">${cards}</div>
        <p class="hint">📱 Votez pour la meilleure réponse (pas la vôtre) !</p>
        <div class="progress-wrap"><div class="progress-bar" id="vprog"></div></div>
        <p class="hint" id="vProgText"></p>
      </div>`;
  }
}

function updateQuiplash(data) {
  if (data.kind === 'progress') {
    const bar = document.getElementById('prog'), txt = document.getElementById('progText');
    if (bar) { bar.style.width = Math.round(data.received / data.expected * 100) + '%'; txt.textContent = `${data.received} / ${data.expected} réponses reçues`; }
  } else if (data.kind === 'allAnswered') {
    addButton('yellow', '🗳️ Lancer le vote', () => hostAction(qpFinal ? 'startVotingFinal' : 'startVoting'));
  } else if (data.kind === 'voteProgress') {
    const bar = document.getElementById('vprog'), txt = document.getElementById('vProgText');
    if (bar) { bar.style.width = Math.round(data.received / data.expected * 100) + '%'; txt.textContent = `${data.received} / ${data.expected} votes reçus`; }
  } else if (data.kind === 'allVoted') {
    addButton('yellow', '🎉 Révéler les votes', () => hostAction(qpFinal ? 'revealFinal' : 'reveal'));
  }
}

function addButton(cls, label, onClick, id) {
  const card = document.querySelector('.card');
  if (!card || (id && document.getElementById(id))) return;
  const btn = document.createElement('button');
  if (id) btn.id = id;
  btn.className = cls;
  btn.textContent = label;
  btn.onclick = onClick;
  card.appendChild(btn);
}

function revealQuiplash(data) {
  const max = Math.max(1, ...data.results.map(r => r.votes));
  data.results.forEach((r, i) => {
    const bar = document.getElementById(`bar${i}`);
    if (bar) setTimeout(() => { bar.style.width = Math.round(r.votes / max * 100) + '%'; }, 200);
  });
  if (data.results.some(r => r.votes > 0)) confetti(40);
  setTimeout(() => {
    const card = document.querySelector('.card');
    const div = document.createElement('div');
    div.style.marginTop = '18px';
    div.innerHTML = `<p><b>Score général :</b></p><div>${scorePills(data.scores)}</div>`;
    card.appendChild(div);
    addButton('secondary', data.final ? '🏆 Fin du Quiplash' : '➡️ Duel suivant', () => hostAction(data.final ? 'finish' : 'next'));
  }, 1200);
}

// ============================================================
// UNDERCOVER
// ============================================================
function renderUndercover(data) {
  if (data.phase === 'clues') {
    const chips = data.turnOrder.map(p => `<div class="turn-chip ${p.id === data.currentPlayerId ? 'active' : ''}" id="uc_${p.id}">${p.name}</div>`).join('');
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge(`Undercover — Manche ${data.round}`)}
      <div class="card wide">
        <p style="font-size:1.2rem">🗣️ Chacun donne un indice à voix haute, dans l'ordre !</p>
        <div class="turn-order">${chips}</div>
        <button id="nextTurnBtn" class="secondary">Joueur suivant ➡️</button>
      </div>`;
    document.getElementById('nextTurnBtn').onclick = () => hostAction('nextTurn');
  } else if (data.phase === 'voting') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge('Vote — qui est l\'imposteur ?')}
      <div class="card wide">
        <p style="font-size:1.2rem">📱 Chacun vote sur son téléphone pour le suspect !</p>
        <div class="turn-order">${data.candidates.map(c => `<div class="turn-chip">${c.name}</div>`).join('')}</div>
        <div class="progress-wrap"><div class="progress-bar" id="ucvprog"></div></div>
        <p class="hint" id="ucvtxt"></p>
      </div>`;
  }
}

function updateUndercover(data) {
  if (data.kind === 'turn') {
    document.querySelectorAll('.turn-chip').forEach(c => c.classList.remove('active'));
    const el = document.getElementById('uc_' + data.currentPlayerId);
    if (el) el.classList.add('active');
  } else if (data.kind === 'voteProgress') {
    const bar = document.getElementById('ucvprog'), txt = document.getElementById('ucvtxt');
    if (bar) { bar.style.width = Math.round(data.received / data.expected * 100) + '%'; txt.textContent = `${data.received} / ${data.expected} votes reçus`; }
  }
}

function revealUndercover(data) {
  confetti(data.gameOver ? 60 : 20);
  const card = document.querySelector('.card');
  card.innerHTML = `
    <p style="font-size:1.3rem">${data.tie ? '🤝 Égalité, personne n\'est éliminé !' : `☠️ <b>${data.eliminatedName}</b> est éliminé(e) — c'était un(e) <b>${data.eliminatedRole === 'civilian' ? 'civil(e)' : data.eliminatedRole === 'mrwhite' ? 'Mr. White' : 'undercover'}</b> !`}</p>
    <p class="hint">Mot des civils : <b>${data.civilianWord}</b> — Mot de l'imposteur : <b>${data.undercoverWord}</b></p>
    ${data.gameOver ? `<h2 class="title-font" style="color:var(--yellow)">${data.winner === 'civilians' ? '🏆 Les civils gagnent !' : '🕵️ Les imposteurs gagnent !'}</h2>` : ''}
    <div style="margin-top:14px"><div class="player-grid">${scorePills(data.scores)}</div></div>
  `;
  addButton(data.gameOver ? 'secondary' : 'yellow', data.gameOver ? '🏁 Terminer' : '➡️ Manche suivante', () => hostAction(data.gameOver ? 'finish' : 'continue'));
}

// ============================================================
// QUIZ DUEL
// ============================================================
function renderQuizduel(data) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    ${roundBadge(`Quiz Duel — Question ${data.index + 1} / ${data.total}`)}
    <div class="card wide">
      <div class="prompt-box">${data.question}</div>
      <div class="matchup" style="flex-wrap:wrap">
        ${data.choices.map((c, i) => `<div class="answer-card" id="qzc${i}" style="width:220px">${String.fromCharCode(65 + i)}. ${c}</div>`).join('')}
      </div>
      <div class="progress-wrap"><div class="progress-bar" id="qzprog"></div></div>
      <p class="hint" id="qztxt">0 / 0 réponses reçues</p>
    </div>`;
}

function updateQuizduel(data) {
  if (data.kind === 'progress') {
    const bar = document.getElementById('qzprog'), txt = document.getElementById('qztxt');
    if (bar) { bar.style.width = Math.round(data.received / data.expected * 100) + '%'; txt.textContent = `${data.received} / ${data.expected} réponses reçues`; }
  } else if (data.kind === 'allAnswered') {
    addButton('yellow', '✅ Révéler la réponse', () => hostAction('reveal'));
  }
}

function revealQuizduel(data) {
  const el = document.getElementById('qzc' + data.correct);
  if (el) { el.style.borderColor = 'var(--teal)'; el.style.borderWidth = '4px'; el.style.borderStyle = 'solid'; }
  if (data.results.some(r => r.correct)) confetti(30);
  const card = document.querySelector('.card');
  const div = document.createElement('div');
  div.style.marginTop = '16px';
  div.innerHTML = `<p><b>Score général :</b></p><div class="player-grid">${scorePills(data.scores)}</div>`;
  card.appendChild(div);
  addButton('secondary', '➡️ Question suivante', () => hostAction('next'));
}

// ============================================================
// TÊTE EN L'AIR (Heads Up)
// ============================================================
let huTimerInterval = null;
let huTimeLeft = 0;

function renderHeadsup(data) {
  if (data.phase === 'collect') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge('Tête en l\'air — préparation')}
      <div class="card wide">
        <p style="font-size:1.2rem">📱 Chaque joueur propose 1 à 2 noms sur son téléphone (perso, ça pimente le jeu !)</p>
        <div class="progress-wrap"><div class="progress-bar" id="hucollectprog"></div></div>
        <p class="hint" id="hucollecttxt">0 / 0 ont proposé des noms</p>
        <button id="startTurnsBtn" class="green">Commencer les tours ▶</button>
      </div>`;
    document.getElementById('startTurnsBtn').onclick = () => hostAction('startTurns');
  } else if (data.phase === 'turn') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge('Tête en l\'air')}
      <div class="card wide">
        <p style="font-size:1.4rem">🤳 <b>${data.currentPlayerName}</b>, mets ton téléphone sur ton front !</p>
        <div class="timer-ring" id="huTimer">${data.duration}</div>
        <p class="hint">Les autres donnent des indices à l'oral.</p>
        <div id="huScoreFeed" class="hint" style="min-height:24px"></div>
        <div class="matchup">
          <button class="green" id="huCorrect">✅ Trouvé !</button>
          <button class="secondary" id="huSkip">⏭️ Passer</button>
        </div>
      </div>`;
    document.getElementById('huCorrect').onclick = () => hostAction('markResult', { result: 'correct' });
    document.getElementById('huSkip').onclick = () => hostAction('markResult', { result: 'skip' });
    startHuTimer(data.duration);
  }
}

function startHuTimer(duration) {
  clearInterval(huTimerInterval);
  huTimeLeft = duration;
  const ring = document.getElementById('huTimer');
  huTimerInterval = setInterval(() => {
    huTimeLeft--;
    const r = document.getElementById('huTimer');
    if (r) {
      r.textContent = huTimeLeft;
      if (huTimeLeft <= 10) r.classList.add('low');
    }
    if (huTimeLeft <= 0) {
      clearInterval(huTimerInterval);
      hostAction('endTurn');
    }
  }, 1000);
}

function updateHeadsup(data) {
  if (data.kind === 'collectProgress') {
    const bar = document.getElementById('hucollectprog'), txt = document.getElementById('hucollecttxt');
    if (bar) { bar.style.width = Math.round(data.received / data.expected * 100) + '%'; txt.textContent = `${data.received} / ${data.expected} ont proposé des noms`; }
  } else if (data.kind === 'scoreUpdate') {
    const feed = document.getElementById('huScoreFeed');
    if (feed) feed.textContent = `${data.result === 'correct' ? '✅' : '⏭️'} "${data.lastWord}" — ${data.correctCount} trouvé(s) sur ce tour`;
  } else if (data.kind === 'turnEnded') {
    clearInterval(huTimerInterval);
    confetti(20);
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      <div class="card wide">
        <p style="font-size:1.4rem">🎉 <b>${data.playerName}</b> a trouvé <b>${data.correctCount}</b> mot(s) !</p>
        <div class="player-grid">${scorePills(data.scores)}</div>
        <p class="hint">Tour suivant dans un instant…</p>
      </div>`;
  }
}

// ============================================================
// DESSINE & PASSE (Telestrations)
// ============================================================
function renderDrawchain(data) {
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    ${roundBadge(`Dessine & Passe — Étape ${data.pass} / ${data.total}`)}
    <div class="card wide">
      <p style="font-size:1.3rem">${data.taskType === 'draw' ? '🎨 Tout le monde dessine en secret…' : '🔎 Tout le monde devine en secret…'}</p>
      <div class="progress-wrap"><div class="progress-bar" id="dcprog"></div></div>
      <p class="hint" id="dctxt">0 / 0</p>
    </div>`;
}

function updateDrawchain(data) {
  if (data.kind === 'progress') {
    const bar = document.getElementById('dcprog'), txt = document.getElementById('dctxt');
    if (bar) { bar.style.width = Math.round(data.received / data.expected * 100) + '%'; txt.textContent = `${data.received} / ${data.expected}`; }
  }
}

function revealDrawchain(data) {
  let bookIdx = 0, stepIdx = 0;
  const books = data.books;

  function renderStep() {
    const book = books[bookIdx];
    const entry = book.entries[stepIdx];
    const isLast = bookIdx === books.length - 1 && stepIdx === book.entries.length - 1;
    let content;
    if (entry.type === 'word') content = `<div class="prompt-box">Mot de départ : ${entry.content}</div>`;
    else if (entry.type === 'draw') content = `<img src="${entry.content}" alt="dessin">`;
    else content = `<div class="prompt-box">💬 ${entry.content || '(aucune réponse)'}</div>`;

    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge(`Chaîne de ${book.ownerName} — étape ${stepIdx + 1}/${book.entries.length}`)}
      <div class="card wide">
        <div class="reveal-strip">${content}</div>
        <p class="hint">par ${entry.by}</p>
        <button id="dcNextBtn" class="secondary">${isLast ? (bookIdx === books.length - 1 ? '🏁 Terminer' : 'Chaîne suivante ➡️') : 'Étape suivante ➡️'}</button>
      </div>`;

    document.getElementById('dcNextBtn').onclick = () => {
      stepIdx++;
      if (stepIdx >= book.entries.length) {
        bookIdx++;
        stepIdx = 0;
        if (bookIdx >= books.length) {
          const card = document.querySelector('.card');
          card.innerHTML = `<div class="player-grid">${scorePills(data.scores)}</div>`;
          addButton('secondary', '🏁 Terminer le jeu', () => hostAction('finish'));
          return;
        }
      }
      renderStep();
    };
  }
  renderStep();
}

// ============================================================
// CONTEUR (Dixit-like)
// ============================================================
function cardHtml(id, extraClass, label) {
  return `<div class="game-card ${extraClass || ''}" data-cid="${id}">${PartyCards.cardSVG(id, 150)}${label ? `<div class="card-owner-tag">${label}</div>` : ''}</div>`;
}

function renderDixit(data) {
  if (data.phase === 'clue') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge(`Conteur — Manche ${data.round} / ${data.total}`)}
      <div class="card wide">
        <p style="font-size:1.3rem">🎙️ <b>${data.storytellerName}</b> choisit une carte et donne un indice mystérieux…</p>
      </div>`;
  } else if (data.phase === 'choose') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge('Conteur')}
      <div class="card wide">
        <div class="prompt-box">💭 Indice : "${data.clue}"</div>
        <p class="hint">📱 Chacun choisit sur son téléphone la carte qui correspond le mieux…</p>
        <div class="progress-wrap"><div class="progress-bar" id="dxprog"></div></div>
        <p class="hint" id="dxtxt"></p>
      </div>`;
  } else if (data.phase === 'vote') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge('Conteur — vote')}
      <div class="card wide">
        <div class="prompt-box">💭 Indice : "${data.clue}"</div>
        <p class="hint">📱 Votez pour la carte du conteur (pas la vôtre) !</p>
        <div class="card-grid">${data.cards.map(id => cardHtml(id, 'large')).join('')}</div>
        <div class="progress-wrap"><div class="progress-bar" id="dxvprog"></div></div>
        <p class="hint" id="dxvtxt"></p>
      </div>`;
  }
}

function updateDixit(data) {
  if (data.kind === 'chooseProgress') {
    const bar = document.getElementById('dxprog'), txt = document.getElementById('dxtxt');
    if (bar) { bar.style.width = Math.round(data.received / data.expected * 100) + '%'; txt.textContent = `${data.received} / ${data.expected}`; }
  } else if (data.kind === 'voteProgress') {
    const bar = document.getElementById('dxvprog'), txt = document.getElementById('dxvtxt');
    if (bar) { bar.style.width = Math.round(data.received / data.expected * 100) + '%'; txt.textContent = `${data.received} / ${data.expected}`; }
  }
}

function revealDixit(data) {
  confetti(30);
  const grid = data.cards.map(c => cardHtml(c.cardId, c.isStorytellerCard ? 'selected' : '', `${c.ownerName}${c.voters.length ? ' — voté par ' + c.voters.join(', ') : ''}`)).join('');
  app.innerHTML = `
    <div class="logo small title-font">PARTY CLASH</div>
    ${roundBadge('Conteur — révélation')}
    <div class="card wide">
      <div class="prompt-box">💭 Indice : "${data.clue}"</div>
      <div class="card-grid">${grid}</div>
      <div class="player-grid" style="margin-top:16px">${scorePills(data.scores)}</div>
      <button id="dxNextBtn" class="secondary">➡️ Manche suivante</button>
    </div>`;
  document.getElementById('dxNextBtn').onclick = () => hostAction('next');
}

boot();
