import fs from 'fs/promises';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

const EditSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  overview: z.string().max(5000).nullable().optional(),
  genres: z.array(z.string()).optional(),
  posterUrl: z.string().url().nullable().optional(),
});

/**
 * PATCH /api/items/[id]
 * Édition manuelle directe des métadonnées (titre affiché, année,
 * synopsis, genres, affiche) — pour corriger à la main un titre mal
 * reconnu ou compléter une fiche sans repasser par une recherche/
 * correspondance TMDB. Verrouille automatiquement l'item (même
 * comportement que "Identifier") : un futur scan ne doit plus jamais
 * écraser une correction manuelle.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }

  const parsed = EditSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }
  const { title, year, overview, genres, posterUrl } = parsed.data;

  await db.mediaItem.update({
    where: { id: item.id },
    data: {
      ...(title !== undefined ? { matchedTitle: title } : {}),
      ...(year !== undefined ? { year } : {}),
      ...(overview !== undefined ? { overview } : {}),
      ...(genres !== undefined ? { genres: genres.join(', ') } : {}),
      ...(posterUrl !== undefined ? { posterUrl } : {}),
      manuallyVerified: true,
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/items/[id]
 * Supprime DÉFINITIVEMENT un film ou une série : la fiche en base, ET le
 * ou les fichiers réels sur le NAS. Pensé pour nettoyer les vrais
 * doublons (le même film détecté deux fois depuis des dossiers
 * différents) — irréversible, l'appli doit faire confirmer avant d'appeler
 * cette route.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const item = await db.mediaItem.findUnique({
    where: { id: params.id },
    include: { episodes: true },
  });
  if (!item) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }

  const filePaths = [
    ...(item.filePath ? [item.filePath] : []),
    ...item.episodes.map((ep) => ep.filePath).filter((p): p is string => Boolean(p)),
  ];

  const failedDeletes: string[] = [];
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
    } catch {
      // Fichier déjà absent, ou droits insuffisants — on continue quand
      // même : mieux vaut nettoyer la fiche que rester bloqué, et on
      // remonte la liste de ce qui n'a pas pu être supprimé.
      failedDeletes.push(filePath);
    }
  }

  await db.episode.deleteMany({ where: { mediaItemId: item.id } });
  await db.mediaItem.delete({ where: { id: item.id } });

  return NextResponse.json({
    ok: true,
    filesDeleted: filePaths.length - failedDeletes.length,
    filesFailed: failedDeletes,
  });
}
