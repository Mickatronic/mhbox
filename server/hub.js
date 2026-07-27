// Fonctions partagées par tous les modules de jeu pour terminer une manche
// et enchaîner sur le jeu suivant de la playlist (ou finir la soirée).
// require() de ./games fait exprès en différé (dans les fonctions) pour éviter
// une dépendance circulaire avec les modules de jeux qui importent ce fichier.

function endMiniGame(room, io) {
  room.phase = 'INTERMISSION';
  room.activeGameType = null;
  room.lastActivate = null;
  room.lastReveal = null;
  room.touch();
  const payload = { scores: room.leaderboard(), playlistIndex: room.playlistIndex, playlistLength: room.playlist.length };
  room.lastFinished = payload;
  io.to(room.code).emit('game:finished', payload);
}

function startNextGame(room, io, config = {}) {
  const { registry } = require('./games');
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
  if (!entry) { room.playlistIndex++; return startNextGame(room, io, config); }
  room.activeGameType = type;
  room.phase = 'PLAYING';
  room.touch();
  entry.mod.start(room, io, config[type] || {});
}

module.exports = { endMiniGame, startNextGame };
