import { readdir } from 'fs/promises';
import path from 'path';

import { isVideoFile, parseFilename } from './filenameParser';
import { readMovieNfo, readSeriesNfo, extractExternalIdsFromName, type ProviderHints } from './localMetadata';

export type DetectedMovie = {
  type: 'MOVIE';
  title: string;
  year: number | null;
  filePath: string;
  tmdbIdHint: number | null;
  imdbIdHint: string | null;
  tvdbIdHint: number | null;
  nfoPath: string | null;
};

export type DetectedSeries = {
  type: 'SERIES';
  title: string;
  year: number | null;
  folderPath: string;
  tmdbIdHint: number | null;
  imdbIdHint: string | null;
  tvdbIdHint: number | null;
  nfoPath: string | null;
  aliases: string[];
  episodes: Array<{ seasonNumber: number; episodeNumber: number; filePath: string }>;
};

export type DetectedItem = DetectedMovie | DetectedSeries;

// Deux formes acceptées : "Saison 1" / "Season 1" en toutes lettres, ou
// "S1 •" (S collé + puce) — motif vu sur certains animés où le dossier
// mêle numéro de saison et nom de l'arc ("S1 • Kazekage Rescue"). Le
// caractère puce (•/·) est assez rare pour rester un signal fiable, sans
// risquer de confondre avec un vrai titre.
const SEASON_FOLDER_PATTERN = /^(?:(?:saison|season)[\s_-]*0*(\d{1,2})\b|s0*(\d{1,2})\s*[•·])/i;

/**
 * Cherche un dossier "Saison X" parmi les niveaux proches (pas seulement
 * le parent direct) — gère le cas fréquent d'un dossier de release
 * intercalé entre le dossier de saison et le fichier lui-même (ex: un
 * seul épisode dans son propre dossier nommé d'après le groupe qui l'a
 * partagé). Renvoie l'index dans `parts`, ou null si aucun trouvé.
 */
/**
 * Numéro de saison porté par un nom de dossier — soit sous la forme
 * classique ("Saison 1", "S1 •"), soit noyée au milieu d'un nom plus
 * long après un tag de groupe entre crochets, convention fréquente chez
 * les fansubs : "[sekkusu&ok] L'Attaque des titans S1 (Shingeki no
 * Kyojin) - VOSTFR-VF [Multi-Audio] [1080p WEB-DL]". Sans ce second
 * motif, ce genre de dossier n'était reconnu comme dossier de saison
 * dans aucun cas, et tombait à tort en "film".
 */
function getSeasonNumberFromFolderName(name: string): number | null {
  const direct = name.match(SEASON_FOLDER_PATTERN);
  if (direct) return parseInt(direct[1] ?? direct[2], 10);

  const withoutLeadingTag = name.replace(/^\[[^\]]*\]\s*/, '');

  // V3.13 — packs/release folders où "Saison X" n'est pas au début :
  // "NOOB - saison 1 - HD", "Show Season 2 WEB-DL", etc. Ces noms
  // décrivent une saison, pas une série autonome.
  const embeddedWord = withoutLeadingTag.match(/(?:^|[\s._-])(?:saison|season)[\s._-]*0*(\d{1,2})(?:\b|[\s._-])/i);
  if (embeddedWord) return parseInt(embeddedWord[1], 10);

  const embedded = withoutLeadingTag.match(/\bs0*(\d{1,2})\b/i);
  return embedded ? parseInt(embedded[1], 10) : null;
}

function findSeasonFolderIndex(parts: string[]): number | null {
  const start = parts.length - 2; // parent direct du fichier
  const end = Math.max(0, parts.length - 4); // jusqu'à 2 niveaux plus haut

  // V3.13.4 — garder le dossier de saison le PLUS EXTERNE dans la fenêtre.
  // Un pack peut contenir à la fois :
  //   Saison_1/[ release Hawkeye.S01... ]/Hawkeye.S01E01.../fichier.mkv
  // Le dossier de release porte lui aussi "S01" et l'ancienne logique le
  // choisissait avant Saison_1. Le scanner prenait alors Saison_1 ou chaque
  // dossier d'épisode pour une série autonome.
  let found: number | null = null;
  for (let i = start; i >= end; i--) {
    if (getSeasonNumberFromFolderName(parts[i]) != null) found = i;
  }
  return found;
}

/**
 * Extrait un numéro d'épisode d'un nom de fichier qui n'a PAS de motif
 * S01E02 classique — cas d'un fichier "01.mkv" ou "Episode 3.mkv" placé
 * dans un dossier "Saison X" qui porte déjà l'info de saison. Cherche
 * d'abord un marqueur explicite (E01, Episode 3, 2x03...), puis un code
 * concaténé saison+épisode (ex: "201" = S02E01, seulement si le chiffre de
 * saison correspond bien à celle déjà connue via le dossier — évite de
 * confondre avec une résolution ou un autre nombre du nom de fichier),
 * et enfin se rabat sur le premier nombre isolé en début de nom.
 */
