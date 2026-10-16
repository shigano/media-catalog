import { notFound } from 'next/navigation';

import { db } from '@/lib/db';
import { getDuration, needsTranscode, probeFile } from '@/lib/ffprobe';
import { getTmdbSeasonDetails } from '@/lib/tmdbMatch';

import { ManualMatch } from './manual-match';
import { PlayButton } from './play-button';

export const dynamic = 'force-dynamic';

// Si ffprobe échoue (fichier illisible, ffmpeg non installé...), on
// suppose par prudence qu'un transcodage est nécessaire plutôt que de
// risquer une lecture directe qui échouerait silencieusement.
async function checkNeedsTranscode(filePath: string): Promise<boolean> {
  try {
    const probe = await probeFile(filePath);
    return needsTranscode(probe);
  } catch {
    return true;
  }
}

export default async function ItemDetailPage({ params }: { params: { id: string } }) {
  const item = await db.mediaItem.findUnique({
    where: { id: params.id },
    include: { episodes: { orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' } ] } },
  });
  if (!item) notFound();

  const movieNeedsTranscode =
    item.type === 'MOVIE' && item.filePath ? await checkNeedsTranscode(item.filePath) : false;
  const movieDuration =
    item.type === 'MOVIE' && item.filePath ? await getDuration(item.filePath) : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-8 flex gap-6">
        <div className="w-40 shrink-0 overflow-hidden rounded-ticket bg-surfaceRaised">
          {item.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.posterUrl} alt={item.title} className="w-full" />
          ) : (
            <div className="flex aspect-[2/3] items-center justify-center p-2 text-center text-xs text-inkMuted">
              {item.title}
            </div>
          )}
        </div>
        <div>
          <h1 className="mb-1 text-2xl text-ink">{item.matchedTitle || item.title}</h1>
          <p className="mb-3 text-sm text-inkMuted">
            {item.type === 'MOVIE' ? 'Film' : 'Série'}
            {item.year ? ` · ${item.year}` : ''} · Détecté sous : "{item.title}"
          </p>
          {item.overview && <p className="text-sm text-inkMuted">{item.overview}</p>}
          <p className="mt-3 text-xs">
            Fichier :{' '}
            <span className="font-mono text-inkMuted">
              {item.filePath ?? item.folderPath}
            </span>
          </p>
          {item.type === 'MOVIE' && item.filePath && (
            <div className="mt-4">
              <PlayButton
                directSrc={`/api/stream/movie/${item.id}`}
                hlsBaseSrc={`/api/transcode/movie/${item.id}`}
                needsTranscode={movieNeedsTranscode}
                durationSeconds={movieDuration}
              />
            </div>
          )}
        </div>
      </div>

      {item.type === 'SERIES' && item.episodes.length > 0 && (
        <div className="mb-8 space-y-6">
          <h2 className="text-lg text-ink">Saisons et épisodes</h2>
          {(await Promise.all(
            [...new Set(item.episodes.map((ep) => ep.seasonNumber))]
              .sort((a, b) => a - b)
              .map(async (seasonNumber) => {
                const localEpisodes = item.episodes.filter((ep) => ep.seasonNumber === seasonNumber);
                const tmdbSeason = item.tmdbId
                  ? await getTmdbSeasonDetails(item.tmdbId, seasonNumber).catch(() => null)
                  : null;
                return { seasonNumber, localEpisodes, tmdbSeason };
              }),
          )).map(({ seasonNumber, localEpisodes, tmdbSeason }) => (
            <div key={seasonNumber}>
              <h3 className="mb-2 text-sm font-semibold text-ink">Saison {seasonNumber}</h3>
              <div className="space-y-1 text-sm">
                {localEpisodes.map((ep) => {
                  const tmdbEpisode = tmdbSeason?.episodes.find(
                    (e) => e.episodeNumber === ep.episodeNumber,
                  );
                  return <EpisodeRow key={ep.id} episode={ep} tmdbEpisode={tmdbEpisode} />;
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <ManualMatch itemId={item.id} itemTitle={item.matchedTitle || item.title} />
    </main>
  );
}

async function EpisodeRow({
  episode,
  tmdbEpisode,
}: {
  episode: { id: string; seasonNumber: number; episodeNumber: number; filePath: string };
  tmdbEpisode?: { name: string; overview: string; airDate: string | null };
}) {
  const [transcode, duration] = await Promise.all([
    checkNeedsTranscode(episode.filePath),
    getDuration(episode.filePath),
  ]);
  const code = `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;
  return (
    <div className="rounded-ticket bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink">
          {code}
          {tmdbEpisode?.name ? ` — ${tmdbEpisode.name}` : ''}
        </span>
        {tmdbEpisode?.airDate && <span className="text-xs text-accent">{tmdbEpisode.airDate}</span>}
      </div>
      {tmdbEpisode?.overview && (
        <p className="mt-1 text-xs text-inkMuted">{tmdbEpisode.overview}</p>
      )}
      <p className="mt-1 truncate text-xs text-inkMuted">{episode.filePath}</p>
      <div className="mt-2">
        <PlayButton
          directSrc={`/api/stream/episode/${episode.id}`}
          hlsBaseSrc={`/api/transcode/episode/${episode.id}`}
          needsTranscode={transcode}
          durationSeconds={duration}
          label="Regarder cet épisode"
        />
      </div>
    </div>
  );
}
