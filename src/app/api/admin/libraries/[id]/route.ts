import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

const Schema = z.object({ name: z.string().min(1).max(100) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nom invalide' }, { status: 400 });
  }

  await db.library.update({
    where: { id: params.id },
    data: { name: parsed.data.name.trim() },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  // Supprime vraiment le contenu détecté sous cette médiathèque, pas
  // seulement son rattachement — sans ça, les items restaient orphelins
  // en base indéfiniment (libraryId à NULL), invisibles dans le panel
  // admin mais toujours présents dans les recherches et listes générales.
  const orphanedItems = await db.mediaItem.findMany({
    where: { libraryId: params.id },
    select: { id: true },
  });
  const orphanedIds = orphanedItems.map((i) => i.id);
  if (orphanedIds.length > 0) {
    await db.episode.deleteMany({ where: { mediaItemId: { in: orphanedIds } } });
    await db.mediaItem.deleteMany({ where: { id: { in: orphanedIds } } });
  }

  // Les dossiers rattachés (LibraryFolder) sont supprimés automatiquement
  // (onDelete: Cascade).
  await db.library.delete({ where: { id: params.id } }).catch(() => null);
  return NextResponse.json({ ok: true, deletedItems: orphanedIds.length });
}
