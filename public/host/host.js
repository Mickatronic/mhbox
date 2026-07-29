const socket = io();
const app = document.getElementById('app');
let roomCode = null;
let hostToken = null;
let players = [];
let availableGames = [];
let activeGameType = null;

const DRAFT_KEY = 'partyclash_host_draft';   // sélections en cours (avant le lancement)
const SESSION_KEY = 'partyclash_host_session'; // {code, hostToken} une fois le salon créé

// Wizard : 1 = choix des jeux, 2 = paramètres/filtres, 3 = salon (code + joueurs)
let wizard = { step: 1, selectedGames: [], selectedPacks: {}, packsCache: {}, tagFilters: {}, rounds: {}, answerSecondsPerQuestion: 60, voteSecondsPerQuestion: 20 };

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

function saveDraft() { localStorage.setItem(DRAFT_KEY, JSON.stringify(wizard)); }
function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } }
function clearDraft() { localStorage.removeItem(DRAFT_KEY); }
function saveSession() { localStorage.setItem(SESSION_KEY, JSON.stringify({ code: roomCode, hostToken })); }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

function api(path, opts) {
  return fetch('/api/host' + path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(opts || {}) })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Erreur'); return d; });
}

// ============================================================
// AUTH HÔTE
// ============================================================
function boot() {
  api('/session').then(({ authenticated }) => authenticated ? afterAuth() : renderLogin());
}

function renderLogin(error) {
  app.innerHTML = `
    <div class="logo title-font">PARTY CLASH</div>
    <div class="card">
      <p>Mot de passe pour lancer une soirée :</p>
      <input type="password" id="pwd" placeholder="Mot de passe">
      <button id="loginBtn" class="green">Se connecter</button>
      ${error ? `<p class="error-msg">${error}</p>` : ''}
    </div>`;
  document.getElementById('loginBtn').onclick = () => {
    api('/login', { method: 'POST', body: JSON.stringify({ password: document.getElementById('pwd').value }) })
      .then(() => location.reload()) // recharge pour que le socket reparte avec le bon cookie
      .catch(e => renderLogin(e.message));
  };
  document.getElementById('pwd').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });
}

// Sur toute (re)connexion du socket (chargement de page, refresh, coupure réseau...),
// on retente de rattacher l'hôte à son salon en cours si on en a un en mémoire.
let authOk = false;
socket.on('connect', () => { if (authOk) attemptResume(); });

function afterAuth() {
  authOk = true;
  fetch('/api/games').then(r => r.json()).then(list => { availableGames = list; attemptResume(); });
}

function attemptResume() {
  const session = loadSession();
  if (!session || !session.code) return startWizard();
  socket.emit('host:reconnect', { code: session.code, hostToken: session.hostToken }, (res) => {
    if (!res || res.error) { clearSession(); return startWizard(); }
    roomCode = session.code;
    hostToken = session.hostToken;
    if (res.phase === 'LOBBY') {
      // La sélection des jeux est un état client ; on la restaure depuis le brouillon local.
      const draft = loadDraft();
      if (draft) wizard = draft;
      wizard.step = 3;
      renderWizard();
    } else if (res.phase === 'PLAYING' || res.phase === 'INTERMISSION') {
      ensureEndPartyButton();
    }
    // Pour PLAYING / INTERMISSION / ENDED, le serveur repousse automatiquement
    // (via resyncTo) l'événement game:activate / game:reveal / game:finished / party:end
    // adéquat à CE socket : les handlers déjà branchés plus bas s'occupent de l'affichage.
  });
}

// ============================================================
// WIZARD : Étape 1 (jeux) → Étape 2 (paramètres/filtres) → Étape 3 (salon)
// ============================================================
function startWizard() {
  wizard = { step: 1, selectedGames: [], selectedPacks: {}, packsCache: {}, tagFilters: {}, rounds: {}, answerSecondsPerQuestion: 60, voteSecondsPerQuestion: 20 };
  clearDraft();
  renderWizard();
}