function extractEpisodeNumbersFromFilename(filename: string, knownSeason: number): number[] {
  const dotIndex = filename.lastIndexOf('.');
  const withoutExt = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;

  if (/Red Dwarf|^(?:0?1|0?2|0?3|0?4|0?5|0?6|0?7|0?8|0?9|10)-/i.test(filename)) {
    console.log(
      `[EPISODE-PARSER-DEBUG] filename=${filename} knownSeason=${knownSeason}`,
    );
  }

  // V3.15.27 — épisodes au format [S2.Ep16], [S3.Ep4], etc.
  //
  // Convention rencontrée notamment sur Winx Club :
  //   [S2.Ep16] Winx Club - Que la fête continue.mkv
  //   [S4.Ep23] Winx Club - Le combat de Bloom.mkv
  //
  // Le dossier Saison X fournit déjà knownSeason. On exige donc que la
  // saison inscrite dans le fichier corresponde exactement à knownSeason.
  // Le marqueur "Ep" est obligatoire afin de ne pas élargir les autres
  // conventions de numérotation.
  const sxEp = withoutExt.match(
    /(?:^|[\[\s._-])s0*(\d{1,2})[.\s_-]*ep0*(\d{1,4})(?=[\]\s._-]|$)/i,
  );
  if (sxEp && parseInt(sxEp[1], 10) === knownSeason) {
    const episodeNumber = parseInt(sxEp[2], 10);
    if (episodeNumber > 0) {
      return [episodeNumber];
    }
  }

  // Fichiers multi-épisodes : S01E01E02, S10E17E18, etc. Un même fichier
  // représente plusieurs épisodes et doit donc créer plusieurs lignes Episode.
  const multi = withoutExt.match(/s0*(\d{1,2})e0*(\d{1,4})(?!\d)((?:e0*\d{1,4}(?!\d))+)/i);
  if (multi && parseInt(multi[1], 10) === knownSeason) {
    const extra = [...multi[3].matchAll(/e0*(\d{1,4})(?!\d)/gi)].map((m) => parseInt(m[1], 10));
    return [parseInt(multi[2], 10), ...extra];
  }

  // V3.13.23 — variante multi-épisodes écrite en langage naturel :
  // S01E36 et 37, S01E36 & 37, S01E36 + 37.
  // Comme pour S01E36E37, un seul fichier physique représente plusieurs
  // épisodes et crée donc plusieurs lignes Episode partageant le filePath.
  const multiNatural = withoutExt.match(
    /s0*(\d{1,2})e0*(\d{1,4})(?!\d)\s*(?:et|&|\+)\s*(?:e)?0*(\d{1,4})(?!\d)/i,
  );
  if (multiNatural && parseInt(multiNatural[1], 10) === knownSeason) {
    return [
      parseInt(multiNatural[2], 10),
      parseInt(multiNatural[3], 10),
    ];
  }

  // V3.15.29 — plusieurs épisodes explicitement chaînés avec tirets :
  //   S13E22-E23-E24 => [22, 23, 24]
  //
  // Traité avant multiDash afin de ne pas s'arrêter à E22-E23.
  const multiExplicitDash = withoutExt.match(
    /s0*(\d{1,2})[.\s_-]*e0*(\d{1,4})(?!\d)((?:\s*[-–—]\s*e\s*0*\d{1,4}(?!\d)){2,})/i,
  );
  if (multiExplicitDash && parseInt(multiExplicitDash[1], 10) === knownSeason) {
    const first = parseInt(multiExplicitDash[2], 10);
    const extra = [
      ...multiExplicitDash[3].matchAll(/[-–—]\s*e\s*0*(\d{1,4})(?!\d)/gi),
    ].map((m) => parseInt(m[1], 10));

    const episodes = [first, ...extra].filter((n) => n > 0);

    if (
      episodes.length >= 3 &&
      episodes.length <= 20 &&
      new Set(episodes).size === episodes.length
    ) {
      return episodes;
    }
  }

  // V3.13.30 — variantes multi-épisodes avec tiret :
  //   S03E23-E24
  //   S01E01-E02
  //   S03E01-02
  // Le premier numéro porte obligatoirement la coordonnée SxxExx complète.
  // Le second est accepté avec ou sans E, mais doit être explicitement
  // séparé par un tiret afin de ne pas interpréter d'autres nombres du nom.
  const multiDash = withoutExt.match(
    /s0*(\d{1,2})[.\s_-]*e0*(\d{1,4})(?!\d)\s*[-–—]\s*(?:e\s*)?0*(\d{1,4})(?!\d)/i,
  );
  if (multiDash && parseInt(multiDash[1], 10) === knownSeason) {
    const first = parseInt(multiDash[2], 10);
    const last = parseInt(multiDash[3], 10);

    // V3.15.26 — une plage explicite représente tous les épisodes compris
    // entre ses deux bornes :
    //
    //   S01E01-E02 => [1, 2]
    //   S02E01-E05 => [1, 2, 3, 4, 5]
    //
    // On limite volontairement la taille d'une plage afin qu'un nombre
    // parasite placé après un tiret ne puisse pas créer des centaines
    // d'épisodes.
    if (first > 0 && last >= first && last - first <= 20) {
      return Array.from(
        { length: last - first + 1 },
        (_, index) => first + index,
      );
    }
  }

  // V3.15.24 — double épisode sous la forme S02E03.04.
  //
  // Le point est également utilisé dans les noms de release standards
  // (ex: S09E22.1080p). On n'accepte donc cette convention que lorsque
  // le second numéro est exactement l'épisode suivant.
  //
  //   S02E03.04 => E03 + E04
  //   S09E22.1080p => rejeté comme multi-épisode
  const multiDot = withoutExt.match(
    /s0*(\d{1,2})[.\s_-]*e0*(\d{1,4})(?!\d)\.0*(\d{1,4})(?!\d)/i,
  );
  if (multiDot && parseInt(multiDot[1], 10) === knownSeason) {
    const first = parseInt(multiDot[2], 10);
    const second = parseInt(multiDot[3], 10);

    if (first > 0 && second === first + 1) {
      return [first, second];
    }
  }

  // V3.15.20 — double épisode numéroté directement en début de fichier
  // lorsque la saison est déjà connue par le dossier.
  //
  // Exemples :
  //   "01 02 Pilote.mkv"       => E01 + E02
  //   "01-02 Pilote.mkv"       => E01 + E02
  //   "01 & 02 Pilote.mkv"     => E01 + E02
  //   "01 et 02 Pilote.mkv"    => E01 + E02
  //
  // On limite volontairement cette convention aux fichiers dont les DEUX
  // numéros sont placés au tout début et seulement lorsqu'une saison > 0
  // est déjà connue par l'arborescence.
  // V3.15.25 — plusieurs épisodes au format NxNN reliés par "&".
  //
  // Exemple :
  //   "Stargate Universe - 1X01 & 1X02 & 1X03 - Air.mkv"
  //     => [1, 2, 3]
  //
  // Sécurité :
  // - au moins deux coordonnées NxNN ;
  // - toutes doivent appartenir à knownSeason ;
  // - les épisodes doivent être strictement consécutifs ;
  // - seuls les séparateurs "&" entre coordonnées sont acceptés ici.
  //
  // Les parseurs SxxExx, multiDash, multiDot et leadingMulti restent inchangés.
  if (knownSeason > 0) {
    const nxnMulti = withoutExt.match(
      /(\d{1,2}[xX]\d{1,4})(?:\s*&\s*\d{1,2}[xX]\d{1,4})+/,
    );

    if (nxnMulti) {
      const coordinates = [
        ...nxnMulti[0].matchAll(/(\d{1,2})[xX]0*(\d{1,4})(?!\d)/g),
      ];

      if (coordinates.length >= 2) {
        const seasons = coordinates.map((m) => parseInt(m[1], 10));
        const episodes = coordinates.map((m) => parseInt(m[2], 10));

        const sameSeason = seasons.every((season) => season === knownSeason);
        const consecutive = episodes.every(
          (episode, index) =>
            index === 0 || episode === episodes[index - 1] + 1,
        );

        if (
          sameSeason &&
          consecutive &&
          episodes.every((episode) => episode > 0)
        ) {
          return episodes;
        }
      }
    }
  }

  // V3.15.30 — format saison-épisode en début de fichier lorsque la
  // saison est déjà connue par le dossier.
  //
  // Exemples Red Dwarf :
  //   Saison 01/01-1_The_End.mkv       => E01
  //   Saison 02/02-3_Thanks...mkv      => E03
  //   Saison 07/07-8_Nanarchy.mkv      => E08
  //   Saison 10/10-1_Trojan.mkv        => E01
  //
  // Sécurité : le premier nombre doit correspondre EXACTEMENT à knownSeason.
  // Cette règle doit précéder leadingMulti, qui traite "01-02" comme un
  // fichier représentant deux épisodes consécutifs.
  const leadingSeasonEpisode = withoutExt.match(
    /^0*(\d{1,2})\s*[-–—]\s*0*(\d{1,4})(?=[^0-9]|$)/,
  );
  if (
    knownSeason > 0 &&
    leadingSeasonEpisode &&
    parseInt(leadingSeasonEpisode[1], 10) === knownSeason
  ) {
    const episodeNumber = parseInt(leadingSeasonEpisode[2], 10);
    if (episodeNumber > 0) {
      return [episodeNumber];
    }
  }

  const leadingMulti = withoutExt.match(
    /^0*(\d{1,3})\s*(?:[-–—&+]|\bet\b)\s*0*(\d{1,3})(?=[^0-9]|$)/i,
  );
  if (knownSeason > 0 && leadingMulti) {
    const first = parseInt(leadingMulti[1], 10);
    const second = parseInt(leadingMulti[2], 10);

    if (first > 0 && second > first && second - first === 1) {
      return [first, second];
    }
  }

  const single = extractEpisodeNumberFromFilenameLegacy(filename, knownSeason);
  return single == null ? [] : [single];
}

