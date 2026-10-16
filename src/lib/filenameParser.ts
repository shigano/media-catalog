export type ParsedMovie = {
  type: 'MOVIE';
  title: string;
  year: number | null;
  tmdbIdHint: number | null;
};

export type ParsedEpisode = {
  type: 'SERIES';
  title: string;
  year: number | null;
  seasonNumber: number;
  episodeNumber: number;
  tmdbIdHint: number | null;
};

export type ParsedFile = ParsedMovie | ParsedEpisode;

// Mots-clés de qualité/source/codec à retirer du titre s'ils s'y sont
// glissés (ex: pas d'année détectée pour couper proprement avant eux).
const NOISE_TOKENS = [
  '1080p', '720p', '2160p', '480p', '4k', 'uhd',
  'bluray', 'blu-ray', 'bdrip', 'brrip', 'webrip', 'web-dl', 'webdl', 'hdtv',
  'dvdrip', 'x264', 'x265', 'h264', 'h265', 'hevc', 'xvid', 'divx', 'aac', 'ac3', 'dts',
  'remux', 'proper', 'repack', 'extended', 'unrated', 'multi', 'vostfr',
  'french', 'truefrench', 'vf', 'vo', 'vff', 'vf2', 'subfrench',
  'hdr', 'hdr10', 'hdr10plus', 'dolbyvision', 'vision', 'dv', '10bit', '8bit',
  'ddp', 'ddp5', 'ddplus', 'atmos', 'eac3', 'flac', 'mp3',
  'nf', 'netflix', 'amzn', 'amazon', 'dsnp', 'disney', 'hmax', 'max', 'atvp',
  'web', 'hdlight', 'light', 'imax', 'criterion', 'complete',
];

const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.webm', '.wmv',
]);

export function isVideoFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

