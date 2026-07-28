# Party Clash 🎉

Plateforme de soirée jeux façon **Jackbox Party Pack**, auto-hébergeable : un écran "host"
(TV/vidéoprojecteur) + les joueurs qui répondent/votent/dessinent depuis leur téléphone.
L'hôte compose une **playlist de mini-jeux** au lancement, le score est cumulé sur toute la soirée.

## Les 6 mini-jeux

- **🗯️ Quiplash** — une file de duels : à chaque duel, 2 joueurs répondent en secret au même
  prompt, et **tous les autres joueurs connectés votent** pour la réponse la plus drôle (jamais
  les 2 auteurs du duel, qui ne peuvent pas voter sur leur propre duel). Le nombre de duels
  s'adapte automatiquement au nombre de joueurs pour garantir que **chacun réponde au moins
  3 fois** (réglable dans le parcours de lancement), avec un algorithme qui varie les
  adversaires plutôt que de toujours opposer les 2 mêmes personnes. Score : 100 points par vote
  reçu. À la fin, un récapitulatif affiche les **meilleures réponses de la soirée** (les plus
  votées) en plus du classement final.
- **🕵️ Undercover** — un mot secret commun aux civils, un mot légèrement différent pour l'imposteur
  (et éventuellement un Mr. White sans mot du tout). Indices à voix haute, votes, élimination,
  jusqu'à la victoire d'un camp.
- **⚡ Quiz Duel** — questions de culture générale, points selon justesse **et vitesse** de réponse.
- **🤳 Tête en l'air** — façon Head's Up : le nom à deviner s'affiche en grand sur le téléphone
  du joueur, qui le colle sur son front sans regarder ; les autres donnent des indices à l'oral.
  Les joueurs peuvent aussi proposer leurs propres noms en début de partie.
- **🎨 Dessine & Passe** — façon Telestrations/téléphone arabe : chacun dessine un mot, passe
  son dessin au voisin qui doit deviner, qui passe sa réponse à un autre qui la dessine, etc.
  Revue finale animée de chaque chaîne complète.
- **🃏 Conteur** — façon Dixit : cartes abstraites générées proceduralement (aucune image
  copyrightée, tout est dessiné en SVG à la volée), indice du conteur, les autres choisissent
  une carte qui correspond, puis votent pour retrouver celle du conteur. Scoring fidèle aux
  règles classiques (0/2/3 points + bonus votes sur les leurres).

Podium animé + confettis à la fin de soirée. 2 à 10 joueurs selon les jeux choisis.

## Tester le moteur de jeu

Des tests automatisés simulent un hôte + plusieurs joueurs via Socket.IO pour vérifier
que chaque mini-jeu fonctionne de bout en bout (rôles, votes, scoring, transitions) :

```bash
npm install               # installe aussi socket.io-client (devDependency)
npm start &                # lance le serveur sur le port 3000
npm test                   # joue automatiquement une partie complète de chaque mini-jeu
```

## Lancer une soirée : le parcours

1. **Connexion hôte** : `/host` demande un mot de passe (variable d'environnement
   `HOST_PASSWORD`, voir plus bas). Ça évite qu'un inconnu tombant sur ton domaine
   puisse lancer/piloter une partie à ta place.
2. **Étape 1 — Choix des jeux** : coche un ou plusieurs mini-jeux (dans l'ordre de clic
   = ordre de jeu dans la soirée).
3. **Étape 2 — Paramètres & filtres par thème** : pour chaque jeu sélectionné, choisis
   les paquets de contenu à utiliser. S'il y a plusieurs thèmes/tags disponibles (définis
   dans `/admin`), des puces de filtre apparaissent pour ne montrer que les paquets
   pertinents (ex : filtrer les questions de Quiz Duel sur "sport"). Le nombre de
   questions de Quiz Duel est aussi réglable ici.
4. **Étape 3 — Salon** : le code à 4 lettres apparaît, les joueurs rejoignent sur leur
   téléphone, tu vois la liste en direct, puis tu lances.

Un bouton **🛑 Terminer la soirée** reste accessible en permanence (coin bas-droit de l'écran
host) une fois la soirée lancée — il affiche immédiatement le classement final, à n'importe
quel moment, sans attendre la fin du jeu en cours. Pratique pour arrêter et relancer une
nouvelle soirée sans redémarrer le serveur.

