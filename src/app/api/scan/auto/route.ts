import { NextRequest, NextResponse } from 'next/server';

import { env } from '@/lib/config';
import { startSmartScan } from '@/lib/scanEngine';

/**
 * POST /api/scan/auto
 * Déclenchement pour la surveillance automatique — pas de session admin
 * ici (un script serveur n'en a pas), juste un secret partagé en en-tête.
 * Le scan intelligent compare le nombre ET une empreinte des chemins vidéo :
 * ajout, suppression, renommage et déplacement sont donc détectés même si le
 * nombre total de fichiers reste identique.
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
