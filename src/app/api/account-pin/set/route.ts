import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

const Schema = z.object({
  newPin: z.string().regex(/^\d{4,6}$/, 'Le code doit contenir 4 à 6 chiffres'),
  currentPin: z.string().optional(),
});

/**
 * POST /api/account-pin/set
 * Définit ou change le code PIN du compte, qui protège la gestion des
 * profils (créer/modifier/supprimer, restreindre des médiathèques) et
 * l'accès à "Mon compte"/"Mes factures" depuis un profil non-mère. Si un
 * PIN existe déjà, l'ancien doit être fourni et correct pour le changer.
 */
export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Requête invalide' }, { status: 400 });
  }

  const existing = await db.accountPin.findUnique({ where: { userId: session.userId } });
  if (existing) {
    if (!parsed.data.currentPin || !(await bcrypt.compare(parsed.data.currentPin, existing.pinHash))) {
      return NextResponse.json({ error: 'Code PIN actuel incorrect' }, { status: 403 });
    }
  }

  const pinHash = await bcrypt.hash(parsed.data.newPin, 10);
  await db.accountPin.upsert({
    where: { userId: session.userId },
    update: { pinHash },
    create: { userId: session.userId, pinHash },
  });

  return NextResponse.json({ ok: true });
}
