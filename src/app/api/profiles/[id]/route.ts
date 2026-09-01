import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

async function loadOwnedProfile(id: string, userId: string) {
  const profile = await db.profile.findUnique({ where: { id } });
  if (!profile || profile.userId !== userId) return null;
  return profile;
}

/**
 * Vérifie le PIN fourni contre celui du compte — utilisé pour les
 * actions sensibles (restreindre des médiathèques, supprimer un profil).
 * Si aucun PIN n'a encore été configuré pour ce compte, on laisse passer
 * (période de grâce avant la toute première configuration) plutôt que de
 * bloquer sans issue.
 */
async function checkPin(userId: string, pin: string | undefined) {
  const existing = await db.accountPin.findUnique({ where: { userId } });
  if (!existing) return true;
  if (!pin) return false;
  return bcrypt.compare(pin, existing.pinHash);
}

const Schema = z.object({
  name: z.string().min(1).max(30).optional(),
  avatarKey: z.string().min(1).optional(),
  // Liste des identifiants de médiathèques à masquer pour ce profil —
  // remplace entièrement la liste existante à chaque appel (pas un ajout
  // incrémental). Nécessite le PIN du compte si un changement est demandé.
  restrictedLibraryIds: z.array(z.string()).optional(),
  pin: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const profile = await loadOwnedProfile(params.id, session.userId);
  if (!profile) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  if (parsed.data.restrictedLibraryIds !== undefined) {
    if (!(await checkPin(session.userId, parsed.data.pin))) {
      return NextResponse.json({ error: 'Code PIN incorrect' }, { status: 403 });
    }
  }

  const updated = await db.profile.update({
    where: { id: profile.id },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.avatarKey ? { avatarKey: parsed.data.avatarKey } : {}),
      ...(parsed.data.restrictedLibraryIds !== undefined
        ? { restrictedLibraryIds: parsed.data.restrictedLibraryIds.join(',') || null }
        : {}),
    },
  });
  return NextResponse.json({ ok: true, profile: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const profile = await loadOwnedProfile(params.id, session.userId);
  if (!profile) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  // Le profil mère ne peut jamais être supprimé — il doit toujours en
  // exister un pour pouvoir gérer les autres profils du compte.
  if (profile.isMaster) {
    return NextResponse.json({ error: 'Le profil principal ne peut pas être supprimé' }, { status: 403 });
  }

  const pin = req.nextUrl.searchParams.get('pin') ?? undefined;
  if (!(await checkPin(session.userId, pin))) {
    return NextResponse.json({ error: 'Code PIN incorrect' }, { status: 403 });
  }

  await db.profile.delete({ where: { id: profile.id } });
  return NextResponse.json({ ok: true });
}
