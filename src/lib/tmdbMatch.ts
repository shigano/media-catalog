import { env } from './config';

export type TmdbMatch = {
  tmdbId: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  overview: string;
  genres: string[];
  confident: boolean; // faux si le résultat n'est qu'une supposition
};

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// Liste des genres TMDB (identifiants stables, quasiment jamais modifiés) —
// en la codant en dur, on évite un appel API supplémentaire par item au
// moment du scan : les résultats de recherche TMDB donnent déjà les
// identifiants de genre (`genre_ids`), juste pas leur nom.
const MOVIE_GENRES: Record<number, string> = {
  28: 'Action', 12: 'Aventure', 16: 'Animation', 35: 'Comédie', 80: 'Crime',
  99: 'Documentaire', 18: 'Drame', 10751: 'Familial', 14: 'Fantastique',
  36: 'Histoire', 27: 'Horreur', 10402: 'Musique', 9648: 'Mystère',
  10749: 'Romance', 878: 'Science-Fiction', 10770: 'Téléfilm', 53: 'Thriller',
  10752: 'Guerre', 37: 'Western',
};
const TV_GENRES: Record<number, string> = {
  10759: 'Action & Aventure', 16: 'Animation', 35: 'Comédie', 80: 'Crime',
  99: 'Documentaire', 18: 'Drame', 10751: 'Familial', 10762: 'Enfants',
  9648: 'Mystère', 10763: 'Actualités', 10764: 'Réalité',
  10765: 'Science-Fiction & Fantastique', 10766: 'Soap', 10767: 'Talk-show',
  10768: 'Guerre & Politique', 37: 'Western',
};

function genreNamesFromIds(ids: number[] | undefined, type: 'MOVIE' | 'SERIES'): string[] {
  const map = type === 'MOVIE' ? MOVIE_GENRES : TV_GENRES;
  return (ids ?? []).map((id) => map[id]).filter((name): name is string => Boolean(name));
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' et ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`´ʼ“”\"«»()[\]{}:;,.!?/\\|+_=\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const maxLen = Math.max(na.length, nb.length);
  const editScore = 1 - levenshtein(na, nb) / maxLen;

  const wordsA = na.split(' ').filter(Boolean);
  const wordsB = nb.split(' ').filter(Boolean);
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  const tokenScore = union ? intersection / union : 0;

  // Un titre inclus dans l'autre est fréquent avec un sous-titre ajouté ou
  // omis. On ne lui donne pas 100 %, car "Alien" et "Alien Covenant" ne
  // sont pas le même film.
  const containmentScore = na.includes(nb) || nb.includes(na)
    ? Math.min(0.9, Math.min(na.length, nb.length) / maxLen + 0.15)
    : 0;

  return Math.max(editScore, tokenScore, containmentScore);
}

