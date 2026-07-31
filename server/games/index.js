const quiplash = require('./quiplash');
const undercover = require('./undercover');
const quizduel = require('./quizduel');
const headsup = require('./headsup');
const drawchain = require('./drawchain');
const dixit = require('./dixit');
const timesup = require('./timesup');
const blancmanger = require('./blancmanger');

// Chaque module doit exposer : start(room, io, config), onPlayerAction(room, io, playerId, action, payload), onHostAction(room, io, socket, action, payload)
const registry = {
  quiplash:    { label: '🗯️ Quiplash',       desc: 'Duels de réponses drôles jugés par tous les autres, plusieurs manches par joueur.', minPlayers: 3, mod: quiplash },
  undercover:  { label: '🕵️ Undercover',      desc: 'Un mot secret, un imposteur, des indices à l\'oral, un vote.', minPlayers: 3, mod: undercover },
  quizduel:    { label: '⚡ Quiz Duel',       desc: 'Questions de culture générale, bonus de vitesse.', minPlayers: 1, mod: quizduel },
  headsup:     { label: '🤳 Tête en l\'air',   desc: 'Le mot est sur TON téléphone, sur ton front, devine à l\'oral.', minPlayers: 3, mod: headsup },
  timesup:     { label: '⏱️ Time\'s Up',      desc: 'Par équipes, 3 manches (décris, un mot, mime), même paquet de mots.', minPlayers: 4, mod: timesup },
  drawchain:   { label: '🎨 Dessine & Passe', desc: 'Dessine, fais deviner, ça tourne à la table façon téléphone arabe.', minPlayers: 3, mod: drawchain },
  dixit:       { label: '🃏 Conteur',         desc: 'Cartes abstraites, indice mystérieux, retrouve la bonne carte.', minPlayers: 3, mod: dixit },
  blancmanger: { label: '🍮 Blanc-Manger Coco', desc: 'Une carte noire à compléter, un juge choisit la carte la plus drôle.', minPlayers: 3, mod: blancmanger },
};

module.exports = { registry };
