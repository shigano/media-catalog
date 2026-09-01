import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

const Schema = z.object({
  tmdbId: z.number(),
  title: z.string(),
  posterUrl: z.string().nullable(),
  overview: z.string(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  await db.mediaItem.update({
    where: { id: params.id },
    data: {
      tmdbId: parsed.data.tmdbId,
      matchedTitle: parsed.data.title,
      posterUrl: parsed.data.posterUrl,
      overview: parsed.data.overview,
      matchStatus: 'MATCHED',
      // Verrouille la reconnaissance : les scans suivants ne toucheront
      // plus à cet item, pour ne jamais écraser une correction manuelle.
      manuallyVerified: true,
    },
  });

  return NextResponse.json({ ok: true });
}