export function extractTmdbIdHint(raw: string): number | null {
  const patterns = [
    /[\[{(]\s*tmdb(?:id)?\s*[-:=]\s*(\d+)\s*[\]})]/i,
    /\btmdb(?:id)?\s*[-:=]\s*(\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function stripProviderIds(raw: string): string {
  return raw
    .replace(/[\[{(]\s*tmdb(?:id)?\s*[-:=]\s*\d+\s*[\]})]/gi, ' ')
    .replace(/\btmdb(?:id)?\s*[-:=]\s*\d+\b/gi, ' ')
    .replace(/[\[{(]\s*imdb(?:id)?\s*[-:=]\s*tt\d+\s*[\]})]/gi, ' ');
}

function cleanTitle(raw: string): string {
  // V3.13 — retirer les tags de release AVANT de convertir les points en
  // espaces. Certains noms commencent par un site entre crochets, ex.
  // "[ Torrent911.ws ] Scream II 1997...". Le pré-nettoyage garantit que
  // le domaine complet disparaît avant toute autre heuristique de titre.
  let title = stripProviderIds(raw)
    .replace(/^\s*\[[^\]]+\]\s*/, ' ')
    .replace(/^\s*(?:www\.)?(?:torrent\d*|oxtorrent|yggtorrent|zone[-_. ]?telechargement)(?:\.[a-z0-9-]+)+(?:\s*[-–:]\s*|\s+)/i, ' ')
    // Échappements Unicode mal encodés rencontrés sur certains fichiers
    // (artefact d'un outil de téléchargement/renommage) — ex: "Nobody
    // %u2019s Fool" au lieu de "Nobody's Fool".
    .replace(/%u2019|%u2018/gi, "'")
    .replace(/%u201c|%u201d/gi, '"')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Tiret isolé en tête (reste typiquement après avoir retiré une année
  // placée en tête du nom, ex: "2008 - Titre" → "- Titre" une fois "2008"
  // extrait — sans ce nettoyage, le tiret restait collé au titre).
  title = title.replace(/^[-–]\s*/, '');

  // Tags entre crochets (nom de site, groupe de release...), en début ou
  // fin de titre — ex: "[ OxTorrent bz ] Le Film" ou "Le Film [GROUPE]".
  title = title.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/\s*\[[^\]]*\]\s*$/, '');
  // Filet de sécurité : un crochet ouvrant resté seul (jamais refermé,
  // souvent à cause d'une coupure ailleurs dans le nom) jusqu'à la fin.
  title = title.replace(/\s*\[.*$/, '');

  // Préfixe de numérotation ajouté pour l'ordre d'affichage (ex: "3 - Police
  // Story 3 - Supercop") — n'a rien à voir avec le vrai titre.
  title = title.replace(/^\d+\s*-\s*/, '');

  // Indicateur de saison isolé qui traîne dans le titre (ex: "Tokyo Ghoul
  // S1", "Monk Saison 7", "Game Of Thrones Saison 5 MULTI") — le numéro de
  // saison est de toute façon suivi séparément via la structure de
  // dossiers, ça n'a rien à faire dans le titre recherché sur TMDB.
  title = title.replace(/[\s-]+S(?:aison|eason)?\s*\d{1,2}\b[\s-]*/gi, ' ').trim();

  // Coupe au token de bruit qui apparaît le PLUS TÔT dans le texte (pas
  // au premier de la liste trouvé n'importe où — sans ça, "multi" pouvait
  // apparaître avant "1080p" dans le texte mais être ignoré simplement
  // parce que "1080p" est plus haut dans la liste ci-dessus).
  const lower = title.toLowerCase();
  let cutIndex = -1;
  for (const token of NOISE_TOKENS) {
    const match = lower.match(new RegExp(`\\b${token}\\b`));
    if (match && match.index !== undefined && match.index > 0) {
      if (cutIndex === -1 || match.index < cutIndex) {
        cutIndex = match.index;
      }
    }
  }
  if (cutIndex > 0) {
    title = title.slice(0, cutIndex);
  }

  return title.replace(/[-–]\s*$/, '').trim();
}

// Motifs d'épisode, du plus spécifique au plus permissif.
const EPISODE_PATTERNS = [
  /^(.*?)[.\s_-]+[Ss](\d{1,2})[.\s_-]?[Ee](\d{1,4})/, // S01E02 ... S21E1000
  /^(.*?)[.\s_-]+(\d{1,2})x(\d{1,4})/i,                // 1x02 ... 21x1000
  /^(.*?)[.\s_-]+Season[.\s_]?(\d{1,2})[.\s_-]+Episode[.\s_]?(\d{1,4})/i,
];

// Numérotation absolue sans aucun indicateur de saison — fréquent en
// anime (ex: "Épisode 074.mkv"), où le découpage se fait par arc/dossier
// plutôt que par "Saison X". Saison mise à 1 par défaut, faute de mieux ;
// le titre vient presque toujours du dossier (voir scanner.ts) puisque le
// nom de fichier ne contient généralement que le numéro d'épisode.
const ABSOLUTE_EPISODE_PATTERN =
  /(?:^|[.\s_-])(?:episode|épisode|ep)\.?\s*0*(\d{1,4})(?:[.\s_-]|$)/i;

const YEAR_PATTERN = /[([]?((?:19|20)\d{2})[)\]]?/;
const BRACKETED_YEAR_PATTERN = /[([]((?:19|20)\d{2})[)\]]/;

/**
 * Analyse un nom de fichier (sans le chemin du dossier) et tente d'en
 * extraire le titre, et s'il s'agit d'un épisode de série, la saison et
 * l'épisode. Heuristique volontairement simple (comme un sous-ensemble des
 * règles utilisées par Jellyfin) — les cas particuliers non couverts
 * remonteront en "non reconnu" plutôt que de produire un mauvais résultat
 * silencieux.
 */
export function parseFilename(filename: string): ParsedFile | null {
  // Ne retire ce qui suit le dernier point que si c'est une VRAIE
  // extension vidéo connue — sans ça, un nom comme "B.R.I" (abréviation
  // avec points, pas d'extension) se faisait amputer de son dernier
  // caractère ("B.R.I" → "B.R"), le point final étant pris à tort pour un
  // séparateur d'extension.
  const dotIndex = filename.lastIndexOf('.');
  const possibleExt = dotIndex > 0 ? filename.slice(dotIndex).toLowerCase() : '';
  const withoutExt = VIDEO_EXTENSIONS.has(possibleExt) ? filename.slice(0, dotIndex) : filename;
  const tmdbIdHint = extractTmdbIdHint(withoutExt);

  for (const pattern of EPISODE_PATTERNS) {
    const match = withoutExt.match(pattern);
    if (match) {
      const [, rawTitle, season, episode] = match;
      const title = cleanTitle(rawTitle);
      if (!title) continue;
      return {
        type: 'SERIES',
        title,
        year: null, // rarement présent avant le marqueur de saison
        seasonNumber: parseInt(season, 10),
        episodeNumber: parseInt(episode, 10),
        tmdbIdHint,
      };
    }
  }

  // Numérotation absolue (pas de saison précisée) : contrairement aux
  // motifs ci-dessus, un titre vide est accepté ici — le nom de fichier
  // ne contient souvent QUE le numéro d'épisode ("Épisode 074.mkv"), le
  // vrai titre viendra du dossier parent dans scanner.ts.
  const absoluteMatch = withoutExt.match(ABSOLUTE_EPISODE_PATTERN);
  if (absoluteMatch && absoluteMatch.index !== undefined) {
    const title = cleanTitle(withoutExt.slice(0, absoluteMatch.index));
    return {
      type: 'SERIES',
      title,
      year: null,
      seasonNumber: 1,
      episodeNumber: parseInt(absoluteMatch[1], 10),
      tmdbIdHint,
    };
  }

  // Pas de motif de série trouvé : on tente un film. On privilégie une
  // année ENTRE PARENTHÈSES OU CROCHETS si elle existe (évite de
  // confondre un titre qui est lui-même un nombre, comme le film "2012",
  // avec l'année).
  //
  // Pour une année SANS parenthèses, on prend la DERNIÈRE occurrence dans
  // le nom, pas la première — un titre qui commence lui-même par un
  // nombre à 4 chiffres ("2001: A Space Odyssey.1968...") ferait sinon
  // confondre "2001" (qui fait partie du titre) avec l'année, alors que
  // la vraie année (1968) apparaît plus loin.
  const bracketedMatch = withoutExt.match(BRACKETED_YEAR_PATTERN);
  let yearMatch = bracketedMatch;
  if (!yearMatch) {
    const allYearMatches = [...withoutExt.matchAll(new RegExp(YEAR_PATTERN, 'g'))];
    yearMatch = allYearMatches.length > 0 ? allYearMatches[allYearMatches.length - 1] : null;
  }

  if (yearMatch && yearMatch.index !== undefined) {
    const beforeYear = cleanTitle(withoutExt.slice(0, yearMatch.index));
    const afterYear = cleanTitle(withoutExt.slice(yearMatch.index + yearMatch[0].length));

    // Motif "Nom de saga - Année - Vrai titre - qualité" (ex: "Asterix
    // (Film) - 1999 - Asterix Et Obelix Contre Cesar - 1080p") : signal
    // volontairement ÉTROIT et précis — seulement quand le préfixe se
    // termine explicitement par "(Film)"/"(Saga)"/"(Collection)", pas une
    // simple comparaison du nombre de mots (une première version, trop
    // large, cassait des cas normaux comme "Cure (1997) (キュア) (Kiyoshi
    // Kurosawa)..." ou "Marseille 2016 1080p.HDlight..." en préférant à
    // tort le texte après l'année, qui n'était que des infos annexes).
    const beforeLooksLikeSagaLabel = /\((?:film|saga|collection)\)\s*$/i.test(beforeYear);
    if (beforeYear && afterYear && beforeLooksLikeSagaLabel) {
      return { type: 'MOVIE', title: afterYear, year: parseInt(yearMatch[1], 10), tmdbIdHint };
    }
    if (beforeYear) {
      return { type: 'MOVIE', title: beforeYear, year: parseInt(yearMatch[1], 10), tmdbIdHint };
    }
    // Le texte avant l'année est vide : elle est en tête du nom (ex:
    // "1962 Dr. No MULTI..."), le titre suit après plutôt que précède.
    if (afterYear) {
      return { type: 'MOVIE', title: afterYear, year: parseInt(yearMatch[1], 10), tmdbIdHint };
    }
  }

  // Dernier recours : tout le nom nettoyé, sans année identifiée.
  const title = cleanTitle(withoutExt);
  if (!title) return null;
  return { type: 'MOVIE', title, year: null, tmdbIdHint };
}
