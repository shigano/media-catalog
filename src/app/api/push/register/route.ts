import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

const Schema = z.object({
  token: z.string().min(1),
  platform: z.string().min(1),
});

/**
 * POST /api/push/register
 * Enregistre (ou met à jour) le jeton Firebase Cloud Messaging de cet
 * appareil — appelé au démarrage de l'appli tant qu'un compte est
 * connecté. Pas de lien direct avec l'identité du compte : une
 * notification envoyée depuis l'admin part vers TOUS les appareils
 * enregistrés, indépendamment de qui est connecté dessus.
 */
export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  await db.pushToken.upsert({
    where: { token: parsed.data.token },
    update: { lastSeenAt: new Date(), platform: parsed.data.platform },
    create: { token: parsed.data.token, platform: parsed.data.platform },
  });

  return NextResponse.json({ ok: true });
}
