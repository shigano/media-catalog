import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { z } from 'zod';

import { env } from '@/lib/config';
import { signSessionToken } from '@/lib/session';

const Schema = z.object({
  userId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.PAIRING_INTERNAL_SECRET;
  const suppliedSecret = req.headers.get('x-pairing-secret');

  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const connection = await mysql.createConnection(
    env.accountPortalDatabaseUrl(),
  );

  try {
    const [userRows] = await connection.execute(
      `SELECT id, email, emailVerified, role
       FROM User
       WHERE id = ?
       LIMIT 1`,
      [parsed.data.userId],
    );

    const user = (userRows as any[])[0];

    if (!user || !user.emailVerified) {
      return NextResponse.json({ error: 'Compte non autorisé' }, { status: 403 });
    }

    const [subscriptionRows] = await connection.execute(
      `SELECT id
       FROM Subscription
       WHERE userId = ? AND status = 'ACTIVE'
       LIMIT 1`,
      [user.id],
    );

    if (!(subscriptionRows as any[])[0]) {
      return NextResponse.json({ error: 'Abonnement actif requis' }, { status: 403 });
    }

    const token = await signSessionToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return NextResponse.json({ token });
  } finally {
    await connection.end();
  }
}
