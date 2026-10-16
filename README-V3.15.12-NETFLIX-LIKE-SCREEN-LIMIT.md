# V3.15.12 — limitation des lectures natives

- La limite vient uniquement de `Plan.maxConcurrentStreams` dans la BDD Account Portal.
- La connexion au compte n'est jamais limitée par le nombre d'appareils connectés.
- La limite est vérifiée uniquement au démarrage d'une lecture native.
- Les sessions actives sont comptées par compte principal, tous profils confondus.
- Le site web ne compte pas.
- Heartbeat toutes les 20 s, TTL 120 s pour nettoyer les apps/box arrêtées brutalement.
- Une session expirée/manquante ne coupe jamais une vidéo déjà lancée.
- Seule une révocation volontaire depuis le compte (`SESSION_REVOKED`) peut demander l'arrêt distant.
