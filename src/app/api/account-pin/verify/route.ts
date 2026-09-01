import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

const Schema = z.object({ pin: z.string().min(1) });

/**
 * POST /api/account-pin/verify
 * Vérifie un code PIN sans effet de bord — utilisé par l'appli avant
 * d'autoriser l'entrée dans la gestion des profils ou l'accès au compte
 * depuis un profil non-mère. Si aucun PIN n'a encore été défini pour ce
 * compte, on autorise (période de grâce avant la toute première
 * configuration) plutôt que de bloquer l'accès sans issue.
 */
export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const existing = await db.accountPin.findUnique({ where: { userId: session.userId } });
  if (!existing) {
    return NextResponse.json({ ok: true, noPinSet: true });
  }

  const valid = await bcrypt.compare(parsed.data.pin, existing.pinHash);
  return NextResponse.json({ ok: valid });
}