function extractEpisodeNumberFromFilenameLegacy(filename: string, knownSeason: number): number | null {
  // V3.13.16 — tous les motifs explicites SxxExxxx/NxXXXX acceptent 4 chiffres.
  // L'ancienne branche `glued` était encore limitée à {1,3} et capturait
  // S21E1000 comme E100 avant même la réconciliation DB.
  const dotIndex = filename.lastIndexOf('.');
  const withoutExt = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;

  // V3.15.22 — les tags de release entre crochets peuvent contenir des
  // hashes commençant par E (ex: [E62D8C33], [E5513F2C]).
  // Ils ne doivent jamais être interprétés comme un numéro d'épisode.
  // On conserve withoutExt intact pour les motifs structurés SxxExx,
  // mais les recherches génériques utilisent cette version nettoyée.
  const withoutReleaseTags = withoutExt.replace(/\[[^\]]*\]/g, ' ');

  // Motif "s01e11" collé, y compris en tout début de nom (sans rien
  // avant) — le cas qui posait problème : les motifs suivants exigent
  // tous un séparateur ou du texte avant le marqueur, ce qui échoue
  // justement quand le nom de fichier ne contient QUE "s01e11...", le
  // titre venant entièrement du dossier.
  const glued = withoutExt.match(/s0*\d{1,2}e0*(\d{1,4})(?!\d)/i);
  if (glued) return parseInt(glued[1], 10);

  // Variante "S1x01" (S collé, puis x au lieu de E) — ni le motif ci-dessus
  // (qui attend un "e") ni le motif NxNN plus bas (qui exige une frontière
  // de mot, absente ici à cause du "S" collé juste avant le chiffre) ne
  // la couvraient.
  const gluedX = withoutExt.match(/s0*\d{1,2}x0*(\d{1,4})(?!\d)/i);
  if (gluedX) return parseInt(gluedX[1], 10);

  // Numéro isolé juste après une année entre parenthèses (ex: "Bleach -
  // Thousand-Year Blood War (2022) - 02 MULTi...") — motif fréquent pour
  // des packs d'épisodes nommés "Titre (Année) - NN qualité", sans aucun
  // marqueur S/E explicite.
  const afterYearNumber = withoutExt.match(/\)\s*[-–]\s*0*(\d{1,4})(?!\d)/);
  if (afterYearNumber) return parseInt(afterYearNumber[1], 10);

  const explicit = withoutReleaseTags.match(
    /(?:^|[^a-z0-9])(?:e|ep|episode|épisode)\.?\s*0*(\d{1,4})(?:[^0-9]|$)/i,
  );
  if (explicit) return parseInt(explicit[1], 10);

  // Motif "NxNN" (2x03) — pas d'exigence de frontière de mot AVANT le
  // chiffre : un titre abrégé collé juste devant ("HaPol2x03") n'a aucun
  // séparateur entre la lettre et le chiffre, une frontière de mot n'y
  // matcherait jamais. On garde la frontière après, pour éviter de
  // capturer un nombre plus long par erreur (ex: "2x031" ne doit pas
  // donner l'épisode 31 d'une saison 203).
  const nxn = withoutExt.match(/\d{1,2}[xX](\d{1,4})(?!\d)/);
  if (nxn) return parseInt(nxn[1], 10);

  // V3.13.17 — format SS.EE en début de fichier dans un dossier Saison X.
  // Exemple Bob l'éponge : "08.13 - titre.avi" dans "Saison 8" => E13.
  // On exige que SS corresponde exactement à knownSeason pour ne pas prendre
  // une résolution/version décimale quelconque pour un numéro d'épisode.
  const seasonDotEpisode = withoutExt.match(/^0*(\d{1,2})\.0*(\d{1,4})(?!\d)(?:[.\s_-]|$)/);
  if (seasonDotEpisode && knownSeason > 0 && parseInt(seasonDotEpisode[1], 10) === knownSeason) {
    return parseInt(seasonDotEpisode[2], 10);
  }

  // V3.13.19 — code concaténé saison+épisode dans un dossier Saison X.
  // Exemples :
  //   Saison 1  + "...0101..." => E01
  //   Saison 1  + "...0122..." => E22
  //   Saison 10 + "...1001..." => E01
  //
  // Cette détection doit passer AVANT le nombre placé en début de fichier :
  // un titre commençant par un chiffre ("7.A.L.Maison.0101...") ne doit pas
  // devenir E07 alors qu'un vrai code 0101 est présent plus loin.
  //
  // On exige cependant de vrais séparateurs autour du code afin qu'un tag
  // collé à du texte ("t411") ne soit pas interprété comme S04E11.
  const concatMatches = [
    ...withoutExt.matchAll(/(?:^|[.\s_-])(\d{3,4})(?=[.\s_-]|$)/g),
  ];
  for (const m of concatMatches) {
    const digits = m[1];

    if (digits.length === 3 && parseInt(digits[0], 10) === knownSeason) {
      return parseInt(digits.slice(1), 10);
    }

    if (digits.length === 4 && parseInt(digits.slice(0, 2), 10) === knownSeason) {
      return parseInt(digits.slice(2), 10);
    }
  }

  // Numéro explicitement placé au tout début du fichier.
  // Cette branche reste utile pour les fichiers du type "01 - titre.avi",
  // mais seulement après avoir recherché un vrai code saison+épisode.
  const leading = withoutExt.match(/^0*(\d{1,4})(?:[^0-9]|$)/);
  if (leading) return parseInt(leading[1], 10);

  // Dernier recours : un numéro isolé n'importe où dans le nom, bordé par
  // des séparateurs (ex: "Sissi.32.avi" — juste le nom de la série suivi
  // du numéro, sans aucun marqueur). On ne l'utilise qu'ici, dans un
  // dossier "Saison X" déjà confirmé par l'appelant, pour limiter le
  // risque de faux positif sur un nombre qui ne serait pas un épisode.
  const anyStandalone = withoutReleaseTags.match(/[.\s_-]0*(\d{1,4})(?:[.\s_-]|$)/);
  if (anyStandalone) return parseInt(anyStandalone[1], 10);

  return null;
}

