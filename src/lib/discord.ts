import { env } from './config';

/**
 * Envoie une notification Discord pour un nouveau titre détecté (nom,
 * affiche, date de sortie) — équivalent des notifications Sonarr/Radarr.
 * Silencieux si aucune URL de webhook n'est configurée, et n'échoue
 * jamais bruyamment (une notification manquée ne doit jamais faire
 * échouer un scan).
 */
export async function notifyDiscordNewItem(item: {
  title: string;
  type: 'MOVIE' | 'SERIES';
  year: number | null;
  posterUrl: string | null;
}): Promise<void> {
  const webhookUrl = env.discordWebhookUrl();
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: item.title,
            description: item.type === 'MOVIE' ? '🎬 Nouveau film' : '📺 Nouvelle série',
            color: item.type === 'MOVIE' ? 0xe8b54a : 0x4ae8c4,
            fields: item.year
              ? [{ name: 'Date de sortie', value: String(item.year), inline: true }]
              : [],
            image: item.posterUrl ? { url: item.posterUrl } : undefined,
          },
        ],
      }),
    });
  } catch {
    // Une notification Discord manquée ne doit jamais faire échouer un
    // scan — on avale silencieusement l'erreur.
  }
}
