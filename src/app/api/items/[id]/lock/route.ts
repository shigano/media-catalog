import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

const Schema = z.object({ locked: z.boolean() });

/**
 * POST /api/items/[id]/lock
 * Verrouille ou déverrouille les métadonnées d'un item, indépendamment
 * d'une correction ("Identifier" verrouille déjà automatiquement) — sert
 * à sceller un item déjà bien reconnu automatiquement, pour qu'un futur
 * scan ne relance plus jamais TMDB dessus (gain de temps sur un gros
 * catalogue déjà validé). Réversible.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  await db.mediaItem.update({
    where: { id: params.id },
    data: { manuallyVerified: parsed.data.locked },
  });

  return NextResponse.json({ ok: true });
}
