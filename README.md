# Party Clash 🎉

Plateforme de soirée jeux façon **Jackbox Party Pack**, auto-hébergeable : un écran "host"
(TV/vidéoprojecteur) + les joueurs qui répondent/votent/dessinent depuis leur téléphone.
L'hôte compose une **playlist de mini-jeux** au lancement, le score est cumulé sur toute la soirée.

## Les 8 mini-jeux

- **🗯️ Quiplash** — se joue en 2 temps :
  1. **Réponses (en parallèle)** : chaque joueur reçoit en privé son propre lot de prompts
     (2-3 en général) et y répond **à son rythme**, dans l'ordre qu'il veut, sans savoir avec
     qui il est en duel. Le vidéoprojecteur n'affiche qu'un tableau "qui a répondu à combien
     de questions" — jamais les prompts ni les réponses.
  2. **Votes (synchrones)** : une fois que tout le monde a fini (ou que le chrono expire), le
     jeu enchaîne les duels **un par un, affichés au vidéoprojecteur** (prompt + les 2 réponses).
     Tous les joueurs votent **en même temps** pour celle qu'ils trouvent la plus drôle — sauf
     les 2 auteurs de cette question précise, qui attendent. Dès que tout le monde a voté (ou
     que le chrono de la question expire), les résultats s'affichent et on enchaîne
     automatiquement sur la question suivante.

  Chrono configurable dans le parcours de lancement (secondes par question, séparément pour
  les réponses et pour les votes) — la durée totale de la phase de réponses est calculée
  automatiquement selon le nombre de questions envoyées à chaque joueur (défaut : 1 min ×
  nombre de questions). Le nombre de duels s'adapte au nombre de joueurs pour garantir que
  **chacun réponde au moins 3 fois** (réglable), en variant les adversaires. Score : 100
  points par vote reçu. Un bouton "Passer maintenant" côté hôte permet de forcer la suite
  sans attendre le chrono. À la fin, un récapitulatif affiche les **meilleures réponses de la
  soirée** (les plus votées) en plus du classement final.
- **🕵️ Undercover** — un mot secret commun aux civils, un mot légèrement différent pour l'imposteur
  (et éventuellement un Mr. White sans mot du tout). Indices à voix haute, votes, élimination,
  jusqu'à la victoire d'un camp. Chrono configurable pour les indices et le vote.
