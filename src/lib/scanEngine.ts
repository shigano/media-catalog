import * as fs from "node:fs/promises";
import { createHash } from 'node:crypto';
import path from 'node:path';
import { db } from './db';
import { notifyDiscordNewItem } from './discord';
import { getLibrariesForScan, type LibraryForScan } from './libraries';
import { scanLibraryRoot, walkVideoFiles, walkVideoFilesDetailed, type DetectedItem } from './scanner';
import { findBestTmdbMatch, findTmdbById, findTmdbByExternalId, getTmdbMovieCollection, getTmdbSeasonDetails, getTmdbSeriesStatus, validateTmdbSeriesSeasons, titleSimilarity, type TmdbMatch } from './tmdbMatch';
import { getAniListAliases } from './localMetadata';
import { stat } from 'node:fs/promises';
import { probeFile, getDuration } from './ffprobe';
import { env } from './config';
import { withRetry } from './retry';


type ProviderEpisodeMetadata = {
  tmdbEpisodeId: number;
  name: string;
  overview: string;
  airDate: string | null;
  stillUrl: string | null;
};

/** V3.13.14 — construit une correspondance fournisseur sûre pour TOUS les
 * épisodes locaux. Cas normal: SxxExx local == TMDB. Cas anime découpé en
 * arcs/saisons locales (ex. Reborn: 8 saisons locales mais 203 épisodes dans
 * une seule saison TMDB): si et seulement si le nombre TOTAL d'épisodes est
 * identique, on mappe par ordre absolu. Aucun mapping ordinal partiel. */
async function buildProviderEpisodeMap(
  tmdbId: number,
  episodes: Array<{ seasonNumber: number; episodeNumber: number }>,
): Promise<{ byLocalKey: Map<string, ProviderEpisodeMetadata>; mode: 'DIRECT' | 'PARTIAL_DIRECT' | 'ORDINAL' | 'NONE'; providerTotal: number }> {
  const byLocalKey = new Map<string, ProviderEpisodeMetadata>();
  const status = await withRetry(() => getTmdbSeriesStatus(tmdbId)).catch(() => null);
  if (!status) return { byLocalKey, mode: 'NONE', providerTotal: 0 };

  const detailsBySeason = new Map<number, Awaited<ReturnType<typeof getTmdbSeasonDetails>>>();
  for (const season of status.seasons) {
    const details = await withRetry(() => getTmdbSeasonDetails(tmdbId, season.seasonNumber)).catch(() => null);
    detailsBySeason.set(season.seasonNumber, details);
  }

  const localSorted = [...episodes].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  const providerSorted = [...detailsBySeason.entries()].flatMap(([seasonNumber, details]) =>
    (details?.episodes ?? []).map((ep) => ({ seasonNumber, ...ep })),
  ).sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);

  const providerTotal = providerSorted.length;
  const directComplete = localSorted.every((local) =>
    (detailsBySeason.get(local.seasonNumber)?.episodes ?? []).some((ep) => ep.episodeNumber === local.episodeNumber),
  );

  if (directComplete) {
    for (const local of localSorted) {
      const ep = (detailsBySeason.get(local.seasonNumber)?.episodes ?? []).find((x) => x.episodeNumber === local.episodeNumber)!;
      byLocalKey.set(`${local.seasonNumber}:${local.episodeNumber}`, ep);
    }
    return { byLocalKey, mode: 'DIRECT', providerTotal };
  }

  if (localSorted.length > 0 && localSorted.length === providerSorted.length) {
    localSorted.forEach((local, index) => byLocalKey.set(`${local.seasonNumber}:${local.episodeNumber}`, providerSorted[index]));
    return { byLocalKey, mode: 'ORDINAL', providerTotal };
  }

  // V3.15.29 — certaines séries sont publiées par le fournisseur sous une
  // seule saison à numérotation absolue, alors que l'édition locale redémarre
  // à E01 pour chaque saison (ex. Jujutsu Kaisen).
  //
  // Sécurité : ordinal partiel uniquement si :
  // - le fournisseur n'a qu'une seule saison ;
  // - le local possède plusieurs saisons ;
  // - chaque saison locale commence à E01 et est strictement continue ;
  // - le local contient moins d'épisodes que le fournisseur.
  const providerSeasonNumbers = new Set(
    providerSorted.map((ep) => ep.seasonNumber),
  );
  const localSeasonNumbers = [
    ...new Set(localSorted.map((ep) => ep.seasonNumber)),
  ];

  const localSeasonsAreContiguousFromOne =
    localSeasonNumbers.length > 1 &&
    localSeasonNumbers.every((seasonNumber) => {
      const numbers = localSorted
        .filter((ep) => ep.seasonNumber === seasonNumber)
        .map((ep) => ep.episodeNumber)
        .sort((a, b) => a - b);

      return (
        numbers.length > 0 &&
        numbers[0] === 1 &&
        numbers.every((number, index) => number === index + 1)
      );
    });

  if (
    localSorted.length > 0 &&
    localSorted.length < providerSorted.length &&
    providerSeasonNumbers.size === 1 &&
    localSeasonsAreContiguousFromOne
  ) {
    localSorted.forEach((local, index) => {
      const provider = providerSorted[index];
      if (provider) {
        byLocalKey.set(
          `${local.seasonNumber}:${local.episodeNumber}`,
          provider,
        );
      }
    });

    return {
      byLocalKey,
      mode: 'PARTIAL_DIRECT',
      providerTotal,
    };
  }

  // V3.13.29 — si les totaux local/fournisseur diffèrent, ne jamais tenter
  // d'alignement ordinal partiel. En revanche, les coordonnées SxxExx qui
  // existent exactement des deux côtés sont sûres et peuvent être enrichies.
  // Les coordonnées locales absentes de TMDB restent volontairement sans
  // correspondance fournisseur.
  for (const local of localSorted) {
    const ep = (detailsBySeason.get(local.seasonNumber)?.episodes ?? []).find(
      (x) => x.episodeNumber === local.episodeNumber,
    );
    if (ep) {
      byLocalKey.set(`${local.seasonNumber}:${local.episodeNumber}`, ep);
    }
  }

  if (byLocalKey.size > 0) {
    return { byLocalKey, mode: 'PARTIAL_DIRECT', providerTotal };
  }

  return { byLocalKey, mode: 'NONE', providerTotal };
}