function resultTitleCandidates(result: any, type: 'MOVIE' | 'SERIES'): string[] {
  const values = type === 'MOVIE'
    ? [result.title, result.original_title]
    : [result.name, result.original_name];
  return values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function resultYearOf(result: any, type: 'MOVIE' | 'SERIES'): number | null {
  const dateStr: string | undefined = type === 'MOVIE' ? result.release_date : result.first_air_date;
  if (!dateStr || !/^\d{4}/.test(dateStr)) return null;
  return Number(dateStr.slice(0, 4));
}

function scoreCandidate(
  queryTitle: string,
  queryYear: number | null,
  result: any,
  type: 'MOVIE' | 'SERIES',
): { score: number; titleScore: number; yearDelta: number | null } {
  const titleScore = Math.max(
    0,
    ...resultTitleCandidates(result, type).map((candidate) => titleSimilarity(queryTitle, candidate)),
  );
  const resultYear = resultYearOf(result, type);
  const yearDelta = queryYear != null && resultYear != null ? Math.abs(queryYear - resultYear) : null;

  // Le titre domine volontairement. L'année sert surtout à départager les
  // remakes/homonymes ; popularité et nombre de votes ne sont que de petits
  // tie-breakers et ne peuvent pas transformer un mauvais titre en match.
  let score = titleScore * 0.78;
  if (queryYear == null || resultYear == null) {
    score += 0.10;
  } else if (yearDelta === 0) {
    score += 0.18;
  } else if (yearDelta === 1) {
    score += 0.14;
  } else if (yearDelta === 2) {
    score += 0.06;
  } else if (yearDelta != null && yearDelta >= 5) {
    score -= 0.12;
  }

  const voteCount = Number(result.vote_count ?? 0);
  const popularity = Number(result.popularity ?? 0);
  score += Math.min(0.025, Math.log10(voteCount + 1) / 160);
  score += Math.min(0.015, Math.log10(popularity + 1) / 120);

  return { score: Math.max(0, Math.min(1, score)), titleScore, yearDelta };
}

async function searchTmdbRaw(
  endpoint: 'movie' | 'tv',
  query: string,
  year: number | null,
  yearParam: string,
  language = 'fr-FR',
): Promise<any[]> {
  const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
  url.searchParams.set('query', query);
  url.searchParams.set('language', language);
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('api_key', env.tmdbApiKey());
  if (year) url.searchParams.set(yearParam, String(year));
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Erreur API TMDB ${response.status}`);
  const data = await response.json();
  return (data.results as any[]) ?? [];
}

function queryVariants(title: string): string[] {
  const variants = new Set<string>();
  const add = (v: string) => {
    const cleaned = v.replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 2) variants.add(cleaned);
  };
  add(title);

  // V3.13.6 — les noms de dossiers de séries gardent parfois l'année dans
  // le titre (ex. "Perdu dans l'espace (1965)"). TMDB attend le titre
  // sans cette année ; on conserve la requête originale puis cette variante.
  const withoutBracketedYear = title.replace(/\s*[\[(](?:19|20)\d{2}[\])]\s*/g, ' ').trim();
  if (withoutBracketedYear && withoutBracketedYear !== title) add(withoutBracketedYear);

  add(title.replace(/\s+et\s+/gi, ' & '));
  add(title.replace(/\s*&\s*/g, ' et '));

  // Supprime un sous-titre après un séparateur seulement comme variante de
  // secours. Ex: "Titre - Director's Cut" peut retrouver "Titre", sans
  // sacrifier la requête complète qui reste essayée en premier.
  const dash = title.split(/\s+[–—-]\s+/)[0];
  if (dash && dash !== title) add(dash);

  // V3.13.6 — certains dossiers nomment une deuxième partie/saison avec un
  // chiffre final ("Ready for Love 2") alors que TMDB indexe la série sans
  // ce suffixe. Variante de RECHERCHE seulement : l'acceptation reste soumise
  // aux seuils de similarité et d'année existants.
  const withoutTrailingPart = title.replace(/\s+(?:part(?:ie)?\s*)?[2-9]$/i, '').trim();
  if (withoutTrailingPart && withoutTrailingPart !== title) add(withoutTrailingPart);

  // V3.13.7 — petite tolérance singulier/pluriel pour les titres localisés.
  // Exemple réel : le dossier "Perdu dans l'espace" alors que l'alias FR
  // fournisseur est "Perdus dans l'espace". Ces variantes servent à la
  // RECHERCHE ; les garde-fous de score/année restent obligatoires.
  const words = withoutBracketedYear.split(/\s+/);
  if (words.length >= 2) {
    const first = words[0];
    if (/^[A-Za-zÀ-ÿ]{4,}$/.test(first)) {
      const toggled = first.toLowerCase().endsWith('s') ? first.slice(0, -1) : `${first}s`;
      add([toggled, ...words.slice(1)].join(' '));
    }
  }
  return [...variants];
}

/**
 * Cherche et classe plusieurs candidats TMDB. Contrairement à l'ancienne
 * version, le premier résultat de l'API n'est jamais accepté aveuglément.
 * Un match automatique exige un titre réellement proche, une année
 * cohérente quand elle est connue, et une avance suffisante sur le second
 * candidat pour éviter les remakes/homonymes.
 */
export async function findBestTmdbMatch(
  title: string,
  year: number | null,
  type: 'MOVIE' | 'SERIES',
  extraAliases: string[] = [],
): Promise<TmdbMatch | null> {
  const endpoint = type === 'MOVIE' ? 'movie' : 'tv';

  // V3.13.6 — si le scanner n'a pas extrait l'année mais qu'elle est encore
  // présente dans le titre du dossier, elle devient un signal de classement.
  // Le titre nettoyé participe aussi au score afin qu'un résultat TMDB exact
  // ne soit pas pénalisé par le suffixe "(1965)" local.
  const embeddedYearMatch = title.match(/[\[(]((?:19|20)\d{2})[\])]/);

  // V3.13.8 — alias local vérifié pour les rares suites dont le titre de
  // distribution n'est pas indexé comme titre principal par TMDB. Gardé
  // volontairement strict (titre normalisé exact) afin de ne pas influencer
  // les autres séries. Ready for Love 2 = Marry Me Again (2025), 31 épisodes.
  const normalizedInput = normalize(title);
  const knownTitleHints: Record<string, { aliases: string[]; year?: number }> = {
    'ready for love 2': { aliases: ['Marry Me Again'], year: 2025 },
  };
  const knownHint = knownTitleHints[normalizedInput];
  const effectiveYear = year ?? (embeddedYearMatch ? Number(embeddedYearMatch[1]) : null) ?? knownHint?.year ?? null;
  const titleWithoutEmbeddedYear = title.replace(/\s*[\[(](?:19|20)\d{2}[\])]\s*/g, ' ').replace(/\s+/g, ' ').trim();

  const yearParam = type === 'MOVIE' ? 'year' : 'first_air_date_year';
  const collected = new Map<number, any>();
  // V3.13.9 — mémorise les résultats réellement retournés par un alias
  // explicite avec l'année attendue. C'est important quand TMDB trouve la
  // bonne fiche via un titre alternatif, mais ne renvoie que le titre
  // local/original dans les champs `name`/`original_name`.
  const explicitAliasYearHits = new Set<number>();
  const normalizedExplicitAliases = new Set((knownHint?.aliases ?? []).map(normalize));

  const allVariants = [...new Set([
    ...queryVariants(title),
    ...(knownHint?.aliases ?? []).flatMap(queryVariants),
    ...extraAliases.flatMap(queryVariants),
  ])].slice(0, 12);
  console.log(`[IDENTIFY-QUERY] type=${type} original=${JSON.stringify(title)} year=${effectiveYear ?? 'none'} variants=${JSON.stringify(allVariants)}`);
  for (const variant of allVariants) {
    // Recherche avec l'année puis sans l'année. TMDB peut avoir une année
    // légèrement différente selon la première diffusion/sortie régionale.
    const withYear = await searchTmdbRaw(endpoint, variant, effectiveYear, yearParam);
    console.log(`[IDENTIFY-SEARCH] query=${JSON.stringify(variant)} year=${effectiveYear ?? 'none'} results=${withYear.length}`);
    const isExplicitAlias = normalizedExplicitAliases.has(normalize(variant));
    for (const r of withYear) {
      collected.set(r.id, r);
      if (isExplicitAlias && effectiveYear != null) explicitAliasYearHits.add(r.id);
    }
    if (collected.size < 8 && effectiveYear != null) {
      const withoutYear = await searchTmdbRaw(endpoint, variant, null, yearParam);
      console.log(`[IDENTIFY-SEARCH] query=${JSON.stringify(variant)} year=none results=${withoutYear.length}`);
      for (const r of withoutYear) collected.set(r.id, r);
    }
    if (collected.size >= 12) break;
  }

  // Certains titres étrangers ne ressortent pas bien avec les données
  // localisées FR. Une seconde langue sert uniquement de filet de sécurité.
  if (collected.size === 0) {
    for (const variant of allVariants.slice(0, 4)) {
      const en = await searchTmdbRaw(endpoint, variant, null, yearParam, 'en-US');
      for (const r of en) collected.set(r.id, r);
      if (collected.size >= 8) break;
    }
  }
  if (collected.size === 0) {
    console.log(`[IDENTIFY-NO-RESULT] original=${JSON.stringify(title)}`);
    return null;
  }

  // V3.13.7 — une variante qui a permis de TROUVER un candidat doit aussi
  // participer au score. En V3.13.6, "Ready for Love" pouvait trouver la
  // bonne fiche, puis être ignoré au scoring au profit du seul titre local
  // "Ready for Love 2".
  // V3.13.8 — une variante destructive qui retire un suffixe numérique
  // ("Ready for Love 2" -> "Ready for Love") sert à la découverte, mais
  // ne peut plus transformer la série précédente en correspondance parfaite.
  // Les alias explicites/vérifiés restent en revanche éligibles au score.
  const trailingPartRemoved = title.replace(/\s+(?:part(?:ie)?\s*)?[2-9]$/i, '').trim();
  const lossyNumericVariant = trailingPartRemoved && trailingPartRemoved !== title
    ? normalize(trailingPartRemoved)
    : null;
  const explicitScoreAliases = new Set([...(knownHint?.aliases ?? []), ...extraAliases].map(normalize));
  const scoreVariants = allVariants.filter((variant) =>
    lossyNumericVariant == null || normalize(variant) !== lossyNumericVariant || explicitScoreAliases.has(normalize(variant)),
  );
  const queryTitlesForScore = [...new Set([
    title,
    titleWithoutEmbeddedYear,
    ...scoreVariants,
    ...(knownHint?.aliases ?? []),
    ...extraAliases,
  ].filter(Boolean))];
  const ranked = [...collected.values()]
    .map((result) => {
      const scores = queryTitlesForScore.map((q) => scoreCandidate(q, effectiveYear, result, type));
      const bestScore = scores.sort((a, b) => b.score - a.score)[0];

      // V3.13.9 — un alias explicite n'est pas une simple variante
      // heuristique. Si TMDB renvoie ce candidat pour cet alias ET pour
      // l'année attendue, la provenance de la recherche devient elle-même
      // un signal fort. Cela corrige notamment Ready for Love 2 ->
      // Marry Me Again, dont le résultat TMDB localisé peut exposer un nom
      // chinois et donc obtenir à tort une faible similarité textuelle.
      if (explicitAliasYearHits.has(result.id)) {
        const resultYear = resultYearOf(result, type);
        const yearDelta = effectiveYear != null && resultYear != null
          ? Math.abs(effectiveYear - resultYear)
          : null;
        if (yearDelta == null || yearDelta <= 1) {
          console.log(`[IDENTIFY-ALIAS-HIT] original=${JSON.stringify(title)} tmdbId=${result.id} aliasYear=${effectiveYear ?? 'none'} resultYear=${resultYear ?? 'none'}`);
          return {
            result,
            score: Math.max(bestScore.score, 0.965),
            titleScore: Math.max(bestScore.titleScore, 0.99),
            yearDelta,
            explicitAliasHit: true,
          };
        }
      }

      return { result, ...bestScore, explicitAliasHit: false };
    })
    .sort((a, b) => b.score - a.score);

  const bestRanked = ranked[0];
  const second = ranked[1];
  const best = bestRanked.result;
  const resultTitle = type === 'MOVIE' ? best.title : best.name;
  const resultYear = resultYearOf(best, type);
  const margin = second ? bestRanked.score - second.score : 1;

  console.log(`[IDENTIFY-CANDIDATE] original=${JSON.stringify(title)} tmdbId=${best.id} title=${JSON.stringify(resultTitle)} year=${resultYear ?? 'none'} titleScore=${bestRanked.titleScore.toFixed(4)} score=${bestRanked.score.toFixed(4)} margin=${margin.toFixed(4)}`);

  // Seuils prudents : mieux vaut "À vérifier" qu'un faux positif silencieux.
  const yearAcceptable = bestRanked.yearDelta == null || bestRanked.yearDelta <= 2;
  const strongTitle = bestRanked.titleScore >= 0.88;
  const exactNormalizedTitle = resultTitleCandidates(best, type).some(
    (candidate) => queryTitlesForScore.some((q) => normalize(candidate) === normalize(q)),
  );
  const confident =
    yearAcceptable &&
    strongTitle &&
    bestRanked.score >= 0.78 &&
    (margin >= 0.035 || exactNormalizedTitle || bestRanked.explicitAliasHit === true);

  // En dessous de ce plancher, le candidat n'est même pas assez proche pour
  // être utile dans "À vérifier" : on le traite comme non reconnu.
  if (bestRanked.titleScore < 0.48 || bestRanked.score < 0.46) {
    console.log(`[IDENTIFY-REJECT] tmdbId=${best.id} reason=below-floor`);
    return null;
  }

  console.log(`[IDENTIFY-MATCH] tmdbId=${best.id} title=${JSON.stringify(resultTitle)} confident=${confident} score=${bestRanked.score.toFixed(4)}`);
  return {
    tmdbId: best.id,
    title: resultTitle,
    year: resultYear,
    posterUrl: best.poster_path ? `${IMAGE_BASE}${best.poster_path}` : null,
    overview: best.overview ?? '',
    genres: genreNamesFromIds(best.genre_ids, type),
    confident,
  };
}

export async function findTmdbById(
  tmdbId: number,
  type: 'MOVIE' | 'SERIES',
): Promise<TmdbMatch | null> {
  const endpoint = type === 'MOVIE' ? 'movie' : 'tv';
  const url = new URL(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}`);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('api_key', env.tmdbApiKey());
  const response = await fetch(url.toString());
  if (!response.ok) return null;
  const data = await response.json();
  const resultTitle = type === 'MOVIE' ? data.title : data.name;
  if (!resultTitle) return null;
  const dateStr: string | undefined = type === 'MOVIE' ? data.release_date : data.first_air_date;
  const resultYear = dateStr && /^\d{4}/.test(dateStr) ? Number(dateStr.slice(0, 4)) : null;
  return {
    tmdbId: data.id,
    title: resultTitle,
    year: resultYear,
    posterUrl: data.poster_path ? `${IMAGE_BASE}${data.poster_path}` : null,
    overview: data.overview ?? '',
    genres: (data.genres ?? []).map((g: any) => g.name).filter((name: any): name is string => typeof name === 'string'),
    confident: true,
  };
}