function stepIndicator() {
  const labels = ['1. Jeux', '2. Paramètres', '3. Salon'];
  return `<div class="turn-order">${labels.map((l, i) => `<div class="turn-chip ${wizard.step === i + 1 ? 'active' : ''}">${l}</div>`).join('')}</div>`;
}

function renderWizard() {
  if (wizard.step === 1) renderStep1();
  else if (wizard.step === 2) renderStep2();
  else renderStep3();
}

// --- Étape 1 : choix des jeux ---
function renderStep1() {
  const tiles = availableGames.map(g => `
    <div class="game-tile ${wizard.selectedGames.includes(g.type) ? 'selected' : ''}" onclick="toggleGame('${g.type}')">
      <div class="gt-title">${g.label}</div>
      <div class="gt-desc">${g.desc}</div>
    </div>`).join('');

  app.innerHTML = `
    <div class="logo title-font">PARTY CLASH</div>
    ${stepIndicator()}
    <div class="card wide">
      <p><b>Choisis un ou plusieurs mini-jeux (dans l'ordre de clic = ordre de jeu) :</b></p>
      <div class="game-picker">${tiles}</div>
      <div class="toolbar">
        <button class="green" id="toStep2Btn" ${wizard.selectedGames.length ? '' : 'disabled'}>Suivant ➡️</button>
      </div>
    </div>`;
  document.getElementById('toStep2Btn').onclick = () => { wizard.step = 2; saveDraft(); renderWizard(); };
}

function toggleGame(type) {
  const i = wizard.selectedGames.indexOf(type);
  if (i >= 0) wizard.selectedGames.splice(i, 1);
  else wizard.selectedGames.push(type);
  if (wizard.selectedGames.includes(type) && !wizard.packsCache[type] && type !== 'dixit') {
    fetch('/api/packs/' + type).then(r => r.json()).then(packs => {
      wizard.packsCache[type] = packs; // [{name, tags}]
      wizard.selectedPacks[type] = packs.map(p => p.name);
      saveDraft();
      renderWizard();
    });
  } else {
    saveDraft();
    renderWizard();
  }
}

// --- Étape 2 : paramètres de jeu + filtres par thème ---
function allTagsFor(type) {
  const packs = wizard.packsCache[type] || [];
  const tags = new Set();
  packs.forEach(p => (p.tags || []).forEach(t => tags.add(t)));
  return [...tags].sort();
}

function toggleTagFilter(type, tag) {
  wizard.tagFilters[type] = wizard.tagFilters[type] || [];
  const i = wizard.tagFilters[type].indexOf(tag);
  if (i >= 0) wizard.tagFilters[type].splice(i, 1);
  else wizard.tagFilters[type].push(tag);
  saveDraft();
  renderWizard();
}

function togglePack(type, name) {
  wizard.selectedPacks[type] = wizard.selectedPacks[type] || [];
  const i = wizard.selectedPacks[type].indexOf(name);
  if (i >= 0) wizard.selectedPacks[type].splice(i, 1);
  else wizard.selectedPacks[type].push(name);
  saveDraft();
}

function setRounds(type, value) {
  wizard.rounds[type] = Math.max(1, parseInt(value, 10) || 8);
  saveDraft();
}

function setQpTiming(field, value) {
  wizard[field] = Math.max(5, parseInt(value, 10) || (field === 'answerSecondsPerQuestion' ? 60 : 20));
  saveDraft();
}

