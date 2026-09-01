import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { getProfilePreferences } from '@/lib/profilePersonalization';
import { requireActiveSession } from '@/lib/session';

/**
 * GET /api/library?type=MOVIE|SERIES&q=recherche&libraryId=xxx&profileId=xxx&sort=recent&limit=20&genre=Action&actor=Nom&groupCollections=true
 * Liste des films/séries détectés, pour un client externe (appli de
 * bureau, mobile...). Ne renvoie que le nécessaire pour une vue en
 * grille — /api/library/[id] donne le détail complet (épisodes, etc).
 *
 * `sort=recent` trie par date d'ajout (le plus récent en premier) plutôt
 * que par titre — utilisé pour les sliders "derniers ajouts" par
 * médiathèque sur la page d'accueil. `limit` plafonne le nombre de
 * résultats, pour ces mêmes sliders (pas besoin de charger toute une
 * médiathèque juste pour en montrer 20). `genre` filtre sur un genre
 * précis (voir /api/genres). `q` cherche aussi dans le casting (acteurs,
 * réalisateurs...), pas seulement le titre. `actor` filtre précisément
 * sur un nom exact (utilisé en cliquant sur une photo d'acteur).
 *
 * `groupCollections=true` (films uniquement) regroupe automatiquement les
 * films d'une même saga TMDB (2 films ou plus déjà présents) en une
 * "collection", façon Jellyfin — voir la réponse `collections` en plus de
 * `items` (qui ne contient alors que les films SANS saga, ou les sagas
 * d'un seul film, pour ne rien afficher en double).
 *
 * `profileId`, si fourni, met légèrement en avant la médiathèque et le
 * type (films/séries) que ce profil regarde le plus — pas un moteur de
 * recommandation, juste un tri qui ressemble à ce qu'il regarde déjà.
 */
