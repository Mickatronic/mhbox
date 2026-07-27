const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const HOST_PASSWORD = process.env.HOST_PASSWORD || 'changeme123';
if (!process.env.HOST_PASSWORD) {
  console.warn('⚠️  HOST_PASSWORD non défini : mot de passe hôte par défaut "changeme123" utilisé. Définis la variable d\'environnement HOST_PASSWORD sur Dokploy pour empêcher n\'importe qui de lancer une soirée.');
}

const COOKIE_NAME = 'party_host_session';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
const sessions = new Map(); // token -> expiry

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > -1) cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

function isValidToken(token) {
  const expiry = token && sessions.get(token);
  return !!(expiry && expiry > Date.now());
}

// Utilisé par le serveur Socket.IO pour vérifier l'auth au moment de la connexion
function isAuthenticatedFromCookieHeader(cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE_NAME];
  return isValidToken(token);
}

router.use(express.json());

router.get('/session', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  res.json({ authenticated: isValidToken(token) });
});

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== HOST_PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect.' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_DURATION_MS);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DURATION_MS / 1000}; SameSite=Lax`);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

module.exports = { router, isAuthenticatedFromCookieHeader };
