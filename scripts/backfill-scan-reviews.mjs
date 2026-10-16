import { PrismaClient } from '@prisma/client';
import path from 'node:path';
const db = new PrismaClient();

async function upsert(item, issueType, reason) {
  const sourcePath = item.type === 'MOVIE' ? item.filePath : item.episodes?.[0]?.filePath ?? null;
  const found = await db.scanReview.findUnique({
    where: { mediaItemId_issueType: { mediaItemId: item.id, issueType } },
  });
  const data = {
    mediaType: item.type,
    detectedTitle: item.title,
    folderPath: item.folderPath,
    sourcePath,
    proposedTmdbId: item.tmdbId,
    proposedTitle: item.matchedTitle,
    identificationScore: item.identificationScore,
    identificationReason: reason ?? item.identificationReason,
    status: 'OPEN',
    resolvedAt: null,
  };
  if (found) await db.scanReview.update({ where: { id: found.id }, data });
  else await db.scanReview.create({ data: { mediaItemId: item.id, issueType, ...data } });
}

(async () => {
  const items = await db.mediaItem.findMany({
    where: { matchStatus: { in: ['AMBIGUOUS', 'UNMATCHED'] } },
    include: { episodes: { select: { filePath: true, seasonNumber: true }, orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }] } },
  });
  let count = 0;
  for (const item of items) {
    let issueType = item.matchStatus === 'AMBIGUOUS' ? 'TITLE_AMBIGUITY' : 'NO_MATCH';
    let reason = item.identificationReason;

    // Ancien scan partiel : ID + titre fournisseur présents mais aucun score/raison.
    if (item.tmdbId && item.matchedTitle && item.identificationScore == null && !item.identificationReason) {
      issueType = 'STALE_IDENTIFICATION';
      reason = 'Ancienne identification partielle : TMDB présent mais score/raison absents';
    }

    // Racines structurelles connues à auditer en priorité.
    if (item.folderPath && /[\\/](?:saison|season)[ _-]*\d+$/i.test(item.folderPath)) {
      issueType = 'ROOT_ERROR';
      reason = 'La fiche pointe vers un dossier de saison au lieu de la racine de série';
    }
    if (item.folderPath && /[\\/](?:sp[ée]ciaux?|specials?)$/i.test(item.folderPath)) {
      issueType = 'ROOT_ERROR';
      reason = 'Le dossier Spéciaux/Specials a été créé comme série autonome ; V3.12 le rattache à la série parente en S00';
    }

    await upsert(item, issueType, reason);
    count++;
  }
  console.log(`ScanReview backfill: ${count} fiche(s) ouvertes.`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
