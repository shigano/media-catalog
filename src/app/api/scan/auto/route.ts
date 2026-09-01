import { NextRequest, NextResponse } from 'next/server';

import { env } from '@/lib/config';
import { startSmartScan } from '@/lib/scanEngine';

/**
 * POST /api/scan/auto
 * Déclenchement pour la tâche planifiée (cron, toutes les 5 minutes) —
 * pas de session admin ici (un script serveur n'en a pas), juste un
 * secret partagé en en-tête. Utilise le scan "intelligent" : vérifie
 * d'abord juste le nombre de fichiers par médiathèque (rapide), et ne
 * lance un vrai scan (avec reconnaissance TMDB) QUE pour celles qui ont
 * effectivement grossi — évite de rescanner tout le catalogue toutes les
 * 5 minutes alors que rien n'a changé la plupart du temps.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-auto-scan-secret');
  if (!secret || secret !== env.autoScanSecret()) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
  }

  const result = await startSmartScan();
  if ('error' in result) {
    // Un scan est déjà en cours — pas une erreur, juste rien à faire.
    return NextResponse.json({ skipped: true, reason: result.error });
  }
  if ('skipped' in result) {
    return NextResponse.json({ skipped: true, reason: result.reason });
  }
  return NextResponse.json({ ok: true, scanLogId: result.scanLogId, librariesScanned: result.librariesScanned });
}
