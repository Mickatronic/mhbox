const quiplash = require('./quiplash');
const undercover = require('./undercover');
const quizduel = require('./quizduel');
const headsup = require('./headsup');
const drawchain = require('./drawchain');
const dixit = require('./dixit');

// Chaque module doit exposer : start(room, io, config), onPlayerAction(room, io, socket, action, payload), onHostAction(room, io, socket, action, payload)
const registry = {
  quiplash:  { label: '🗯️ Quiplash',      desc: 'Réponds aux prompts les plus drôles, fais voter la salle.', minPlayers: 2, mod: quiplash },
  undercover:{ label: '🕵️ Undercover',     desc: 'Un mot secret, un imposteur, des indices à l\'oral, un vote.', minPlayers: 3, mod: undercover },
  quizduel:  { label: '⚡ Quiz Duel',      desc: 'Questions de culture générale, bonus de vitesse.', minPlayers: 1, mod: quizduel },
  headsup:   { label: '🤳 Tête en l\'air',  desc: 'Le mot est sur TON téléphone, sur ton front, devine à l\'oral.', minPlayers: 3, mod: headsup },
  drawchain: { label: '🎨 Dessine & Passe',desc: 'Dessine, fais deviner, ça tourne à la table façon téléphone arabe.', minPlayers: 3, mod: drawchain },
  dixit:     { label: '🃏 Conteur',        desc: 'Cartes abstraites, indice mystérieux, retrouve la bonne carte.', minPlayers: 3, mod: dixit },
};

module.exports = { registry };