function renderStep2() {
  const sections = wizard.selectedGames.map(type => {
    const game = availableGames.find(g => g.type === type);
    const packs = wizard.packsCache[type] || [];
    if (type === 'dixit') {
      return `<div class="admin-section"><h2>${game.label}</h2><p class="hint">Aucun paramètre : les cartes sont générées automatiquement.</p></div>`;
    }
    const activeFilters = wizard.tagFilters[type] || [];
    const tags = allTagsFor(type);
    const tagChips = tags.map(t => `<span class="pill" style="cursor:pointer;${activeFilters.includes(t) ? 'background:var(--teal);color:#063a2b' : ''}" onclick="toggleTagFilter('${type}','${t}')">${t}</span>`).join('');
    const visiblePacks = packs.filter(p => !activeFilters.length || (p.tags || []).some(t => activeFilters.includes(t)));
    const packBoxes = visiblePacks.map(p => {
      const checked = (wizard.selectedPacks[type] || []).includes(p.name) ? 'checked' : '';
      const cid = 'pk_' + type + '_' + p.name.replace(/\W/g, '_');
      return `<label class="pill" style="display:block;cursor:pointer;text-align:left">
        <input type="checkbox" id="${cid}" ${checked} onchange="togglePack('${type}','${p.name.replace(/'/g, "\\'")}')" style="margin-right:8px">${p.name}
        ${p.tags && p.tags.length ? `<span class="hint"> (${p.tags.join(', ')})</span>` : ''}
      </label>`;
    }).join('') || '<p class="hint">Aucun paquet pour ce filtre.</p>';

    const roundsInput = type === 'quizduel'
      ? `<label class="hint">Nombre de questions : <input type="text" style="width:60px;display:inline-block;margin:0 0 0 8px" value="${wizard.rounds.quizduel || 8}" onchange="setRounds('quizduel', this.value)"></label>`
      : type === 'quiplash'
      ? `<label class="hint">Réponses par joueur (minimum) : <input type="text" style="width:60px;display:inline-block;margin:0 0 0 8px" value="${wizard.rounds.quiplash || 3}" onchange="setRounds('quiplash', this.value)"></label>
         <br><label class="hint">Secondes par question (réponse) : <input type="text" style="width:60px;display:inline-block;margin:0 0 0 8px" value="${wizard.answerSecondsPerQuestion || 60}" onchange="setQpTiming('answerSecondsPerQuestion', this.value)"></label>
         <br><label class="hint">Secondes par duel (vote) : <input type="text" style="width:60px;display:inline-block;margin:0 0 0 8px" value="${wizard.voteSecondsPerQuestion || 20}" onchange="setQpTiming('voteSecondsPerQuestion', this.value)"></label>
         <p class="hint">Le temps total est calculé automatiquement selon le nombre de questions envoyées à chaque joueur.</p>`
      : '';

    return `
      <div class="admin-section">
        <h2>${game.label}</h2>
        ${tags.length ? `<p class="hint">Filtrer par thème :</p><div style="margin-bottom:8px">${tagChips}</div>` : ''}
        ${packBoxes}
        ${roundsInput}
      </div>`;
  }).join('');

  app.innerHTML = `
    <div class="logo title-font">PARTY CLASH</div>
    ${stepIndicator()}
    <div class="card wide">
      ${sections || '<p class="hint">Aucun jeu sélectionné.</p>'}
      <div class="toolbar">
        <button class="secondary" id="backBtn">⬅️ Retour</button>
        <button class="green" id="toStep3Btn">Suivant ➡️</button>
      </div>
    </div>`;
  document.getElementById('backBtn').onclick = () => { wizard.step = 1; saveDraft(); renderWizard(); };
  document.getElementById('toStep3Btn').onclick = () => {
    wizard.step = 3;
    saveDraft();
    if (!roomCode) {
      socket.emit('host:create', (res) => {
        if (res.error) return alert(res.error);
        roomCode = res.code; hostToken = res.hostToken;
        saveSession();
        renderWizard();
      });
    } else {
      renderWizard();
    }
  };
}

// --- Étape 3 : salon (code + joueurs) ---
function renderStep3() {
  if (!roomCode) {
    socket.emit('host:create', (res) => {
      if (res.error) return alert(res.error);
      roomCode = res.code; hostToken = res.hostToken;
      saveSession();
      renderStep3();
    });
    return;
  }
  const gamesSummary = wizard.selectedGames.map(t => availableGames.find(g => g.type === t)?.label).join(' · ');
  app.innerHTML = `
    <div class="logo title-font">PARTY CLASH</div>
    ${stepIndicator()}
    <div class="card wide">
      <p>Rejoignez sur votre téléphone :</p>
      <p style="font-size:1.2rem"><b>${location.origin}</b></p>
      <div class="code-box">${roomCode}</div>
      <p class="hint">Lien direct : ${location.origin}/?code=${roomCode}</p>
      <p class="hint">Playlist : ${gamesSummary}</p>
      <div class="player-grid" id="players"></div>
      <div class="toolbar">
        <button class="secondary" id="backBtn">⬅️ Modifier les jeux</button>
        <button id="startBtn" class="green">Lancer la soirée 🎉</button>
      </div>
    </div>`;
  document.getElementById('backBtn').onclick = () => { wizard.step = 2; saveDraft(); renderWizard(); };
  document.getElementById('startBtn').onclick = startParty;
  renderPlayers();
}

