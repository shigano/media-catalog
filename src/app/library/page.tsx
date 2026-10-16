import Link from 'next/link';

import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  MATCHED: 'Reconnu',
  AMBIGUOUS: 'À vérifier',
  UNMATCHED: 'Non reconnu',
};
const STATUS_COLOR: Record<string, string> = {
  MATCHED: 'text-success',
  AMBIGUOUS: 'text-accent',
  UNMATCHED: 'text-danger',
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: { status?: string; libraryId?: string };
}) {
  const statusFilter = searchParams.status;
  const libraryFilter = searchParams.libraryId;

  const libraries = await db.library.findMany({ orderBy: { name: 'asc' } });

  const items = await db.mediaItem.findMany({
    where: {
      ...(statusFilter ? { matchStatus: statusFilter as any } : {}),
      ...(libraryFilter ? { libraryId: libraryFilter } : {}),
    },
    orderBy: { title: 'asc' },
    // Un vrai plafond de sécurité (pas 200 comme avant, qui masquait
    // silencieusement tout ce qui vient après alphabétiquement dès que la
    // bibliothèque dépasse ce nombre) — filtre par médiathèque si tu veux
    // vraiment tout voir d'une catégorie précise.
    take: 4000,
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="mb-2 text-3xl font-semibold text-ink">Bibliothèque</h1>
      <p className="mb-6 text-sm text-inkMuted">{items.length} titre{items.length > 1 ? 's' : ''} affiché{items.length > 1 ? 's' : ''}</p>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link
          href={{ query: { ...(libraryFilter ? { libraryId: libraryFilter } : {}) } }}
          className={`rounded-ticket border px-3 py-1.5 ${!statusFilter ? 'border-accent text-accent' : 'border-white/15 text-inkMuted'}`}
        >
          Tous statuts
        </Link>
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <Link
            key={key}
            href={{ query: { status: key, ...(libraryFilter ? { libraryId: libraryFilter } : {}) } }}
            className={`rounded-ticket border px-3 py-1.5 ${statusFilter === key ? 'border-accent text-accent' : 'border-white/15 text-inkMuted'}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="mb-8 flex flex-wrap gap-2 text-sm">
        <Link
          href={{ query: { ...(statusFilter ? { status: statusFilter } : {}) } }}
          className={`rounded-ticket border px-3 py-1.5 ${!libraryFilter ? 'border-accent text-accent' : 'border-white/15 text-inkMuted'}`}
        >
          Toutes médiathèques
        </Link>
        {libraries.map((lib) => (
          <Link
            key={lib.id}
            href={{ query: { libraryId: lib.id, ...(statusFilter ? { status: statusFilter } : {}) } }}
            className={`rounded-ticket border px-3 py-1.5 ${libraryFilter === lib.id ? 'border-accent text-accent' : 'border-white/15 text-inkMuted'}`}
          >
            {lib.name}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-inkMuted">
          Rien à afficher — lance un scan depuis la page d'accueil.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
          {items.map((item) => (
            <Link key={item.id} href={`/library/${item.id}`} className="text-sm">
              <div className="mb-2 aspect-[2/3] overflow-hidden rounded-ticket bg-surfaceRaised">
                {item.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.posterUrl}
                    alt={item.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-2 text-center text-xs text-inkMuted">
                    {item.title}
                  </div>
                )}
              </div>
              <p className="truncate text-ink">{item.matchedTitle || item.title}</p>
              <p className={`text-xs ${STATUS_COLOR[item.matchStatus]}`}>
                {STATUS_LABEL[item.matchStatus]}
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