- **⚡ Quiz Duel** — façon "Trivial Pursuit" par thèmes, en 5 temps qui bouclent :
  1. **Choix des thèmes préférés** (optionnel) : chaque joueur (ou équipe) choisit X thèmes
     parmi ceux disponibles (X configurable ; **X=0 = tous les thèmes sont automatiquement en
     jeu**, cette étape est alors sautée). Le bassin de thèmes réellement joués est l'union des
     choix de tout le monde.
  2. **Désignation** d'un joueur (ou d'une équipe) qui propose 3 thèmes parmi le bassin —
     méthode de désignation configurable : au hasard, chacun son tour, le plus faible, ou le
     plus fort.
  3. Le joueur/l'équipe désigné(e) **choisit 1 des 3 thèmes proposés**, puis **3 questions** de
     ce thème sont posées : tout le monde répond, la question et les 4 réponses sont affichées
     au vidéoprojecteur et sur les téléphones. Points selon justesse **et vitesse**.
  4. **Résultats de la manche** affichés sur le vidéoprojecteur et sur l'écran des joueurs
     (classement général, + classement par équipe en mode équipe).
  5. On reboucle à l'étape 2 pour la manche suivante, jusqu'au nombre de manches configuré
     (par défaut : une par joueur).

  **Mode équipe** activable/paramétrable au lancement (nombre d'équipes) : les équipes sont
  formées automatiquement (avec bouton pour remélanger), tout le monde répond individuellement
  aux questions mais les points s'additionnent aussi au score de l'équipe, et c'est l'équipe
  (pas un joueur isolé) qui est désignée pour choisir le thème.

  Chronos configurables séparément pour le choix des thèmes préférés, la désignation du thème,
  et chaque question. 32 thèmes fournis (cinéma, histoire, sport, sciences, mythologie, jeux
  vidéo, etc.), chacun avec quelques questions de départ à compléter via `/admin` — le format
  est inchangé, une IA peut générer un lot de questions à coller directement dans le paquet
  JSON du thème.
  Chrono configurable par question.
- **🤳 Tête en l'air** — façon Head's Up : le nom à deviner s'affiche en grand sur le téléphone
  du joueur, qui le colle sur son front sans regarder ; les autres donnent des indices à l'oral.
  L'ajout de noms personnalisés par les joueurs est **activable/désactivable** dans les
  paramètres. Chrono par tour configurable.
- **⏱️ Time's Up** — par équipes (2 équipes formées automatiquement). Même paquet de mots
  deviné sur **3 manches successives** (activables/désactivables séparément) : manche 1 on
  décrit librement, manche 2 un seul mot autorisé, manche 3 mime uniquement en silence. Chaque
  équipe joue des tours chronométrés (chrono configurable) jusqu'à épuisement du paquet, puis
  le paquet est repioché pour la manche suivante. Deux modes de manette configurables :
  - **Chacun son tour** : le joueur dont c'est le tour utilise son propre téléphone déjà connecté.
  - **Manette unique** : un seul téléphone (en plus du vidéoprojecteur) sert de manette pour
    toute la partie, peu importe l'équipe ou la personne physiquement en train de décrire — les
    joueurs se le passent à la main autour de la table.

  L'ajout de noms personnalisés par les joueurs est également activable/désactivable. Réutilise
  la même banque de contenu que Tête en l'air (gérable depuis `/admin` sous "Tête en l'air").
- **🎨 Dessine & Passe** — façon Telestrations/téléphone arabe : chacun dessine un mot, passe
  son dessin au voisin qui doit deviner, qui passe sa réponse à un autre qui la dessine, etc.
  Revue finale animée de chaque chaîne complète. Chrono configurable (dessin / devinette).
- **🃏 Conteur** — façon Dixit : cartes abstraites générées proceduralement (aucune image
  copyrightée, tout est dessiné en SVG à la volée), indice du conteur, les autres choisissent
  une carte qui correspond, puis votent pour retrouver celle du conteur. Scoring fidèle aux
  règles classiques (0/2/3 points + bonus votes sur les leurres). Chrono configurable pour
  chacune des 3 phases (indice / choix / vote).
- **🍮 Blanc-Manger Coco** — une carte noire à trou est affichée, chaque joueur (sauf le juge du
  tour) complète le trou avec une carte blanche depuis sa main ; le juge découvre les
  combinaisons anonymement et choisit la plus drôle, qui remporte la manche. Le rôle de juge
  tourne à chaque manche. Chrono configurable (temps pour choisir sa carte / temps du juge).

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
3. **Étape 2 — Paramètres & filtres par tag** : pour chaque jeu sélectionné, choisis
   les paquets de contenu à utiliser (des boutons "Tout cocher"/"Tout décocher" permettent
   d'aller vite). S'il y a plusieurs tags disponibles (définis dans `/admin`), des puces de
   filtre apparaissent pour ne montrer que les paquets pertinents. Pour Quiz Duel, chaque
   paquet coché devient un **thème** jouable au sens du jeu (voir ci-dessus) ; le nombre de
   manches et tous les autres réglages (thèmes par joueur, méthode de désignation, chronos,
   mode équipe) sont aussi ici.
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

**Code + pseudo dans l'URL du joueur** : après avoir rejoint, l'URL du navigateur du joueur
se met à jour automatiquement en `?code=XXXX&name=Pseudo`. Un lien du type
`https://party.hvlt.fr/?code=XXXX&name=Alice` permet de rejoindre directement sans ressaisir
le code ni le pseudo (pratique pour un lien partagé ou un favori) — ce n'est pas un mécanisme
sécurisé (n'importe qui avec ce lien peut se faire passer pour "Alice"), mais ce n'est pas
l'objectif ici : la reconnexion fiable en cours de partie repose elle sur le token privé
stocké dans le navigateur, pas sur l'URL.

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
  Tête en l'air (partagé avec Time's Up), Dessine & Passe, Blanc-Manger Coco — Conteur n'a pas
  besoin de contenu, ses cartes sont générées) :
  - **Créer** un nouveau paquet (ex : "Soirée BTS SIO 2027")
  - **Éditer** un paquet existant avec un formulaire adapté au type de contenu :
    - Quiplash / Tête en l'air / Dessine & Passe : une liste de textes simples (prompts / noms / mots)
    - Undercover : des paires de mots (mot civil / mot imposteur)
    - Quiz Duel : des blocs question + 4 choix + bouton radio pour la bonne réponse
    - Blanc-Manger Coco : deux listes séparées (cartes noires à trou, cartes blanches)
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
| Quiz Duel | `server/content/quizduel/` | `{ "name": "...", "questions": [{ "q": "...", "choices": ["a","b","c","d"], "correct": 0 }] }` — **chaque fichier = un thème jouable**, 32 fournis d'origine |
| Tête en l'air | `server/content/headsup/` | `{ "name": "...", "names": ["...", ...] }` |
| Time's Up | *(partage le dossier `headsup/` ci-dessus)* | — |
| Dessine & Passe | `server/content/drawchain/` | `{ "name": "...", "words": ["...", ...] }` |
| Conteur | *(aucun fichier requis — cartes procédurales)* | — |
| Blanc-Manger Coco | `server/content/blancmanger/` | `{ "name": "...", "blackCards": ["... ______ ...", ...], "whiteCards": ["...", ...] }` |

## Architecture

```
server/
  index.js          → serveur Express + Socket.IO, dispatch générique vers le jeu actif
  hostAuth.js        → API auth hôte (mot de passe pour lancer une soirée)
  admin.js           → API admin (auth + CRUD des paquets de contenu, avec tags)
  room.js            → Room générique (joueurs à identité stable, cache de resynchronisation)
  hub.js             → transitions entre mini-jeux (fin de manche → jeu suivant)
  content.js         → chargeur générique des paquets de contenu par type de jeu
  timerUtil.js       → petit helper de minuteur partagé par les modules de jeu
  games/
    index.js         → registre des mini-jeux disponibles
    quiplash.js, undercover.js, quizduel.js, headsup.js, timesup.js,
    drawchain.js, dixit.js, blancmanger.js
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
