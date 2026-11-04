// Fonctions partagées par tous les modules de jeu pour terminer une manche
// et enchaîner sur le jeu suivant de la playlist (ou finir la soirée).
// require() de ./games fait exprès en différé (dans les fonctions) pour éviter
// une dépendance circulaire avec les modules de jeux qui importent ce fichier.

// Coupe le minuteur éventuel du mini-jeu en cours : sinon il peut se déclencher
// après la fin du jeu (ex. "Terminer la soirée" en plein tour) et relancer un écran fantôme.
function stopGameTimer(room) {
  const gs = room.gameState;
  if (gs && gs.timer) { clearTimeout(gs.timer); gs.timer = null; }
}

function endMiniGame(room, io, extra = {}) {
  stopGameTimer(room);
  room.phase = 'INTERMISSION';
  room.activeGameType = null;
  room.lastActivate = null;
  room.lastReveal = null;
  room.touch();
  const payload = { scores: room.leaderboard(), playlistIndex: room.playlistIndex, playlistLength: room.playlist.length, ...extra };
  room.lastFinished = payload;
  io.to(room.code).emit('game:finished', payload);
}

function startNextGame(room, io, config = {}) {
  const { registry } = require('./games');
  stopGameTimer(room);
  room.lastPrivateData.clear();
  room.playlistIndex++;
  room.lastFinished = null;
  if (room.playlistIndex >= room.playlist.length) {
    room.phase = 'ENDED';
    const payload = { scores: room.leaderboard() };
    room.lastPartyEnd = payload;
    room.touch();
    io.to(room.code).emit('party:end', payload);
    return;
  }
  const type = room.playlist[room.playlistIndex];
  const entry = registry[type];
  if (!entry) return startNextGame(room, io, config); // type inconnu : on passe au suivant (startNextGame incrémente déjà l'index)
  room.activeGameType = type;
  room.phase = 'PLAYING';
  room.touch();
  entry.mod.start(room, io, config[type] || {});
}

// Permet à l'hôte de terminer la soirée immédiatement, quel que soit l'état du jeu en cours.
function endPartyNow(room, io) {
  stopGameTimer(room);
  room.phase = 'ENDED';
  room.activeGameType = null;
  room.lastActivate = null;
  room.lastReveal = null;
  room.lastFinished = null;
  const payload = { scores: room.leaderboard() };
  room.lastPartyEnd = payload;
  room.touch();
  io.to(room.code).emit('party:end', payload);
}

module.exports = { endMiniGame, startNextGame, endPartyNow };
