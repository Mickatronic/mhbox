const app = document.getElementById('app');
let overview = [];

function api(path, opts) {
  return fetch('/api/admin' + path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts })
    .then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Erreur serveur');
      return data;
    });
}

function shell(inner) {
  app.innerHTML = `
    <div class="logo title-font" style="font-size:2.6rem">PARTY CLASH — ADMIN</div>
    <div class="card admin-app">${inner}</div>`;
}

// ============================================================
// AUTH
// ============================================================
function boot() {
  api('/session').then(({ authenticated }) => authenticated ? loadDashboard() : renderLogin());
}

function renderLogin(error) {
  shell(`
    <p>Connecte-toi pour gérer le contenu des mini-jeux.</p>
    <input type="password" id="pwd" placeholder="Mot de passe admin">
    <button id="loginBtn" class="green">Se connecter</button>
    ${error ? `<p class="error-msg">${error}</p>` : ''}
  `);
  document.getElementById('loginBtn').onclick = () => {
    const password = document.getElementById('pwd').value;
    api('/login', { method: 'POST', body: JSON.stringify({ password }) })
      .then(loadDashboard)
      .catch(e => renderLogin(e.message));
  };
  document.getElementById('pwd').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });
}

function logout() {
  api('/logout', { method: 'POST' }).then(renderLogin);
}

// ============================================================
// DASHBOARD
// ============================================================
function loadDashboard() {
  api('/content').then(data => { overview = data; renderDashboard(); });
}

function renderDashboard() {
  const sections = overview.map(section => `
    <div class="admin-section">
      <h2>${section.label}</h2>
      ${section.packs.map(p => `
        <div class="pack-row">
          <div><span class="pr-name">${p.name}</span><span class="pr-count">(${p.count} élément${p.count > 1 ? 's' : ''})</span>${p.tags && p.tags.length ? `<div class="hint">${p.tags.join(', ')}</div>` : ''}</div>
          <div class="pr-actions">
            <button class="secondary" onclick="openEditor('${section.gameType}','${p.file}')">✏️ Éditer</button>
            <button class="del" onclick="deletePack('${section.gameType}','${p.file}')" style="background:#e63946;box-shadow:0 4px 0 #a12630">🗑️</button>
          </div>
        </div>`).join('') || '<p class="hint">Aucun paquet pour l\'instant.</p>'}
      <button class="yellow" onclick="createPack('${section.gameType}')">➕ Nouveau paquet</button>
    </div>`).join('');

  shell(`
    ${sections}
    <button class="secondary" onclick="logout()" style="margin-top:10px">Se déconnecter</button>
  `);
}

function createPack(gameType) {
  const name = prompt('Nom du nouveau paquet :');
  if (!name) return;
  api('/content/' + gameType, { method: 'POST', body: JSON.stringify({ name }) })
    .then(res => openEditor(gameType, res.file))
    .catch(e => alert(e.message));
}

function deletePack(gameType, file) {
  if (!confirm('Supprimer ce paquet définitivement ?')) return;
  api(`/content/${gameType}/${file}`, { method: 'DELETE' }).then(loadDashboard).catch(e => alert(e.message));
}

// ============================================================
// ÉDITEUR (générique selon le type d'items)
// ============================================================
function openEditor(gameType, file) {
  const section = overview.find(s => s.gameType === gameType);
  api(`/content/${gameType}/${file}`).then(({ name, tags, items }) => renderEditor(gameType, file, section.itemType, name, tags || [], items));
}