async function resolveMatch(item: DetectedItem, libraryName?: string): Promise<{ match: TmdbMatch | null; source: string; score: number; reason: string }> {
  if (item.tmdbIdHint != null) {
    const match = await findTmdbById(item.tmdbIdHint, item.type);
    return { match, source: 'NFO/TMDB-ID', score: match ? 1 : 0, reason: match ? `ID TMDB explicite: ${item.tmdbIdHint}` : `ID TMDB introuvable: ${item.tmdbIdHint}` };
  }
  if (item.imdbIdHint) {
    const match = await findTmdbByExternalId(item.imdbIdHint, 'imdb_id', item.type);
    if (match) return { match, source: 'NFO/IMDb→TMDB', score: 0.99, reason: `ID IMDb explicite ${item.imdbIdHint} résolu via TMDB` };
  }
  if (item.tvdbIdHint) {
    const match = await findTmdbByExternalId(item.tvdbIdHint, 'tvdb_id', item.type);
    if (match) return { match, source: 'NFO/TVDB→TMDB', score: 0.99, reason: `ID TVDB explicite ${item.tvdbIdHint} résolu via TMDB` };
  }

  const isAnime = /anim[ée]s?/i.test(libraryName ?? '');
  const detectedAliases = item.type === 'SERIES' ? item.aliases : [];
  const aniAliases = isAnime ? await getAniListAliases(item.title) : [];

  // V3.8 — VERROU D'IDENTITÉ PHYSIQUE.
  // Les alias issus des noms de fichiers peuvent être plus génériques que le
  // dossier de série (ex. dossier "Bleach La Guerre Sanglante..." mais un
  // parseur qui remonte simplement "Bleach"). Un tel alias ne doit jamais
  // pouvoir faire converger une branche distincte vers la série parente.
  // On ne garde donc, pour la reconnaissance automatique, que les alias qui
  // conservent une part significative des mots distinctifs du titre local.
  const normTokens = (value: string) => new Set(
    value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t.length > 2),
  );
  const identityTokens = normTokens(item.title);
  const aliasPreservesIdentity = (alias: string) => {
    if (identityTokens.size <= 1) return true;
    const aliasTokens = normTokens(alias);
    const overlap = [...identityTokens].filter((t) => aliasTokens.has(t)).length;
    return overlap / identityTokens.size >= 0.5;
  };
  const aliases = [...new Set([...detectedAliases, ...aniAliases].filter((alias) => alias && aliasPreservesIdentity(alias)))];
  const match = await findBestTmdbMatch(item.title, item.year, item.type, aliases);
  if (!match) return { match: null, source: isAnime ? 'TMDB+AniList' : 'TMDB', score: 0, reason: 'Aucun candidat assez proche' };

  let score = match.confident ? 0.88 : 0.62;
  const reasons = [match.confident ? 'Titre/année TMDB cohérents' : 'Candidat TMDB ambigu'];
  if (aliases.length) reasons.push(`Alias de détection utilisés: ${aliases.slice(0, 4).join(' | ')}`);
  if (item.type === 'SERIES') {
    const seasons = [...new Set(item.episodes.map((e) => e.seasonNumber))];
    const validation = await validateTmdbSeriesSeasons(match.tmdbId, seasons);
    const topologyAdjusted = Math.max(0, Math.min(1, score * 0.82 + validation.score * 0.18));
    // V3.12 : l'organisation LOCALE des saisons ne doit plus annuler une
    // identité TMDB forte. Exemple Les Aventures de Sonic : même série et
    // mêmes 65 épisodes, mais le pack local les répartit sur 4 saisons.
    // On garde la série MATCHED et on journalise le décalage dans ScanReview.
    score = match.confident ? Math.max(0.80, topologyAdjusted) : topologyAdjusted;
    if (validation.missingSeasons.length) reasons.push(`Saison(s) absente(s) chez TMDB: ${validation.missingSeasons.join(', ')}`);
    else reasons.push('Saisons présentes chez TMDB');
  }
  return { match, source: isAnime ? 'TMDB+AniList' : 'TMDB', score, reason: reasons.join(' ; ') };
}

async function resolveWithExistingTmdb(
  item: DetectedItem,
  existing: { tmdbId: number | null; matchedTitle: string | null; matchStatus: string } | null,
  libraryName?: string,
): Promise<{ match: TmdbMatch | null; source: string; score: number; reason: string }> {
  // V3.13.26 — une identité TMDB déjà MATCHED reste stable même lorsque
  // manuallyVerified=false. Le déverrouillage des métadonnées doit permettre
  // de rafraîchir affiches/résumés/saisons, jamais de réidentifier
  // automatiquement une série déjà reconnue.
  //
  // Le rematch manuel reste indépendant de cette logique de scan.
  if (existing?.tmdbId != null && existing.matchStatus === 'MATCHED') {
    const match = await withRetry(() => findTmdbById(existing.tmdbId!, item.type)).catch(() => null);
    if (match) {
      return {
        match,
        source: 'EXISTING-MATCHED-TMDB-ID',
        score: 0.99,
        reason: `Identité TMDB MATCHED conservée: ${existing.tmdbId}`,
      };
    }

    // Si TMDB est momentanément indisponible, ne pas remplacer une identité
    // validée par une recherche textuelle potentiellement différente.
    return {
      match: null,
      source: 'ERROR',
      score: 0,
      reason: `Impossible de revalider temporairement l'ID TMDB existant: ${existing.tmdbId}`,
    };
  }

  // V3.12 — récupération d'un scan interrompu/ancien : plusieurs fiches ont
  // déjà le BON tmdbId + matchedTitle mais sont restées AMBIGUOUS/UNMATCHED
  // avec score/reason vides. On revalide l'ID chez TMDB au lieu de repartir
  // d'une recherche textuelle fragile. Garde-fou : le titre local doit rester
  // suffisamment proche du titre fournisseur, afin de ne pas verrouiller un
  // ancien faux positif (ex. "Spéciaux" -> "FX Effets Spéciaux").
  if (existing?.tmdbId != null && existing.matchedTitle && existing.matchStatus !== 'MATCHED') {
    const storedSimilarity = titleSimilarity(item.title, existing.matchedTitle);
    if (storedSimilarity >= 0.62) {
      const match = await withRetry(() => findTmdbById(existing.tmdbId!, item.type)).catch(() => null);
      if (match && titleSimilarity(item.title, match.title) >= 0.62) {
        return {
          match,
          source: 'EXISTING-TMDB-ID',
          score: 0.96,
          reason: `ID TMDB existant revalidé: ${existing.tmdbId}`,
        };
      }
    }
  }
  return resolveMatch(item, libraryName);
}

async function upsertScanReview(args: {
  mediaItemId: string;
  mediaType: 'MOVIE' | 'SERIES';
  detectedTitle: string;
  folderPath?: string | null;
  sourcePath?: string | null;
  proposedTmdbId?: number | null;
  proposedTitle?: string | null;
  score?: number | null;
  reason?: string | null;
  issueType: string;
}) {
  const existing = await db.scanReview.findUnique({
    where: { mediaItemId_issueType: { mediaItemId: args.mediaItemId, issueType: args.issueType } },
  });
  const data = {
    mediaType: args.mediaType,
    detectedTitle: args.detectedTitle,
    folderPath: args.folderPath ?? null,
    sourcePath: args.sourcePath ?? null,
    proposedTmdbId: args.proposedTmdbId ?? null,
    proposedTitle: args.proposedTitle ?? null,
    identificationScore: args.score ?? null,
    identificationReason: args.reason ?? null,
    status: 'OPEN',
    resolvedAt: null,
  };
  if (existing) {
    await db.scanReview.update({ where: { id: existing.id }, data });
  } else {
    await db.scanReview.create({ data: { mediaItemId: args.mediaItemId, issueType: args.issueType, ...data } });
  }
}

