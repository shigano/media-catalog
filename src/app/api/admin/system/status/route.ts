import { NextResponse } from 'next/server';

import { requireAdminSession } from '@/lib/session';
import { getServicesStatus } from '@/lib/systemControl';

/**
 * GET /api/admin/system/status
 * État pm2 des deux services (account-portal, media-catalog) — pour la
 * section "Serveur" du panel admin.
 */
export async function GET(req: Request) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const services = await getServicesStatus();
  return NextResponse.json({ services });
}
