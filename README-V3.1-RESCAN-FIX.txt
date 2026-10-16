MEDIA-CATALOG V3.1 — correction rescan série

Correction principale : POST /api/items/[id]/rescan-episodes ne limite plus
la suppression des épisodes fantômes au seul MediaItem.folderPath historique.
Chaque Episode.filePath existant est désormais vérifié directement sur le NAS.
Un fichier disparu est supprimé de la base même s'il provenait d'un autre
sous-dossier/ancien emplacement de la série.

Cela corrige notamment le cas d'une saison supprimée du NAS qui restait visible
sur la fiche après « Actualiser les métadonnées ».