function renderPlayers() {
  const el = document.getElementById('players');
  if (!el) return;
  el.innerHTML = players.map(p => `<div class="player-chip">${p.name}${p.connected ? '' : ' 💤'}</div>`).join('');
  const btn = document.getElementById('startBtn');
  if (btn) {
    const minRequired = Math.max(2, ...wizard.selectedGames.map(t => (availableGames.find(g => g.type === t) || {}).minPlayers || 2));
    const ok = players.length >= minRequired && wizard.selectedGames.length > 0;
    btn.disabled = !ok;
    btn.textContent = !ok ? `Il faut au moins ${minRequired} joueurs` : `Lancer la soirée (${players.length} joueurs)`;
  }
}

function startParty() {
  const minRequired = Math.max(2, ...wizard.selectedGames.map(t => (availableGames.find(g => g.type === t) || {}).minPlayers || 2));
  if (players.length < minRequired || wizard.selectedGames.length === 0) return;
  const config = {};
  wizard.selectedGames.forEach(t => {
    config[t] = {};
    if (wizard.selectedPacks[t]) config[t].packNames = wizard.selectedPacks[t];
    if (wizard.rounds[t] && t === 'quizduel') config[t].rounds = wizard.rounds[t];
    if (wizard.rounds[t] && t === 'quiplash') config[t].answersPerPlayer = wizard.rounds[t];
    if (t === 'quiplash') {
      config[t].answerSecondsPerQuestion = wizard.answerSecondsPerQuestion || 60;
      config[t].voteSecondsPerQuestion = wizard.voteSecondsPerQuestion || 20;
    }
  });
  clearDraft();
  socket.emit('host:startParty', { code: roomCode, playlist: wizard.selectedGames, config });
  ensureEndPartyButton();
}

socket.on('room:players', (list) => { players = list; renderPlayers(); });

// ============================================================
// TRANSITIONS : fin de mini-jeu / fin de soirée
// ============================================================

