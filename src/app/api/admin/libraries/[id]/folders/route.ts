import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

const Schema = z.object({ path: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Chemin invalide' }, { status: 400 });
  }

  const path = parsed.data.path.trim();
  const existing = await db.libraryFolder.findUnique({ where: { path } });
  if (existing) {
    return NextResponse.json({ error: 'Ce dossier est déjà rattaché à une médiathèque' }, { status: 409 });
  }

  const folder = await db.libraryFolder.create({
    data: { libraryId: params.id, path },
  });
  return NextResponse.json({ ok: true, folder });
}
