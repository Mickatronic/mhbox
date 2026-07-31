// Petit helper partagé par les modules de jeu pour gérer un minuteur unique
// par salon (un seul timer actif à la fois dans gs.timer), avec transition
// automatique à l'expiration, et annulation propre en cas d'avance manuelle.

function clearTimer(gs) {
  if (gs.timer) { clearTimeout(gs.timer); gs.timer = null; }
}

function scheduleTimer(gs, ms, fn) {
  clearTimer(gs);
  gs.timer = setTimeout(fn, ms);
}

module.exports = { clearTimer, scheduleTimer };
