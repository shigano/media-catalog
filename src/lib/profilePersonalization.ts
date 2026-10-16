import { db } from './db';

export async function getContinueWatching(profileId: string) {
  const progress = await db.watchProgress.findMany({
    where: {
      profileId,
      positionSeconds: { gt: 30 },
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });

  // Ancienne version : 1 requête SQL par ligne de progression. Sur un
  // profil avec 20 entrées, l'accueil pouvait donc déclencher 21 requêtes
  // juste pour "Continuer à regarder". On charge désormais les films et
  // épisodes concernés en deux requêtes groupées.
  const movieIds = progress.flatMap((p) => (p.mediaItemId ? [p.mediaItemId] : []));
  const episodeIds = progress.flatMap((p) => (p.episodeId ? [p.episodeId] : []));

  const [movies, episodes] = await Promise.all([
    movieIds.length > 0
      ? db.mediaItem.findMany({ where: { id: { in: movieIds } } })
      : Promise.resolve([]),
    episodeIds.length > 0
      ? db.episode.findMany({
          where: { id: { in: episodeIds } },
          include: { mediaItem: true },
        })
      : Promise.resolve([]),
  ]);

  const moviesById = new Map(movies.map((item) => [item.id, item]));
  const episodesById = new Map(episodes.map((episode) => [episode.id, episode]));

  const results = [];
  for (const p of progress) {
    if (p.durationSeconds && p.positionSeconds >= p.durationSeconds - 30) continue;

    if (p.mediaItemId) {
      const item = moviesById.get(p.mediaItemId);
      if (!item) continue;
      results.push({
        id: item.id,
        type: 'MOVIE' as const,
        title: item.matchedTitle || item.title,
        posterUrl: item.posterUrl,
        positionSeconds: p.positionSeconds,
        durationSeconds: p.durationSeconds,
      });
      continue;
    }

    if (p.episodeId) {
      const episode = episodesById.get(p.episodeId);
      if (!episode) continue;
      results.push({
        id: episode.mediaItem.id,
        episodeId: episode.id,
        type: 'SERIES' as const,
        title: `${episode.mediaItem.matchedTitle || episode.mediaItem.title} — S${episode.seasonNumber}E${episode.episodeNumber}`,
        posterUrl: episode.mediaItem.posterUrl,
        positionSeconds: p.positionSeconds,
        durationSeconds: p.durationSeconds,
      });
    }
  }
  return results;
}

/**
 * Dégage une préférence simple pour ce profil (bibliothèque et type les
 * plus regardés) à partir de son historique de lecture.
 */
export async function getProfilePreferences(profileId: string) {
  const progress = await db.watchProgress.findMany({
    where: { profileId },
    select: { mediaItemId: true, episodeId: true },
    take: 100,
    orderBy: { updatedAt: 'desc' },
  });

  const movieIds = [...new Set(progress.flatMap((p) => (p.mediaItemId ? [p.mediaItemId] : [])))];
  const episodeIds = [...new Set(progress.flatMap((p) => (p.episodeId ? [p.episodeId] : [])))];

  const [movies, episodes] = await Promise.all([
    movieIds.length > 0
      ? db.mediaItem.findMany({
          where: { id: { in: movieIds } },
          select: { id: true, libraryId: true, type: true },
        })
      : Promise.resolve([]),
    episodeIds.length > 0
      ? db.episode.findMany({
          where: { id: { in: episodeIds } },
          select: {
            id: true,
            mediaItem: { select: { libraryId: true, type: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const movieById = new Map(movies.map((item) => [item.id, item]));
  const episodeById = new Map(episodes.map((episode) => [episode.id, episode.mediaItem]));
  const libraryCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();

  for (const p of progress) {
    const item = p.mediaItemId
      ? movieById.get(p.mediaItemId) ?? null
      : p.episodeId
        ? episodeById.get(p.episodeId) ?? null
        : null;
    if (!item) continue;
    if (item.libraryId) {
      libraryCounts.set(item.libraryId, (libraryCounts.get(item.libraryId) ?? 0) + 1);
    }
    typeCounts.set(item.type, (typeCounts.get(item.type) ?? 0) + 1);
  }

  const preferredLibraryId = [...libraryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const preferredType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return { preferredLibraryId, preferredType };
}

/**
 * "À suivre" façon Jellyfin : pour chaque série récemment regardée, renvoie
 * le prochain épisode DISPONIBLE après le dernier épisode terminé par ce
 * profil. Les WatchedMark persistent même lorsque WatchProgress est nettoyé,
 * donc une série réapparaît automatiquement lorsqu'un nouvel épisode est
 * ajouté au NAS plus tard.
 */
export async function getNextUp(profileId: string) {
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: { restrictedLibraryIds: true },
  });
  const restricted = new Set(
    (profile?.restrictedLibraryIds ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );

  const marks = await db.watchedMark.findMany({
    where: { profileId, episodeId: { not: null } },
    orderBy: { watchedAt: 'desc' },
    take: 2000,
    select: { episodeId: true, watchedAt: true },
  });
  const watchedEpisodeIds = marks
    .map((m) => m.episodeId)
    .filter((x): x is string => Boolean(x));
  if (watchedEpisodeIds.length === 0) return [];

  const watchedEpisodes = await db.episode.findMany({
    where: { id: { in: watchedEpisodeIds } },
    include: { mediaItem: true },
  });
  const watchedEpisodeById = new Map(watchedEpisodes.map((e) => [e.id, e]));
  const watchedSet = new Set(watchedEpisodeIds);

  // L'ordre des WatchedMark est déjà le plus récent d'abord. On conserve
  // donc un seul point de reprise par série : le dernier épisode terminé.
  const currentBySeries = new Map<string, { episode: (typeof watchedEpisodes)[number]; watchedAt: Date }>();
  for (const mark of marks) {
    if (!mark.episodeId) continue;
    const episode = watchedEpisodeById.get(mark.episodeId);
    if (!episode || currentBySeries.has(episode.mediaItemId)) continue;
    if (episode.mediaItem.matchStatus !== 'MATCHED') continue;
    if (episode.mediaItem.libraryId && restricted.has(episode.mediaItem.libraryId)) continue;
    currentBySeries.set(episode.mediaItemId, { episode, watchedAt: mark.watchedAt });
    if (currentBySeries.size >= 40) break;
  }
  if (currentBySeries.size === 0) return [];

  const seriesIds = [...currentBySeries.keys()];
  const [availableEpisodes, activeProgress] = await Promise.all([
    db.episode.findMany({
      where: { mediaItemId: { in: seriesIds }, matchStatus: 'MATCHED' },
      orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }],
      select: {
        id: true,
        mediaItemId: true,
        seasonNumber: true,
        episodeNumber: true,
        tmdbEpisodeName: true,
        tmdbEpisodeStillUrl: true,
      },
    }),
    db.watchProgress.findMany({
      where: { profileId, episodeId: { not: null }, positionSeconds: { gt: 30 } },
      select: { episodeId: true },
    }),
  ]);
  const inProgress = new Set(
    activeProgress.map((p) => p.episodeId).filter((x): x is string => Boolean(x)),
  );

  const bySeries = new Map<string, typeof availableEpisodes>();
  for (const episode of availableEpisodes) {
    const list = bySeries.get(episode.mediaItemId) ?? [];
    list.push(episode);
    bySeries.set(episode.mediaItemId, list);
  }

  const result = [];
  for (const [seriesId, current] of currentBySeries) {
    const currentEpisode = current.episode;
    const candidates = bySeries.get(seriesId) ?? [];
    const candidate = candidates.find((episode) => {
      const after = episode.seasonNumber > currentEpisode.seasonNumber ||
        (episode.seasonNumber === currentEpisode.seasonNumber && episode.episodeNumber > currentEpisode.episodeNumber);
      if (!after || watchedSet.has(episode.id) || inProgress.has(episode.id)) return false;

      // Ne saute jamais volontairement un trou au milieu d'une saison.
      // Ex.: E02 terminé, E03 absent, E04 présent => on attend E03.
      if (episode.seasonNumber === currentEpisode.seasonNumber) {
        return episode.episodeNumber === currentEpisode.episodeNumber + 1;
      }
      return episode.seasonNumber === currentEpisode.seasonNumber + 1 && episode.episodeNumber === 1;
    });
    if (!candidate) continue;

    result.push({
      id: currentEpisode.mediaItem.id,
      episodeId: candidate.id,
      type: 'SERIES' as const,
      title: currentEpisode.mediaItem.matchedTitle || currentEpisode.mediaItem.title,
      episodeTitle: candidate.tmdbEpisodeName,
      seasonNumber: candidate.seasonNumber,
      episodeNumber: candidate.episodeNumber,
      posterUrl: currentEpisode.mediaItem.posterUrl,
      stillUrl: candidate.tmdbEpisodeStillUrl,
      watchedAt: current.watchedAt,
    });
    if (result.length >= 20) break;
  }

  return result;
}
