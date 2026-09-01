import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminSession } from '@/lib/session';
import {
  isValidService,
  rebootServer,
  restartServiceDelayed,
  startService,
  stopServiceDelayed,
} from '@/lib/systemControl';

const Schema = z.object({
  action: z.enum(['restart', 'stop', 'start', 'reboot-vps']),
  // Absent/ignoré pour "reboot-vps", requis pour les autres.
  service: z.string().optional(),
});

/**
 * POST /api/admin/system/action
 * Liste FERMÉE d'actions serveur (redémarrer/arrêter/démarrer un
 * service, ou redémarrer le VPS entier) — jamais de commande arbitraire
 * acceptée, uniquement ces 4 actions prédéfinies. `reboot-vps` est
 * délibérément la seule à ne demander aucun `service` (elle concerne
 * tout le serveur).
 */
export async function POST(req: Request) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }
  const { action, service } = parsed.data;

  if (action === 'reboot-vps') {
    rebootServer();
    return NextResponse.json({ ok: true, message: 'Redémarrage du VPS en cours…' });
  }

  if (!service || !isValidService(service)) {
    return NextResponse.json({ error: 'Service invalide' }, { status: 400 });
  }

  if (action === 'restart') {
    restartServiceDelayed(service);
    return NextResponse.json({ ok: true, message: `Redémarrage de ${service} en cours…` });
  }
  if (action === 'stop') {
    stopServiceDelayed(service);
    return NextResponse.json({ ok: true, message: `Arrêt de ${service} en cours…` });
  }
  if (action === 'start') {
    const result = await startService(service);
    return NextResponse.json({ ok: result.ok, message: result.output });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
