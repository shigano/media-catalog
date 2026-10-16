import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type PlaybackTrackMeta = {
  type: 'audio' | 'subtitle';
  ordinal: number;
  streamIndex: number;
  codec: string | null;
  language: string | null;
  title: string | null;
};

/**
 * Lit les tags des pistes audio/sous-titres directement dans le conteneur.
 * Media3 peut parfois exposer `und` alors que ffprobe retrouve bien
 * tags.language / tags.title dans le MKV.
 */
export async function probePlaybackTracks(filePath: string): Promise<PlaybackTrackMeta[]> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filePath,
    ]);
    const data = JSON.parse(stdout);
    const streams = (data.streams ?? []) as Array<{
      index?: number;
      codec_type?: string;
      codec_name?: string;
      tags?: { language?: string; LANGUAGE?: string; title?: string; TITLE?: string };
    }>;
    let audioOrdinal = 0;
    let subtitleOrdinal = 0;
    const out: PlaybackTrackMeta[] = [];
    for (const stream of streams) {
      if (stream.codec_type !== 'audio' && stream.codec_type !== 'subtitle') continue;
      const type = stream.codec_type as 'audio' | 'subtitle';
      const ordinal = type === 'audio' ? ++audioOrdinal : ++subtitleOrdinal;
      const language = stream.tags?.language ?? stream.tags?.LANGUAGE ?? null;
      const title = stream.tags?.title ?? stream.tags?.TITLE ?? null;
      out.push({
        type,
        ordinal,
        streamIndex: Number(stream.index ?? -1),
        codec: stream.codec_name ?? null,
        language,
        title,
      });
    }
    return out;
  } catch (error) {
    console.warn('[TRACKS] ffprobe indisponible ou pistes non lisibles', error);
    return [];
  }
}