function renderEditor(gameType, file, itemType, name, tags, items) {
  shell(`
    <span class="back-link" onclick="loadDashboard()">⬅️ Retour</span>
    <label class="hint">Nom du paquet</label>
    <input type="text" id="packName" value="${escapeAttr(name)}">
    <label class="hint">Thèmes / tags (séparés par des virgules — utilisés comme filtres côté hôte)</label>
    <input type="text" id="packTags" placeholder="ex: culture générale, sport, facile" value="${escapeAttr(tags.join(', '))}">
    <div id="itemsWrap"></div>
    <div class="toolbar">
      <button class="yellow" id="addItemBtn">➕ Ajouter</button>
      <button class="green" id="saveBtn">💾 Enregistrer</button>
    </div>
    <p class="hint" id="saveMsg"></p>
  `);

  const wrap = document.getElementById('itemsWrap');

  function addTextRow(value) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<input type="text" value="${escapeAttr(value || '')}"><button class="del">✕</button>`;
    row.querySelector('.del').onclick = () => row.remove();
    wrap.appendChild(row);
  }

  function addPairRow(a, b) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<input type="text" placeholder="Mot civil" value="${escapeAttr(a || '')}">
                      <input type="text" placeholder="Mot imposteur" value="${escapeAttr(b || '')}">
                      <button class="del">✕</button>`;
    row.querySelector('.del').onclick = () => row.remove();
    wrap.appendChild(row);
  }

  function addQuizBlock(q) {
    q = q || { q: '', choices: ['', '', '', ''], correct: 0 };
    const block = document.createElement('div');
    block.className = 'quiz-block';
    const rid = 'r' + Math.random().toString(36).slice(2);
    block.innerHTML = `
      <div class="qb-top"><b>Question</b><button class="del">✕</button></div>
      <input type="text" class="qb-question" placeholder="Intitulé de la question" value="${escapeAttr(q.q)}">
      ${[0, 1, 2, 3].map(i => `
        <div class="qb-choice">
          <input type="radio" name="${rid}" ${q.correct === i ? 'checked' : ''} value="${i}">
          <input type="text" class="qb-choice-input" placeholder="Choix ${i + 1}" value="${escapeAttr(q.choices[i] || '')}">
        </div>`).join('')}
      <p class="hint">Coche le bouton radio du bon choix.</p>
    `;
    block.querySelector('.del').onclick = () => block.remove();
    wrap.appendChild(block);
  }

  if (itemType === 'text') {
    items.forEach(v => addTextRow(v));
    if (!items.length) addTextRow('');
    document.getElementById('addItemBtn').onclick = () => addTextRow('');
  } else if (itemType === 'pair') {
    items.forEach(p => addPairRow(p[0], p[1]));
    if (!items.length) addPairRow('', '');
    document.getElementById('addItemBtn').onclick = () => addPairRow('', '');
  } else if (itemType === 'quiz') {
    items.forEach(q => addQuizBlock(q));
    if (!items.length) addQuizBlock();
    document.getElementById('addItemBtn').onclick = () => addQuizBlock();
  }

  document.getElementById('saveBtn').onclick = () => {
    const name2 = document.getElementById('packName').value.trim();
    const tags2 = document.getElementById('packTags').value.split(',').map(t => t.trim()).filter(Boolean);
    let newItems = [];
    if (itemType === 'text') {
      newItems = [...wrap.children].map(r => r.querySelector('input').value.trim()).filter(Boolean);
    } else if (itemType === 'pair') {
      newItems = [...wrap.children].map(r => {
        const inputs = r.querySelectorAll('input[type=text]');
        return [inputs[0].value.trim(), inputs[1].value.trim()];
      }).filter(p => p[0] && p[1]);
    } else if (itemType === 'quiz') {
      newItems = [...wrap.children].map(block => {
        const qText = block.querySelector('.qb-question').value.trim();
        const choiceInputs = [...block.querySelectorAll('.qb-choice-input')];
        const radios = [...block.querySelectorAll('input[type=radio]')];
        const correct = radios.findIndex(r => r.checked);
        return { q: qText, choices: choiceInputs.map(c => c.value.trim()), correct: correct >= 0 ? correct : 0 };
      }).filter(q => q.q && q.choices.every(Boolean));
    }

    api(`/content/${gameType}/${file}`, { method: 'PUT', body: JSON.stringify({ name: name2, tags: tags2, items: newItems }) })
      .then(() => { document.getElementById('saveMsg').textContent = '✅ Enregistré !'; loadDashboardSilently(); })
      .catch(e => { document.getElementById('saveMsg').textContent = '❌ ' + e.message; });
  };
}

function loadDashboardSilently() {
  api('/content').then(data => { overview = data; });
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

boot();