function ensureEndPartyButton() {
  if (document.getElementById('endPartyBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'endPartyBtn';
  btn.textContent = '🛑 Terminer la soirée';
  btn.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:1000;background:#e63946;box-shadow:0 4px 0 #a12630;font-size:.9rem;padding:10px 16px;margin:0';
  btn.onclick = () => {
    if (confirm('Terminer la soirée maintenant et afficher le classement final ?')) hostAction('hub:end');
  };
  document.body.appendChild(btn);
}
function removeEndPartyButton() {
  const btn = document.getElementById('endPartyBtn');
  if (btn) btn.remove();
}

function scorePills(scores) {
  return scores.map(p => `<div class="pill">${p.name}: ${p.score} pts</div>`).join('');
}

socket.on('game:finished', (data) => {
  clearInterval(qpTimerInterval);
  confetti(30);
  const bestJokes = data.recap && data.recap.bestJokes;
  const jokesHtml = bestJokes && bestJokes.length ? `
    <div class="admin-section" style="margin-top:16px;text-align:left">
      <h2>🏅 Les meilleures réponses</h2>
      ${bestJokes.map((j, i) => `
        <div class="pack-row" style="display:block">
          <div class="hint">${j.prompt}</div>
          <div><b>${j.name}</b> — ${j.text} <span class="pr-count">(${j.votes} vote${j.votes > 1 ? 's' : ''})</span></div>
        </div>`).join('')}
    </div>` : '';
  app.innerHTML = `
    <div class="logo small title-font">SCORES</div>
    <div class="card wide">
      <div class="player-grid">${scorePills(data.scores)}</div>
      ${jokesHtml}
      <button id="nextGameBtn" class="yellow" style="margin-top:20px">Jeu suivant ▶</button>
    </div>`;
  document.getElementById('nextGameBtn').onclick = () => hostAction('hub:next');
  ensureEndPartyButton();
});

socket.on('party:end', ({ scores }) => {
  confetti(120);
  clearSession();
  removeEndPartyButton();
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

boot();

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
let qpTimerInterval = null;

function startQpTimer(deadline) {
  clearInterval(qpTimerInterval);
  function tick() {
    const el = document.getElementById('qpTimer');
    if (!el) { clearInterval(qpTimerInterval); return; }
    const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const m = Math.floor(remaining / 60), s = remaining % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('low', remaining <= 15);
  }
  tick();
  qpTimerInterval = setInterval(tick, 1000);
}

function progressTableHtml(table, label) {
  return `<div class="player-grid">${table.map(p => `<div class="player-chip">${p.name} — ${p.done}/${p.total} ${label}${p.done >= p.total ? ' ✅' : ''}</div>`).join('')}</div>`;
}

function renderQuiplash(data) {
  if (data.phase === 'answering') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge('Quiplash — Réponses en cours')}
      <div class="card wide">
        <p style="font-size:1.2rem">✍️ Chacun répond à ses propres duels, à son rythme, sur son téléphone…</p>
        <div class="timer-ring" id="qpTimer">--:--</div>
        <div id="qpTable">${progressTableHtml([], 'réponses')}</div>
        <button class="secondary" id="qpSkipBtn" style="margin-top:16px">⏭️ Passer au vote maintenant</button>
      </div>`;
    startQpTimer(data.deadline);
    document.getElementById('qpSkipBtn').onclick = () => hostAction('skipPhase');
  } else if (data.phase === 'voting') {
    app.innerHTML = `
      <div class="logo small title-font">PARTY CLASH</div>
      ${roundBadge(`Quiplash — Question ${data.index + 1} / ${data.total}`)}
      <div class="card wide">
        <div class="timer-ring" id="qpTimer">--:--</div>
        <div class="prompt-box">${data.prompt}</div>
        <div class="matchup">
          <div class="answer-card" data-i="0">${data.options[0].text}<div class="votes-bar" id="bar0"></div></div>
          <div class="vs">VS</div>
          <div class="answer-card" data-i="1">${data.options[1].text}<div class="votes-bar" id="bar1"></div></div>
        </div>
        <p class="hint">📱 Tout le monde vote en même temps, sauf les 2 auteurs de cette question !</p>
        <div id="qpVoteTxt" class="hint"></div>
        <button class="secondary" id="qpSkipBtn" style="margin-top:10px">⏭️ Résultats maintenant</button>
      </div>`;
    startQpTimer(data.deadline);
    document.getElementById('qpSkipBtn').onclick = () => hostAction('skipPhase');
  }
}

function updateQuiplash(data) {
  if (data.kind === 'answerProgress') {
    const wrap = document.getElementById('qpTable');
    if (wrap) wrap.innerHTML = progressTableHtml(data.table, 'réponses');
  } else if (data.kind === 'voteProgress') {
    const txt = document.getElementById('qpVoteTxt');
    if (txt) txt.textContent = `${data.received} / ${data.expected} votes reçus`;
  }
}

function revealQuiplash(data) {
  clearInterval(qpTimerInterval);
  const max = Math.max(1, ...data.results.map(r => r.votes));
  data.results.forEach((r, i) => {
    const bar = document.getElementById(`bar${i}`);
    if (bar) setTimeout(() => { bar.style.width = Math.round(r.votes / max * 100) + '%'; }, 200);
  });
  if (data.results.some(r => r.votes > 0)) confetti(30);
  const skipBtn = document.getElementById('qpSkipBtn');
  if (skipBtn) skipBtn.remove();
  const timer = document.getElementById('qpTimer');
  if (timer) timer.outerHTML = '<p class="hint">➡️ Question suivante dans un instant…</p>';
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