export type TmdbSeasonEpisode = {
  /** Id TMDB propre à cet épisode précis (distinct de l'id de la série) —
   * permet une identification fiable indépendante du numéro de
   * saison/épisode (utile si jamais TMDB renumérote une saison). */
  tmdbEpisodeId: number;
  episodeNumber: number;
  name: string;
  overview: string;
  airDate: string | null;
  stillUrl: string | null;
};

export type TmdbSeasonDetails = {
  posterUrl: string | null;
  episodes: TmdbSeasonEpisode[];
};

/**
 * Détails d'une saison précise : son affiche, et pour chaque épisode son
 * nom, synopsis, date de sortie et vignette — tout en un seul appel TMDB
 * par langue (leur endpoint "saison" renvoie déjà la liste complète des
 * épisodes). Le français est prioritaire, mais TMDB laisse souvent les
 * synopsis d'épisodes vides en français sur les séries moins connues —
 * on complète alors avec la version anglaise plutôt que de laisser vide.
 * Renvoie null si la saison n'existe pas du tout côté TMDB (numérotation
 * qui ne correspond pas exactement, fréquent avec les animes à
 * numérotation absolue) — pas une erreur bloquante, juste une saison
 * sans enrichissement.
 */
export async function getTmdbSeasonDetails(
  tmdbId: number,
  seasonNumber: number,
): Promise<TmdbSeasonDetails | null> {
  const fetchSeason = async (language: string) => {
    const url = new URL(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}`);
    url.searchParams.set('language', language);
    url.searchParams.set('api_key', env.tmdbApiKey());
    const response = await fetch(url.toString(), { next: { revalidate: 21600 } });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.success === false ? null : data;
  };

  const [frData, enData] = await Promise.all([fetchSeason('fr-FR'), fetchSeason('en-US')]);
  const base = frData ?? enData;
  if (!base) return null;

  const enEpisodeByNumber = new Map<number, any>(
    (enData?.episodes ?? []).map((ep: any) => [ep.episode_number, ep]),
  );

  return {
    posterUrl: base.poster_path ? `${IMAGE_BASE}${base.poster_path}` : null,
    episodes: (base.episodes ?? []).map((ep: any) => {
      const enFallback = enEpisodeByNumber.get(ep.episode_number);
      return {
        tmdbEpisodeId: ep.id,
        episodeNumber: ep.episode_number,
        name: ep.name || enFallback?.name || `Épisode ${ep.episode_number}`,
        overview: ep.overview || enFallback?.overview || '',
        airDate: ep.air_date ?? enFallback?.air_date ?? null,
        stillUrl: ep.still_path
          ? `${IMAGE_BASE}${ep.still_path}`
          : enFallback?.still_path
            ? `${IMAGE_BASE}${enFallback.still_path}`
            : null,
      };
    }),
  };
}

export type TmdbCastMember = {
  name: string;
  character: string;
  profileUrl: string | null;
};

export type TmdbFullDetails = {
  runtimeMinutes: number | null;
  genres: string[];
  tagline: string | null;
  voteAverage: number | null;
  backdropUrl: string | null;
  imdbId: string | null;
  cast: TmdbCastMember[];
  /** Présent seulement pour un film appartenant à une saga TMDB. */
  collection: { id: number; name: string; posterUrl: string | null } | null;
  /**
   * Statut officiel TMDB d'une série ("Returning Series", "Ended",
   * "Canceled", "In Production", "Planned", "Pilot") — null pour un film.
   * Sert au suivi "séries en cours" : une série sort automatiquement de
   * la liste suivie une fois son statut passé à "Ended" ou "Canceled".
   */
  seriesStatus: string | null;
  /** Idem, indicateur booléen TMDB équivalent — null pour un film. */
  inProduction: boolean | null;
  /**
   * Classification parentale brute ("U", "10", "12", "16", "18"...) —
   * France si disponible, USA en repli sinon. Peut être null si TMDB n'a
   * aucune donnée pour ce titre.
   */
  certification: string | null;
  /**
   * Prochain épisode à diffuser selon TMDB — null pour un film, ou pour
   * une série sans épisode annoncé pour l'instant.
   */
  nextEpisode: TmdbNextEpisode | null;
};

export type TmdbNextEpisode = {
  airDate: string; // format TMDB "YYYY-MM-DD"
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
};

const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
const PROFILE_BASE = 'https://image.tmdb.org/t/p/w200';

/**
 * Convertit une classification brute TMDB en rang numérique croissant
 * (0 = tous publics, plus haut = plus restrictif) pour permettre un tri
 * direct en base — TMDB ne renvoie pas un vocabulaire parfaitement
 * homogène ("U", "PG", "10", "-12", "16+"...), donc on extrait le premier
 * nombre trouvé comme âge minimum ; sans nombre ("U", "G", "Tous
 * publics"...) ou classification absente, rang 0 (tous publics par
 * défaut plutôt que de fausser le tri en les mettant tout en bas).
 */
export function certificationRank(certification: string | null): number {
  if (!certification) return 0;
  const match = certification.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Détails enrichis d'un film ou d'une série déjà reconnu — genres, note,
 * durée, casting principal, image de fond large, lien IMDb, et
 * appartenance à une saga le cas échéant. Un seul appel (avec
 * append_to_response) suffit à tout récupérer d'un coup côté TMDB.
 */
export async function getTmdbFullDetails(
  tmdbId: number,
  type: 'MOVIE' | 'SERIES',
): Promise<TmdbFullDetails | null> {
  const endpoint = type === 'MOVIE' ? 'movie' : 'tv';
  const url = new URL(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}`);
  url.searchParams.set('language', 'fr-FR');
  // "release_dates" (films) / "content_ratings" (séries) donnent la
  // classification par pays en un seul appel supplémentaire, sans coût
  // API additionnel (même requête, juste un champ de plus demandé).
  url.searchParams.set(
    'append_to_response',
    type === 'MOVIE' ? 'credits,external_ids,release_dates' : 'credits,external_ids,content_ratings',
  );
  url.searchParams.set('api_key', env.tmdbApiKey());

  const response = await fetch(url.toString(), { next: { revalidate: 21600 } });
  if (!response.ok) return null;
  const d = await response.json();

  // Classification : France en priorité, USA en repli si absente côté
  // FR — TMDB laisse souvent le champ FR vide même quand les données US
  // existent.
  let certification: string | null = null;
  if (type === 'MOVIE') {
    const results = d.release_dates?.results ?? [];
    const fr = results.find((r: any) => r.iso_3166_1 === 'FR');
    const us = results.find((r: any) => r.iso_3166_1 === 'US');
    certification =
      fr?.release_dates?.find((rd: any) => rd.certification)?.certification ||
      us?.release_dates?.find((rd: any) => rd.certification)?.certification ||
      null;
  } else {
    const results = d.content_ratings?.results ?? [];
    const fr = results.find((r: any) => r.iso_3166_1 === 'FR');
    const us = results.find((r: any) => r.iso_3166_1 === 'US');
    certification = fr?.rating || us?.rating || null;
  }

  return {
    runtimeMinutes: type === 'MOVIE' ? (d.runtime ?? null) : (d.episode_run_time?.[0] ?? null),
    genres: (d.genres ?? []).map((g: any) => g.name),
    tagline: d.tagline || null,
    voteAverage: typeof d.vote_average === 'number' ? d.vote_average : null,
    backdropUrl: d.backdrop_path ? `${BACKDROP_BASE}${d.backdrop_path}` : null,
    imdbId: d.external_ids?.imdb_id ?? null,
    certification,
    cast: (d.credits?.cast ?? []).slice(0, 12).map((c: any) => ({
      name: c.name,
      character: c.character ?? '',
      profileUrl: c.profile_path ? `${PROFILE_BASE}${c.profile_path}` : null,
    })),
    collection: d.belongs_to_collection
      ? {
          id: d.belongs_to_collection.id,
          name: d.belongs_to_collection.name,
          // TMDB fournit une affiche DÉDIÉE à la collection, distincte de
          // celle de chaque film — c'est elle qu'on veut pour la tuile de
          // saga groupée, pas l'affiche du premier film venu.
          posterUrl: d.belongs_to_collection.poster_path
            ? `${IMAGE_BASE}${d.belongs_to_collection.poster_path}`
            : null,
        }
      : null,
    seriesStatus: type === 'SERIES' ? (d.status ?? null) : null,
    inProduction: type === 'SERIES' ? (d.in_production ?? null) : null,
    nextEpisode:
      type === 'SERIES' && d.next_episode_to_air
        ? {
            airDate: d.next_episode_to_air.air_date,
            seasonNumber: d.next_episode_to_air.season_number,
            episodeNumber: d.next_episode_to_air.episode_number,
            name: d.next_episode_to_air.name || null,
          }
        : null,
  };
}