**Un refresh de la page host (ou une coupure réseau) ne fait plus perdre la partie** :
l'hôte se reconnecte automatiquement à son salon (token stocké dans le navigateur) et
retrouve exactement l'écran où il en était — même chose côté joueurs, y compris si leur
téléphone se met en veille ou change de réseau en pleine partie (c'était la cause la
plus probable de "ça ne marche pas quand je teste" : Socket.IO reconnecte silencieusement
avec un nouvel identifiant réseau, et sans identité stable le joueur devenait invisible
pour le serveur). Chaque joueur a maintenant un identifiant stable indépendant de sa
connexion réseau, donc ses votes/réponses continuent d'être comptés après une coupure.

## Sécurité : mots de passe hôte et admin

Deux mots de passe séparés, tous deux via variables d'environnement Dokploy (onglet
*Environment*) :

- `HOST_PASSWORD` — pour lancer/piloter une soirée sur `/host`.
- `ADMIN_PASSWORD` — pour gérer le contenu sur `/admin`.

Si l'une n'est pas définie, une valeur par défaut `changeme123` est utilisée avec un
avertissement dans les logs du conteneur. **Change les deux avant de mettre le site en
public.**

## Lancer en local (test rapide)

```bash
npm install
npm start
# Écran host  : http://localhost:3000/host
# Manette     : http://localhost:3000/
```

## Déploiement sur Dokploy

1. Pousse ce dossier dans un repo Git (GitHub/Gitea/GitLab...).
2. Dans Dokploy : **Create Application → Docker Compose** (pas "Application" simple,
   pour bien utiliser le `docker-compose.yml` fourni).
3. Renseigne l'URL du repo, branche, et le chemin du `docker-compose.yml` à la racine.
4. Dokploy détecte le service `party-clash` exposé sur le port interne `3000`.
5. Configure ton domaine (ex : `party.hvlt.fr`) dans l'onglet **Domains**, avec le port `3000`
   — Dokploy/Traefik gère le HTTPS automatiquement.
6. Déploie. L'écran host est sur `https://party.hvlt.fr/host`, les joueurs rejoignent sur
   `https://party.hvlt.fr/`.

> ⚠️ Le jeu utilise Socket.IO en WebSocket : vérifie juste que le proxy (Traefik, géré par
> Dokploy) autorise les upgrades WebSocket — c'est le comportement par défaut.

## Interface d'administration du contenu

Accessible sur `/admin` (ex : `https://party.hvlt.fr/admin`), protégée par un mot de passe.

- **Mot de passe** : défini via la variable d'environnement `ADMIN_PASSWORD` (à ajouter dans
  Dokploy, onglet *Environment*). Si elle n'est pas définie, le mot de passe par défaut
  `changeme123` est utilisé — un avertissement s'affiche dans les logs du conteneur pour te le
  rappeler. **Change-le avant de mettre le site en public.**
- Une fois connecté, tu vois chaque mini-jeu qui a du contenu (Quiplash, Undercover, Quiz Duel,
  Tête en l'air, Dessine & Passe — Conteur n'a pas besoin de contenu, ses cartes sont générées) :
  - **Créer** un nouveau paquet (ex : "Soirée BTS SIO 2027")
  - **Éditer** un paquet existant avec un formulaire adapté au type de contenu :
    - Quiplash / Tête en l'air / Dessine & Passe : une liste de textes simples (prompts / noms / mots)
    - Undercover : des paires de mots (mot civil / mot imposteur)
    - Quiz Duel : des blocs question + 4 choix + bouton radio pour la bonne réponse
    - Chaque paquet a aussi un champ **thèmes/tags** (ex : "culture générale, sport, facile") —
      ce sont ces tags qui alimentent les filtres proposés à l'hôte à l'étape 2 du parcours de
      lancement, pour retrouver plus vite le bon paquet quand il y en a beaucoup.
  - **Supprimer** un paquet
- Les modifications écrivent directement les fichiers `.json` dans `server/content/`, donc
  elles sont immédiatement visibles côté hôte au prochain lancement de partie — pas besoin de
  redéployer.

## Ajouter facilement du contenu (questions, mots, paires…)

