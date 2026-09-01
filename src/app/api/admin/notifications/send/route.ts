import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';
import { getFirebaseMessaging } from '@/lib/firebaseAdmin';

const Schema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  mediaItemId: z.string().min(1),
});

// FCM limite un envoi groupé à 500 jetons par appel — au-delà, il faut
// découper en plusieurs lots.
const BATCH_SIZE = 500;

/**
 * POST /api/admin/notifications/send
 * Diffuse une notification à TOUS les appareils enregistrés — pas de
 * ciblage par utilisateur, volontairement simple (une annonce pour tout
 * le monde, façon "nouveau contenu disponible"). Le film/série mentionné
 * est transmis en données brutes (pas juste dans le texte) pour que
 * l'appli sache où naviguer au clic. Les jetons qui échouent (appli
 * désinstallée, jeton expiré...) sont automatiquement retirés.
 */
export async function POST(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }
  const { title, body, mediaItemId } = parsed.data;

  const item = await db.mediaItem.findUnique({ where: { id: mediaItemId } });
  if (!item) {
    return NextResponse.json({ error: 'Film/série introuvable' }, { status: 404 });
  }

  const tokens = await db.pushToken.findMany({ select: { id: true, token: true } });
  if (tokens.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, message: 'Aucun appareil enregistré.' });
  }

  const messaging = getFirebaseMessaging();
  let sent = 0;
  const invalidTokenIds: string[] = [];

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    const response = await messaging.sendEachForMulticast({
      tokens: batch.map((t) => t.token),
      notification: {
        title,
        body,
        // URL déjà absolue (TMDB) — utilisable telle quelle, Android
        // affiche automatiquement une notification "grande image" avec
        // l'affiche du titre mentionné quand ce champ est présent.
        imageUrl: item.posterUrl ?? undefined,
      },
      android: {
        notification: {
          // Doit correspondre exactement au nom du drawable généré côté
          // appli (res/drawable/ic_notification.png) — sans ça, Android
          // retombe sur l'icône générique par défaut du système.
          icon: 'ic_notification',
          imageUrl: item.posterUrl ?? undefined,
        },
      },
      data: {
        mediaItemId: item.id,
        mediaType: item.type, // "MOVIE" | "SERIES" — pour savoir où naviguer côté appli
      },
    });
    sent += response.successCount;
    response.responses.forEach((r, index) => {
      if (!r.success) invalidTokenIds.push(batch[index].id);
    });
  }

  if (invalidTokenIds.length > 0) {
    await db.pushToken.deleteMany({ where: { id: { in: invalidTokenIds } } }).catch(() => null);
  }

  return NextResponse.json({
    ok: true,
    sent,
    failed: invalidTokenIds.length,
  });
}