async function resolveScanReview(mediaItemId: string, issueType: string) {
  await db.scanReview.updateMany({
    where: { mediaItemId, issueType, status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });
}

async function probeEpisodeFile(filePath: string) {
  try {
    const st = await stat(filePath);
    if (!env.deepMediaAnalysis()) {
      return { fileSizeBytes: BigInt(st.size), fileModifiedAt: st.mtime };
    }
    const [codecs, duration] = await Promise.all([
      probeFile(filePath).catch(() => ({ videoCodec: null, audioCodec: null })),
      getDuration(filePath),
    ]);
    return { fileSizeBytes: BigInt(st.size), fileModifiedAt: st.mtime, durationSeconds: duration == null ? null : Math.round(duration), videoCodec: codecs.videoCodec, audioCodec: codecs.audioCodec };
  } catch {
    return {};
  }
}
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function autoPublishNewMediaEnabled() {
  const setting = await db.systemSetting.findUnique({ where: { key: 'AUTO_PUBLISH_NEW_MEDIA' } }).catch(() => null);
  return setting?.value === 'true';
}

export async function queueNewMedia(args: {
  type: 'MOVIE' | 'SERIES' | 'EPISODE';
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  mediaPath?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  sourceMediaItemId?: string | null;
  sourceEpisodeId?: string | null;
}) {
  if (await autoPublishNewMediaEnabled()) return;
  if (args.sourceEpisodeId) {
    const exists = await db.upcomingRelease.findUnique({ where: { sourceEpisodeId: args.sourceEpisodeId } });
    if (exists) return;
  } else if (args.sourceMediaItemId) {
    const exists = await db.upcomingRelease.findUnique({ where: { sourceMediaItemId: args.sourceMediaItemId } });
    if (exists) return;
  }
  await db.upcomingRelease.create({
    data: {
      type: args.type, title: args.title, subtitle: args.subtitle ?? null, imageUrl: args.imageUrl ?? null,
      mediaPath: args.mediaPath ?? null, seasonNumber: args.seasonNumber ?? null, episodeNumber: args.episodeNumber ?? null,
      sourceMediaItemId: args.sourceMediaItemId ?? null, sourceEpisodeId: args.sourceEpisodeId ?? null,
      status: 'PENDING',
      enabled: true,
      availableAt: null,
      publishAt: null,
    },
  });
  console.log(`[UPCOMING-PENDING] ${args.type} ${args.title}${args.subtitle ? ` — ${args.subtitle}` : ''}`);
}

function fingerprintPaths(paths: string[]): string {
  const hash = createHash('sha1');
  for (const filePath of [...paths].sort()) {
    hash.update(filePath);
    hash.update('\n');
  }
  return hash.digest('hex');
}

export async function persistItem(
  item: DetectedItem,
  libraryId: string,
  libraryName?: string,
  options: { queueUpcoming?: boolean } = {},
) {
  // V3.15.28 — un scan normal conserve le comportement historique.
  // Un rescan ciblé de maintenance peut désactiver uniquement la création
  // des entrées "À venir", sans modifier la détection/persistance des médias.
  const queueUpcoming = options.queueUpcoming !== false;
  if (item.type === 'MOVIE') {
    let existing = await db.mediaItem.findFirst({ where: { filePath: item.filePath } });

    // Une correction manuelle ("Identifier") verrouille la reconnaissance
    // — on ne relance surtout pas TMDB dessus, et on n'écrase aucun de ses
    // champs. Sans ça, chaque nouveau scan effaçait silencieusement les
    // corrections manuelles en relançant la recherche automatique dessus.
    if (existing?.manuallyVerified) {
      const saved = await db.mediaItem.update({
        where: { id: existing.id },
        data: { filePath: item.filePath, libraryId },
      });
      return { matchStatus: saved.matchStatus, id: saved.id };
    }

    const resolved = await withRetry(() => resolveWithExistingTmdb(item, existing, libraryName)).catch(() => ({ match: null, source: 'ERROR', score: 0, reason: 'Erreur fournisseur' }));
    const tmdbResult = resolved.match;
    const matchStatus: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' = !tmdbResult
      ? 'UNMATCHED'
      : resolved.score >= 0.78
        ? 'MATCHED'
        : 'AMBIGUOUS';

    // Détection automatique de la saga dès la reconnaissance — sans ça,
    // deux films d'une même saga n'étaient regroupés qu'après un passage
    // par l'enrichissement ou la consultation d'une fiche, ce qui pouvait
    // laisser deux ajouts récents non réunis pendant un moment.
    const collection =
      matchStatus === 'MATCHED' && tmdbResult
        ? await getTmdbMovieCollection(tmdbResult.tmdbId).catch(() => null)
        : null;

    const data = {
      type: 'MOVIE' as const,
      title: item.title,
      year: item.year,
      filePath: item.filePath,
      libraryId,
      imdbId: item.imdbIdHint,
      tvdbId: item.tvdbIdHint,
      metadataSource: item.nfoPath ? resolved.source : resolved.source,
      identificationScore: resolved.score,
      identificationReason: resolved.reason,
      localNfoPath: item.nfoPath,
      matchStatus,
      tmdbId: tmdbResult?.tmdbId,
      matchedTitle: tmdbResult?.title,
      posterUrl: tmdbResult?.posterUrl,
      overview: tmdbResult?.overview,
      genres: tmdbResult?.genres.join(', ') || null,
      ...(collection
        ? { collectionId: collection.id, collectionName: collection.name, collectionPosterUrl: collection.posterUrl }
        : {}),
    };
    let saved;
    if (existing) {
      saved = await db.mediaItem.update({ where: { id: existing.id }, data });
    } else {
      try {
        saved = await db.mediaItem.create({ data });
      } catch (error) {
        // Deux scans peuvent constater simultanément que le fichier n'existe
        // pas. L'index DB est l'arbitre final : le perdant récupère simplement
        // le MediaItem créé par l'autre scan.
        if ((error as any)?.code !== 'P2002') throw error;

        const raced = await db.mediaItem.findFirst({
          where: { type: 'MOVIE', filePath: item.filePath },
        });

        if (!raced) throw error;

        existing = raced;
        saved = await db.mediaItem.update({
          where: { id: raced.id },
          data,
        });

        console.log(
          `[MEDIAITEM-RACE-RECOVERED] MOVIE ${item.filePath} -> ${raced.id}`,
        );
      }
    }

    if (matchStatus === 'MATCHED') {
      if (!saved.manuallyVerified && saved.tmdbId != null && saved.posterUrl && saved.overview) {
        await db.mediaItem.update({ where: { id: saved.id }, data: { manuallyVerified: true } });
        console.log(`[AUTO-METADATA-LOCK] MOVIE item=${saved.id} tmdb=${saved.tmdbId}`);
      }
      await resolveScanReview(saved.id, 'STALE_IDENTIFICATION');
      await resolveScanReview(saved.id, 'TITLE_AMBIGUITY');
      await resolveScanReview(saved.id, 'NO_MATCH');
    } else {
      await upsertScanReview({
        mediaItemId: saved.id,
        mediaType: 'MOVIE',
        detectedTitle: item.title,
        sourcePath: item.filePath,
        proposedTmdbId: tmdbResult?.tmdbId ?? existing?.tmdbId ?? null,
        proposedTitle: tmdbResult?.title ?? existing?.matchedTitle ?? null,
        score: resolved.score,
        reason: resolved.reason,
        issueType: matchStatus === 'AMBIGUOUS' ? 'TITLE_AMBIGUITY' : 'NO_MATCH',
      });
    }

    // Uniquement pour un titre VRAIMENT nouveau (existing === null), pas
    // une simple mise à jour d'un item déjà connu — sinon chaque scan
    // renverrait une notification pour tout le catalogue existant.
    if (!existing) {
      await queueNewMedia({
        type: 'MOVIE',
        title: saved.matchedTitle || saved.title,
        imageUrl: saved.posterUrl,
        mediaPath: saved.filePath,
        sourceMediaItemId: saved.id,
      });
      notifyDiscordNewItem({
        title: saved.matchedTitle || saved.title,
        type: 'MOVIE',
        year: saved.year,
        posterUrl: saved.posterUrl,
      });
    }

    return { matchStatus, id: saved.id };
  } else {
    // V3.5 : l'identité locale primaire d'une série est son dossier logique.
    // On ne fusionne PLUS deux fiches juste parce que leur titre local est
    // identique : c'était une source de collisions entre remakes/franchises.
    // Une fusion multi-emplacements n'est autorisée qu'après un MATCHED TMDB.
    let existing = await db.mediaItem.findFirst({
      where: { type: 'SERIES', folderPath: item.folderPath },
    });

    if (existing?.manuallyVerified) {
      const seriesItem = await db.mediaItem.update({
        where: { id: existing.id },
        data: { folderPath: existing.folderPath ?? item.folderPath, libraryId },
      });

      // V3.9 — une fiche vérifiée manuellement reste verrouillée côté identité,
      // mais ses épisodes doivent quand même être rescannés SANS jamais écraser
      // le fichier d'un autre SxxExx. L'ancienne branche faisait un upsert avec
      // update:{filePath}, ce qui contournait entièrement le garde V3.6.
      //
      // Si tmdbSeasonNumber est renseigné, cette fiche locale représente une
      // branche/saison TMDB précise. On conserve la numérotation LOCALE dans la
      // base, et on ne l'utilise que pour choisir les métadonnées fournisseur.
      let providerByLocalKey = new Map<string, ProviderEpisodeMetadata>();
      if (seriesItem.tmdbId != null && seriesItem.tmdbSeasonNumber != null) {
        // Branche explicitement liée à UNE saison TMDB (ex. TYBW): conserver
        // cette règle prioritaire et la numérotation locale existante.
        const detail = await withRetry(() =>
          getTmdbSeasonDetails(seriesItem.tmdbId!, seriesItem.tmdbSeasonNumber!),
        ).catch(() => null);
        if (detail) {
          await db.mediaItem.update({
            where: { id: seriesItem.id },
            data: { ...(detail.posterUrl ? { posterUrl: detail.posterUrl } : {}), matchedTitle: null },
          }).catch(() => null);
          const localSorted = [...item.episodes].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
          const providerSorted = [...detail.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
          const sameNumbering = localSorted.length === providerSorted.length &&
            localSorted.every((e, i) => e.episodeNumber === providerSorted[i].episodeNumber);
          if (localSorted.length === providerSorted.length && !sameNumbering) {
            localSorted.forEach((localEp, i) => providerByLocalKey.set(`${localEp.seasonNumber}:${localEp.episodeNumber}`, providerSorted[i]));
            console.log(`[TMDB-BRANCH-ORDINAL] ${seriesItem.title}: ${localSorted.length} épisodes locaux -> TMDB saison ${seriesItem.tmdbSeasonNumber}`);
          } else {
            for (const localEp of localSorted) {
              const providerEp = providerSorted.find((ep) => ep.episodeNumber === localEp.episodeNumber);
              if (providerEp) providerByLocalKey.set(`${localEp.seasonNumber}:${localEp.episodeNumber}`, providerEp);
            }
          }
        }
      } else if (seriesItem.tmdbId != null) {
        // Important: le verrou protège l'IDENTITÉ de la série, pas son cache
        // d'épisodes. Une ancienne fiche verrouillée doit pouvoir être enrichie.
        const mapped = await buildProviderEpisodeMap(seriesItem.tmdbId, item.episodes);
        providerByLocalKey = mapped.byLocalKey;
        console.log(`[TMDB-LOCKED-ENRICH] ${seriesItem.title}: mode=${mapped.mode} local=${item.episodes.length} provider=${mapped.providerTotal} mapped=${providerByLocalKey.size}`);
      }

      // V3.13.24 — un même fichier physique peut représenter plusieurs
      // épisodes (ex. S01E36 et 37). Dans ce cas, plusieurs lignes Episode
      // doivent pouvoir partager le même filePath. La récupération V3.13.15
      // par chemin physique reste active uniquement pour les fichiers qui
      // représentent une seule coordonnée.
      const episodePathCounts = new Map<string, number>();
      for (const detectedEpisode of item.episodes) {
        const physicalPath = path.resolve(detectedEpisode.filePath);
        episodePathCounts.set(
          physicalPath,
          (episodePathCounts.get(physicalPath) ?? 0) + 1,
        );
      }

      for (const episode of item.episodes) {
        const key = {
          mediaItemId: seriesItem.id,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
        };
        let existingEpisode = await db.episode.findUnique({
          where: { mediaItemId_seasonNumber_episodeNumber: key },
        });

        // V3.13.15 — récupération d'une ancienne coordonnée tronquée.
        // Exemple historique One Piece: le fichier physique S21E1009 pouvait
        // être resté en BDD sous S21E100. Si la nouvelle clé S21E1009 est
        // libre, le CHEMIN PHYSIQUE fait foi: on déplace la ligne existante au
        // bon SxxExx au lieu de créer un doublon et de laisser la vieille clé.
        if (
          !existingEpisode &&
          (episodePathCounts.get(path.resolve(episode.filePath)) ?? 0) === 1
        ) {
          const samePhysicalEpisode = await db.episode.findFirst({
            where: { mediaItemId: seriesItem.id, filePath: episode.filePath },
            orderBy: { updatedAt: 'desc' },
          });
          if (samePhysicalEpisode &&
              (samePhysicalEpisode.seasonNumber !== episode.seasonNumber || samePhysicalEpisode.episodeNumber !== episode.episodeNumber)) {
            const provider = providerByLocalKey.get(`${episode.seasonNumber}:${episode.episodeNumber}`);
            const mediaFacts = await probeEpisodeFile(episode.filePath);
            existingEpisode = await db.episode.update({
              where: { id: samePhysicalEpisode.id },
              data: {
                seasonNumber: episode.seasonNumber,
                episodeNumber: episode.episodeNumber,
                ...(provider ? {
                  tmdbEpisodeId: provider.tmdbEpisodeId,
                  tmdbEpisodeName: provider.name,
                  tmdbEpisodeOverview: provider.overview || null,
                  tmdbEpisodeStillUrl: provider.stillUrl,
                  tmdbEpisodeAirDate: provider.airDate ? new Date(provider.airDate) : null,
                  matchStatus: 'MATCHED' as const,
                } : {}),
                ...mediaFacts,
              },
            });
            console.log(`[EPISODE-COORDINATE-RECOVERY] ${seriesItem.title}: ${samePhysicalEpisode.seasonNumber}:${samePhysicalEpisode.episodeNumber} -> ${episode.seasonNumber}:${episode.episodeNumber} | ${episode.filePath}`);
          }
        }

        if (existingEpisode && path.resolve(existingEpisode.filePath) !== path.resolve(episode.filePath)) {
          console.warn(
            `[MANUAL-EPISODE-COLLISION] ${seriesItem.title} S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')} ` +
            `conserve ${existingEpisode.filePath}; ignore ${episode.filePath}`,
          );
          continue;
        }

        const provider = providerByLocalKey.get(`${episode.seasonNumber}:${episode.episodeNumber}`);
        const mediaFacts = await probeEpisodeFile(episode.filePath);
        const wasNewEpisode = existingEpisode == null;
        const savedEpisode = await db.episode.upsert({
          where: { mediaItemId_seasonNumber_episodeNumber: key },
          update: {
            ...(provider ? {
              tmdbEpisodeId: provider.tmdbEpisodeId,
              tmdbEpisodeName: provider.name,
              tmdbEpisodeOverview: provider.overview || null,
              tmdbEpisodeStillUrl: provider.stillUrl,
              tmdbEpisodeAirDate: provider.airDate ? new Date(provider.airDate) : null,
              matchStatus: 'MATCHED' as const,
            } : {}),
            ...mediaFacts,
          },
          create: {
            mediaItemId: seriesItem.id,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            filePath: episode.filePath,
            ...(provider ? {
              tmdbEpisodeId: provider.tmdbEpisodeId,
              tmdbEpisodeName: provider.name,
              tmdbEpisodeOverview: provider.overview || null,
              tmdbEpisodeStillUrl: provider.stillUrl,
              tmdbEpisodeAirDate: provider.airDate ? new Date(provider.airDate) : null,
              matchStatus: 'MATCHED' as const,
            } : {}),
            ...mediaFacts,
          },
        });
        if (wasNewEpisode && queueUpcoming) {
          await queueNewMedia({
            type: 'EPISODE',
            title: seriesItem.matchedTitle || seriesItem.title,
            subtitle: `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}${provider?.name ? ` · ${provider.name}` : ''}`,
            imageUrl: provider?.stillUrl || seriesItem.posterUrl,
            mediaPath: episode.filePath, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
            sourceEpisodeId: savedEpisode.id,
          });
        }
      }
      return { matchStatus: seriesItem.matchStatus, id: seriesItem.id };
    }

    const resolved = await withRetry(() => resolveWithExistingTmdb(item, existing, libraryName)).catch(() => ({ match: null, source: 'ERROR', score: 0, reason: 'Erreur fournisseur' }));
    const tmdbResult = resolved.match;
    const matchStatus: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' = !tmdbResult
      ? 'UNMATCHED'
      : resolved.score >= 0.78
        ? 'MATCHED'
        : 'AMBIGUOUS';

    // V3.6 — SÉCURITÉ D'IDENTITÉ : un dossier physique logique = une fiche.
    // On ne fusionne JAMAIS automatiquement deux racines différentes sur le
    // seul tmdbId. Un faux match fournisseur (ex. TYBW identifié comme Bleach)
    // ne doit surtout pas permettre d'écraser les épisodes de l'autre branche.
    // Les multi-emplacements pourront être reliés explicitement plus tard via
    // une table dédiée, mais pas au niveau du MediaItem principal.

    const remoteMetadata = resolved.source === 'ERROR'
      ? {}
      : matchStatus === 'MATCHED' && tmdbResult
        ? {
            tmdbId: tmdbResult.tmdbId,
            matchedTitle: tmdbResult.title,
            posterUrl: tmdbResult.posterUrl,
            overview: tmdbResult.overview,
            genres: tmdbResult.genres.join(', ') || null,
          }
        : {
            // Candidat faible/ambigu : on efface une ancienne identification
            // automatique erronée au lieu de continuer à l'afficher.
            tmdbId: null,
            matchedTitle: null,
            posterUrl: null,
            overview: null,
            genres: null,
          };

    const data = {
      type: 'SERIES' as const,
      title: item.title,
      year: item.year,
      folderPath: item.folderPath,
      libraryId,
      imdbId: item.imdbIdHint,
      tvdbId: item.tvdbIdHint,
      metadataSource: resolved.source,
      identificationScore: resolved.score,
      identificationReason: resolved.reason,
      localNfoPath: item.nfoPath,
      matchStatus,
      ...remoteMetadata,
    };
    let seriesItem;
    if (existing) {
      seriesItem = await db.mediaItem.update({
        where: { id: existing.id },
        data,
      });
    } else {
      try {
        seriesItem = await db.mediaItem.create({ data });
      } catch (error) {
        // Même protection que pour les films, mais l'identité locale d'une
        // série reste strictement son dossier logique.
        if ((error as any)?.code !== 'P2002') throw error;

        const raced = await db.mediaItem.findFirst({
          where: {
            type: 'SERIES',
            folderPath: item.folderPath,
          },
        });

        if (!raced) throw error;

        existing = raced;
        seriesItem = await db.mediaItem.update({
          where: { id: raced.id },
          data,
        });

        console.log(
          `[MEDIAITEM-RACE-RECOVERED] SERIES ${item.folderPath} -> ${raced.id}`,
        );
      }
    }

    const firstSourcePath = item.episodes[0]?.filePath ?? null;
    if (matchStatus === 'MATCHED') {
      await resolveScanReview(seriesItem.id, 'STALE_IDENTIFICATION');
      await resolveScanReview(seriesItem.id, 'TITLE_AMBIGUITY');
      await resolveScanReview(seriesItem.id, 'NO_MATCH');
    } else {
      await upsertScanReview({
        mediaItemId: seriesItem.id,
        mediaType: 'SERIES',
        detectedTitle: item.title,
        folderPath: item.folderPath,
        sourcePath: firstSourcePath,
        proposedTmdbId: tmdbResult?.tmdbId ?? existing?.tmdbId ?? null,
        proposedTitle: tmdbResult?.title ?? existing?.matchedTitle ?? null,
        score: resolved.score,
        reason: resolved.reason,
        issueType: matchStatus === 'AMBIGUOUS' ? 'TITLE_AMBIGUITY' : 'NO_MATCH',
      });
    }

    // La topologie des saisons est un diagnostic distinct de l'identité.
    // Une série peut être correctement reconnue tout en ayant un découpage
    // local différent de TMDB (Sonic est le cas de référence).
    if (tmdbResult) {
      const localSeasons = [...new Set(item.episodes.map((ep) => ep.seasonNumber))];
      const topology = await withRetry(() => validateTmdbSeriesSeasons(tmdbResult.tmdbId, localSeasons)).catch(() => null);
      if (topology?.missingSeasons.length) {
        await upsertScanReview({
          mediaItemId: seriesItem.id,
          mediaType: 'SERIES',
          detectedTitle: item.title,
          folderPath: item.folderPath,
          sourcePath: firstSourcePath,
          proposedTmdbId: tmdbResult.tmdbId,
          proposedTitle: tmdbResult.title,
          score: resolved.score,
          reason: `Découpage local différent de TMDB ; saison(s) fournisseur absente(s): ${topology.missingSeasons.join(', ')}`,
          issueType: 'PROVIDER_SEASON_MISMATCH',
        });
      } else {
        await resolveScanReview(seriesItem.id, 'PROVIDER_SEASON_MISMATCH');
      }
    }

    if (!existing) {
      await queueNewMedia({
        type: 'SERIES',
        title: seriesItem.matchedTitle || seriesItem.title,
        imageUrl: seriesItem.posterUrl,
        mediaPath: seriesItem.folderPath,
        sourceMediaItemId: seriesItem.id,
      });
      notifyDiscordNewItem({
        title: seriesItem.matchedTitle || seriesItem.title,
        type: 'SERIES',
        year: seriesItem.year,
        posterUrl: seriesItem.posterUrl,
      });
    }

    // Une fois la série reconnue, résout les épisodes par saison pendant le scan.
    // Avant cette étape, Episode.matchStatus restait toujours à sa valeur SQL
    // par défaut UNMATCHED, même lorsqu'un tmdbEpisodeId avait ensuite été trouvé
    // lors de l'ouverture de la fiche série.
    let providerByLocalKey = new Map<string, ProviderEpisodeMetadata>();

    // V3.13.27 — une fiche locale peut représenter explicitement UNE saison
    // TMDB tout en conservant une numérotation locale S01 (ex. TYBW).
    // Dans ce cas on mappe exclusivement cette saison fournisseur.
    if (
      matchStatus === 'MATCHED' &&
      tmdbResult &&
      seriesItem.tmdbSeasonNumber != null
    ) {
      const detail = await withRetry(() =>
        getTmdbSeasonDetails(tmdbResult.tmdbId, seriesItem.tmdbSeasonNumber!),
      ).catch(() => null);

      if (detail) {
        // V3.15.18 — une branche physique liée explicitement à une saison TMDB
        // utilise l'affiche de CETTE saison et non l'affiche générale de la série.
        if (detail.posterUrl && seriesItem.posterUrl !== detail.posterUrl) {
          await db.mediaItem.update({
            where: { id: seriesItem.id },
            data: { posterUrl: detail.posterUrl },
          });
          console.log(
            `[TMDB-BRANCH-POSTER] ${seriesItem.title}: saison TMDB ${seriesItem.tmdbSeasonNumber}`,
          );
        }

        const localSorted = [...item.episodes].sort(
          (a, b) =>
            a.seasonNumber - b.seasonNumber ||
            a.episodeNumber - b.episodeNumber,
        );
        const providerSorted = [...detail.episodes].sort(
          (a, b) => a.episodeNumber - b.episodeNumber,
        );

        const sameNumbering =
          localSorted.length === providerSorted.length &&
          localSorted.every(
            (e, i) => e.episodeNumber === providerSorted[i]?.episodeNumber,
          );

        if (localSorted.length === providerSorted.length && !sameNumbering) {
          localSorted.forEach((localEp, i) => {
            const providerEp = providerSorted[i];
            if (providerEp) {
              providerByLocalKey.set(
                `${localEp.seasonNumber}:${localEp.episodeNumber}`,
                providerEp,
              );
            }
          });
          console.log(
            `[TMDB-BRANCH-ORDINAL] ${seriesItem.title}: ${localSorted.length} épisodes locaux -> TMDB saison ${seriesItem.tmdbSeasonNumber}`,
          );
        } else {
          for (const localEp of localSorted) {
            const providerEp = providerSorted.find(
              (ep) => ep.episodeNumber === localEp.episodeNumber,
            );
            if (providerEp) {
              providerByLocalKey.set(
                `${localEp.seasonNumber}:${localEp.episodeNumber}`,
                providerEp,
              );
            }
          }
        }

        console.log(
          `[TMDB-EPISODE-MAP-SEASON] ${seriesItem.title}: tmdb=${tmdbResult.tmdbId} season=${seriesItem.tmdbSeasonNumber} local=${localSorted.length} provider=${providerSorted.length} mapped=${providerByLocalKey.size}`,
        );
      }
    } else if (matchStatus === 'MATCHED' && tmdbResult) {
      const mapped = await buildProviderEpisodeMap(tmdbResult.tmdbId, item.episodes);
      providerByLocalKey = mapped.byLocalKey;
      console.log(`[TMDB-EPISODE-MAP] ${seriesItem.title}: mode=${mapped.mode} local=${item.episodes.length} provider=${mapped.providerTotal} mapped=${providerByLocalKey.size}`);
    }

    // V3.13.27 — même protection multi-épisode que V3.13.24 dans la
    // branche non verrouillée. Un fichier physique peut représenter plusieurs
    // coordonnées (ex. S01E36 et 37) et ne doit alors jamais servir à
    // déplacer l'une des lignes Episode sur l'autre.
    const episodePathCounts = new Map<string, number>();
    for (const detectedEpisode of item.episodes) {
      const physicalPath = path.resolve(detectedEpisode.filePath);
      episodePathCounts.set(
        physicalPath,
        (episodePathCounts.get(physicalPath) ?? 0) + 1,
      );
    }

    for (const episode of item.episodes) {
      const providerEpisode = providerByLocalKey.get(`${episode.seasonNumber}:${episode.episodeNumber}`) ?? null;
      const tmdbEpisodeId = providerEpisode?.tmdbEpisodeId ?? null;
      const episodeMatchStatus: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' = tmdbEpisodeId != null
        ? 'MATCHED'
        : matchStatus === 'MATCHED'
          ? 'AMBIGUOUS'
          : 'UNMATCHED';

      // V3.3 — réaffectation par chemin physique.
      // Un fichier vidéo ne doit pas rester attaché à une ancienne fiche de
      // série lorsque la nouvelle logique de regroupement découvre qu'il
      // appartient à une autre série. C'est exactement le cas d'une
      // arborescence de franchise du type :
      //   Bleach (2004)/Bleach/...
      //   Bleach (2004)/Bleach La Guerre Sanglante.../...
      // Les versions précédentes pouvaient créer la bonne nouvelle fiche,
      // tout en laissant les anciennes lignes Episode sous "Bleach" jusqu'à
      // un nettoyage ultérieur. Ici on migre immédiatement la ligne existante
      // qui pointe vers LE MÊME fichier, ce qui conserve aussi son id (et donc
      // l'historique de lecture/favoris lié à cet Episode).
      const targetKey = {
        mediaItemId: seriesItem.id,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
      };

      const mediaFacts = await probeEpisodeFile(episode.filePath);

      let targetEpisode = await db.episode.findUnique({
        where: { mediaItemId_seasonNumber_episodeNumber: targetKey },
      });

      // V3.13.15 — si CE fichier physique existe déjà sous la même série mais
      // avec une ancienne coordonnée erronée/tronquée, corriger sa clé avant
      // toute création. On conserve ainsi Episode.id et donc progression,
      // favoris et historique. La migration n'est faite que si la nouvelle clé
      // est libre; une vraie collision reste protégée par V3.6.
      if (
        !targetEpisode &&
        (episodePathCounts.get(path.resolve(episode.filePath)) ?? 0) === 1
      ) {
        const samePhysicalEpisode = await db.episode.findFirst({
          where: { mediaItemId: seriesItem.id, filePath: episode.filePath },
          orderBy: { updatedAt: 'desc' },
        });
        if (samePhysicalEpisode &&
            (samePhysicalEpisode.seasonNumber !== episode.seasonNumber || samePhysicalEpisode.episodeNumber !== episode.episodeNumber)) {
          targetEpisode = await db.episode.update({
            where: { id: samePhysicalEpisode.id },
            data: {
              seasonNumber: episode.seasonNumber,
              episodeNumber: episode.episodeNumber,
              tmdbEpisodeId,
              ...(providerEpisode ? {
                tmdbEpisodeName: providerEpisode.name,
                tmdbEpisodeOverview: providerEpisode.overview || null,
                tmdbEpisodeStillUrl: providerEpisode.stillUrl,
                tmdbEpisodeAirDate: providerEpisode.airDate ? new Date(providerEpisode.airDate) : null,
              } : {}),
              matchStatus: episodeMatchStatus,
              ...mediaFacts,
            },
          });
          console.log(`[EPISODE-COORDINATE-RECOVERY] ${seriesItem.title}: ${samePhysicalEpisode.seasonNumber}:${samePhysicalEpisode.episodeNumber} -> ${episode.seasonNumber}:${episode.episodeNumber} | ${episode.filePath}`);
        }
      }

      if (!targetEpisode) {
        const misplacedEpisode = await db.episode.findFirst({
          where: {
            filePath: episode.filePath,
            mediaItemId: { not: seriesItem.id },
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
          },
          orderBy: { updatedAt: 'desc' },
        });

        if (misplacedEpisode) {
          await db.episode.update({
            where: { id: misplacedEpisode.id },
            data: {
              mediaItemId: seriesItem.id,
              seasonNumber: episode.seasonNumber,
              episodeNumber: episode.episodeNumber,
              filePath: episode.filePath,
              tmdbEpisodeId,
              matchStatus: episodeMatchStatus,
              ...mediaFacts,
            },
          });
          console.log(
            `[REASSIGNED] ${episode.filePath} -> ${seriesItem.title} S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`,
          );
          continue;
        }
      }

      // V3.6 — ne jamais remplacer silencieusement un épisode existant par
      // un AUTRE fichier qui porte le même SxxExx. C'est exactement ainsi que
      // les S01E01..S01E24 de Bleach avaient été remplacés par les fichiers
      // TYBW lorsque les deux branches avaient été fusionnées par erreur.
      if (targetEpisode && path.resolve(targetEpisode.filePath) !== path.resolve(episode.filePath)) {
        // V3.15.21 — si l'ancien chemin de cette coordonnée n'existe plus
        // physiquement, il s'agit d'un déplacement/renommage et non d'une
        // vraie collision. On conserve l'ID Episode et on adopte le nouveau
        // chemin détecté. Si l'ancien fichier existe encore, la protection
        // anti-collision Bleach/TYBW reste strictement inchangée.
        let oldPathStillExists = false;
        try {
          await fs.access(targetEpisode.filePath);
          oldPathStillExists = true;
        } catch {
          oldPathStillExists = false;
        }

        if (oldPathStillExists) {
          console.warn(
            `[EPISODE-COLLISION] ${seriesItem.title} S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')} ` +
            `conserve ${targetEpisode.filePath}; ignore ${episode.filePath}`,
          );
          continue;
        }

        console.log(
          `[EPISODE-PATH-RENAMED] ${seriesItem.title} S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')} ` +
          `${targetEpisode.filePath} -> ${episode.filePath}`,
        );

        targetEpisode = await db.episode.update({
          where: { id: targetEpisode.id },
          data: { filePath: episode.filePath },
        });
      }

      const wasNewEpisode = targetEpisode == null && existing != null;
      const savedEpisode = await db.episode.upsert({
        where: {
          mediaItemId_seasonNumber_episodeNumber: targetKey,
        },
        update: {
          ...(tmdbEpisodeId != null ? { tmdbEpisodeId } : {}),
          ...(providerEpisode ? {
            tmdbEpisodeName: providerEpisode.name,
            tmdbEpisodeOverview: providerEpisode.overview || null,
            tmdbEpisodeStillUrl: providerEpisode.stillUrl,
            tmdbEpisodeAirDate: providerEpisode.airDate ? new Date(providerEpisode.airDate) : null,
          } : {}),
          matchStatus: episodeMatchStatus,
          ...mediaFacts,
        },
        create: {
          mediaItemId: seriesItem.id,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          filePath: episode.filePath,
          tmdbEpisodeId,
          tmdbEpisodeName: providerEpisode?.name ?? null,
          tmdbEpisodeOverview: providerEpisode?.overview || null,
          tmdbEpisodeStillUrl: providerEpisode?.stillUrl ?? null,
          tmdbEpisodeAirDate: providerEpisode?.airDate ? new Date(providerEpisode.airDate) : null,
          matchStatus: episodeMatchStatus,
          ...mediaFacts,
        },
      });
      if (wasNewEpisode && queueUpcoming) {
        await queueNewMedia({
          type: 'EPISODE',
          title: seriesItem.matchedTitle || seriesItem.title,
          subtitle: `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}${providerEpisode?.name ? ` · ${providerEpisode.name}` : ''}`,
          imageUrl: providerEpisode?.stillUrl || seriesItem.posterUrl,
          mediaPath: episode.filePath, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
          sourceEpisodeId: savedEpisode.id,
        });
      }
    }

    if (matchStatus === 'MATCHED' && tmdbResult && seriesItem.posterUrl && seriesItem.overview) {
      const unresolvedEpisodes = await db.episode.count({
        where: {
          mediaItemId: seriesItem.id,
          OR: [{ matchStatus: { not: 'MATCHED' } }, { tmdbEpisodeId: null }],
        },
      });
      // V3.13.12 — garde-fou défensif : un dossier dont le nom est lui-même
      // un épisode (ex. Chernobyl.S01E01.MULTi...) ne peut jamais devenir une
      // racine définitivement verrouillée. Le scanner doit d'abord le remonter
      // au parent commun ; si une détection feuille passe malgré tout, on la
      // laisse volontairement déverrouillée pour permettre la réparation.
      const episodeLikeRoot = /(?:^|[^a-z0-9])s\d{1,2}[\s._-]*e\d{1,4}(?:[^a-z0-9]|$)/i.test(
        path.basename(seriesItem.folderPath ?? ''),
      );
      // V3.13.25 — une série reconnue ne doit plus être verrouillée
      // automatiquement. Les métadonnées doivent rester actualisables afin
      // notamment de récupérer les affiches et métadonnées des saisons.
      // manuallyVerified reste disponible pour les verrouillages réellement
      // décidés manuellement.
      if (unresolvedEpisodes === 0 && !seriesItem.manuallyVerified) {
        console.log(`[AUTO-METADATA-LOCK-DISABLED] SERIES item=${seriesItem.id} tmdb=${seriesItem.tmdbId} episodes=${item.episodes.length}`);
      }
    }

    return { matchStatus, id: seriesItem.id };
  }
}

/**
 * Scanne les médiathèques données (une ou plusieurs), en mettant à jour
 * `scanLogId` au fil de l'eau. Le nettoyage des entrées fantômes est
 * limité aux médiathèques scannées ici — important pour qu'un
 * "actualiser cette médiathèque" ne supprime jamais le contenu des
 * autres.
 */
export async function runScan(scanLogId: string, libraries: LibraryForScan[]) {
  const scanStartedAt = new Date();
  let filesScanned = 0;
  let matched = 0;
  let unmatched = 0;

  // Une médiathèque dont au moins un dossier NAS n'a pas pu être lu
  // ne doit JAMAIS subir de nettoyage destructif pendant ce scan.
  const unsafeLibraryIds = new Set<string>();

  // Comptage total lancé EN PARALLÈLE, sans jamais bloquer le démarrage du
  // vrai traitement — sur un NAS distant (SSHFS...), attendre ce comptage
  // avant de commencer donnait l'impression que le scan était figé à zéro
  // pendant un long moment. Ici, le pourcentage se complète dès que ce
  // comptage rattrape le traitement réel, sans rien retarder.
  void (async () => {
    let total = 0;
    for (const library of libraries) {
      for (const root of library.folders) {
        try {
          total += (await walkVideoFiles(root)).length;
          await db.scanLog.update({ where: { id: scanLogId }, data: { totalFiles: total } });
        } catch {
          // Pas grave : le comptage est un bonus d'affichage, pas critique.
        }
      }
    }
  })();

  try {
    for (const library of libraries) {
      for (const root of library.folders) {
        const {
          items,
          filesScanned: countInRoot,
          scanComplete,
          failedDirectories,
        } = await scanLibraryRoot(root);

        if (!scanComplete) {
          unsafeLibraryIds.add(library.id);
          console.error(
            `[SCAN-CLEANUP-DISABLED] library=${library.name} root=${root} ` +
            `failedDirectories=${failedDirectories.length}`,
          );
        }

        const detectedOwnerByPath = new Map<string, { id: string; title: string }>();
        filesScanned += countInRoot;
        await db.scanLog.update({ where: { id: scanLogId }, data: { filesScanned } });

        for (const item of items) {
          try {
            const { matchStatus: status, id } = await persistItem(item, library.id, library.name);
            if (item.type === 'SERIES') {
              for (const ep of item.episodes) detectedOwnerByPath.set(ep.filePath, { id, title: item.title });
            }
            if (status === 'MATCHED') matched += 1;
            else unmatched += 1;
            console.log(`[${status}] ${item.title}`);
          } catch (e) {
            unmatched += 1;
            console.error(`Échec de traitement pour "${item.title}" :`, e);
          }

          await db.scanLog.update({
            where: { id: scanLogId },
            data: { itemsMatched: matched, itemsUnmatched: unmatched },
          });

          await sleep(100); // ménage l'API TMDB, pas de besoin d'aller plus vite
        }

        // V3.4 : réconciliation AUTORITAIRE par chemin physique. Même si une
        // ancienne ligne BDD porte déjà le même SxxExx sous une autre fiche,
        // l'identité détectée pendant CE scan gagne. Cela corrige les bases
        // historiques où Bleach/TYBW (ou Naruto/Shippuden, etc.) ont été fusionnés.
        for (const detectedItem of items) {
          if (detectedItem.type !== 'SERIES') continue;
          for (const ep of detectedItem.episodes) {
            const owner = detectedOwnerByPath.get(ep.filePath);
            if (!owner) continue;
            const rows = await db.episode.findMany({ where: { filePath: ep.filePath }, orderBy: { updatedAt: 'desc' } });
            const correct = rows.find((r) => r.mediaItemId === owner.id);
            const wrong = rows.filter((r) => r.mediaItemId !== owner.id);
            if (!correct && wrong.length) {
              const candidate = wrong[0];
              const collision = await db.episode.findUnique({
                where: { mediaItemId_seasonNumber_episodeNumber: { mediaItemId: owner.id, seasonNumber: ep.seasonNumber, episodeNumber: ep.episodeNumber } },
              });
              if (!collision) {
                await db.episode.update({ where: { id: candidate.id }, data: { mediaItemId: owner.id, seasonNumber: ep.seasonNumber, episodeNumber: ep.episodeNumber, filePath: ep.filePath } });
                console.log(`[OWNERSHIP-FIX] ${ep.filePath} -> ${owner.title}`);
              } else if (collision.filePath === ep.filePath) {
                await db.episode.delete({ where: { id: candidate.id } });
              }
            }
            if (wrong.length > 1) {
              await db.episode.deleteMany({ where: { id: { in: wrong.slice(1).map((r) => r.id) } } });
            }
          }
        }
      }
    }

    const scannedLibraryIds = libraries.map((l) => l.id);

    // Seules les médiathèques dont TOUTES les racines ont été lues
    // correctement peuvent subir un nettoyage des entrées fantômes.
    const cleanupLibraryIds = scannedLibraryIds.filter(
      (id) => !unsafeLibraryIds.has(id),
    );

    if (unsafeLibraryIds.size > 0) {
      console.warn(
        `[SCAN-CLEANUP-GUARD] nettoyage désactivé pour ${unsafeLibraryIds.size} médiathèque(s) incomplètement lue(s)`,
      );
    }

    // Nettoyage limité aux médiathèques scannées ici : un item non
    // retouché par CE scan, dans une des médiathèques concernées,
    // correspond à un fichier disparu/déplacé/reclassé.
    //
    // IMPORTANT : on détermine les MediaItem protégés AVANT le nettoyage
    // des épisodes stale. Sinon les épisodes d'une série stale protégée
    // pourraient être supprimés avant que la fiche elle-même soit sauvée.
    const stale = await db.mediaItem.findMany({
      where: { libraryId: { in: cleanupLibraryIds }, updatedAt: { lt: scanStartedAt } },
      select: { id: true },
    });

    const staleIds = stale.map((s) => s.id);
    const protectedIds = new Set<string>();

    if (staleIds.length > 0) {
      // V3.15.29 — Protection des données utilisateur.
      // Favorite / WatchProgress / WatchedMark stockent mediaItemId sans FK
      // vers MediaItem. Supprimer directement une fiche stale rendrait ces
      // données silencieusement orphelines.
      const [favoriteRefs, progressRefs, watchedRefs] = await Promise.all([
        db.favorite.findMany({
          where: { mediaItemId: { in: staleIds } },
          select: { mediaItemId: true },
        }),
        db.watchProgress.findMany({
          where: { mediaItemId: { in: staleIds } },
          select: { mediaItemId: true },
        }),
        db.watchedMark.findMany({
          where: { mediaItemId: { in: staleIds } },
          select: { mediaItemId: true },
        }),
      ]);

      for (const row of favoriteRefs) {
        if (row.mediaItemId) protectedIds.add(row.mediaItemId);
      }
      for (const row of progressRefs) {
        if (row.mediaItemId) protectedIds.add(row.mediaItemId);
      }
      for (const row of watchedRefs) {
        if (row.mediaItemId) protectedIds.add(row.mediaItemId);
      }

      if (protectedIds.size > 0) {
        console.warn(
          `[STALE-USERDATA-PROTECTED] ${protectedIds.size} MediaItem(s) stale conservé(s) car encore référencé(s) par Favorite/WatchProgress/WatchedMark.`,
        );
      }
    }

    // Les séries existantes sont upsertées épisode par épisode pendant le
    // scan. Un épisode non revu depuis le début du scan est normalement
    // devenu stale.
    //
    // Exception : si son MediaItem parent est lui-même stale ET protégé par
    // des données utilisateur, on conserve également ses épisodes. Cela
    // empêche de sauver une coquille de série après avoir détruit son contenu.
    const staleEpisodes = await db.episode.findMany({
      where: {
        updatedAt: { lt: scanStartedAt },
        mediaItem: { libraryId: { in: cleanupLibraryIds } },
      },
      select: { id: true, mediaItemId: true },
    });

    const deletableStaleEpisodeIds = staleEpisodes
      .filter((ep) => !protectedIds.has(ep.mediaItemId))
      .map((ep) => ep.id);

    const protectedStaleEpisodeCount =
      staleEpisodes.length - deletableStaleEpisodeIds.length;

    if (protectedStaleEpisodeCount > 0) {
      console.warn(
        `[STALE-EPISODE-USERDATA-PROTECTED] ${protectedStaleEpisodeCount} épisode(s) stale conservé(s) car leur MediaItem parent est protégé.`,
      );
    }

    if (deletableStaleEpisodeIds.length > 0) {
      // Ces trois tables stockent episodeId sans relation Prisma directe :
      // on les nettoie explicitement avant de supprimer les épisodes.
      await Promise.all([
        db.watchProgress.deleteMany({
          where: { episodeId: { in: deletableStaleEpisodeIds } },
        }),
        db.favorite.deleteMany({
          where: { episodeId: { in: deletableStaleEpisodeIds } },
        }),
        db.watchedMark.deleteMany({
          where: { episodeId: { in: deletableStaleEpisodeIds } },
        }),
      ]);

      await db.episode.deleteMany({
        where: { id: { in: deletableStaleEpisodeIds } },
      });

      console.log(
        `${deletableStaleEpisodeIds.length} épisode(s) fantôme(s) nettoyé(s).`,
      );
    }

    if (staleIds.length > 0) {
      const deletableStaleIds = staleIds.filter((id) => !protectedIds.has(id));

      // V3.13 — clôturer les diagnostics AVANT la suppression de la fiche.
      await db.scanReview.updateMany({
        where: { mediaItemId: { in: deletableStaleIds }, status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });

      if (deletableStaleIds.length > 0) {
        await db.episode.deleteMany({
          where: { mediaItemId: { in: deletableStaleIds } },
        });
        await db.mediaItem.deleteMany({
          where: { id: { in: deletableStaleIds } },
        });
      }

      console.log(
        `${deletableStaleIds.length} entrée(s) fantôme(s) nettoyée(s), ` +
        `${protectedIds.size} protégée(s) par données utilisateur.`,
      );
    }

    // Mémorise à la fois le nombre ET l'empreinte des chemins vidéo.
    // Une série réorganisée de Saison 3 -> Saison 2 peut garder exactement
    // le même nombre de fichiers : le count seul ne voyait donc rien.
    for (const library of libraries) {
      // Ne pas mémoriser une empreinte potentiellement partielle :
      // cela pourrait faire croire au smart-scan que cet état incomplet
      // représente correctement le NAS.
      if (unsafeLibraryIds.has(library.id)) {
        console.warn(
          `[SCAN-FINGERPRINT-SKIP] library=${library.name} reason=incomplete-nas-read`,
        );
        continue;
      }

      try {
        const paths: string[] = [];
        let fingerprintComplete = true;

        for (const root of library.folders) {
          const walk = await walkVideoFilesDetailed(root);

          if (!walk.complete) {
            fingerprintComplete = false;
            console.warn(
              `[SCAN-FINGERPRINT-SKIP] library=${library.name} root=${root} ` +
              `failedDirectories=${walk.failedDirectories.length}`,
            );
            break;
          }

          paths.push(...walk.files);
        }

        if (!fingerprintComplete) {
          continue;
        }

        await db.library.update({
          where: { id: library.id },
          data: {
            lastKnownFileCount: paths.length,
            lastKnownFingerprint: fingerprintPaths(paths),
          },
        });
      } catch {
        // Pas grave : au pire la prochaine vérification légère
        // redéclenchera un scan complet inutilement une fois.
      }
    }

    await db.scanLog.update({
      where: { id: scanLogId },
      data: {
        status: 'done',
        errorMessage: null,
        filesScanned,
        itemsMatched: matched,
        itemsUnmatched: unmatched,
        finishedAt: new Date(),
      },
    });
  } catch (e) {
    await db.scanLog.update({
      where: { id: scanLogId },
      data: { status: 'error', errorMessage: String(e), finishedAt: new Date() },
    });
  }
}

/** Marque en erreur tout scan resté "en cours" depuis plus de 6h (crash,
 * redémarrage serveur...), puis indique si un scan est actuellement actif. */
async function reapStaleScansAndCheckRunning(): Promise<boolean> {
  const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
  await db.scanLog.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) } },
    data: {
      status: 'error',
      errorMessage: 'Scan resté bloqué (probable crash ou redémarrage) — marqué automatiquement en erreur.',
      finishedAt: new Date(),
    },
  });
  const running = await db.scanLog.findFirst({ where: { status: 'running' } });
  return Boolean(running);
}

