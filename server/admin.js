const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { registry } = require('./games');

const router = express.Router();

// --- Schéma de contenu par type de jeu (Conteur n'a pas de contenu, cartes procédurales) ---
// Time's Up réutilise le contenu de "headsup" (même banque de noms), donc pas d'entrée séparée ici.
const SCHEMAS = {
  quiplash:    { field: 'prompts',   itemType: 'text' },
  undercover:  { field: 'pairs',     itemType: 'pair' },
  quizduel:    { field: 'questions', itemType: 'quiz' },
  headsup:     { field: 'names',     itemType: 'text' },
  drawchain:   { field: 'words',     itemType: 'text' },
  blancmanger: { itemType: 'blancmanger', fields: ['blackCards', 'whiteCards'] }
};

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD non défini : mot de passe admin par défaut "changeme123" utilisé. Définis la variable d\'environnement ADMIN_PASSWORD sur Dokploy pour sécuriser /admin.');
}

const COOKIE_NAME = 'party_admin_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12h
const sessions = new Map(); // token -> expiry

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > -1) cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

function requireAdmin(req, res, next) {
  const token = parseCookies(req)[COOKIE_NAME];
  const expiry = token && sessions.get(token);
  if (expiry && expiry > Date.now()) return next();
  res.status(401).json({ error: 'Non authentifié.' });
}

router.use(express.json());

router.get('/session', (req, res) => {
  const token = parseCookies(req)[COOKIE_NAME];
  const expiry = token && sessions.get(token);
  res.json({ authenticated: !!(expiry && expiry > Date.now()) });
});

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect.' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_DURATION_MS);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DURATION_MS / 1000}; SameSite=Lax`);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

router.use(requireAdmin);

function contentDir(gameType) { return path.join(__dirname, 'content', gameType); }

function slugify(name) {
  return (name || 'paquet').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'paquet';
}

function safeFile(gameType, file) {
  // empêche toute tentative de traversée de répertoire
  const base = path.basename(file || '');
  if (!/^[a-z0-9-]+\.json$/.test(base)) return null;
  const full = path.join(contentDir(gameType), base);
  if (!full.startsWith(contentDir(gameType))) return null;
  return full;
}

function itemCount(schema, data) {
  if (schema.fields) return schema.fields.reduce((sum, f) => sum + (data[f] || []).length, 0);
  return (data[schema.field] || []).length;
}

router.get('/content', (req, res) => {
  const out = [];
  Object.keys(SCHEMAS).forEach(gameType => {
    const dir = contentDir(gameType);
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const schema = SCHEMAS[gameType];
    const label = (registry[gameType] && registry[gameType].label) || gameType;
    const packs = files.map(f => {
      let data;
      try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { data = { name: f }; }
      return { file: f, name: data.name || f, count: itemCount(schema, data), tags: data.tags || [] };
    });
    out.push({ gameType, label, field: schema.field, itemType: schema.itemType, fields: schema.fields, packs });
  });
  res.json(out);
});

router.get('/content/:gameType/:file', (req, res) => {
  const schema = SCHEMAS[req.params.gameType];
  if (!schema) return res.status(404).json({ error: 'Type de jeu inconnu.' });
  const full = safeFile(req.params.gameType, req.params.file);
  if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'Paquet introuvable.' });
  const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
  if (schema.fields) {
    const out = { name: data.name || req.params.file, tags: data.tags || [] };
    schema.fields.forEach(f => out[f] = data[f] || []);
    return res.json(out);
  }
  res.json({ name: data.name || req.params.file, tags: data.tags || [], items: data[schema.field] || [] });
});

router.post('/content/:gameType', (req, res) => {
  const schema = SCHEMAS[req.params.gameType];
  if (!schema) return res.status(404).json({ error: 'Type de jeu inconnu.' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom de paquet requis.' });
  const dir = contentDir(req.params.gameType);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let base = slugify(name), file = base + '.json', i = 2;
  while (fs.existsSync(path.join(dir, file))) { file = `${base}-${i}.json`; i++; }
  let data;
  if (schema.fields) {
    data = { name, tags: [] };
    schema.fields.forEach(f => data[f] = []);
  } else {
    data = { name, tags: [], [schema.field]: [] };
  }
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2), 'utf-8');
  res.json({ file, name, tags: [], ...(schema.fields ? Object.fromEntries(schema.fields.map(f => [f, []])) : { items: [] }) });
});

router.put('/content/:gameType/:file', (req, res) => {
  const schema = SCHEMAS[req.params.gameType];
  if (!schema) return res.status(404).json({ error: 'Type de jeu inconnu.' });
  const full = safeFile(req.params.gameType, req.params.file);
  if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'Paquet introuvable.' });

  const name = (req.body.name || '').trim() || req.params.file;
  const tags = Array.isArray(req.body.tags) ? [...new Set(req.body.tags.map(t => String(t || '').trim().toLowerCase()).filter(Boolean))] : [];

  if (schema.fields) {
    const data = { name, tags };
    schema.fields.forEach(f => {
      const raw = Array.isArray(req.body[f]) ? req.body[f] : [];
      data[f] = raw.map(s => String(s || '').trim()).filter(Boolean);
    });
    fs.writeFileSync(full, JSON.stringify(data, null, 2), 'utf-8');
    return res.json({ file: req.params.file, name, tags, ...Object.fromEntries(schema.fields.map(f => [f, data[f]])) });
  }

  let items = Array.isArray(req.body.items) ? req.body.items : [];

  if (schema.itemType === 'text') {
    items = items.map(s => String(s || '').trim()).filter(Boolean);
  } else if (schema.itemType === 'pair') {
    items = items
      .map(p => Array.isArray(p) ? [String(p[0] || '').trim(), String(p[1] || '').trim()] : null)
      .filter(p => p && p[0] && p[1]);
  } else if (schema.itemType === 'quiz') {
    items = items
      .map(q => ({
        q: String(q.q || '').trim(),
        choices: Array.isArray(q.choices) ? q.choices.slice(0, 4).map(c => String(c || '').trim()) : [],
        correct: Number.isInteger(q.correct) ? q.correct : 0
      }))
      .filter(q => q.q && q.choices.length === 4 && q.choices.every(Boolean));
  }

  const data = { name, tags, [schema.field]: items };
  fs.writeFileSync(full, JSON.stringify(data, null, 2), 'utf-8');
  res.json({ file: req.params.file, name, tags, items });
});

router.delete('/content/:gameType/:file', (req, res) => {
  const schema = SCHEMAS[req.params.gameType];
  if (!schema) return res.status(404).json({ error: 'Type de jeu inconnu.' });
  const full = safeFile(req.params.gameType, req.params.file);
  if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'Paquet introuvable.' });
  fs.unlinkSync(full);
  res.json({ ok: true });
});

module.exports = router;
