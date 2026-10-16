import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

import { env } from './config';

export type AccountAuthResult = {
  userId: string;
  email: string;
  role: string; // "USER" | "SUPPORT" | "ADMIN"
};

function effectiveStreamLimit(row: any): number {
  const configured = Number(row?.maxConcurrentStreams ?? 0);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 1;
}

/** Limite effective de lectures natives simultanées pour le compte. */
export async function getAccountConcurrentStreamLimit(userId: string): Promise<number> {
  const connection = await mysql.createConnection(env.accountPortalDatabaseUrl());
  try {
    const [rows] = await connection.execute(
      `SELECT p.name, p.billingFamily, p.maxConcurrentStreams
       FROM Subscription s
       INNER JOIN Plan p ON p.id = CASE
         WHEN s.adminPlanId IS NOT NULL
          AND (s.adminPlanExpiresAt IS NULL OR s.adminPlanExpiresAt > NOW())
         THEN s.adminPlanId
         ELSE s.planId
       END
       WHERE s.userId = ? AND s.status = 'ACTIVE'
         AND (
           s.provider <> 'ADMIN'
           OR s.currentPeriodEnd IS NULL
           OR s.currentPeriodEnd > NOW()
         )
       ORDER BY s.createdAt DESC
       LIMIT 1`,
      [userId],
    );
    const plan = (rows as any[])[0];
    return effectiveStreamLimit(plan);
  } finally {
    await connection.end();
  }
}


export type AccountAdPolicy = {
  planName: string | null;
  billingFamily: string | null;
  hasAds: boolean;
  movieAdEveryStarts: number | null;
  seriesAdEveryEpisodes: number | null;
};

function positiveIntegerOrNull(value: unknown): number | null {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Politique publicitaire effective du dernier abonnement actif. */
export async function getAccountAdPolicy(userId: string): Promise<AccountAdPolicy> {
  const connection = await mysql.createConnection(env.accountPortalDatabaseUrl());
  try {
    const [rows] = await connection.execute(
      `SELECT p.name, p.billingFamily, p.hasAds, p.movieAdEveryStarts, p.seriesAdEveryEpisodes
       FROM Subscription s
       INNER JOIN Plan p ON p.id = CASE
         WHEN s.adminPlanId IS NOT NULL
          AND (s.adminPlanExpiresAt IS NULL OR s.adminPlanExpiresAt > NOW())
         THEN s.adminPlanId
         ELSE s.planId
       END
       WHERE s.userId = ? AND s.status = 'ACTIVE'
         AND (
           s.provider <> 'ADMIN'
           OR s.currentPeriodEnd IS NULL
           OR s.currentPeriodEnd > NOW()
         )
       ORDER BY s.createdAt DESC
       LIMIT 1`,
      [userId],
    );
    const plan = (rows as any[])[0];
    if (!plan) {
      return {
        planName: null,
        billingFamily: null,
        hasAds: false,
        movieAdEveryStarts: null,
        seriesAdEveryEpisodes: null,
      };
    }

    return {
      planName: plan.name ?? null,
      billingFamily: plan.billingFamily ?? null,
      hasAds: Boolean(plan.hasAds),
      movieAdEveryStarts: positiveIntegerOrNull(plan.movieAdEveryStarts),
      seriesAdEveryEpisodes: positiveIntegerOrNull(plan.seriesAdEveryEpisodes),
    };
  } finally {
    await connection.end();
  }
}

/**
 * Vérifie un email/mot de passe directement contre la base du portail
 * d'abonnement (compte.drak-tharon.fr) — les DEUX applications tournent
 * sur le même serveur MySQL, donc pas besoin d'un appel HTTP entre elles,
 * une simple requête SQL brute suffit (media-catalog n'a pas ce schéma
 * dans son propre Prisma, d'où l'accès direct plutôt que typé).
 *
 * Refuse la connexion si : email inconnu, mot de passe incorrect, email
 * non confirmé, ou aucun abonnement actif — exactement les mêmes règles
 * que doit respecter un vrai service payant.
 */
export async function verifyAccountPortalCredentials(
  email: string,
  password: string,
): Promise<AccountAuthResult | null> {
  const connection = await mysql.createConnection(env.accountPortalDatabaseUrl());
  try {
    const [userRows] = await connection.execute(
      'SELECT id, email, passwordHash, emailVerified, role FROM User WHERE email = ? LIMIT 1',
      [email],
    );
    const user = (userRows as any[])[0];
    if (!user || !user.emailVerified) return null;

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) return null;

    // On vérifie uniquement qu'un abonnement actif existe. Le nombre
    // d'appareils/lectures simultanés n'est plus une caractéristique
    // d'autorisation et n'est plus embarqué dans le jeton.
    const [subscriptionRows] = await connection.execute(
      `SELECT s.id
       FROM Subscription s
       WHERE s.userId = ? AND s.status = 'ACTIVE'
         AND (
           s.provider <> 'ADMIN'
           OR s.currentPeriodEnd IS NULL
           OR s.currentPeriodEnd > NOW()
         )
       LIMIT 1`,
      [user.id],
    );
    const subscription = (subscriptionRows as any[])[0];
    if (!subscription) return null;

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
  } finally {
    await connection.end();
  }
}
