import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type ProbeResult = { videoCodec: string | null; audioCodec: string | null };

const BROWSER_COMPATIBLE_VIDEO = new Set(['h264']);
const BROWSER_COMPATIBLE_AUDIO = new Set(['aac', 'mp3']);

/**
 * Interroge ffprobe pour connaître les codecs vidéo/audio d'un fichier.
 * Nécessite que `ffmpeg` (qui fournit `ffprobe`) soit installé sur le
 * serveur — sudo apt install ffmpeg si ce n'est pas déjà fait.
 */
export async function probeFile(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const streams = (data.streams ?? []) as Array<{ codec_type: string; codec_name: string }>;
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  return {
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
  };
}

/** Récupère la durée totale du fichier en secondes, si disponible. */
export async function getDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      filePath,
    ]);
    const data = JSON.parse(stdout);
    const duration = parseFloat(data.format?.duration);
    return Number.isFinite(duration) ? duration : null;
  } catch {
    return null;
  }
}

/** true si le fichier a besoin d'être transcodé pour se lire dans un navigateur. */
export function needsTranscode(probe: ProbeResult): boolean {
  if (!probe.videoCodec || !BROWSER_COMPATIBLE_VIDEO.has(probe.videoCodec)) return true;
  if (!probe.audioCodec || !BROWSER_COMPATIBLE_AUDIO.has(probe.audioCodec)) return true;
  return false;
}
