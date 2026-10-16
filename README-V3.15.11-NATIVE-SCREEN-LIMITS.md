# Media Catalog V3.15.11 — limitation des écrans natifs

- Standard : 3 écrans simultanés.
- Premium : 7 écrans simultanés.
- Seules les applications natives créent des sessions : Android mobile/tablette, Android TV/Bbox, Windows.
- Le lecteur web ne crée aucune session et ne compte pas.
- Heartbeat attendu toutes les 20 s ; expiration serveur après 70 s sans heartbeat.
- Une session révoquée retourne HTTP 410 au heartbeat suivant.
- Le comptage est effectué dans une transaction SERIALIZABLE avec retry anti-course.

## Nouvelles routes
- POST /api/app-playback-sessions/start
- POST /api/app-playback-sessions/heartbeat
- POST /api/app-playback-sessions/end

## Déploiement
Après remplacement des sources :

```bash
npm install
npx prisma generate
npx prisma db push
npm run build
pm2 restart media-catalog --update-env
```

`prisma db push` ajoute les métadonnées de session à `ActiveStreamSession`.
