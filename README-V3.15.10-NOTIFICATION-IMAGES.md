# Media Catalog V3.15.10 — images notifications Android

- L'affiche sélectionnée reste récupérée depuis MediaItem.posterUrl.
- L'URL TMDB w500 est réduite en w342 pour limiter le poids de l'image distante FCM.
- imageUrl est envoyé dans notification.imageUrl, android.notification.imageUrl et data.imageUrl.
