import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { sendPinResetCode } from '@/lib/mailer';
import { requireActiveSession } from '@/lib/session';

/**
 * POST /api/account-pin/forgot
 * Génère un code à 6 chiffres, valable 15 minutes, envoyé à l'adresse
 * email du compte (connue via le jeton de session, jamais redemandée —
 * évite d'envoyer le code à une adresse arbitraire tapée par erreur).
 * Remplace tout code précédent pour ce compte.
 */
export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const code = randomInt(100000, 999999).toString();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const sent = await sendPinResetCode(session.email, code).catch(() => false);
  if (!sent) {
    return NextResponse.json(
      { error: "L'envoi d'email n'est pas configuré sur ce serveur pour l'instant." },
      { status: 503 },
    );
  }

  await db.accountPinReset.upsert({
    where: { userId: session.userId },
    update: { codeHash, expiresAt },
    create: { userId: session.userId, codeHash, expiresAt },
  });

  // Adresse partiellement masquée, pour confirmer sans exposer l'email
  // en entier si l'écran est visible par-dessus l'épaule de quelqu'un.
  const [localPart, domain] = session.email.split('@');
  const masked = `${localPart.slice(0, 2)}${'*'.repeat(Math.max(1, localPart.length - 2))}@${domain}`;

  return NextResponse.json({ ok: true, sentTo: masked });
}
