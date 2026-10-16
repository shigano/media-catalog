function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante: ${name}`);
  return value;
}

export const env = {
  databaseUrl: () => requireEnv('DATABASE_URL'),
  tmdbApiKey: () => requireEnv('TMDB_API_KEY'),
  /** Ancien réglage, conservé pour la migration automatique vers la base
   * de données (voir libraryPaths.ts) — plus utilisé directement après le
   * premier scan. */
  libraryPaths: () =>
    (process.env.LIBRARY_PATHS ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  /**
   * Connexion brute (hors Prisma, media-catalog n'a pas ce schéma) vers la
   * base du portail d'abonnement — sert uniquement à vérifier les
   * identifiants et le statut d'abonnement au moment de la connexion.
   */
  accountPortalDatabaseUrl: () => requireEnv('ACCOUNT_PORTAL_DATABASE_URL'),
  /** Secret de signature des jetons de session media-catalog (distinct de
   * celui du portail — ce sont deux applications séparées). */
  jwtSecret: () => requireEnv('JWT_SECRET'),
  /** Secret partagé pour le déclenchement de scan automatique planifié
   * (cron) — appelé sans session admin, juste ce secret en en-tête. */
  autoScanSecret: () => requireEnv('AUTO_SCAN_SECRET'),
  /** URL du webhook Discord — notifie un salon à chaque nouveau titre
   * détecté (nom, affiche, date de sortie). Optionnel : si absent, les
   * notifications sont simplement désactivées, pas d'erreur. */
  discordWebhookUrl: () => process.env.DISCORD_WEBHOOK_URL || null,
  deepMediaAnalysis: () => process.env.DEEP_MEDIA_ANALYSIS === 'true',
  omdbApiKey: () => process.env.OMDB_API_KEY || null,
  tvdbApiKey: () => process.env.TVDB_API_KEY || null,
  /** SMTP — sert uniquement à l'envoi du code de récupération du PIN de
   * compte (voir account-pin/forgot). Mêmes identifiants que ceux déjà
   * utilisés côté account-portal, à copier dans le .env de media-catalog
   * — optionnel : si absent, la récupération par email est simplement
   * indisponible plutôt que de faire planter le serveur au démarrage. */
  smtp: {
    host: () => process.env.SMTP_HOST || null,
    port: () => (process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587),
    secure: () => process.env.SMTP_SECURE === 'true',
    user: () => process.env.SMTP_USER || null,
    password: () => process.env.SMTP_PASSWORD || null,
    sender: () => process.env.SMTP_SENDER || process.env.SMTP_USER || null,
  },
};