/** Lance un scan de TOUTES les médiathèques, si aucun n'est déjà en cours. */
export async function startFullScan(): Promise<{ ok: true; scanLogId: string } | { error: string }> {
  if (await reapStaleScansAndCheckRunning()) return { error: 'Un scan est déjà en cours' };

  const libraries = await getLibrariesForScan();
  const scanLog = await db.scanLog.create({ data: {} });
  void runScan(scanLog.id, libraries);
  return { ok: true, scanLogId: scanLog.id };
}

/**
 * Vérification légère avant de lancer un scan complet — compte juste les
 * fichiers vidéo de chaque médiathèque (rapide, pas de matching TMDB) et
 * ne scanne réellement (avec reconnaissance TMDB, le plus coûteux) que
 * celles dont le compte a augmenté depuis le dernier scan. Utilisé par
 * le déclenchement planifié (cron toutes les 5 minutes) pour éviter de
 * relancer un scan complet de tout le catalogue à chaque fois alors que
 * rien n'a changé la plupart du temps — "Tout scanner" dans le panel
 * admin reste un vrai scan complet forcé (startFullScan), pour un
 * rafraîchissement volontaire.
 */
export async function startSmartScan(): Promise<
  | { ok: true; scanLogId: string; librariesScanned: string[] }
  | { ok: true; skipped: true; reason: string }
  | { error: string }
