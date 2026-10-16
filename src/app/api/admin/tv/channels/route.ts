import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

function validateUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}
function parseChannel(body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim();
  const sourceType = String(body.sourceType ?? 'OFFICIAL').toUpperCase();
  const sourceUrl = validateUrl(body.sourceUrl);
  const rightsNote = String(body.rightsNote ?? '').trim();
  if (!name || name.length > 160 || !sourceUrl ||
      !['OFFICIAL', 'HLS', 'DASH'].includes(sourceType) ||
      (sourceType !== 'OFFICIAL' && !rightsNote)) return null;
  const number = body.number == null || body.number === '' ? null : Number(body.number);
  if (number != null && (!Number.isInteger(number) || number < 0 || number > 99999)) return null;
  return { name, sourceType, sourceUrl, number,
    category: String(body.category ?? 'Autres').slice(0, 80),
    logoUrl: body.logoUrl ? validateUrl(body.logoUrl) : null,
    epgId: body.epgId ? String(body.epgId).slice(0, 160) : null,
    rightsNote: rightsNote || null };
}
export async function GET(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ channels: await db.tvChannel.findMany({ orderBy: [{ number: 'asc' }, { name: 'asc' }] }) });
}
export async function POST(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;
  const body = await req.json().catch(() => null);
  const parsed = body && typeof body === 'object' && !Array.isArray(body) ? parseChannel(body) : null;
  if (!parsed) return NextResponse.json({ error: 'Chaîne invalide : URL HTTPS et justification des droits pour les flux intégrés requises.' }, { status: 400 });
  const channel = await db.tvChannel.create({ data: { ...parsed, isActive: false } });
  return NextResponse.json({ channel }, { status: 201 });
}
export async function PATCH(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== 'string') return NextResponse.json({ error: 'ID requis' }, { status: 400 });
  const existing = await db.tvChannel.findUnique({ where: { id: body.id } });
  if (!existing) return NextResponse.json({ error: 'Chaîne introuvable' }, { status: 404 });
  const parsed = parseChannel({ ...existing, ...body });
  if (!parsed) return NextResponse.json({ error: 'Données invalides' }, { status: 400 });
  const channel = await db.tvChannel.update({ where: { id: body.id }, data: { ...parsed, isActive: body.isActive === undefined ? existing.isActive : body.isActive === true } });
  return NextResponse.json({ channel });
}
export async function DELETE(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });
  await db.tvChannel.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
