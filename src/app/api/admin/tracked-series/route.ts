import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';
import type { MissingEpisode } from '@/lib/seriesTracking';

/**
 * GET /api/admin/tracked-series
 * "Séries en cours" au sens pratique : celles où il te MANQUE au moins
 * un épisode déjà diffusé selon TMDB. Lit UNIQUEMENT le cache déjà
 * calculé (rapide, aucun appel TMDB ici) — le calcul lui-même se fait en
 * tâche de fond via POST /api/admin/tracked-series/refresh, pour ne
 * jamais bloquer l'ouverture du panel sur un gros catalogue ni risquer
 * un faux "à jour" en cas de coup de mou de l'API TMDB pendant la
 * requête. Triée par date du prochain épisode connu (le plus proche en
 * premier).
 */
export async function GET(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const series = await db.mediaItem.findMany({
    where: { type: 'SERIES', matchStatus: 'MATCHED', missingEpisodesCount: { gt: 0 } },
    orderBy: { title: 'asc' },
    include: {
      _count: {
        select: { episodes: true },
      },
      missingEpisodeIgnores: {
        select: {
          seasonNumber: true,
          episodeNumber: true,
        },
      },
      missingSeasonIgnores: {
        select: {
          seasonNumber: true,
        },
      },
    },
  });

  // V3.13.20 — une même série peut exister physiquement sur plusieurs NAS.
  // Le suivi est logique par identité TMDB : une seule ligne doit apparaître
  // dans le panel, même si plusieurs MediaItem représentent la même série.
  //
  // tmdbSeasonNumber fait partie de la clé afin de ne pas fusionner une
  // branche fournisseur explicite avec la série complète.
  //
  // Si plusieurs copies existent, on utilise comme fiche représentative
  // celle qui possède le plus d'épisodes locaux.
  const representativeByTmdb = new Map<string, (typeof series)[number]>();

  for (const item of series) {
    const key = item.tmdbId != null
      ? `${item.tmdbId}:${item.tmdbSeasonNumber ?? 'full'}`
      : `item:${item.id}`;

    const current = representativeByTmdb.get(key);
    if (!current || item._count.episodes > current._count.episodes) {
      representativeByTmdb.set(key, item);
    }
  }

  // Les données MediaItem restent la vérité brute. Les ignores sont appliqués
  // uniquement à la réponse du panel admin : un scan futur peut donc
  // recalculer les vrais manquants sans annuler le choix de l'administrateur.
  const results = [...representativeByTmdb.values()]
    .map((item) => {
      const rawMissing =
        (item.missingEpisodesData as unknown as MissingEpisode[] | null) ?? [];

      const ignoredKeys = new Set(
        item.missingEpisodeIgnores.map(
          (ignored) => `${ignored.seasonNumber}:${ignored.episodeNumber}`,
        ),
      );

      const ignoredSeasons = new Set(
        item.missingSeasonIgnores.map((ignored) => ignored.seasonNumber),
      );

      const missingEpisodes = rawMissing.filter(
        (episode) =>
          !ignoredSeasons.has(episode.seasonNumber) &&
          !ignoredKeys.has(
            `${episode.seasonNumber}:${episode.episodeNumber}`,
          ),
      );

      return {
        id: item.id,
        title: item.matchedTitle || item.title,
        year: item.year,
        posterUrl: item.posterUrl,
        tmdbStatus: item.tmdbSeriesStatus,
        nextEpisodeAirDate: item.tmdbNextEpisodeAirDate
          ? item.tmdbNextEpisodeAirDate.toISOString()
          : null,
        nextEpisodeLabel: item.tmdbNextEpisodeLabel,
        missingEpisodesCount: missingEpisodes.length,
        missingEpisodes,
        ignoredEpisodesCount: rawMissing.length - missingEpisodes.length,
      };
    })
    .filter((item) => item.missingEpisodesCount > 0);

  results.sort((a, b) => {
    if (!a.nextEpisodeAirDate && !b.nextEpisodeAirDate) return a.title.localeCompare(b.title);
    if (!a.nextEpisodeAirDate) return 1;
    if (!b.nextEpisodeAirDate) return -1;
    return a.nextEpisodeAirDate.localeCompare(b.nextEpisodeAirDate);
  });

  // Nombre de séries jamais encore calculées (ou dont le cache a plus de
  // 24h) — permet à l'appli de savoir si elle doit lancer/poursuivre un
  // rafraîchissement en tâche de fond après avoir affiché ce qui est
  // déjà connu.
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pendingRefresh = await db.mediaItem.count({
    where: {
      type: 'SERIES',
      matchStatus: 'MATCHED',
      tmdbId: { not: null },
      OR: [{ tmdbSeriesStatusCheckedAt: null }, { tmdbSeriesStatusCheckedAt: { lt: staleCutoff } }],
    },
  });

  return NextResponse.json({ series: results, pendingRefresh });
}
