import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { verifyAccountPortalCredentials } from '@/lib/accountAuth';
import { signSessionToken } from '@/lib/session';

const Schema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const result = await verifyAccountPortalCredentials(parsed.data.email, parsed.data.password);
  if (!result) {
    return NextResponse.json(
      {
        error:
          "Identifiants incorrects, email non confirmé, ou aucun abonnement actif sur ce compte.",
      },
      { status: 401 },
    );
  }

  const token = await signSessionToken(result);

  const response = NextResponse.json({ token, role: result.role });
  // Cookie pour le tableau de bord web ; les applications (bureau/mobile/
  // TV) utilisent plutôt le `token` renvoyé ci-dessus, en en-tête Bearer.
  response.cookies.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  });
  return response;
}
