# media-catalog V3.4.1 — lectures simultanées illimitées

- Les routes stream direct et HLS n’appellent plus de limite de sessions.
- L’authentification vérifie toujours un abonnement actif, mais n’utilise plus `Plan.maxConcurrentStreams`.
- Les anciens clients restent compatibles : `/api/stream-session/end` répond toujours correctement et le helper historique est un no-op.
- La table `ActiveStreamSession` reste dans Prisma uniquement pour éviter une migration destructive.
- Aucun `db push` supplémentaire n’est nécessaire par rapport à V3.4 si la V3.4 a déjà synchronisé la base.