/**
 * Statut TMDB d'une série, léger (pas de casting/collection) — utilisé
 * pour la liste admin des "séries en cours" : un appel simple par série
 * suivie, pas besoin du détail complet.
 */
export type TmdbSeriesSeason = { seasonNumber: number; episodeCount: number };

export async function getTmdbSeriesStatus(tmdbId: number): Promise<{
  status: string | null;
  inProduction: boolean | null;
  nextEpisode: TmdbNextEpisode | null;
  /** Une entrée par saison (numéro + nombre d'épisodes selon TMDB),
   * saison 0 ("Spéciaux") exclue — sert à savoir quelles saisons vérifier
   * en détail pour calculer les épisodes manquants, sans avoir à
   * requêter TOUTES les saisons systématiquement. */
  seasons: TmdbSeriesSeason[];
} | null> {
  const url = new URL(`https://api.themoviedb.org/3/tv/${tmdbId}`);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('api_key', env.tmdbApiKey());

  const response = await fetch(url.toString(), { next: { revalidate: 3600 } });
  if (!response.ok) return null;
  const d = await response.json();
  return {
    status: d.status ?? null,
    inProduction: typeof d.in_production === 'boolean' ? d.in_production : null,
    nextEpisode: d.next_episode_to_air
      ? {
          airDate: d.next_episode_to_air.air_date,
          seasonNumber: d.next_episode_to_air.season_number,
          episodeNumber: d.next_episode_to_air.episode_number,
          name: d.next_episode_to_air.name || null,
        }
      : null,
    seasons: (d.seasons ?? [])
      .filter((s: any) => s.season_number !== 0)
      .map((s: any) => ({ seasonNumber: s.season_number, episodeCount: s.episode_count ?? 0 })),
  };
}