export async function GET(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const type = req.nextUrl.searchParams.get('type');
  const q = req.nextUrl.searchParams.get('q')?.trim();
  const libraryId = req.nextUrl.searchParams.get('libraryId');
  const profileId = req.nextUrl.searchParams.get('profileId');
  const sort = req.nextUrl.searchParams.get('sort'); // "recent" | null (titre)
  const genre = req.nextUrl.searchParams.get('genre');
  const actor = req.nextUrl.searchParams.get('actor');
  const collectionId = req.nextUrl.searchParams.get('collectionId');
  const groupCollections = req.nextUrl.searchParams.get('groupCollections') === 'true';
  // "unmatched" : items pas encore reconnus avec certitude (AMBIGUOUS ou
  // UNMATCHED) — utilisé par le panel admin pour lister rapidement ce qui
  // reste à corriger, sans avoir à fouiller la grille normale.
  const matchStatusFilter = req.nextUrl.searchParams.get('matchStatus');
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.min(100, Math.max(1, parseInt(limitParam, 10) || 0)) : undefined;

  // Médiathèques restreintes pour ce profil (contrôle parental) — un
  // profil enfant ne doit voir AUCUN titre de ces médiathèques, y
  // compris via une recherche ou un genre qui y mènerait indirectement.
  let restrictedLibraryIds: string[] = [];
  if (profileId) {
    const profile = await db.profile.findUnique({ where: { id: profileId }, select: { restrictedLibraryIds: true } });
    restrictedLibraryIds = profile?.restrictedLibraryIds?.split(',').filter(Boolean) ?? [];
  }

  const items = await db.mediaItem.findMany({
    where: {
      ...(type === 'MOVIE' || type === 'SERIES' ? { type } : {}),
      // Combine correctement les deux filtres de médiathèque plutôt que
      // de risquer que le second écrase le premier (deux clés `libraryId`
      // dans un même objet, la dernière l'emporterait sinon) : si la
      // médiathèque demandée précisément est restreinte pour ce profil,
      // aucun résultat ; sinon, exclusion normale des restreintes.
      ...(libraryId
        ? restrictedLibraryIds.includes(libraryId)
          ? { libraryId: '__none__' }
          : { libraryId }
        : restrictedLibraryIds.length > 0
          ? { libraryId: { notIn: restrictedLibraryIds } }
          : {}),
      ...(genre ? { genres: { contains: genre } } : {}),
      ...(actor ? { castNames: { contains: actor } } : {}),
      ...(collectionId ? { collectionId: parseInt(collectionId, 10) } : {}),
      ...(matchStatusFilter === 'unmatched'
        ? { matchStatus: { in: ['UNMATCHED', 'AMBIGUOUS'] } }
        : session.role !== 'ADMIN'
          // Un client normal ne doit jamais voir un titre pas encore
          // reconnu (souvent des doublons au titre garbled, une vraie
          // mauvaise expérience) — seul un admin (via le panel "À
          // vérifier", ou pour du dépannage) y a accès.
          ? { matchStatus: 'MATCHED' }
          : {}),
      ...(q
        ? {
            // Recherche générale volontairement limitée au titre — croiser
            // aussi les noms d'acteurs faisait remonter des résultats sans
            // rapport apparent avec ce qui était tapé (ex: "rube" trouvait
            // des films sans lien juste parce qu'un acteur s'appelait
            // "Rubén"). La recherche par acteur reste disponible ailleurs,
            // en cliquant sur un nom dans le casting d'une fiche.
            OR: [
              { title: { contains: q } },
              { matchedTitle: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy:
      sort === 'recent'
        ? { createdAt: 'desc' }
        : sort === 'year'
          ? { year: 'desc' }
          : sort === 'runtime'
            ? { runtimeMinutes: 'desc' }
            : sort === 'rating'
              ? { tmdbVoteAverage: 'desc' }
              : sort === 'playCount'
                ? { playCount: 'desc' }
                : sort === 'contentRating'
                  ? { contentRatingRank: 'asc' }
                  // "random" et "lastWatched" : l'ordre exact ici n'a pas
                  // d'importance, le tri final a lieu juste après le
                  // chargement (mélange, ou croisement avec les données
                  // de lecture par profil).
                  : { title: 'asc' },
    ...(limit && sort !== 'random' && sort !== 'lastWatched' ? { take: limit } : {}),
    select: {
      id: true,
      type: true,
      title: true,
      matchedTitle: true,
      year: true,
      posterUrl: true,
      matchStatus: true,
      genres: true,
      libraryId: true,
      library: { select: { id: true, name: true } },
      collectionId: true,
      collectionName: true,
      collectionPosterUrl: true,
      manuallyVerified: true,
      tmdbVoteAverage: true,
      runtimeMinutes: true,
      playCount: true,
      contentRating: true,
      contentRatingRank: true,
      createdAt: true,
    },
  });

  let ordered = items;
  if (sort === 'random') {
    // Mélange en mémoire (Fisher-Yates) — la limite (si demandée) est
    // appliquée APRÈS le mélange, pas avant, pour un vrai tirage sur
    // l'ensemble des résultats plutôt que sur les N premiers par titre.
    ordered = [...items];
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
    if (limit) ordered = ordered.slice(0, limit);
  } else if (sort === 'lastWatched' && profileId) {
    // Croise avec les dates de lecture DE CE PROFIL — pas stockable
    // directement en tri base vu que ça touche deux tables (progression
    // de film ET d'épisode). Les titres jamais regardés par ce profil
    // passent en dernier plutôt que d'être exclus.
    const movieIds = items.filter((i) => i.type === 'MOVIE').map((i) => i.id);
    const seriesIds = items.filter((i) => i.type === 'SERIES').map((i) => i.id);

    const movieProgress = await db.watchProgress.findMany({
      where: { profileId, mediaItemId: { in: movieIds } },
      select: { mediaItemId: true, updatedAt: true },
    });
    const lastWatchedByItem = new Map<string, Date>(
      movieProgress.map((p) => [p.mediaItemId!, p.updatedAt]),
    );

    if (seriesIds.length > 0) {
      const episodes = await db.episode.findMany({
        where: { mediaItemId: { in: seriesIds } },
        select: { id: true, mediaItemId: true },
      });
      const seriesIdByEpisodeId = new Map(episodes.map((e) => [e.id, e.mediaItemId]));
      const episodeProgress = await db.watchProgress.findMany({
        where: { profileId, episodeId: { in: episodes.map((e) => e.id) } },
        select: { episodeId: true, updatedAt: true },
      });
      for (const p of episodeProgress) {
        const seriesId = seriesIdByEpisodeId.get(p.episodeId!);
        if (!seriesId) continue;
        const current = lastWatchedByItem.get(seriesId);
        if (!current || p.updatedAt > current) lastWatchedByItem.set(seriesId, p.updatedAt);
      }
    }

    ordered = [...items].sort((a, b) => {
      const da = lastWatchedByItem.get(a.id);
      const db_ = lastWatchedByItem.get(b.id);
      if (!da && !db_) return a.title.localeCompare(b.title);
      if (!da) return 1;
      if (!db_) return -1;
      return db_.getTime() - da.getTime();
    });
    if (limit) ordered = ordered.slice(0, limit);
  }
  if (profileId) {
    if (q) {
      db.searchLog.create({ data: { profileId, query: q } }).catch(() => null);
    }
    // La personnalisation ne s'applique qu'au tri par titre — un slider
    // "derniers ajouts" doit rester trié par date, et un tri explicite
    // (aléatoire, note, durée, date de sortie, lectures, classification)
    // ne doit pas être ré-écrasé non plus, sans quoi il perdrait sa
    // raison d'être.
    if (sort == null) {
      const { preferredLibraryId, preferredType } = await getProfilePreferences(profileId);
      if (preferredLibraryId || preferredType) {
        const score = (item: (typeof items)[number]) =>
          (item.libraryId === preferredLibraryId ? 2 : 0) + (item.type === preferredType ? 1 : 0);
        ordered = [...items].sort((a, b) => score(b) - score(a));
      }
    }
  }

  const toJson = (item: (typeof items)[number]) => ({
    id: item.id,
    type: item.type,
    title: item.matchedTitle || item.title,
    year: item.year,
    posterUrl: item.posterUrl,
    matchStatus: item.matchStatus,
    genres: item.genres ? item.genres.split(', ').filter(Boolean) : [],
    libraryId: item.library?.id ?? null,
    libraryName: item.library?.name ?? null,
    isLocked: item.manuallyVerified,
    voteAverage: item.tmdbVoteAverage,
    runtimeMinutes: item.runtimeMinutes,
    playCount: item.playCount,
    contentRating: item.contentRating,
  });

  if (groupCollections && type === 'MOVIE') {
    // Regroupe par saga tout en préservant l'ordre déjà établi par
    // `ordered` (quel que soit le tri actif) : chaque tuile (film seul ou
    // saga) hérite du rang de son PREMIER film rencontré dans `ordered`,
    // ce qui les entrelace naturellement au lieu d'afficher toutes les
    // sagas avant tous les films seuls comme c'était le cas auparavant.
    const byCollection = new Map<number, { movies: typeof items; firstIndex: number }>();
    const standalone: Array<{ item: (typeof items)[number]; firstIndex: number }> = [];

    ordered.forEach((item, index) => {
      if (item.collectionId) {
        const group = byCollection.get(item.collectionId);
        if (group) {
          group.movies.push(item);
        } else {
          byCollection.set(item.collectionId, { movies: [item], firstIndex: index });
        }
      } else {
        standalone.push({ item, firstIndex: index });
      }
    });

    type Tile =
      | { kind: 'movie'; firstIndex: number; data: ReturnType<typeof toJson> }
      | {
          kind: 'collection';
          firstIndex: number;
          data: { id: number; name: string; posterUrl: string | null; movieIds: string[] };
        };

    const tiles: Tile[] = standalone.map(({ item, firstIndex }) => ({
      kind: 'movie',
      firstIndex,
      data: toJson(item),
    }));

    for (const [collectionId, { movies, firstIndex }] of byCollection) {
      if (movies.length >= 2) {
        tiles.push({
          kind: 'collection',
          firstIndex,
          data: {
            id: collectionId,
            name: movies[0].collectionName ?? 'Saga',
            // Affiche dédiée à la collection si connue ; sinon on
            // retombe temporairement sur celle du premier film plutôt
            // que de n'avoir aucune image du tout.
            posterUrl: movies[0].collectionPosterUrl ?? movies[0].posterUrl,
            movieIds: movies.map((m) => m.id),
          },
        });
      } else {
        // Une "saga" d'un seul film ne mérite pas sa propre tuile.
        tiles.push({ kind: 'movie', firstIndex, data: toJson(movies[0]) });
      }
    }

    tiles.sort((a, b) => a.firstIndex - b.firstIndex);

    return NextResponse.json({
      tiles: tiles.map(({ kind, data }) => ({ kind, ...data })),
    });
  }

  return NextResponse.json({ items: ordered.map(toJson) });
}
