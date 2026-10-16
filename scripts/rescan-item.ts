import { db } from '../src/lib/db';
import { rescanSeriesById } from '../src/lib/targetedRescan/rescanSeriesById';

async function main() {
  const itemId = process.argv[2]?.trim();

  if (!itemId) {
    console.error('Usage: npm run rescan:item -- <MEDIA_ITEM_ID>');
    process.exitCode = 1;
    return;
  }

  console.log('============================================================');
  console.log('[TARGETED-RESCAN-CLI]');
  console.log(`ID : ${itemId}`);
  console.log('============================================================');

  const result = await rescanSeriesById(itemId);

  const episodes = await db.episode.findMany({
    where: { mediaItemId: result.itemId },
    select: { filePath: true },
  });

  const physicalFiles = new Set(episodes.map((e) => e.filePath)).size;

  console.log('');
  console.log('============================================================');
  console.log('[TARGETED-RESCAN-CLI-RESULT]');
  console.log(`Série              : ${result.title}`);
  console.log(`ID                 : ${result.itemId}`);
  console.log(`Episodes           : ${episodes.length}`);
  console.log(`Fichiers physiques : ${physicalFiles}`);
  console.log(`Manquants          : ${result.missingEpisodesCount}`);
  console.log(`Ajoutés             : ${result.episodesAdded}`);
  console.log(`Supprimés           : ${result.episodesRemoved}`);
  console.log(`Doublons supprimés  : ${result.duplicatesRemoved}`);
  console.log(`Séries réévaluées   : ${result.seriesReevaluated.length}`);
  console.log('Statut              : OK');
  console.log('============================================================');
}

main()
  .catch((error) => {
    console.error('');
    console.error('============================================================');
    console.error('[TARGETED-RESCAN-CLI-ERROR]');
    console.error(error instanceof Error ? error.message : error);

    if (
      typeof error === 'object' &&
      error !== null &&
      'physicalRoots' in error
    ) {
      console.error('Racines physiques :', error.physicalRoots);
    }

    console.error('============================================================');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
