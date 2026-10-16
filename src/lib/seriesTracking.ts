import { db } from './db';
import { getTmdbSeasonDetails, getTmdbSeriesStatus, type TmdbSeriesSeason } from './tmdbMatch';

export type MissingEpisode = {
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  airDate: string;
};

export type SeriesTrackingResult = {
  status: string | null;
  nextEpisodeAirDate: Date | null;
  nextEpisodeLabel: string | null;
  missingEpisodes: MissingEpisode[];
};

/** Sous-ensemble des champs mis en cache sur MediaItem, nécessaire pour
 * pouvoir retomber proprement sur l'existant si TMDB ne répond pas. */
export type SeriesTrackingCacheInput = {
  id: string;
  tmdbId: number;
  tmdbSeasonNumber: number | null;
  tmdbSeriesStatus: string | null;
  tmdbNextEpisodeAirDate: Date | null;
  tmdbNextEpisodeLabel: string | null;
  missingEpisodesData: unknown;
  episodeTrackingMode?: string | null;
};

function episodeLabel(seasonNumber: number, episodeNumber: number, name: string | null) {
  const code = `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
  return name ? `${code} · ${name}` : code;
}

/**
 * Recalcule le suivi complet d'une série (statut, prochain épisode,
 * épisodes manquants) et persiste le résultat en base — appelé quand le
 * cache (tmdbSeriesStatusCheckedAt) a plus de 24h, ou explicitement à la
 * demande. N'appelle TMDB saison par saison QUE pour les saisons où le
 * compte local est inférieur au compte TMDB : une saison déjà complète
 * localement ne coûte aucun appel supplémentaire.
 *
 * Si TMDB ne répond pas du tout (rate limit, coupure), on NE TOUCHE PAS
 * au cache existant et on renvoie les anciennes valeurs telles quelles —
 * important : sans cette précaution, un simple raté réseau écrasait
 * silencieusement un vrai résultat par "aucun épisode manquant" pour 24h,
 * ce qui faisait disparaître à tort des séries de la liste.
 */
export async function refreshSeriesTracking(item: SeriesTrackingCacheInput): Promise<SeriesTrackingResult> {
  const previousMissing = (item.missingEpisodesData as MissingEpisode[] | null) ?? [];
  const overview = await getTmdbSeriesStatus(item.tmdbId).catch(() => null);

  if (!overview) {
    // Échec TMDB : on renvoie l'état précédent sans rien réécrire, pour
    // que le prochain appel retente bientôt plutôt que de rester figé
    // "faussement à jour" pendant 24h.
    return {
      status: item.tmdbSeriesStatus,
      nextEpisodeAirDate: item.tmdbNextEpisodeAirDate,
      nextEpisodeLabel: item.tmdbNextEpisodeLabel,
      missingEpisodes: previousMissing,
    };
  }

  const result: SeriesTrackingResult = {
    status: overview.status,
    nextEpisodeAirDate: overview.nextEpisode ? new Date(overview.nextEpisode.airDate) : null,
    nextEpisodeLabel: overview.nextEpisode
      ? episodeLabel(overview.nextEpisode.seasonNumber, overview.nextEpisode.episodeNumber, overview.nextEpisode.name)
      : null,
    missingEpisodes: [],
  };

  // V3.13.20 — plusieurs bibliothèques/NAS peuvent contenir la même série.
  // Pour le suivi TMDB, toutes les copies partageant le même tmdbId forment
  // une seule présence logique. On ne considère donc un épisode manquant
  // que s'il est absent de TOUTES les copies physiques.
  //
  // Les branches explicitement liées à une saison fournisseur restent
  // isolées afin de préserver le comportement TYBW / tmdbSeasonNumber.
  const siblingSeries = item.tmdbSeasonNumber == null
    ? await db.mediaItem.findMany({
        where: {
          type: 'SERIES',
          matchStatus: 'MATCHED',
          tmdbId: item.tmdbId,
          tmdbSeasonNumber: null,
        },
        select: { id: true },
      })
    : [{ id: item.id }];

  const logicalMediaItemIds = siblingSeries.map((s) => s.id);

  // Un même épisode présent sur deux NAS ne doit pas être compté deux fois.
  // Le compte exact par saison est donc calculé à partir des numéros uniques.
  const logicalEpisodeRows = await db.episode.findMany({
    where: { mediaItemId: { in: logicalMediaItemIds } },
    select: { seasonNumber: true, episodeNumber: true, tmdbEpisodeId: true },
  });

  // V3.15.23 — l'identité TMDB d'un épisode est globale à la série logique.
  // Certaines éditions physiques redémarrent la numérotation par saison alors
  // que TMDB conserve une saison continue (ex. Shangri-La Frontier :
  // local S02E01 == TMDB S01E26).
  const logicalProviderEpisodeIds = new Set(
    logicalEpisodeRows
      .map((ep) => ep.tmdbEpisodeId)
      .filter((id): id is number => id != null),
  );

  const episodeNumbersBySeason = new Map<number, Set<number>>();
  for (const ep of logicalEpisodeRows) {
    let numbers = episodeNumbersBySeason.get(ep.seasonNumber);
    if (!numbers) {
      numbers = new Set<number>();
      episodeNumbersBySeason.set(ep.seasonNumber, numbers);
    }
    numbers.add(ep.episodeNumber);
  }

  const localCountBySeason = new Map(
    [...episodeNumbersBySeason.entries()].map(([seasonNumber, numbers]) => [
      seasonNumber,
      numbers.size,
    ]),
  );

  // V3.9 — une branche physique peut représenter explicitement UNE saison
  // fournisseur tout en gardant sa numérotation locale. Dans ce mode, on ne
  // compare surtout pas cette fiche à toutes les saisons de la série TMDB :
  // cela ferait réapparaître de faux "épisodes manquants" de Bleach original
  // sur une fiche TYBW séparée.
  // V3.13.22 — certaines éditions physiques regroupent plusieurs segments
  // fournisseur dans un seul fichier (LOCAL_PACKAGED). Dans ce cas, le
  // découpage TMDB ne peut pas servir à déduire le nombre de fichiers NAS
  // manquants : les segments fournisseur supplémentaires ne sont pas des
  // fichiers physiques absents.
  //
  // Ce mode est volontairement explicite et par série : aucune heuristique
  // globale basée sur la durée ou le nombre de fichiers.
  const localPackaged = item.episodeTrackingMode === 'LOCAL_PACKAGED';

  // V3.15.17 — certaines séries mélangent plusieurs types de découpage selon
  // les saisons. Un override LOCAL_PACKAGED au niveau saison empêche uniquement
  // cette saison d'être comparée au découpage fournisseur, sans masquer les
  // véritables épisodes/saisons absents ailleurs dans la même série.
  //
  // Le mode LOCAL_PACKAGED global reste prioritaire et conserve exactement
  // son comportement historique.
  const seasonTrackingOverrides = localPackaged
    ? []
    : await db.seriesSeasonTrackingOverride.findMany({
        where: {
          mediaItemId: item.id,
          mode: 'LOCAL_PACKAGED',
        },
        select: { seasonNumber: true },
      });

  const localPackagedSeasons = new Set(
    seasonTrackingOverrides.map((override) => override.seasonNumber),
  );

  const seasonsToCheck = localPackaged
    ? []
    : item.tmdbSeasonNumber != null
      ? overview.seasons.filter(
          (s: TmdbSeriesSeason) =>
            s.seasonNumber === item.tmdbSeasonNumber &&
            !localPackagedSeasons.has(s.seasonNumber),
        )
      : overview.seasons.filter(
          (s: TmdbSeriesSeason) =>
            !localPackagedSeasons.has(s.seasonNumber) &&
            (localCountBySeason.get(s.seasonNumber) ?? 0) < s.episodeCount,
        );

  const today = new Date().toISOString().slice(0, 10);
  const missing: MissingEpisode[] = [];

  for (const season of seasonsToCheck) {
    const detail = await getTmdbSeasonDetails(item.tmdbId, season.seasonNumber).catch(() => null);
    if (!detail) continue; // saison illisible pour l'instant : on ne la compte pas plutôt que de deviner

    const localRows = await db.episode.findMany({
      where: item.tmdbSeasonNumber != null
        ? { mediaItemId: item.id }
        : {
            mediaItemId: { in: logicalMediaItemIds },
            seasonNumber: season.seasonNumber,
          },
      select: { episodeNumber: true, tmdbEpisodeId: true },
      orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }],
    });

    const matchedProviderIds = new Set(localRows.map((r) => r.tmdbEpisodeId).filter((id): id is number => id != null));
    const localEpisodeNumbers = new Set(localRows.map((r) => r.episodeNumber));
    const completeByOrdinal = item.tmdbSeasonNumber != null && localRows.length === detail.episodes.length;

    for (const ep of detail.episodes) {
      // Pas encore diffusé : ce n'est pas "manquant", juste pas encore sorti.
      if (!ep.airDate || ep.airDate > today) continue;
      // Pour une branche explicite, les ids TMDB déjà attribués sont la vérité.
      // Si le nombre de fichiers == le nombre fournisseur, l'appariement ordinal
      // V3.9 signifie que la branche est complète même avec un trou local 1..41.
      if (item.tmdbSeasonNumber != null) {
        if (matchedProviderIds.has(ep.tmdbEpisodeId) || completeByOrdinal) continue;
      } else if (
        logicalProviderEpisodeIds.has(ep.tmdbEpisodeId) ||
        matchedProviderIds.has(ep.tmdbEpisodeId) ||
        localEpisodeNumbers.has(ep.episodeNumber)
      ) {
        // V3.13.21 — l'ID épisode TMDB est prioritaire lorsqu'il existe.
        // Important pour les séries dont la numérotation physique locale
        // diffère du découpage fournisseur (ex. La Pat' Patrouille).
        // Le numéro local reste un fallback pour les épisodes non enrichis.
        continue;
      }
      missing.push({
        seasonNumber: item.tmdbSeasonNumber != null ? 1 : season.seasonNumber,
        episodeNumber: ep.episodeNumber,
        name: ep.name || null,
        airDate: ep.airDate,
      });
    }

    if (seasonsToCheck.length > 1) await new Promise((r) => setTimeout(r, 150));
  }

  missing.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  result.missingEpisodes = missing;

  await db.mediaItem
    .update({
      where: { id: item.id },
      data: {
        tmdbSeriesStatus: result.status,
        tmdbSeriesStatusCheckedAt: new Date(),
        tmdbNextEpisodeAirDate: result.nextEpisodeAirDate,
        tmdbNextEpisodeLabel: result.nextEpisodeLabel,
        missingEpisodesCount: result.missingEpisodes.length,
        missingEpisodesData: result.missingEpisodes,
      },
    })
    .catch(() => null);

  return result;
}