export type TmdbCollectionMovie = {
  tmdbId: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  releaseDate: string | null;
};

/**
 * Appartenance à une saga TMDB — appel minimal (juste l'endpoint de base
 * du film, sans append_to_response) utilisé au moment même du scan pour
 * détecter automatiquement une saga dès qu'un film est reconnu, sans
 * attendre une consultation de fiche ou un passage d'enrichissement.
 */
export async function getTmdbMovieCollection(
  tmdbId: number,
): Promise<{ id: number; name: string; posterUrl: string | null } | null> {
  const url = new URL(`https://api.themoviedb.org/3/movie/${tmdbId}`);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('api_key', env.tmdbApiKey());

  const response = await fetch(url.toString(), { next: { revalidate: 43200 } });
  if (!response.ok) return null;
  const d = await response.json();
  if (!d.belongs_to_collection) return null;
  return {
    id: d.belongs_to_collection.id,
    name: d.belongs_to_collection.name,
    posterUrl: d.belongs_to_collection.poster_path
      ? `${IMAGE_BASE}${d.belongs_to_collection.poster_path}`
      : null,
  };
}

/**
 * Films d'une saga TMDB, triés par date de sortie — pour proposer un
 * visionnage dans l'ordre, comme Jellyfin le fait pour les collections.
 */
