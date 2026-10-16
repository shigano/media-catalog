import path from 'node:path';
import { access, readdir } from 'node:fs/promises';

import { db } from '@/lib/db';
import {
  scanLibraryRoot,
  canonicalSeriesFolderFromPath,
  type DetectedSeries,
} from '@/lib/scanner';
import { persistItem, queueNewMedia } from '@/lib/scanEngine';
import { refreshSeriesTracking } from '@/lib/seriesTracking';

function isInsideFolder(filePath: string, folderPath: string): boolean {
  const file = path.resolve(filePath);
  const folder = path.resolve(folderPath);
  return file === folder || file.startsWith(`${folder}${path.sep}`);
}

function directChildUnderRoot(filePath: string, rootPath: string): string | null {
  const root = path.resolve(rootPath);
  const file = path.resolve(filePath);
  if (!isInsideFolder(file, root) || file === root) return null;

  const relative = path.relative(root, file);
  const parts = relative.split(path.sep).filter(Boolean);
  // Il faut au minimum un dossier enfant + le fichier. Si le fichier est
  // directement à la racine de la médiathèque, aucun rescan ciblé sûr n'est
  // possible sans scanner toute la bibliothèque.
  if (parts.length < 2) return null;
  return path.join(root, parts[0]);
}

async function beginTargetedScanGuard(itemId: string): Promise<{ id: string } | { error: string }> {
  // Le scan automatique/full utilise ScanLog.status=running comme mutex.
  // Jusqu'en V3.13.9, le rescan ciblé n'y participait pas : le cron pouvait
  // donc démarrer au milieu d'une actualisation manuelle. On inscrit désormais
  // aussi le rescan ciblé dans ScanLog pour que les deux chemins se bloquent
  // mutuellement.
  const staleBefore = new Date(Date.now() - 3 * 60 * 60 * 1000);
  await db.scanLog.updateMany({
    where: { status: 'running', startedAt: { lt: staleBefore } },
    data: {
      status: 'error',
      errorMessage: 'Scan resté bloqué (probable crash ou redémarrage) — marqué automatiquement en erreur.',
      finishedAt: new Date(),
    },
  });

  const running = await db.scanLog.findFirst({
    where: { status: 'running' },
    orderBy: { startedAt: 'asc' },
    select: { id: true, startedAt: true },
  });
  if (running) {
    console.warn(`[RESCAN-GUARD-BUSY] item=${itemId} activeScan=${running.id}`);
    return { error: 'Un autre scan est déjà en cours. Réessaie quand il est terminé.' };
  }

  const scanLog = await db.scanLog.create({ data: {} });
  console.log(`[RESCAN-GUARD-ACQUIRED] item=${itemId} scanLog=${scanLog.id}`);
  return { id: scanLog.id };
}

/**
 * V3.5 — rescan réellement CIBLE.
 *
 * On ne scanne plus le parent arbitraire de la fiche (qui pouvait remonter à
 * une grosse branche de médiathèque). On reconstruit les quelques racines
 * physiques concernées à partir :
 *   1) du folderPath de la fiche ;
 *   2) des filePath de ses épisodes déjà connus.
 *
 * C'est important pour réparer une fiche comme Bleach : si des épisodes TYBW
 * sont rattachés au mauvais MediaItem, leur chemin nous fait aussi scanner la
 * vraie branche TYBW, mais rien d'autre dans la médiathèque.
 */
