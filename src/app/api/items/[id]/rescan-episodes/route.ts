import { NextResponse } from 'next/server';

import { requireAdminSession } from '@/lib/session';
import { rescanSeriesById } from '@/lib/targetedRescan/rescanSeriesById';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  try {
    const result = await rescanSeriesById(params.id);
    return NextResponse.json(result);
  } catch (error) {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;

    const message =
      error instanceof Error
        ? error.message
        : 'Erreur pendant le rescan ciblé';

    const physicalRoots =
      typeof error === 'object' &&
      error !== null &&
      'physicalRoots' in error &&
      Array.isArray(error.physicalRoots)
        ? error.physicalRoots
        : undefined;

    return NextResponse.json(
      {
        error: message,
        ...(physicalRoots ? { physicalRoots } : {}),
      },
      { status: statusCode },
    );
  }
}
