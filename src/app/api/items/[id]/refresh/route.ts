import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';
import { findBestTmdbMatch, findTmdbById, titleSimilarity } from '@/lib/tmdbMatch';
import { POST as rescanSeriesEpisodes } from '../rescan-episodes/route';

/**
 * POST /api/items/[id]/refresh
 * Relance automatiquement la recherche TMDB pour cet item précis, à
 * partir de son titre déjà détecté — équivalent du "Actualiser les
 * métadonnées" de Jellyfin (récupère une affiche manquante, un synopsis
 * mis à jour...), sans passer par une recherche manuelle.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }

  // V3.13.1 : le bouton "Actualiser" de l'admin web appelle uniquement
  // /refresh. Jusqu'ici SERIES était un no-op en supposant qu'un second appel
  // vers /rescan-episodes suivrait (c'est vrai dans l'app Flutter, pas dans
  // l'admin web). On délègue donc réellement au rescan ciblé ici.
  if (item.type === 'SERIES') {
    console.log(`[SERIES-REFRESH-DELEGATE] item=${item.id} title=${item.title}`);
    const rescanResponse = await rescanSeriesEpisodes(req, { params });
    if (!rescanResponse.ok) return rescanResponse;

    const rescan = await rescanResponse.json();
    const refreshed = await db.mediaItem.findUnique({ where: { id: item.id } });
    return NextResponse.json({
      ok: true,
      delegatedToTargetedRescan: false,
      rescan,
      item: refreshed
        ? {
            title: refreshed.tmdbSeasonNumber != null
              ? refreshed.title
              : (refreshed.matchedTitle || refreshed.title),
            posterUrl: refreshed.posterUrl,
            matchStatus: refreshed.matchStatus,
          }
        : {
            // La fiche cliquée pouvait être un faux dossier structurel
            // (Saison 1, Épisodes spéciaux, NOOB HD) supprimé après que ses
            // épisodes ont été réaffectés à la vraie série.
            title: item.title,
            posterUrl: item.posterUrl,
            matchStatus: 'MATCHED',
            removedAsStructuralDuplicate: true,
          },
    });
  }

  console.log(`[MOVIE-REFRESH-START] item=${item.id} title=${item.title}`);

  // V3.12.2 : les anciens films pouvaient déjà avoir le bon tmdbId et le bon
  // matchedTitle, mais être restés AMBIGUOUS avec score/reason null après un
  // scan interrompu. Dans ce cas on revalide d'abord l'ID enregistré chez
  // TMDB, au lieu de refaire une recherche textuelle plus fragile.
  let match = null as Awaited<ReturnType<typeof findTmdbById>>;
  let usedStoredTmdbId = false;

  if (item.tmdbId != null && item.matchedTitle) {
    const byId = await findTmdbById(item.tmdbId, 'MOVIE').catch(() => null);
    if (byId) {
      const storedTitleScore = titleSimilarity(item.matchedTitle, byId.title);
      const localTitleScore = titleSimilarity(item.title, byId.title);
      if (storedTitleScore >= 0.85 || localTitleScore >= 0.62) {
        match = byId;
        usedStoredTmdbId = true;
        console.log(
          `[MOVIE-RECONCILE] item=${item.id} tmdb=${item.tmdbId} ` +
          `storedTitleScore=${storedTitleScore.toFixed(3)} localTitleScore=${localTitleScore.toFixed(3)}`,
        );
      }
    }
  }

  if (!match) {
    match = await findBestTmdbMatch(item.title, item.year, item.type).catch(() => null);
  }

  if (!match) {
    console.log(`[MOVIE-REFRESH-END] item=${item.id} status=NO_MATCH`);
    return NextResponse.json({ error: 'Aucune correspondance trouvée sur TMDB' }, { status: 404 });
  }

  const matchStatus = usedStoredTmdbId ? 'MATCHED' : (match.confident ? 'MATCHED' : 'AMBIGUOUS');
  const identificationScore = usedStoredTmdbId ? 1 : null;
  const identificationReason = usedStoredTmdbId
    ? `ID TMDB explicite: ${match.tmdbId}`
    : null;

  const updated = await db.mediaItem.update({
    where: { id: item.id },
    data: {
      tmdbId: match.tmdbId,
      matchedTitle: match.title,
      posterUrl: match.posterUrl,
      overview: match.overview,
      genres: match.genres.join(', ') || null,
      metadataSource: 'TMDB',
      matchStatus,
      ...(usedStoredTmdbId
        ? { identificationScore, identificationReason }
        : {}),
    },
  });

  if (matchStatus === 'MATCHED') {
    await db.scanReview.updateMany({
      where: {
        mediaItemId: item.id,
        status: 'OPEN',
        issueType: { in: ['STALE_IDENTIFICATION', 'TITLE_AMBIGUITY', 'NO_MATCH'] },
      },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  console.log(
    `[MOVIE-REFRESH-END] item=${item.id} status=${matchStatus} tmdb=${match.tmdbId} ` +
    `reconciled=${usedStoredTmdbId}`,
  );

  return NextResponse.json({
    ok: true,
    item: {
      title: updated.tmdbSeasonNumber != null ? updated.title : (updated.matchedTitle || updated.title),
      posterUrl: updated.posterUrl,
      matchStatus: updated.matchStatus,
    },
  });
}