export async function rescanSeriesById(itemId: string) {
  console.log(`[RESCAN-START] item=${itemId}`);

  const item = await db.mediaItem.findUnique({
    where: { id: itemId },
    include: { library: { include: { folders: true } }, episodes: true },
  });
  if (!item) {
    throw Object.assign(new Error('Introuvable'), { statusCode: 404 });
  }
  if (item.type !== 'SERIES' || !item.folderPath) {
    throw Object.assign(
      new Error("Cet item n'est pas une série avec un dossier connu"),
      { statusCode: 400 },
    );
  }

  const guard = await beginTargetedScanGuard(item.id);
  if ('error' in guard) {
    throw Object.assign(new Error(guard.error), { statusCode: 409 });
  }

  try {
  const libraryRoots = item.library?.folders.map((f) => path.resolve(f.path)) ?? [];
  const scanRoots = new Set<string>();
  // V3.13.13 — lorsqu'une fausse fiche pointe sur la racine de bibliothèque
  // mais que ses épisodes convergent vers un unique dossier enfant, ce dossier
  // récupéré devient un scope STRICT. Il ne doit plus repasser par
  // canonicalTargetScope(), qui peut interpréter un nom de release contenant
  // S01 comme un simple conteneur de saison et remonter jusqu'à /Animés.
  let recoveredLibraryRootScope: string | null = null;

  // V3.13.3 — un MediaItem erroné peut déjà pointer SOUS un dossier de
  // saison (ex. Hawkeye/Saison_1/<release>/Hawkeye.S01E01). Dans ce cas,
  // canonicalSeriesFolderFromPath(candidate) ne suffit pas car le basename
  // du candidat n'est pas structurel. On cherche donc aussi un ancêtre
  // Saison/Spéciaux et on remonte sa racine canonique.
  const canonicalTargetScope = (candidate: string): string => {
    const resolved = path.resolve(candidate);
    let current = resolved;
    while (true) {
      const canonical = canonicalSeriesFolderFromPath(current);
      if (canonical !== current) return canonical;

      const parent = path.dirname(current);
      if (parent === current) break;
      if (libraryRoots.some((r) => current === r)) break;
      current = parent;
    }
    return canonicalSeriesFolderFromPath(resolved);
  };

  const addScope = (candidate: string) => {
    const canonical = canonicalTargetScope(candidate);
    const insideLibrary = libraryRoots.length === 0 || libraryRoots.some((r) => isInsideFolder(canonical, r));
    if (insideLibrary) scanRoots.add(path.resolve(canonical));
  };

  // V3.13.2 — si la fiche elle-même pointe vers un dossier STRUCTUREL
  // (Saison_1, NOOB - saison 2 - HD, Épisodes spéciaux...), sa racine
  // canonique est prioritaire. On ne doit surtout pas reconstruire le scope
  // depuis le parent immédiat de chaque fichier : Hawkeye possède par exemple
  // un dossier de release puis un dossier par épisode sous Saison_1 ; l'ancien
  // code scannait alors ces dossiers feuille séparément et fabriquait 6 séries.
  //
  // Pour une vraie racine de série non structurelle, on conserve en revanche
  // le comportement V3.11 : les chemins physiques des épisodes restent utiles
  // pour réparer les franchises réparties sur plusieurs branches (Bleach/TYBW).
  const resolvedItemFolder = path.resolve(item.folderPath);
  const canonicalItemFolder = canonicalTargetScope(resolvedItemFolder);
  const itemIsStructuralRoot = canonicalItemFolder !== resolvedItemFolder;
  const itemIsLibraryRoot = libraryRoots.some((r) => r === resolvedItemFolder);

  // V3.13.10 — récupération sûre d'une ancienne fausse fiche qui pointe
  // directement sur la racine de médiathèque (ex. `Animés`) alors que ses
  // épisodes connus sont tous dans UN vrai dossier enfant (ex. Shaman King).
  // On ne doit JAMAIS rescanner la racine complète pour réparer cette fiche.
  if (itemIsLibraryRoot) {
    if (item.episodes.length === 0) {
      console.warn(`[TARGET-ROOT-ABORT] item=${item.id} root=${resolvedItemFolder} sans épisode connu`);
      await db.scanLog.update({
        where: { id: guard.id },
        data: {
          status: 'error',
          errorMessage: 'Rescan ciblé refusé : la fiche pointe sur une racine de médiathèque et ne possède aucun épisode permettant de retrouver sa vraie racine.',
          finishedAt: new Date(),
        },
      });
      throw Object.assign(
        new Error('Rescan ciblé refusé : impossible de déterminer une racine physique sûre depuis cette fiche.'),
        { statusCode: 409 },
      );
    }

    const physicalRoots = new Set<string>();
    for (const ep of item.episodes) {
      const child = directChildUnderRoot(ep.filePath, resolvedItemFolder);
      if (!child) {
        console.warn(`[TARGET-ROOT-ABORT] épisode sans dossier enfant sûr: ${ep.filePath}`);
        await db.scanLog.update({
          where: { id: guard.id },
          data: {
            status: 'error',
            errorMessage: `Rescan ciblé refusé : épisode sans dossier enfant sûr (${ep.filePath}).`,
            finishedAt: new Date(),
          },
        });
        throw Object.assign(
          new Error('Rescan ciblé refusé : structure physique ambiguë.'),
          { statusCode: 409 },
        );
      }
      physicalRoots.add(path.resolve(child));
    }

    if (physicalRoots.size !== 1) {
      console.warn(`[TARGET-ROOT-ABORT] item=${item.id} plusieurs racines physiques: ${[...physicalRoots].join(' | ')}`);
      await db.scanLog.update({
        where: { id: guard.id },
        data: {
          status: 'error',
          errorMessage: `Rescan ciblé refusé : ${physicalRoots.size} racines physiques distinctes détectées.`,
          finishedAt: new Date(),
        },
      });
      throw Object.assign(
        new Error('Rescan ciblé refusé : les épisodes actuels couvrent plusieurs dossiers physiques. Aucun scan global n’a été lancé.'),
        {
          statusCode: 409,
          physicalRoots: [...physicalRoots],
        },
      );
    }

    const recoveredRoot = path.resolve([...physicalRoots][0]);
    recoveredLibraryRootScope = recoveredRoot;
    scanRoots.clear();
    scanRoots.add(recoveredRoot);
    console.log(`[TARGET-ROOT-RECOVERY] ${resolvedItemFolder} -> ${recoveredRoot} (${item.episodes.length} épisode(s))`);
    console.log(`[TARGET-ROOT-SCOPE-LOCK] item=${item.id} scope=${recoveredRoot}`);
  } else if (itemIsStructuralRoot) {
    addScope(item.folderPath);
    console.log(`[TARGET-SCOPE] racine structurelle remontée: ${resolvedItemFolder} -> ${canonicalItemFolder}`);
  } else {
    if (item.episodes.length === 0) addScope(item.folderPath);
    for (const ep of item.episodes) addScope(path.dirname(ep.filePath));
  }

  // V3.6 — réparation d'une franchise locale : si la fiche se trouve dans
  // un conteneur sous la racine de médiathèque (ex. Bleach (2004)/Bleach et
  // Bleach (2004)/Bleach La Guerre Sanglante...), on ajoute CE parent au
  // périmètre. Cela permet de réparer les deux branches en un clic sans
  // remonter jusqu'à toute la médiathèque Animés.
  const itemFolder = path.resolve(item.folderPath);
  const directLibraryRoot = libraryRoots.find((r) => isInsideFolder(itemFolder, r));
  const parentFolder = path.dirname(itemFolder);
  if (!recoveredLibraryRootScope && directLibraryRoot && parentFolder !== directLibraryRoot && isInsideFolder(parentFolder, directLibraryRoot)) {
    try {
      const entries = await readdir(parentFolder, { withFileTypes: true });
      const childDirs = entries.filter((e) => e.isDirectory()).length;
      if (childDirs >= 2 && childDirs <= 20) {
        scanRoots.add(parentFolder);
        console.log(`[TARGET-SCOPE] conteneur franchise ajouté: ${parentFolder}`);
      }
    } catch { /* parent inaccessible : conserver le scope strict */ }
  }

  // V3.13.13 — invariant de sécurité : après TARGET-ROOT-RECOVERY, aucun
  // autre chemin ne peut être ajouté au rescan. Même une évolution future de
  // la logique de franchise/canonicalisation ne pourra donc élargir ce scan à
  // toute la médiathèque.
  if (recoveredLibraryRootScope) {
    const before = [...scanRoots];
    scanRoots.clear();
    scanRoots.add(recoveredLibraryRootScope);
    if (before.length !== 1 || path.resolve(before[0] ?? '') !== recoveredLibraryRootScope) {
      console.log(`[TARGET-ROOT-SCOPE-ENFORCE] ${before.join(' | ')} -> ${recoveredLibraryRootScope}`);
    }
  }

  // V3.13.12 — si le scope contient à la fois un dossier feuille et son
  // ancêtre (cas Chernobyl : dossier S01E01 + parent Chernobyl 2019), on ne
  // scanne que l'ancêtre. Scanner les deux profondeurs pouvait produire une
  // détection feuille concurrente avant la fusion.
  const compactedRoots = [...scanRoots].filter((candidate) => {
    const resolvedCandidate = path.resolve(candidate);
    return ![...scanRoots].some((other) => {
      const resolvedOther = path.resolve(other);
      return resolvedOther !== resolvedCandidate && isInsideFolder(resolvedCandidate, resolvedOther);
    });
  });
  if (compactedRoots.length !== scanRoots.size) {
    console.log(`[TARGET-SCOPE-COMPACT] ${[...scanRoots].join(' | ')} -> ${compactedRoots.join(' | ')}`);
    scanRoots.clear();
    for (const root of compactedRoots) scanRoots.add(root);
  }

  const detectedByFolder = new Map<string, DetectedSeries>();
  for (const scopeRoot of scanRoots) {
    const resolvedScope = path.resolve(scopeRoot);
    const isLibraryRoot = libraryRoots.some((r) => r === resolvedScope);
    // V3.13.1 — un rescan ciblé d'une vraie série située SOUS la racine de
    // médiathèque peut utiliser le nom de sa racine même sans tvshow.nfo.
    // C'est indispensable pour Noob/Saison_1/Hawkeye. En revanche la racine
    // de bibliothèque elle-même (ex. /mnt/nas/Animés) reste interdite afin
    // de ne jamais recréer une fausse série portant le nom de la bibliothèque.
    const { items: detected } = await scanLibraryRoot(scopeRoot, {
      allowRootSeriesName: !isLibraryRoot,
    });
    for (const d of detected) {
      if (d.type !== 'SERIES') continue;
      detectedByFolder.set(path.resolve(d.folderPath), d);
    }
  }
  // V3.13.5 — un même ensemble d'épisodes peut être détecté à plusieurs
  // profondeurs lorsque les releases ajoutent des dossiers par épisode
  // (Hawkeye/Saison_1/<release>/Hawkeye.S01E01/...). Si une détection
  // descendante ne possède AUCUN fichier propre et que tous ses épisodes sont
  // déjà couverts par une détection ancêtre, l'ancêtre est l'unique
  // propriétaire physique. On supprime donc la détection imbriquée avant
  // toute écriture en BDD. Cela évite les allers-retours de propriétaire entre
  // Phase1/Phase2 sans fusionner des branches réellement distinctes.
  const allDetected = [...detectedByFolder.values()];
  const relevant = allDetected.filter((candidate) => {
    const candidateRoot = path.resolve(candidate.folderPath);
    const candidateFiles = new Set(candidate.episodes.map((ep) => path.resolve(ep.filePath)));
    if (candidateFiles.size === 0) return true;

    for (const ancestor of allDetected) {
      if (ancestor === candidate) continue;
      const ancestorRoot = path.resolve(ancestor.folderPath);
      if (ancestorRoot === candidateRoot || !isInsideFolder(candidateRoot, ancestorRoot)) continue;

      const ancestorFiles = new Set(ancestor.episodes.map((ep) => path.resolve(ep.filePath)));
      const fullyCovered = [...candidateFiles].every((filePath) => ancestorFiles.has(filePath));
      if (fullyCovered) {
        console.log(`[NESTED-DETECTION-SKIP] ${candidate.title} @ ${candidate.folderPath} couvert par ${ancestor.title} @ ${ancestor.folderPath}`);
        return false;
      }
    }
    return true;
  });
  console.log(`[RESCAN-DETECTED] ${relevant.length} série(s): ${relevant.map((s) => `${s.title} @ ${s.folderPath}`).join(' | ')}`);

  // V3.11 — ROOT LOCK : si le rescan ne voit qu'une seule vraie série et que
  // tous les épisodes actuels sont physiquement sous cette racine plus précise,
  // on déplace l'identité du MediaItem EXISTANT au lieu de créer une nouvelle
  // fiche puis de réaffecter 52 épisodes. L'id est conservé (progression, favoris,
  // liens) et les rescans suivants restent idempotents.
  if (relevant.length === 1) {
    const detectedRoot = path.resolve(relevant[0].folderPath);
    const currentRoot = path.resolve(item.folderPath);
    const allEpisodesInside = item.episodes.length > 0 && item.episodes.every((ep) => isInsideFolder(ep.filePath, detectedRoot));

    // V3.13.2 — deux déplacements sûrs de racine :
    //  1) ROOT-LOCK historique : vers une racine plus précise située dessous ;
    //  2) STRUCTURAL-LIFT : depuis un faux dossier Saison/Spéciaux vers son
    //     vrai parent canonique. Ce second cas est sûr même si la fiche a déjà
    //     perdu ses épisodes lors d'un ancien rescan erroné : la structure du
    //     chemin suffit et permet de conserver le MediaItem.id existant.
    const preciseDescend =
      detectedRoot !== currentRoot && isInsideFolder(detectedRoot, currentRoot) && allEpisodesInside;
    const structuralLift =
      detectedRoot !== currentRoot &&
      canonicalSeriesFolderFromPath(currentRoot) === detectedRoot;

    if (preciseDescend || structuralLift) {
      await db.mediaItem.update({
        where: { id: item.id },
        data: { folderPath: relevant[0].folderPath, title: relevant[0].title },
      });
      console.log(`[${structuralLift ? 'STRUCTURAL-LIFT' : 'ROOT-LOCK'}] ${currentRoot} -> ${detectedRoot}`);
    }
  }

  const beforeIds = new Set(item.episodes.map((e) => e.id));
  const ownerByPath = new Map<string, { ownerId: string; seasonNumber: number; episodeNumber: number }>();

  console.log('[RESCAN-PHASE1] création/identification des propriétaires physiques');
  for (const detectedSeries of relevant) {
    const saved = await persistItem(
      detectedSeries,
      item.libraryId ?? '',
      item.library?.name,
      { queueUpcoming: false },
    );
    for (const ep of detectedSeries.episodes) {
      ownerByPath.set(ep.filePath, {
        ownerId: saved.id,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
      });
    }
  }

  // V3.16 — réparation des anciennes coordonnées du BON propriétaire.
  //
  // Un ancien parseur peut avoir enregistré le bon fichier sous la bonne
  // série mais avec une mauvaise coordonnée SxxExx. Exemple Red Dwarf :
  //
  //   /Saison 02/02-1_Kryten.mkv enregistré en S02E02
  //   alors que le scanner corrigé le détecte désormais en S02E01.
  //
  // La réconciliation d'ownership ci-dessous ne peut pas corriger ce cas,
  // car mediaItemId est déjà correct. De plus, persistItem() protège
  // volontairement une coordonnée occupée par un autre fichier.
  //
  // On libère donc AVANT la deuxième passe les anciennes lignes du bon
  // propriétaire dont le chemin physique est connu mais dont les coordonnées
  // ne correspondent plus au scanner.
  //
  // Sécurité : une ligne possédant encore progression/favori/marquage vu
  // n'est jamais supprimée automatiquement.
  console.log('[RESCAN-COORDINATE-REPAIR] vérification des coordonnées par chemin physique');

  for (const [filePath, detected] of ownerByPath) {
    const rows = await db.episode.findMany({
      where: {
        filePath,
        mediaItemId: detected.ownerId,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const misplaced = rows.filter(
      (row) =>
        row.seasonNumber !== detected.seasonNumber ||
        row.episodeNumber !== detected.episodeNumber,
    );

    for (const row of misplaced) {
      const [progressCount, favoriteCount, watchedCount] = await Promise.all([
        db.watchProgress.count({ where: { episodeId: row.id } }),
        db.favorite.count({ where: { episodeId: row.id } }),
        db.watchedMark.count({ where: { episodeId: row.id } }),
      ]);

      const referenceCount =
        progressCount + favoriteCount + watchedCount;

      if (referenceCount > 0) {
        console.warn(
          `[COORDINATE-REPAIR-SKIP] ${filePath} ` +
          `S${String(row.seasonNumber).padStart(2, '0')}E${String(row.episodeNumber).padStart(2, '0')} ` +
          `-> S${String(detected.seasonNumber).padStart(2, '0')}E${String(detected.episodeNumber).padStart(2, '0')} ` +
          `(${referenceCount} référence(s) utilisateur)`,
        );
        continue;
      }

      await db.episode.delete({ where: { id: row.id } });

      console.log(
        `[COORDINATE-REPAIR] ${filePath} ` +
        `S${String(row.seasonNumber).padStart(2, '0')}E${String(row.episodeNumber).padStart(2, '0')} ` +
        `-> S${String(detected.seasonNumber).padStart(2, '0')}E${String(detected.episodeNumber).padStart(2, '0')}`,
      );
    }
  }

  // Réconciliation autoritaire par chemin physique : le fichier gagne sur
  // l'ancien mediaItemId. On conserve l'Episode.id quand aucune collision
  // n'existe, pour préserver au maximum historique/favoris/progression.
  for (const [filePath, detected] of ownerByPath) {
    const rows = await db.episode.findMany({ where: { filePath }, orderBy: { updatedAt: 'desc' } });
    const correct = rows.find((r) => r.mediaItemId === detected.ownerId);
    const wrong = rows.filter((r) => r.mediaItemId !== detected.ownerId);

    if (!correct && wrong.length) {
      const collision = await db.episode.findUnique({
        where: {
          mediaItemId_seasonNumber_episodeNumber: {
            mediaItemId: detected.ownerId,
            seasonNumber: detected.seasonNumber,
            episodeNumber: detected.episodeNumber,
          },
        },
      });
      if (!collision) {
        await db.episode.update({
          where: { id: wrong[0].id },
          data: {
            mediaItemId: detected.ownerId,
            seasonNumber: detected.seasonNumber,
            episodeNumber: detected.episodeNumber,
            filePath,
          },
        });
        console.log(`[OWNERSHIP-FIX] ${filePath} -> ${detected.ownerId}`);
      } else if (path.resolve(collision.filePath) !== path.resolve(filePath)) {
        console.warn(`[OWNERSHIP-COLLISION] conserve ${collision.filePath}; impossible de déplacer ${filePath}`);
      }
    }

    // V3.8 — si le bon propriétaire possède DÉJÀ exactement le même fichier,
    // toute ligne identique restée sous une autre série est un doublon de BDD,
    // pas un média distinct. C'était le cas des 25 TYBW S01E01..E25 présents
    // à la fois sous Bleach et sous TYBW. On nettoie ces doublons avant la
    // deuxième passe afin de libérer les clés SxxExx du mauvais propriétaire.
    if (correct && wrong.length) {
      const duplicateWrong = wrong.filter((r) => path.resolve(r.filePath) === path.resolve(filePath));
      if (duplicateWrong.length) {
        const duplicateIds = duplicateWrong.map((r) => r.id);
        await Promise.all([
          db.watchProgress.deleteMany({ where: { episodeId: { in: duplicateIds } } }),
          db.favorite.deleteMany({ where: { episodeId: { in: duplicateIds } } }),
          db.watchedMark.deleteMany({ where: { episodeId: { in: duplicateIds } } }),
        ]);
        await db.episode.deleteMany({ where: { id: { in: duplicateIds } } });
        console.log(`[OWNERSHIP-DEDUP] ${duplicateIds.length} doublon(s) supprimé(s) pour ${filePath}`);
      }
    }

    const remainingWrong = await db.episode.findMany({
      where: { filePath, mediaItemId: { not: detected.ownerId } },
      orderBy: { updatedAt: 'desc' },
    });
    if (remainingWrong.length > 1) {
      const extraIds = remainingWrong.slice(1).map((r) => r.id);
      await Promise.all([
        db.watchProgress.deleteMany({ where: { episodeId: { in: extraIds } } }),
        db.favorite.deleteMany({ where: { episodeId: { in: extraIds } } }),
        db.watchedMark.deleteMany({ where: { episodeId: { in: extraIds } } }),
      ]);
      await db.episode.deleteMany({ where: { id: { in: extraIds } } });
    }
  }

  // V3.7 — deuxième passe déterministe.
  //
  // Une base déjà corrompue peut contenir, par exemple, TYBW S01E01 dans la
  // fiche physique /Bleach. Pendant la première passe, la protection V3.6
  // refuse à juste titre d'écraser TYBW par Bleach S01E01. Plus loin dans la
  // même passe, TYBW est réaffecté à sa propre fiche, ce qui libère enfin la
  // clé Bleach/S01E01. Sans seconde passe, cette case reste vide jusqu'au
  // prochain clic. On repersiste donc toutes les séries du périmètre APRES la
  // réconciliation d'ownership afin de remplir les emplacements désormais
  // libérés, sans jamais écraser un fichier différent.
  console.log('[RESCAN-PHASE2] remplissage des emplacements libérés après réaffectation');
  for (const detectedSeries of relevant) {
    await persistItem(
      detectedSeries,
      item.libraryId ?? '',
      item.library?.name,
      { queueUpcoming: false },
    );
  }

  // Supprime uniquement les épisodes qui n'existent réellement plus.
  const currentEpisodes = await db.episode.findMany({ where: { mediaItemId: item.id } });
  const staleIds: string[] = [];
  for (const ep of currentEpisodes) {
    try { await access(ep.filePath); } catch { staleIds.push(ep.id); }
  }
  if (staleIds.length) {
    await Promise.all([
      db.watchProgress.deleteMany({ where: { episodeId: { in: staleIds } } }),
      db.favorite.deleteMany({ where: { episodeId: { in: staleIds } } }),
      db.watchedMark.deleteMany({ where: { episodeId: { in: staleIds } } }),
    ]);
    await db.episode.deleteMany({ where: { id: { in: staleIds } } });
  }

  // Nettoyage des anciennes fiches artificielles dans le périmètre ciblé
  // (ex. Voyage 01..13 de Capitaine Flam). On ne supprime jamais une fiche
  // vérifiée manuellement ni une fiche qui possède encore des épisodes.
  const candidates = await db.mediaItem.findMany({
    where: { type: 'SERIES', libraryId: item.libraryId ?? undefined, manuallyVerified: false },
    include: { _count: { select: { episodes: true } } },
  });
  const emptyDuplicateIds = candidates
    .filter((candidate) =>
      candidate._count.episodes === 0 &&
      candidate.folderPath != null &&
      [...scanRoots].some((root) => isInsideFolder(candidate.folderPath!, root)),
    )
    .map((candidate) => candidate.id);
  let deletedEmptyDuplicateCount = 0;

  if (emptyDuplicateIds.length) {
    // Protection des fiches encore référencées par des données utilisateur.
    const [favoriteRefs, progressRefs, watchedRefs] = await Promise.all([
      db.favorite.findMany({
        where: { mediaItemId: { in: emptyDuplicateIds } },
        select: { mediaItemId: true },
      }),
      db.watchProgress.findMany({
        where: { mediaItemId: { in: emptyDuplicateIds } },
        select: { mediaItemId: true },
      }),
      db.watchedMark.findMany({
        where: { mediaItemId: { in: emptyDuplicateIds } },
        select: { mediaItemId: true },
      }),
    ]);

    const protectedEmptyDuplicateIds = new Set<string>();

    for (const row of favoriteRefs) {
      if (row.mediaItemId) protectedEmptyDuplicateIds.add(row.mediaItemId);
    }
    for (const row of progressRefs) {
      if (row.mediaItemId) protectedEmptyDuplicateIds.add(row.mediaItemId);
    }
    for (const row of watchedRefs) {
      if (row.mediaItemId) protectedEmptyDuplicateIds.add(row.mediaItemId);
    }

    const deletableEmptyDuplicateIds = emptyDuplicateIds.filter(
      (id) => !protectedEmptyDuplicateIds.has(id),
    );

    if (protectedEmptyDuplicateIds.size > 0) {
      console.warn(
        `[DEDUP-USERDATA-PROTECTED] ${protectedEmptyDuplicateIds.size} fiche(s) série vide(s) conservée(s) car encore référencée(s) par Favorite/WatchProgress/WatchedMark.`,
      );
    }

    // V3.12.1 — clôture uniquement les diagnostics des fiches réellement
    // supprimables. Une fiche protégée conserve son diagnostic.
    if (deletableEmptyDuplicateIds.length > 0) {
      await db.scanReview.updateMany({
        where: {
          mediaItemId: { in: deletableEmptyDuplicateIds },
          issueType: { in: ['ROOT_ERROR', 'NO_MATCH', 'TITLE_AMBIGUITY'] },
          status: 'OPEN',
        },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });

      const deleted = await db.mediaItem.deleteMany({
        where: { id: { in: deletableEmptyDuplicateIds } },
      });

      deletedEmptyDuplicateCount = deleted.count;

      console.log(
        `[DEDUP] ${deletedEmptyDuplicateCount} fiche(s) série vide(s) supprimée(s) dans le périmètre ciblé.`,
      );
    }
  }

  const refreshed = await db.mediaItem.findUnique({ where: { id: item.id } });
  const tracking = refreshed?.tmdbId
    ? await refreshSeriesTracking({
        id: refreshed.id,
        tmdbId: refreshed.tmdbId,
        tmdbSeasonNumber: refreshed.tmdbSeasonNumber,
        tmdbSeriesStatus: refreshed.tmdbSeriesStatus,
        tmdbNextEpisodeAirDate: refreshed.tmdbNextEpisodeAirDate,
        tmdbNextEpisodeLabel: refreshed.tmdbNextEpisodeLabel,
        missingEpisodesData: refreshed.missingEpisodesData,
        episodeTrackingMode: refreshed.episodeTrackingMode,
      })
    : { missingEpisodes: [] };

  const after = await db.episode.findMany({
    where: { mediaItemId: item.id },
    select: {
      id: true,
      seasonNumber: true,
      episodeNumber: true,
      filePath: true,
      tmdbEpisodeName: true,
      tmdbEpisodeStillUrl: true,
    },
  });
  const afterIds = new Set(after.map((e) => e.id));
  const addedEpisodes = after.filter((ep) => !beforeIds.has(ep.id));

  // V3.15.29 — un rescan ciblé reste silencieux pendant ses deux passes
  // internes (queueUpcoming:false), puis seuls les épisodes réellement
  // créés pendant CE rescan entrent dans la file de validation.
  //
  // Cela évite de republier les épisodes déjà connus pendant les phases
  // de réconciliation tout en garantissant qu'un nouveau fichier détecté
  // reste masqué côté utilisateurs jusqu'à validation admin.
  for (const ep of addedEpisodes) {
    await queueNewMedia({
      type: 'EPISODE',
      title: refreshed?.matchedTitle || refreshed?.title || item.matchedTitle || item.title,
      subtitle: `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}${ep.tmdbEpisodeName ? ` · ${ep.tmdbEpisodeName}` : ''}`,
      imageUrl: ep.tmdbEpisodeStillUrl || refreshed?.posterUrl || item.posterUrl,
      mediaPath: ep.filePath,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
      sourceEpisodeId: ep.id,
    });
  }

  if (addedEpisodes.length > 0) {
    console.log(`[TARGETED-UPCOMING-PENDING] item=${item.id} queued=${addedEpisodes.length}`);
  }

  console.log(`[RESCAN-END] item=${item.id} series=${relevant.length} added=${addedEpisodes.length} removed=${[...beforeIds].filter((id) => !afterIds.has(id)).length}`);

  await db.scanLog.update({
    where: { id: guard.id },
    data: {
      status: 'done',
      filesScanned: ownerByPath.size,
      itemsMatched: relevant.length,
      finishedAt: new Date(),
    },
  });

  return {
    itemId: item.id,
    title: refreshed?.title ?? item.title,
    scanRoots: [...scanRoots],
    seriesReevaluated: relevant.map((s) => ({ title: s.title, folderPath: s.folderPath })),
    episodesAdded: addedEpisodes.length,
    episodesRemoved: [...beforeIds].filter((id) => !afterIds.has(id)).length,
    duplicatesRemoved: deletedEmptyDuplicateCount,
    missingEpisodesCount: tracking.missingEpisodes.length,
    missingEpisodes: tracking.missingEpisodes,
  };
  } catch (error) {
    await db.scanLog.update({
      where: { id: guard.id },
      data: { status: 'error', errorMessage: String(error), finishedAt: new Date() },
    }).catch(() => undefined);
    console.error(`[RESCAN-ERROR] item=${item.id}`, error);
    throw error;
  }
}