Le plus simple est d'utiliser l'interface `/admin` ci-dessus. Si tu préfères éditer les
fichiers à la main (ou scripter un import en masse), chaque jeu lit tous les fichiers
`.json` présents dans son dossier `server/content/<jeu>/` :

| Jeu | Dossier | Format |
|---|---|---|
| Quiplash | `server/content/quiplash/` | `{ "name": "...", "prompts": ["...", ...] }` |
| Undercover | `server/content/undercover/` | `{ "name": "...", "pairs": [["MotCivil","MotImposteur"], ...] }` |
| Quiz Duel | `server/content/quizduel/` | `{ "name": "...", "questions": [{ "q": "...", "choices": ["a","b","c","d"], "correct": 0 }] }` |
| Tête en l'air | `server/content/headsup/` | `{ "name": "...", "names": ["...", ...] }` |
| Dessine & Passe | `server/content/drawchain/` | `{ "name": "...", "words": ["...", ...] }` |
| Conteur | *(aucun fichier requis — cartes procédurales)* | — |

## Architecture

```
server/
  index.js          → serveur Express + Socket.IO, dispatch générique vers le jeu actif
  hostAuth.js        → API auth hôte (mot de passe pour lancer une soirée)
  admin.js           → API admin (auth + CRUD des paquets de contenu, avec tags)
  room.js            → Room générique (joueurs à identité stable, cache de resynchronisation)
  hub.js             → transitions entre mini-jeux (fin de manche → jeu suivant)
  content.js         → chargeur générique des paquets de contenu par type de jeu
  games/
    index.js         → registre des mini-jeux disponibles
    quiplash.js, undercover.js, quizduel.js, headsup.js, drawchain.js, dixit.js
  content/<jeu>/*.json → paquets de contenu (extensible, voir tableau ci-dessus)
public/
  host/host.js       → auth + parcours en 3 étapes + rendu de chaque mini-jeu
  player/player.js   → identité stable + reconnexion + manette mobile
  admin/admin.js     → interface d'administration du contenu (CRUD + tags)
  shared/style.css   → thème visuel "party" (couleurs vives, animations CSS)
  shared/cards.js    → générateur procédural déterministe de cartes abstraites (Conteur)
```

### Comment marche la reconnexion (host & joueurs)

- Chaque salon a un `hostToken` secret (connu seulement du navigateur de l'hôte) et
  chaque joueur a un `playerId` stable + un `playerToken` secret, stockés dans le
  `localStorage` du navigateur — pas dans l'URL, pas dans le socket.id qui change à
  chaque reconnexion réseau.
- `room.js` mémorise le dernier événement pertinent envoyé à la salle (`lastActivate`,
  `lastReveal`, `lastFinished`, `lastPartyEnd`, et le dernier `game:privateData` par
  joueur). Quand un socket se reconnecte (`host:reconnect` / `player:reconnect`), le
  serveur rejoue simplement ces événements vers CE socket — les gestionnaires déjà
  branchés côté client (`socket.on('game:activate', ...)`, etc.) réaffichent alors le
  bon écran automatiquement, sans code de synchronisation dédié à écrire dans chaque
  mini-jeu.
- Les salons inactifs depuis plus de 6h sont nettoyés automatiquement en mémoire.

Chaque module de jeu expose 3 fonctions : `start(room, io, config)`,
`onPlayerAction(room, io, socket, action, payload)`, `onHostAction(room, io, socket, action, payload)`.
Pour ajouter un 7ᵉ mini-jeu : créer `server/games/monjeu.js` avec ces 3 fonctions, l'ajouter
au registre dans `server/games/index.js`, puis ajouter le rendu correspondant dans
`host.js`/`player.js` (fonctions `renderMonjeu`/`pMonjeuActivate` suivant le même pattern
que les jeux existants).

Aucune base de données : les parties vivent en mémoire le temps de la soirée
(comme une vraie partie Jackbox). Simple à héberger, pas de volume de données à gérer.

## Idées d'évolution

- Undercover : ajouter la "dernière chance" de Mr. White (deviner le mot civil pour gagner
  seul quand il est éliminé).
- Dessine & Passe : scoring plus fin (comparaison floue mot final / mot de départ).
- Timer serveur (plutôt que client) pour un chrono robuste même si l'écran host se recharge.
- Persister les scores multi-soirées avec un petit SQLite/PostgreSQL si besoin.