> {
  if (await reapStaleScansAndCheckRunning()) return { error: 'Un scan est déjà en cours' };

  const libraries = await getLibrariesForScan();
  const withFingerprints = await Promise.all(
    libraries.map(async (library) => {
      const paths: string[] = [];
      let readable = true;
      for (const root of library.folders) {
        try {
          paths.push(...(await walkVideoFiles(root)));
        } catch {
          // Un NAS temporairement inaccessible ne doit surtout pas faire
          // croire que tous ses fichiers ont été supprimés.
          readable = false;
        }
      }
      return {
        library,
        readable,
        count: paths.length,
        fingerprint: fingerprintPaths(paths),
      };
    }),
  );

  const dbLibraries = await db.library.findMany({
    where: { id: { in: libraries.map((l) => l.id) } },
    select: { id: true, lastKnownFileCount: true, lastKnownFingerprint: true },
  });
  const lastKnownById = new Map(
    dbLibraries.map((l) => [
      l.id,
      { count: l.lastKnownFileCount, fingerprint: l.lastKnownFingerprint },
    ]),
  );

  const needsScan = withFingerprints
    .filter(({ library, readable, count, fingerprint }) => {
      if (!readable) return false;
      const lastKnown = lastKnownById.get(library.id);
      return (
        lastKnown == null ||
        lastKnown.count == null ||
        lastKnown.fingerprint == null ||
        count !== lastKnown.count ||
        fingerprint !== lastKnown.fingerprint
      );
    })
    .map(({ library }) => library);

  if (needsScan.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: 'Aucune modification de fichiers détectée depuis le dernier scan.',
    };
  }

  const scanLog = await db.scanLog.create({ data: {} });
  void runScan(scanLog.id, needsScan);
  return { ok: true, scanLogId: scanLog.id, librariesScanned: needsScan.map((l) => l.name) };
}