export async function walkVideoFilesDetailed(root: string): Promise<{
  files: string[];
  complete: boolean;
  failedDirectories: string[];
}> {
  const results: string[] = [];
  const failedDirectories: string[] = [];

  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      failedDirectories.push(dir);
      console.error(`[SCAN-NAS-READ-ERROR] ${dir}: ${String(error)}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (isVideoFile(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  await walk(root);

  return {
    files: results,
    complete: failedDirectories.length === 0,
    failedDirectories,
  };
}

export async function walkVideoFiles(root: string): Promise<string[]> {
  return (await walkVideoFilesDetailed(root)).files;
}

/**
 * Scanne un dossier racine de bibliothèque et regroupe les fichiers vidéo
 * détectés en films et séries (avec leurs épisodes). Utilise le nom des
 * dossiers parents quand il est disponible (généralement plus fiable que
 * le nom du fichier lui-même) pour le titre.
 */
/**
 * Sous-dossiers qui organisent une série sans constituer une série distincte.
 *
 * V3.10 : les dossiers de release contenant "Integrale", "Complete", "Pack"
 * ou "Collection" ne sont PLUS automatiquement considérés comme de simples
 * conteneurs. Ils peuvent être la vraie racine physique de la série, comme
 * "Capitaine.Flam.Integrale..." qui contient ensuite Voyage 01..13.
 * Seuls les dossiers structurels non ambigus (Saison, Voyage, Arc, Partie...)
 * sont remontés automatiquement.
 */
export function isSeriesContainerFolder(name: string): boolean {
  const n = name.trim();
  return (
    getSeasonNumberFromFolderName(n) != null ||
    /^voyage\s*0*\d+\b/i.test(n) ||
    /^(?:arc|partie|part|cour)\s*0*\d+\b/i.test(n) ||
    /^(?:(?:[ée]pisodes?\s+)?sp[ée]ciaux?|specials?|special\s+episodes?)$/i.test(n) ||
    /^[ivxlcdm]+\s*[-–]/i.test(n)
  );
}

/**
 * Remonte les dossiers purement organisationnels (Voyage 01, Saison 1,
 * Arc...) mais s'arrête dès qu'un vrai dossier de série est rencontré.
 * Un dossier "Integrale/Complete/Pack" est conservé comme racine potentielle.
 */
export function canonicalSeriesFolderFromPath(folderPath: string): string {
  let current = path.resolve(folderPath);
  while (isSeriesContainerFolder(path.basename(current))) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export async function scanLibraryRoot(
  root: string,
  options: { allowRootSeriesName?: boolean } = {},
): Promise<{
  items: DetectedItem[];
  filesScanned: number;
  scanComplete: boolean;
  failedDirectories: string[];
}> {
  const walkResult = await walkVideoFilesDetailed(root);
  const files = walkResult.files;
  const rootBaseName = path.basename(root);
  const movies: DetectedMovie[] = [];
  const seriesByKey = new Map<string, DetectedSeries>();
  const seriesNfoCache = new Map<string, Promise<ProviderHints>>();
  const movieNfoCache = new Map<string, Promise<ProviderHints>>();
  const seriesNfoFor = (folder: string) => {
    let value = seriesNfoCache.get(folder);
    if (!value) { value = readSeriesNfo(folder); seriesNfoCache.set(folder, value); }
    return value;
  };
  const movieNfoFor = (folder: string, file: string) => {
    const key = `${folder}::${file}`;
    let value = movieNfoCache.get(key);
    if (!value) { value = readMovieNfo(folder, file); movieNfoCache.set(key, value); }
    return value;
  };

  function addEpisode(
    title: string,
    year: number | null,
    seasonNumber: number,
    episodeNumber: number,
    filePath: string,
    folderPathParts: string[],
    tmdbIdHint: number | null = null,
    imdbIdHint: string | null = null,
    tvdbIdHint: number | null = null,
    nfoPath: string | null = null,
    aliases: string[] = [],
  ) {
    const canonicalFolder = path.join(root, folderPathParts.join(path.sep));
    const key = path.resolve(canonicalFolder).toLowerCase();
    let series = seriesByKey.get(key);
    if (!series) {
      series = {
        type: 'SERIES',
        title,
        year,
        folderPath: canonicalFolder,
        tmdbIdHint,
        imdbIdHint,
        tvdbIdHint,
        nfoPath,
        aliases: [...new Set(aliases.filter(Boolean))],
        episodes: [],
      };
      seriesByKey.set(key, series);
    } else {
      if (series.tmdbIdHint == null && tmdbIdHint != null) series.tmdbIdHint = tmdbIdHint;
      if (series.imdbIdHint == null && imdbIdHint != null) series.imdbIdHint = imdbIdHint;
      if (series.tvdbIdHint == null && tvdbIdHint != null) series.tvdbIdHint = tvdbIdHint;
      if (series.nfoPath == null && nfoPath != null) series.nfoPath = nfoPath;
      for (const alias of aliases) if (alias && !series.aliases.includes(alias)) series.aliases.push(alias);
    }
    series.episodes.push({ seasonNumber, episodeNumber, filePath });
  }

  // Dossiers qui indiquent du contenu "bonus" (making-of, featurettes,
  // scènes coupées...) — jamais un vrai film ou épisode identifiable
  // individuellement. Repéré n'importe où dans le chemin, pas seulement
  // en dossier parent immédiat : un fichier générique ("Batman.mkv") peut
  // se trouver dans un sous-dossier nommé d'après la featurette elle-même
  // ("Saison 1/Featurettes/Tour of the Batcave/Batman.mkv"), pas
  // directement sous "Featurettes".
  const BONUS_FOLDER_PATTERN = /^(featurettes?|extras?|bonus|specials?|behind[\s_-]the[\s_-]scenes|making[\s_-]of|deleted[\s_-]scenes|bloopers?|g[ée]n[ée]riques?|openings?|endings?)$/i;

  for (const filePath of files) {
    const relative = path.relative(root, filePath);
    const parts = relative.split(path.sep);
    const filename = parts[parts.length - 1];

    const parentFolder = parts.length >= 2 ? parts[parts.length - 2] : null;
    const grandparentFolder = parts.length >= 3 ? parts[parts.length - 3] : null;

    // V3.12 — un dossier "Spéciaux/Specials" sous une série n'est PAS une
    // série autonome. Il représente la saison spéciale locale S00. C'était
    // notamment le cas de Wolf's Rain/Spéciaux/Episode 1.mkv, anciennement
    // transformé en fausse série "Spéciaux" puis associé à un résultat TMDB
    // sans rapport. On rattache ces fichiers à la série parente.
    const SPECIAL_FOLDER_PATTERN = /^(?:(?:[ée]pisodes?\s+)?sp[ée]ciaux?|specials?|special\s+episodes?)$/i;
    if (parentFolder && SPECIAL_FOLDER_PATTERN.test(parentFolder)) {
      const episodeNumbers = extractEpisodeNumbersFromFilename(filename, 0);
      const showFolderName = grandparentFolder || rootBaseName;
      const parsedShow = parseFilename(showFolderName);
      if (episodeNumbers.length > 0 && parsedShow?.title) {
        const showFolderParts = parts.slice(0, Math.max(0, parts.length - 2));
        const physicalSeriesFolder = showFolderParts.length
          ? path.join(root, ...showFolderParts)
          : path.resolve(root);
        const nfo = await seriesNfoFor(physicalSeriesFolder);
        const title = nfo.title || parsedShow.title;
        const year = nfo.year ?? ('year' in parsedShow ? parsedShow.year : null);
        for (const episodeNumber of episodeNumbers) {
          addEpisode(
            title,
            year,
            0,
            episodeNumber,
            filePath,
            showFolderParts,
            nfo.tmdbId ?? parsedShow.tmdbIdHint,
            nfo.imdbId,
            nfo.tvdbId,
            nfo.nfoPath,
          );
        }
        continue;
      }
    }

    if (parts.slice(0, -1).some((p) => BONUS_FOLDER_PATTERN.test(p))) {
      continue;
    }

    // Cas d'un dossier "Saison X" / "Season X" (éventuellement avec un
    // dossier de release intercalé entre la saison et le fichier) : le
    // fichier lui-même n'a pas forcément de S01E02 dans son nom, la saison
    // est déjà donnée par le dossier — on ne se fie pas à
    // parseFilename(filename) pour la classification dans ce cas précis,
    // sans quoi chaque épisode devient à tort un "film".
    const seasonFolderIndex = findSeasonFolderIndex(parts);
    if (seasonFolderIndex !== null) {
      const knownSeason = getSeasonNumberFromFolderName(parts[seasonFolderIndex])!;
      const episodeNumbers = extractEpisodeNumbersFromFilename(filename, knownSeason);
      const showFolderIndex = seasonFolderIndex - 1;

      // V3.12.1 — lors d'un rescan ciblé, `root` peut être directement la
      // racine de la série. Dans ce cas le chemin relatif est seulement
      // `Saison 1/fichier.mkv` et il n'existe donc aucun niveau au-dessus de
      // `Saison 1` dans `parts`. L'ancienne logique abandonnait alors la
      // détection, même avec un tvshow.nfo valide à la racine (cas Negima).
      //
      // On n'utilise rootBaseName comme titre QUE si un vrai tvshow.nfo est
      // présent à la racine : cela évite qu'un scan de bibliothèque contenant
      // directement un dossier `Saison 1` crée une fausse série appelée
      // "Enfants" ou "Séries".
      const rootSeriesNfo = showFolderIndex < 0 ? await seriesNfoFor(path.resolve(root)) : null;
      const rootNfoHasIdentity =
        rootSeriesNfo != null &&
        (Boolean(rootSeriesNfo.title) || rootSeriesNfo.tmdbId != null || Boolean(rootSeriesNfo.imdbId) || rootSeriesNfo.tvdbId != null);
      const canUseRootAsSeries =
        showFolderIndex < 0 &&
        (rootNfoHasIdentity || options.allowRootSeriesName === true);

      const showFolderName =
        showFolderIndex >= 0
          ? parts[showFolderIndex]
          : canUseRootAsSeries
            ? rootBaseName
            : null;
      const parsedShow = showFolderName ? parseFilename(showFolderName) : null;
      const physicalSeriesFolder = showFolderIndex >= 0
        ? path.join(root, ...parts.slice(0, showFolderIndex + 1))
        : path.resolve(root);
      const nfo = showFolderIndex >= 0 ? await seriesNfoFor(physicalSeriesFolder) : rootSeriesNfo;

      // Important : on ne retombe JAMAIS sur le nom du dossier de saison
      // lui-même comme titre ("Saison 1" n'est pas un titre de série).
      if (episodeNumbers.length > 0 && (nfo?.title || parsedShow?.title)) {
        const title = nfo?.title || parsedShow!.title;
        const year = nfo?.year ?? (parsedShow && 'year' in parsedShow ? parsedShow.year : null);
        const folderParts = showFolderIndex >= 0 ? parts.slice(0, showFolderIndex + 1) : [];
        for (const episodeNumber of episodeNumbers) {
          addEpisode(
            title,
            year,
            knownSeason,
            episodeNumber,
            filePath,
            folderParts,
            nfo?.tmdbId ?? parsedShow?.tmdbIdHint ?? null,
            nfo?.imdbId ?? null,
            nfo?.tvdbId ?? null,
            nfo?.nfoPath ?? null,
            parsedShow?.title ? [parsedShow.title] : [],
          );
        }
        continue;
      }
      // Motif de saison reconnu mais aucun numéro d'épisode ou aucun titre
      // de série exploitable : on retombe sur l'analyse classique ci-dessous
      // plutôt que d'abandonner le fichier ou de créer une entrée fausse.
    }

    // Dossier d'arc en chiffres romains ("II -Asgard", "IV -Kraken"...),
    // sans AUCUN dossier "Saison X" au-dessus — convention vue sur
    // certains animés qui numérotent leurs arcs plutôt que leurs saisons.
    // Le vrai nom de la série est un niveau plus haut (le dossier d'arc
    // n'est qu'un sous-classement) ; on numérote en épisodes absolus,
    // saison 1 par défaut (l'admin peut corriger via "Identifier" si le
    // découpage réel en saisons TMDB diffère).
    const ROMAN_ARC_FOLDER_PATTERN = /^[ivxlcdm]+\s*[-–]/i;
    if (
      seasonFolderIndex === null &&
      parentFolder &&
      ROMAN_ARC_FOLDER_PATTERN.test(parentFolder) &&
      grandparentFolder &&
      grandparentFolder !== rootBaseName
    ) {
      const episodeNumbers = extractEpisodeNumbersFromFilename(filename, 1);
      const parsedShow = parseFilename(grandparentFolder);
      if (episodeNumbers.length > 0 && parsedShow?.title) {
        const year = 'year' in parsedShow ? parsedShow.year : null;
        for (const episodeNumber of episodeNumbers) {
          addEpisode(
            parsedShow.title,
            year,
            1,
            episodeNumber,
            filePath,
            parts.slice(0, parts.length - 2),
            parsedShow.tmdbIdHint,
          );
        }
        continue;
      }
    }

    // Fichier "[Groupe] Titre - NNN - Sous-titre" posé directement dans le
    // dossier de la série, sans AUCUN dossier de saison ni d'arc au-dessus
    // — convention de nommage à plat vue chez certains fansubs
    // (numérotation absolue, tout dans un seul dossier). Le tag entre
    // crochets en tête est le signal le plus fiable pour ne pas confondre
    // avec un vrai titre de film qui contiendrait un nombre par hasard.
    const BRACKET_TAG_EPISODE_PATTERN = /^\[[^\]]+\]\s*.+?[-–]\s*0*(\d{1,4})\s*[-–]/;
    if (seasonFolderIndex === null && parentFolder && parentFolder !== rootBaseName) {
      const bracketMatch = filename.match(BRACKET_TAG_EPISODE_PATTERN);
      // On exclut ce qui ressemble à une année (1900-2099) — un film
      // publié sous la forme "[Groupe] Titre - 2020 - 1080p.mkv" utilise
      // exactement la même forme dash-nombre-dash, mais 2020 est une
      // année, pas un numéro d'épisode.
      const isPlausibleYear = (n: number) => n >= 1900 && n <= 2099;
      if (bracketMatch && !isPlausibleYear(parseInt(bracketMatch[1], 10))) {
        const episodeNumber = parseInt(bracketMatch[1], 10);
        const parsedShow = parseFilename(parentFolder);
        if (parsedShow?.title) {
          const year = 'year' in parsedShow ? parsedShow.year : null;
          addEpisode(
            parsedShow.title,
            year,
            1,
            episodeNumber,
            filePath,
            parts.slice(0, parts.length - 1),
            parsedShow.tmdbIdHint,
          );
          continue;
        }
      }
    }

    let parsedFile = parseFilename(filename);
    if (!parsedFile) continue;

    // V3.13.28 — certains packs placent chaque épisode dans un dossier de
    // release qui porte SxxExx, alors que le fichier vidéo interne a un nom
    // abrégé sans coordonnée exploitable :
    //   Greys.Anatomy.S04E09.../gas409fr.avi
    // Le dossier parent immédiat fait alors foi uniquement s'il est reconnu
    // sans ambiguïté comme épisode de série.
    if (parsedFile.type !== 'SERIES' && parentFolder) {
      const parsedEpisodeFolder = parseFilename(parentFolder);
      if (parsedEpisodeFolder?.type === 'SERIES') {
        parsedFile = parsedEpisodeFolder;
        console.log(`[EPISODE-PARENT-FOLDER-FALLBACK] ${parentFolder} -> ${filename}`);
      }
    }

    if (parsedFile.type === 'SERIES') {
      // Pour un épisode qui porte déjà SxxExx dans son nom, le dossier parent
      // DIRECT est le meilleur candidat pour le nom de la série. L'ancienne
      // logique prenait le grand-parent en priorité : dans une arborescence
      // de franchise telle que
      //   Bleach (2004)/Bleach/...S01E01.mkv
      //   Bleach (2004)/Bleach La Guerre Sanglante.../...S03E01.mkv
      // les deux branches devenaient donc "Bleach" et fusionnaient dans la
      // même fiche. Le grand-parent n'est qu'un fallback lorsque le fichier
      // est directement sous la racine ou si le parent n'est pas exploitable.
      // V3.5 : déterminer d'abord la RACINE LOGIQUE de la série.
      // Un dossier "Voyage 01" reste un conteneur structurel. V3.10 : un
      // dossier de release nommé "... Integrale/Complete/Pack" peut en revanche
      // être la vraie racine de série et ne doit plus être sauté automatiquement.
      // Cela stabilise notamment Capitaine Flam Integrale au-dessus de Voyage 01..13.
      // V3.13.4 — lorsqu'un dossier de saison a été détecté dans les parents,
      // la vraie série est forcément AU-DESSUS de ce dossier. Ne jamais repartir
      // du parent direct du fichier : sous Saison_1 il peut y avoir un dossier
      // de release puis un dossier par épisode, qui ne sont pas des séries.
      let seriesFolderIndex = seasonFolderIndex !== null
        ? seasonFolderIndex - 1
        : parts.length - 2;

      // V3.13.12 — certains packs mettent CHAQUE épisode dans son propre
      // dossier de release :
      //   Chernobyl 2019/Chernobyl.S01E01.MULTi.../video.mkv
      //   Chernobyl 2019/Chernobyl.S01E02.MULTi.../video.mkv
      // Le dossier feuille contient alors lui-même SxxExxx : ce n'est pas la
      // racine d'une série. On remonte d'un niveau afin que tous les dossiers
      // frères convergent vers la vraie racine physique commune.
      if (seasonFolderIndex === null && seriesFolderIndex >= 0) {
        const episodeFolderName = parts[seriesFolderIndex];
        const EPISODE_RELEASE_FOLDER_PATTERN = /(?:^|[^a-z0-9])s\d{1,2}[\s._-]*e\d{1,4}(?:[^a-z0-9]|$)/i;
        if (EPISODE_RELEASE_FOLDER_PATTERN.test(episodeFolderName)) {
          const oldIndex = seriesFolderIndex;
          seriesFolderIndex -= 1;
          console.log(`[EPISODE-FOLDER-LIFT] ${parts[oldIndex]} -> ${seriesFolderIndex >= 0 ? parts[seriesFolderIndex] : rootBaseName}`);
        }
      }

      // V3.13.8 — une release de série peut être placée DIRECTEMENT sous la
      // racine de médiathèque tout en portant S01 dans son propre nom :
      //   /Animés/Shaman King (2021) S01 MULTi .../episode.mkv
      // Dans ce cas seasonFolderIndex === 0 et l'ancienne logique remontait à
      // -1, donc à /Animés. La protection V3.13 empêchait heureusement de créer
      // à nouveau la fausse série, mais elle empêchait aussi de réparer celle
      // déjà existante. Si ce dossier porte un vrai titre de release (et n'est
      // pas simplement "Saison 1" / "Season 1" / "S01"), il devient à
      // la fois la racine physique de la série et le porteur du numéro de saison.
      if (seasonFolderIndex === 0 && seriesFolderIndex < 0) {
        const seasonFolderName = parts[0];
        const pureSeasonContainer = /^(?:saison|season)[\s._-]*0*\d{1,2}$/i.test(seasonFolderName.trim()) ||
          /^s0*\d{1,2}$/i.test(seasonFolderName.trim());
        const parsedSeasonRelease = parseFilename(seasonFolderName);
        if (!pureSeasonContainer && parsedSeasonRelease?.type === 'SERIES' && parsedSeasonRelease.title) {
          seriesFolderIndex = 0;
          console.log(`[DIRECT-SEASON-RELEASE-ROOT] ${seasonFolderName}`);
        }
      }

      while (seriesFolderIndex >= 0 && isSeriesContainerFolder(parts[seriesFolderIndex])) {
        seriesFolderIndex--;
      }
      const folderParts = seriesFolderIndex >= 0 ? parts.slice(0, seriesFolderIndex + 1) : [];
      const physicalSeriesFolder = seriesFolderIndex >= 0
        ? path.join(root, ...folderParts)
        : path.resolve(root);
      const nfo = await seriesNfoFor(physicalSeriesFolder);

      // V3.13 — ne jamais transformer la RACINE D'UNE MÉDIATHÈQUE en série
      // simplement parce qu'un fichier placé directement dessous contient
      // SxxExx. C'est ce qui avait créé la fausse fiche "Animés" ensuite
      // rapprochée de SHAMAN KING. Une racine ciblée de vraie série reste
      // autorisée lorsqu'un tvshow.nfo fournit une identité explicite.
      const rootHasSeriesIdentity =
        Boolean(nfo.title) || nfo.tmdbId != null || Boolean(nfo.imdbId) || nfo.tvdbId != null;
      if (seriesFolderIndex < 0 && !rootHasSeriesIdentity && options.allowRootSeriesName !== true) {
        console.warn(`[SCAN-SKIP-LIBRARY-ROOT-SERIES] ${filePath}`);
        continue;
      }

      const trustedFolderName = seriesFolderIndex >= 0 ? parts[seriesFolderIndex] : rootBaseName;
      const parsedFolder = parseFilename(trustedFolderName);
      const nameIds = extractExternalIdsFromName(`${trustedFolderName ?? ''} ${filename}`);
      // Seul tvshow.nfo peut fournir l'identité de série. Le sidecar de
      // l'épisode reste volontairement hors de cette décision.
      const title = nfo.title || parsedFolder?.title || parsedFile.title;
      if (!title) continue;
      const year = nfo.year ?? (parsedFolder && 'year' in parsedFolder ? parsedFolder.year : null);

      const episodeNumbers = extractEpisodeNumbersFromFilename(filename, parsedFile.seasonNumber);
      const numbers = episodeNumbers.length > 0 ? episodeNumbers : [parsedFile.episodeNumber];
      for (const episodeNumber of numbers) {
        addEpisode(
          title,
          year,
          parsedFile.seasonNumber,
          episodeNumber,
          filePath,
          folderParts,
          nfo.tmdbId ?? parsedFolder?.tmdbIdHint ?? parsedFile.tmdbIdHint,
          nfo.imdbId ?? nameIds.imdbId,
          nfo.tvdbId ?? nameIds.tvdbId,
          nfo.nfoPath,
          [parsedFile.title, nfo.originalTitle ?? ''],
        );
      }
    } else {
      // Un dossier "Saison X" n'est JAMAIS un dossier dédié à un film —
      // c'est toujours un indicateur de série. Si on arrive ici malgré
      // tout (le fichier n'a pas été reconnu comme épisode plus haut,
      // souvent un motif de nommage encore non couvert), on refuse de lui
      // faire confiance comme titre, plutôt que de créer un faux film
      // appelé littéralement "Saison 1".
      const parentIsSeasonFolder =
        parentFolder != null && getSeasonNumberFromFolderName(parentFolder) != null;
      const trustedParentFolder =
        parentFolder && parentFolder !== rootBaseName && !parentIsSeasonFolder ? parentFolder : null;
      const parsedFolder = trustedParentFolder ? parseFilename(trustedParentFolder) : null;

      // Si le nom de fichier lui-même porte déjà un titre ET une année
      // (signal fort, ex: "1962 Dr. No MULTI..."), on lui fait confiance
      // en priorité — le dossier parent peut être une simple collection
      // ("007", "Star Wars") qui contient plusieurs films distincts, pas
      // un dossier dédié à CE film précis (contrairement à "Movie Name
      // (2020)/fichier.mkv", où dossier et fichier ne font qu'un).
      const filenameIsStrong = parsedFile.type === 'MOVIE' && parsedFile.year != null;
      const title = filenameIsStrong ? parsedFile.title : parsedFolder?.title || parsedFile.title;
      const year = filenameIsStrong
        ? parsedFile.year
        : (parsedFolder && 'year' in parsedFolder ? parsedFolder.year : null) ?? parsedFile.year;

      // Un fichier resté dans un dossier "Saison X" sans titre exploitable
      // (ni dans le nom de fichier, ni via un dossier de show plus haut,
      // puisqu'on refuse justement le dossier de saison lui-même) : mieux
      // vaut l'ignorer que créer une entrée au titre garbled.
      if (parentIsSeasonFolder && !title) continue;

      // Contenu "bonus" générique (générique de début/fin, opening,
      // ending...) à l'intérieur d'un dossier de saison : ce n'est pas un
      // épisode identifiable individuellement, chercher à le faire
      // correspondre à un film sur TMDB ne peut que tomber sur un résultat
      // n'ayant aucun rapport (le titre de fichier n'étant lui-même pas un
      // vrai titre) — mieux vaut l'ignorer proprement.
      if (parentIsSeasonFolder && /generique|générique|opening|ending|credits?/i.test(filename)) {
        continue;
      }

      const movieNfo = await movieNfoFor(path.dirname(filePath), filePath);
      const movieNameIds = extractExternalIdsFromName(`${parentFolder ?? ''} ${filename}`);
      movies.push({
        type: 'MOVIE',
        title: movieNfo.title || title,
        year: movieNfo.year ?? year,
        filePath,
        tmdbIdHint: movieNfo.tmdbId ?? parsedFolder?.tmdbIdHint ?? parsedFile.tmdbIdHint,
        imdbIdHint: movieNfo.imdbId ?? movieNameIds.imdbId,
        tvdbIdHint: movieNfo.tvdbId ?? movieNameIds.tvdbId,
        nfoPath: movieNfo.nfoPath,
      });
    }
  }

  return {
    items: [...movies, ...seriesByKey.values()],
    filesScanned: files.length,
    scanComplete: walkResult.complete,
    failedDirectories: walkResult.failedDirectories,
  };
}
