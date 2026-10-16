Media Catalog V3.12 — Scan Review + Reconciliation

Objectifs:
- conserver en BDD une vraie file de diagnostic ScanReview avec chemins NAS ;
- réparer les anciens statuts AMBIGUOUS/UNMATCHED issus d'un scan interrompu quand un TMDB existant peut être revalidé sans ambiguïté ;
- ne plus dégrader l'identité d'une série uniquement parce que son découpage local de saisons diffère de TMDB ;
- rattacher Spéciaux/Specials à la série parente en saison locale S00 ;
- exposer GET /api/admin/scan-reviews?status=OPEN pour l'audit admin.

Garde-fous:
- un ancien tmdbId n'est réutilisé que si le titre local et le titre fournisseur restent suffisamment proches ;
- "Spéciaux" -> "FX Effets Spéciaux" ne passe pas ce garde-fou ;
- MediaItem reste la source de vérité ; ScanReview est un journal diagnostic.

Déploiement: changement Prisma obligatoire.
npx prisma db push
npx prisma generate
rm -rf .next
npm run build
pm2 restart media-catalog
pm2 save
pm2 flush

Backfill des éléments déjà À vérifier, sans rescanner le NAS:
node scripts/backfill-scan-reviews.mjs
