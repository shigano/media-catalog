import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { getLibrariesForScan } from '@/lib/libraries';
import { runScan } from '@/lib/scanEngine';
import { requireAdminSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  // Déclenche la migration automatique depuis .env au tout premier appel.
  await getLibrariesForScan();

  const libraries = await db.library.findMany({
    include: {
      folders: { orderBy: { createdAt: 'asc' } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ libraries });
}

const Schema = z.object({
  name: z.string().min(1).max(100),
  paths: z.array(z.string().min(1)).min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const library = await db.library.create({
    data: {
      name: parsed.data.name.trim(),
      folders: { create: parsed.data.paths.map((path) => ({ path: path.trim() })) },
    },
    include: { folders: true },
  });

  // Scan immédiat de cette nouvelle médiathèque, comme le ferait Jellyfin
  // à l'ajout d'une bibliothèque — pas besoin d'un clic "Actualiser" en
  // plus pour voir apparaître son contenu.
  const running = await db.scanLog.findFirst({ where: { status: 'running' } });
  if (!running) {
    const scanLog = await db.scanLog.create({ data: {} });
    void runScan(scanLog.id, [
      { id: library.id, name: library.name, folders: library.folders.map((f) => f.path) },
    ]);
  }

  return NextResponse.json({ ok: true, library });
}