export async function getTmdbCollection(collectionId: number): Promise<TmdbCollectionMovie[]> {
  const url = new URL(`https://api.themoviedb.org/3/collection/${collectionId}`);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('api_key', env.tmdbApiKey());

  const response = await fetch(url.toString(), { next: { revalidate: 43200 } });
  if (!response.ok) return [];
  const d = await response.json();

  return (d.parts ?? [])
    .map((p: any) => ({
      tmdbId: p.id,
      title: p.title,
      year: p.release_date ? Number(p.release_date.slice(0, 4)) : null,
      posterUrl: p.poster_path ? `${IMAGE_BASE}${p.poster_path}` : null,
      releaseDate: p.release_date || null,
    }))
    .sort((a: TmdbCollectionMovie, b: TmdbCollectionMovie) =>
      (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'),
    );
}

/** Résout un identifiant IMDb/TVDB via l'endpoint /find de TMDB. Cela permet
 * de croiser les fournisseurs sans imposer une clé OMDb/TVDB supplémentaire. */
export async function findTmdbByExternalId(
  externalId: string | number,
  source: 'imdb_id' | 'tvdb_id',
  type: 'MOVIE' | 'SERIES',
): Promise<TmdbMatch | null> {
  const url = new URL(`https://api.themoviedb.org/3/find/${externalId}`);
  url.searchParams.set('external_source', source);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('api_key', env.tmdbApiKey());
  const response = await fetch(url.toString());
  if (!response.ok) return null;
  const d = await response.json();
  const list = type === 'MOVIE' ? d.movie_results : d.tv_results;
  const first = Array.isArray(list) ? list[0] : null;
  if (!first?.id) return null;
  return findTmdbById(first.id, type);
}

/** Vérifie que les saisons vues sur disque existent réellement chez TMDB.
 * Retourne un score 0..1 et la liste des saisons absentes. */
export async function validateTmdbSeriesSeasons(
  tmdbId: number,
  seasonsOnDisk: number[],
): Promise<{ score: number; missingSeasons: number[] }> {
  const status = await getTmdbSeriesStatus(tmdbId).catch(() => null);
  if (!status || seasonsOnDisk.length === 0) return { score: 0.5, missingSeasons: [] };
  const known = new Set(status.seasons.map((s) => s.seasonNumber));
  const missing = [...new Set(seasonsOnDisk.filter((n) => n > 0 && !known.has(n)))];
  return { score: missing.length === 0 ? 1 : Math.max(0, 1 - missing.length / Math.max(1, seasonsOnDisk.length)), missingSeasons: missing };
}
