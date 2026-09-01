import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

const MAX_PROFILES = 5;

export async function GET(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const profiles = await db.profile.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ profiles });
}

const Schema = z.object({
  name: z.string().min(1).max(30),
  avatarKey: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const count = await db.profile.count({ where: { userId: session.userId } });
  if (count >= MAX_PROFILES) {
    return NextResponse.json({ error: `Maximum ${MAX_PROFILES} profils par compte` }, { status: 409 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const profile = await db.profile.create({
    data: {
      userId: session.userId,
      name: parsed.data.name.trim(),
      avatarKey: parsed.data.avatarKey,
      // Le tout premier profil d'un compte devient automatiquement le
      // profil "mère" — seul lui pourra ensuite gérer les autres profils
      // et accéder à "Mon compte"/"Mes factures".
      isMaster: count === 0,
    },
  });
  return NextResponse.json({ ok: true, profile });
}
