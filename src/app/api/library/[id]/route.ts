import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';
import { certificationRank, getTmdbCollection, getTmdbFullDetails, getTmdbSeasonDetails } from '@/lib/tmdbMatch';

/**
 * GET /api/library/[id]
 * Détail complet d'un film ou d'une série, incluant les URLs de diffusion
 * directe prêtes à l'emploi. Pas de transcodage ici — un client natif
 * (appli de bureau via media_kit/libmpv) décode directement le fichier
 * lui-même.
 *
 * Pour une série, les épisodes sont regroupés par saison, chaque saison
 * enrichie avec son affiche TMDB et, pour chaque épisode, son nom, son
 * synopsis, sa date de sortie et sa vignette. Pour un film appartenant à
 * une saga TMDB, les autres films de la saga sont proposés triés par
 * date de sortie, avec indication de ceux déjà disponibles dans ta
 * bibliothèque (cliquables) et ceux qui ne le sont pas encore.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const profileId = url.searchParams.get('profileId');

  const item = await db.mediaItem.findUnique({
    where: { id: params.id },
    include: {
      episodes: { orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }] },
    },
  });
  if (!item) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }
  // Un client normal ne doit jamais pouvoir consulter la fiche d'un
  // titre pas encore reconnu — masqué de la grille, mais ça ne protège
  // rien si l'id est deviné/partagé sans ce contrôle ici aussi.
  if (item.matchStatus !== 'MATCHED' && session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }

  // Même logique pour une médiathèque restreinte (contrôle parental) —
  // masquée des listes, mais accessible par lien direct sans ce contrôle
  // ici aussi.
  if (profileId && item.libraryId) {
    const profile = await db.profile.findUnique({ where: { id: profileId }, select: { restrictedLibraryIds: true } });
    const restrictedIds = profile?.restrictedLibraryIds?.split(',').filter(Boolean) ?? [];
    if (restrictedIds.includes(item.libraryId)) {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }
  }

  let seasons: unknown = undefined;
  let fullDetails = null;
  let saga: unknown = undefined;
  const itemGenres = item.genres ? item.genres.split(', ').filter(Boolean) : [];

  if (item.tmdbId) {
    fullDetails = await getTmdbFullDetails(item.tmdbId, item.type).catch(() => null);
  }

  if (item.type === 'SERIES') {
    const seasonNumbers = [...new Set(item.episodes.map((ep) => ep.seasonNumber))].sort(
      (a, b) => a - b,
    );

    // Un seul aller-retour pour tous les favoris d'épisodes de ce profil
    // sur cette série, plutôt qu'une requête par épisode.
    const favoriteEpisodeIds = profileId
      ? new Set(
          (
            await db.favorite.findMany({
              where: { profileId, episodeId: { in: item.episodes.map((ep) => ep.id) } },
              select: { episodeId: true },
            })
          ).map((f) => f.episodeId),
        )
      : new Set<string | null>();

    // Même principe pour les épisodes déjà vus par ce profil — la marque
    // "vu" (voir WatchedMark) persiste indépendamment de la progression
    // de lecture, jamais nettoyée une fois un épisode terminé.
    const watchedEpisodeIds = profileId
      ? new Set(
          (
            await db.watchedMark.findMany({
              where: { profileId, episodeId: { in: item.episodes.map((ep) => ep.id) } },
              select: { episodeId: true },
            })
          ).map((w) => w.episodeId),
        )
      : new Set<string | null>();

    seasons = await Promise.all(
      seasonNumbers.map(async (seasonNumber) => {
        const localEpisodes = item.episodes.filter((ep) => ep.seasonNumber === seasonNumber);

        const tmdbSeason = item.tmdbId
          ? await getTmdbSeasonDetails(item.tmdbId, seasonNumber).catch(() => null)
          : null;

        return {
          seasonNumber,
          posterUrl: tmdbSeason?.posterUrl ?? item.posterUrl,
          episodes: localEpisodes.map((ep) => {
            const tmdbEpisode = tmdbSeason?.episodes.find(
              (e) => e.episodeNumber === ep.episodeNumber,
            );
            // Mémorise l'id TMDB propre de l'épisode dès qu'on le
            // découvre — pas besoin d'attendre, juste une consultation
            // suffit (contrairement au scan qui n'a jamais cette info).
            if (tmdbEpisode && ep.tmdbEpisodeId == null) {
              db.episode
                .update({ where: { id: ep.id }, data: { tmdbEpisodeId: tmdbEpisode.tmdbEpisodeId } })
                .catch(() => null);
            }
            return {
              id: ep.id,
              tmdbEpisodeId: ep.tmdbEpisodeId ?? tmdbEpisode?.tmdbEpisodeId ?? null,
              seasonNumber: ep.seasonNumber,
              episodeNumber: ep.episodeNumber,
              streamUrl: `/api/stream/episode/${ep.id}`,
              // Une correction manuelle (tmdbEpisodeName) prime toujours
              // sur le nom TMDB — sans ça, éditer un épisode n'aurait
              // aucun effet visible, TMDB étant relu à chaque consultation.
              name: ep.tmdbEpisodeName ?? tmdbEpisode?.name ?? null,
              overview: tmdbEpisode?.overview ?? null,
              airDate: tmdbEpisode?.airDate ?? null,
              stillUrl: tmdbEpisode?.stillUrl ?? null,
              isFavorite: favoriteEpisodeIds.has(ep.id),
              watched: watchedEpisodeIds.has(ep.id),
            };
          }),
        };
      }),
    );
  } else if (item.type === 'MOVIE' && fullDetails?.collection) {
    const collectionMovies = await getTmdbCollection(fullDetails.collection.id).catch(() => []);
    if (collectionMovies.length > 1) {
      const matches = await db.mediaItem.findMany({
        where: { type: 'MOVIE', tmdbId: { in: collectionMovies.map((m) => m.tmdbId) } },
        select: { id: true, tmdbId: true },
      });
      const localIdByTmdbId = new Map(matches.map((m) => [m.tmdbId, m.id]));

      saga = {
        name: fullDetails.collection.name,
        movies: collectionMovies.map((m) => ({
          tmdbId: m.tmdbId,
          title: m.title,
          year: m.year,
          posterUrl: m.posterUrl,
          localId: localIdByTmdbId.get(m.tmdbId) ?? null,
          isCurrent: localIdByTmdbId.get(m.tmdbId) === item.id,
        })),
      };
    }
  }

  // Suggestions "dans le même genre" — parmi ce que TU possèdes déjà,
  // pas une recommandation TMDB externe qui proposerait des titres que tu
  // n'as pas. Filtré en base sur au moins un genre en commun, puis trié
  // en mémoire par nombre de genres partagés.
  let suggestions: unknown = undefined;
  if (itemGenres.length > 0) {
    const candidates = await db.mediaItem.findMany({
      where: {
        type: item.type,
        id: { not: item.id },
        matchStatus: 'MATCHED',
        OR: itemGenres.map((g) => ({ genres: { contains: g } })),
      },
      select: { id: true, title: true, matchedTitle: true, posterUrl: true, year: true, genres: true },
      take: 100,
    });

    suggestions = candidates
      .map((c) => {
        const cGenres = c.genres ? c.genres.split(', ').filter(Boolean) : [];
        const overlap = cGenres.filter((g) => itemGenres.includes(g)).length;
        return { ...c, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 12)
      .map((c) => ({
        id: c.id,
        title: c.matchedTitle || c.title,
        posterUrl: c.posterUrl,
        year: c.year,
      }));
  }

  // Enregistre casting, collection, ET le statut TMDB de la série dès
  // qu'on les connaît — le statut alimente ensuite la liste admin
  // "Séries en cours" sans avoir à rappeler TMDB à chaque ouverture de
  // cette liste (voir GET /api/admin/tracked-series).
  if (fullDetails) {
    const updates: Record<string, unknown> = {};
    if (item.castNames == null && fullDetails.cast.length > 0) {
      updates.castNames = fullDetails.cast.map((c) => c.name).join(', ');
    }
    if (item.collectionId == null && fullDetails.collection) {
      updates.collectionId = fullDetails.collection.id;
      updates.collectionName = fullDetails.collection.name;
      updates.collectionPosterUrl = fullDetails.collection.posterUrl;
    }
    if (item.type === 'SERIES' && fullDetails.seriesStatus != null) {
      updates.tmdbSeriesStatus = fullDetails.seriesStatus;
      updates.tmdbSeriesStatusCheckedAt = new Date();
      updates.tmdbNextEpisodeAirDate = fullDetails.nextEpisode
        ? new Date(fullDetails.nextEpisode.airDate)
        : null;
      updates.tmdbNextEpisodeLabel = fullDetails.nextEpisode
        ? `S${String(fullDetails.nextEpisode.seasonNumber).padStart(2, '0')}E${String(fullDetails.nextEpisode.episodeNumber).padStart(2, '0')}${fullDetails.nextEpisode.name ? ` · ${fullDetails.nextEpisode.name}` : ''}`
        : null;
    }
    // Note et durée — persistées dès qu'on les connaît, comme le
    // casting, pour permettre de trier TOUTE la médiathèque dessus (pas
    // seulement les items déjà consultés individuellement).
    if (item.tmdbVoteAverage == null && fullDetails.voteAverage != null) {
      updates.tmdbVoteAverage = fullDetails.voteAverage;
    }
    if (item.runtimeMinutes == null && fullDetails.runtimeMinutes != null) {
      updates.runtimeMinutes = fullDetails.runtimeMinutes;
    }
    if (item.contentRating == null && fullDetails.certification != null) {
      updates.contentRating = fullDetails.certification;
      updates.contentRatingRank = certificationRank(fullDetails.certification);
    }
    if (Object.keys(updates).length > 0) {
      await db.mediaItem.update({ where: { id: item.id }, data: updates }).catch(() => null);
    }
  }

  const isFavorite = profileId
    ? Boolean(
        await db.favorite.findUnique({
          where: { profileId_mediaItemId: { profileId, mediaItemId: item.id } },
        }),
      )
    : false;

  return NextResponse.json({
    id: item.id,
    type: item.type,
    title: item.matchedTitle || item.title,
    originalTitle: item.title,
    year: item.year,
    posterUrl: item.posterUrl,
    overview: item.overview,
    matchStatus: item.matchStatus,
    streamUrl: item.type === 'MOVIE' ? `/api/stream/movie/${item.id}` : undefined,
    seasons,
    runtimeMinutes: fullDetails?.runtimeMinutes ?? null,
    genres: itemGenres,
    tagline: fullDetails?.tagline ?? null,
    voteAverage: fullDetails?.voteAverage ?? null,
    backdropUrl: fullDetails?.backdropUrl ?? null,
    imdbId: fullDetails?.imdbId ?? null,
    cast: fullDetails?.cast ?? [],
    saga,
    suggestions,
    isFavorite,
    isLocked: item.manuallyVerified,
    tmdbSeriesStatus: fullDetails?.seriesStatus ?? item.tmdbSeriesStatus ?? null,
    nextEpisodeAirDate: fullDetails?.nextEpisode
      ? fullDetails.nextEpisode.airDate
      : item.tmdbNextEpisodeAirDate?.toISOString().slice(0, 10) ?? null,
    nextEpisodeLabel: fullDetails?.nextEpisode
      ? `S${String(fullDetails.nextEpisode.seasonNumber).padStart(2, '0')}E${String(fullDetails.nextEpisode.episodeNumber).padStart(2, '0')}${fullDetails.nextEpisode.name ? ` · ${fullDetails.nextEpisode.name}` : ''}`
      : item.tmdbNextEpisodeLabel ?? null,
  });
}
