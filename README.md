# Media Catalog — Phase 1 (détection et catalogage automatique)

Scanne un ou plusieurs dossiers, détecte automatiquement les films et
séries à partir des noms de fichiers/dossiers (même logique que Jellyfin),
et va chercher affiche/synopsis sur TMDB. Interface web pour parcourir le
résultat et corriger manuellement les reconnaissances ratées.

**Ce que ce projet fait** : détection, catalogage, correspondance TMDB.
**Ce qu'il ne fait PAS (volontairement, voir la discussion)** : lire les
vidéos. C'est la Phase 2, un chantier séparé (transcodage, HLS, sous-titres...).

## Démarrage

```bash
npm install
cp .env.example .env      # renseigne DATABASE_URL, TMDB_API_KEY, LIBRARY_PATHS
npx prisma db push
npm run dev
```

Ouvre `http://localhost:3000`, clique "Lancer un scan".

## Limites connues de l'analyseur de noms de fichiers

L'analyseur (`src/lib/filenameParser.ts`) couvre les motifs les plus
courants (`S01E02`, `1x02`, année entre parenthèses...) mais **ne
prétend pas couvrir tous les cas** — les noms de fichiers très
désorganisés, les langues non latines, ou les conventions inhabituelles
donneront de mauvais résultats. C'est pour ça que chaque item a un statut
(Reconnu / À vérifier / Non reconnu) et une page de correction manuelle :
prévois de repasser sur les items "à vérifier" après chaque scan, plutôt
que de faire confiance à 100% au résultat automatique — exactement comme
il faut le faire avec Jellyfin lui-même au demeurant.

## Déploiement sur le VPS

Même principe que le portail de gestion de compte (dossier séparé, propre
process pm2, propre reverse proxy Apache si tu veux y accéder par un
sous-domaine, ex: `catalog.drak-tharon.fr`). Redemande-moi le détail
complet de ces étapes si besoin, on l'a déjà fait plusieurs fois pour le
portail.

## Authentification (comptes du portail d'abonnement)

Depuis ce changement, `media-catalog` n'est plus un outil ouvert : la
connexion utilise **les mêmes comptes que le portail d'abonnement**
(compte.drak-tharon.fr) — même email, même mot de passe. Seuls les
comptes avec un **abonnement actif** peuvent se connecter, que ce soit sur
le tableau de bord web (réservé au rôle ADMIN) ou depuis une application
cliente (bureau/mobile/TV, ouvert à tout abonné actif).

Techniquement : `media-catalog` se connecte directement à la base MySQL
du portail (`ACCOUNT_PORTAL_DATABASE_URL`) pour vérifier les identifiants
au moment de la connexion — pas d'appel HTTP entre les deux applications,
juste une requête SQL, puisqu'elles tournent sur le même serveur MySQL.

**Configuration nécessaire dans `.env`** :

```bash
ACCOUNT_PORTAL_DATABASE_URL="mysql://portal_user:motdepasse@localhost:3306/account_portal"
JWT_SECRET="$(openssl rand -hex 32)"
```

Utilise le même utilisateur MySQL que le portail (`portal_user`) — il a
déjà les droits nécessaires sur cette base.

### Deux niveaux d'accès

- **Tableau de bord web** (`/`, `/library`, corrections manuelles) —
  réservé au rôle `ADMIN` (ton propre compte, avec `role='ADMIN'` en
  base). Un abonné normal ne peut pas y accéder, même avec un abonnement
  actif — ce sont des outils d'administration, pas l'expérience client.
- **API JSON** (`/api/library`, `/api/stream/...`) — ouverte à **tout
  abonné actif**, c'est ce que consomment les applications de bureau/
  mobile/TV.

## Déploiement sur le VPS

Même principe que le portail : dossier séparé, propre process pm2. Pour
un sous-domaine public (ex: `catalog.drak-tharon.fr`), même démarche que
pour `media.drak-tharon.fr` et `compte.drak-tharon.fr` — DNS, reverse
proxy Apache, certificat SSL via certbot. Redemande-moi le détail complet
si besoin, on l'a déjà fait plusieurs fois dans ce projet.

## Suite (Phase 2, démarrée)

**Transcodage ajouté** : chaque film/épisode est vérifié (`ffprobe`) au
chargement de sa page. S'il est déjà dans un format lisible nativement
(H.264/AAC), lecture directe comme avant. Sinon, un transcodage HLS à la
volée démarre automatiquement (`ffmpeg`), et le lecteur bascule dessus.

**Pré-requis obligatoire sur le VPS** :

```bash
sudo apt update && sudo apt install ffmpeg
npm install   # récupère hls.js, ajouté aux dépendances
```

**Limites connues de cette première version**, pour que tu saches à quoi
t'attendre :

- **Pas de vrai "saut" dans la barre de lecture** — le transcodage part
  du début du fichier et avance progressivement. Avancer plus loin que ce
  qui a déjà été transcodé bloque la lecture le temps que ça rattrape. Un
  vrai système de saut (redémarrer ffmpeg à la position visée) est un
  raffinement pour une prochaine passe, pas encore fait.
- **Aucune accélération matérielle** — tout se fait en logiciel (CPU). Sur
  un VPS modeste, ça peut ne pas suivre en temps réel pour de la vidéo
  1080p+, surtout si plusieurs lectures tournent en même temps. À
  surveiller avec `htop` pendant les premiers essais.
- **Une session ffmpeg par item, partagée entre spectateurs** — si deux
  personnes regardent le même film en même temps, elles partagent le même
  flux transcodé (un saut de l'une affecte l'autre). Pas un souci pour un
  usage familial, à revoir si plusieurs profils regardent des choses
  différentes simultanément.
- **La page de détail d'une série interroge `ffprobe` pour CHAQUE
  épisode** au chargement — peut ralentir l'affichage pour une série avec
  beaucoup d'épisodes. À optimiser plus tard (probablement en ne
  vérifiant qu'au moment du clic sur "Regarder", pas à l'avance).

**⚠️ Sécurité, toujours d'actualité** : cet outil expose du contenu vidéo
brut (et maintenant transcodé) sans authentification. Ne l'expose
**jamais** publiquement. Continue à y accéder uniquement via le tunnel SSH
(`ssh -L 3001:localhost:3001 ...`).


