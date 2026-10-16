import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

const REASONS = ['WRONG_MATCH', 'PLAYBACK_ISSUE', 'MISSING_SUBTITLES', 'AUDIO_ISSUE', 'OTHER'] as const;

const Schema = z.object({
  profileId: z.string(),
  reason: z.enum(REASONS),
  comment: z.string().max(1000).optional(),
});

/**
 * POST /api/items/[id]/report
 * Un client signale un problème sur ce film/cette série — motif
 * prédéfini + texte libre facultatif.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const profile = await db.profile.findUnique({ where: { id: parsed.data.profileId } });
  if (!profile || profile.userId !== session.userId) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item) {
    return NextResponse.json({ error: 'Titre introuvable' }, { status: 404 });
  }

  await db.report.create({
    data: {
      mediaItemId: item.id,
      profileId: profile.id,
      reason: parsed.data.reason,
      comment: parsed.data.comment?.trim() || null,
    },
  });

  return NextResponse.json({ ok: true });
}
