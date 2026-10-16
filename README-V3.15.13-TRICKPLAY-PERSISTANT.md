# Media Catalog V3.15.13 — TrickPlay persistant + préchauffage

- Cache par défaut : `/var/cache/dreamfilms/trickplay-tiles` (persistant après reboot).
- Après un scan réussi, films et épisodes MATCHED des médiathèques scannées sont mis en file de pré-génération.
- Une seule génération FFmpeg TrickPlay à la fois (`nice -n 10`) pour ménager NAS/CPU.
- Les médias dont le cache est déjà valide sont ignorés.
- La génération à la demande reste compatible si un média n'est pas encore préchauffé.
- Aucun changement dans l'application Flutter, le lecteur TV/Bbox, la durée ou Windows.

## Déploiement
Depuis `/var/www/media-catalog`, extraire/copier les fichiers de ce patch en conservant les chemins, puis :

```bash
mkdir -p /var/cache/dreamfilms/trickplay-tiles
chmod 755 /var/cache/dreamfilms /var/cache/dreamfilms/trickplay-tiles
npm run build
pm2 restart 0
pm2 save
```

Optionnel dans `.env` :
`TRICKPLAY_TILE_CACHE_DIR=/var/cache/dreamfilms/trickplay-tiles`

L'ancien cache `/tmp/dreamfilms-trickplay-tiles` n'est pas supprimé automatiquement.
