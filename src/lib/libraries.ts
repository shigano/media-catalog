import { env } from './config';
import { db } from './db';

export type LibraryForScan = {
  id: string;
  name: string;
  folders: string[];
};

/**
 * Renvoie les médiathèques à scanner (avec leurs dossiers), depuis la
 * base — au tout premier appel, si aucune médiathèque n'existe, on
 * pré-remplit avec l'ancien LIBRARY_PATHS de .env (si présent), regroupé
 * dans une médiathèque "Bibliothèque" unique — à renommer/scinder ensuite
 * depuis le panel admin si besoin.
 */
export async function getLibrariesForScan(): Promise<LibraryForScan[]> {
  const libraries = await db.library.findMany({
    include: { folders: true },
    orderBy: { createdAt: 'asc' },
  });
  if (libraries.length > 0) {
    return libraries.map((l) => ({
      id: l.id,
      name: l.name,
      folders: l.folders.map((f) => f.path),
    }));
  }

  let seedPaths: string[] = [];
  try {
    seedPaths = env.libraryPaths();
  } catch {
    seedPaths = [];
  }
  if (seedPaths.length === 0) return [];

  const created = await db.library.create({
    data: {
      name: 'Bibliothèque',
      folders: { create: seedPaths.map((path) => ({ path })) },
    },
    include: { folders: true },
  });
  return [{ id: created.id, name: created.name, folders: created.folders.map((f) => f.path) }];
}
