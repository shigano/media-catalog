import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

const Schema = z.object({
  code: z.string().min(1),
  newPin: z.string().regex(/^\d{4,6}$/, 'Le code doit contenir 4 à 6 chiffres'),
});

/**
 * POST /api/account-pin/reset
 * Vérifie le code reçu par email et, si valide, remplace directement le
 * PIN par le nouveau fourni — pas besoin de connaître l'ancien PIN,
 * c'est tout l'intérêt de cette voie de récupération.
 */
export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Requête invalide' }, { status: 400 });
  }

  const reset = await db.accountPinReset.findUnique({ where: { userId: session.userId } });
  if (!reset || reset.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Code expiré, redemande-en un nouveau.' }, { status: 410 });
  }

  const valid = await bcrypt.compare(parsed.data.code, reset.codeHash);
  if (!valid) {
    return NextResponse.json({ error: 'Code incorrect' }, { status: 403 });
  }

  const pinHash = await bcrypt.hash(parsed.data.newPin, 10);
  await db.accountPin.upsert({
    where: { userId: session.userId },
    update: { pinHash },
    create: { userId: session.userId, pinHash },
  });
  // Le code ne doit plus jamais pouvoir être réutilisé une fois consommé.
  await db.accountPinReset.delete({ where: { userId: session.userId } });

  return NextResponse.json({ ok: true });
}
