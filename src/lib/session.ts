import { jwtVerify, SignJWT } from 'jose';
import { NextResponse } from 'next/server';

import { env } from './config';

const SESSION_DURATION = '90d';

function secretKey() {
  return new TextEncoder().encode(env.jwtSecret());
}

export type SessionPayload = {
  userId: string;
  email: string;
  role: string;
};

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    role: payload.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return {
      userId: payload.sub as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

/**
 * Récupère la session depuis une requête API : jeton "Bearer" dans
 * l'en-tête Authorization (utilisé par les applications de bureau/mobile/
 * TV) OU cookie de session (utilisé par le tableau de bord web).
 */
export async function getSessionFromRequest(req: Request): Promise<SessionPayload | null> {
  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (bearerToken) {
    const session = await verifySessionToken(bearerToken);
    if (session) return session;
  }

  // Paramètre d'URL "token" : nécessaire pour les routes de diffusion
  // vidéo, que certains lecteurs ouvrent directement par URL sans pouvoir
  // y attacher un en-tête Authorization personnalisé.
  const url = new URL(req.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    const session = await verifySessionToken(queryToken);
    if (session) return session;
  }

  const cookieHeader = req.headers.get('cookie');
  const cookieToken = cookieHeader
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('session='))
    ?.slice('session='.length);
  if (cookieToken) {
    return verifySessionToken(cookieToken);
  }

  return null;
}

/**
 * À utiliser en tête de route : renvoie la session si valide, ou une
 * réponse 401 prête à renvoyer directement sinon.
 * Usage : `const session = await requireActiveSession(req); if (session instanceof NextResponse) return session;`
 */
export async function requireActiveSession(
  req: Request,
): Promise<SessionPayload | NextResponse> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  }
  return session;
}

/** Comme requireActiveSession, mais exige en plus le rôle ADMIN. */
export async function requireAdminSession(
  req: Request,
): Promise<SessionPayload | NextResponse> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  }
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 });
  }
  return session;
}
