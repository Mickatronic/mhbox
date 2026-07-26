const fs = require('fs');
const path = require('path');

/**
 * Charge tous les fichiers .json présents dans server/content/<gameType>/
 * Pour ajouter du contenu à un jeu : dépose un nouveau fichier .json dans
 * le dossier correspondant, aucune modification de code n'est nécessaire.
 */
function loadPacks(gameType) {
  const dir = path.join(__dirname, 'content', gameType);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    return { file: f, name: data.name || f, data };
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr, n) {
  return shuffle(arr).slice(0, n);
}

module.exports = { loadPacks, shuffle, pick };
