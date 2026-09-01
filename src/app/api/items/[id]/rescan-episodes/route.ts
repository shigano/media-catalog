import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';
import { scanLibraryRoot } from '@/lib/scanner';
import { refreshSeriesTracking } from '@/lib/seriesTracking';

/**
 * POST /api/items/[id]/rescan-episodes
 * Re-détecte les épisodes présents dans le dossier de CETTE série
 * uniquement (pas tout le NAS, pas de re-matching TMDB — l'item est déjà
 * reconnu) — pour vérifier immédiatement si un épisode ajouté sur le NAS
 * est bien détecté, sans attendre le prochain scan planifié. Recalcule
 * ensuite les épisodes manquants avec les données à jour.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }
  if (item.type !== 'SERIES' || !item.folderPath) {
    return NextResponse.json({ error: "Cet item n'est pas une série avec un dossier connu" }, { status: 400 });
  }
  if (!item.tmdbId) {
    return NextResponse.json({ error: 'Série non reconnue (pas d\'id TMDB)' }, { status: 400 });
  }

  const { items: detected } = await scanLibraryRoot(item.folderPath);

  // Le dossier d'une série ne contient que ses propres épisodes : peu
  // importe le titre détecté pour le regroupement interne au scan, tous
  // les épisodes trouvés ici appartiennent à CET item.
  const episodes = detected.flatMap((d) => (d.type === 'SERIES' ? d.episodes : []));

  let added = 0;
  for (const ep of episodes) {
    const existing = await db.episode.findUnique({
      where: {
        mediaItemId_seasonNumber_episodeNumber: {
          mediaItemId: item.id,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
        },
      },
    });
    if (existing) {
      if (existing.filePath !== ep.filePath) {
        await db.episode.update({ where: { id: existing.id }, data: { filePath: ep.filePath } });
      }
      continue;
    }
    await db.episode.create({
      data: {
        mediaItemId: item.id,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        filePath: ep.filePath,
      },
    });
    added += 1;
  }

  // Recalcul forcé (pas de cache 24h ici) : l'utilisateur vient
  // explicitement de demander une vérification immédiate.
  const tracking = await refreshSeriesTracking({
    id: item.id,
    tmdbId: item.tmdbId,
    tmdbSeriesStatus: item.tmdbSeriesStatus,
    tmdbNextEpisodeAirDate: item.tmdbNextEpisodeAirDate,
    tmdbNextEpisodeLabel: item.tmdbNextEpisodeLabel,
    missingEpisodesData: item.missingEpisodesData,
  });

  return NextResponse.json({
    episodesAdded: added,
    missingEpisodesCount: tracking.missingEpisodes.length,
    missingEpisodes: tracking.missingEpisodes,
  });
}
