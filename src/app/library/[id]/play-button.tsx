'use client';

import { useEffect, useRef, useState } from 'react';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function PlayButton({
  directSrc,
  hlsBaseSrc,
  needsTranscode,
  durationSeconds,
  label = 'Regarder',
}: {
  directSrc: string;
  /** Base d'URL sans la position, ex: "/api/transcode/movie/xxx" — la
   * position est ajoutée comme segment de chemin ("/0/playlist.m3u8"). */
  hlsBaseSrc: string;
  needsTranscode: boolean;
  /** Durée totale connue (ffprobe), pour la barre de progression. Null si inconnue. */
  durationSeconds: number | null;
  label?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [seekOffset, setSeekOffset] = useState(0); // position (s) où la session HLS actuelle a démarré
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import('hls.js').default | null>(null);

  function startHlsAt(startSeconds: number) {
    if (!videoRef.current) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setSeekOffset(startSeconds);
    setPreparing(true);

    const hlsSrc = `${hlsBaseSrc}/${Math.floor(startSeconds)}/playlist.m3u8`;

    (async () => {
      const Hls = (await import('hls.js')).default;
      if (!videoRef.current) return;

      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(hlsSrc);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setPreparing(false);
          videoRef.current?.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          console.error('Erreur hls.js :', data.type, data.details, 'fatal:', data.fatal);
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                hlsRef.current = null;
                break;
            }
          }
        });
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        videoRef.current.src = hlsSrc;
        setPreparing(false);
      }
    })();
  }

  useEffect(() => {
    if (!playing || !needsTranscode) return;
    startHlsAt(0);
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, needsTranscode]);

  function handleSeekBarClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!durationSeconds) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const targetSeconds = Math.floor(ratio * durationSeconds);
    startHlsAt(targetSeconds);
  }

  const displayedTime = seekOffset + currentTime;
  const progressRatio = durationSeconds ? Math.min(1, displayedTime / durationSeconds) : 0;

  if (playing) {
    return (
      <div>
        {preparing && (
          <p className="mb-2 text-xs text-inkMuted">
            Préparation du flux (transcodage en cours, ça peut prendre
            quelques secondes)…
          </p>
        )}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          controls
          autoPlay={!needsTranscode}
          className="w-full rounded-ticket bg-black"
          src={needsTranscode ? undefined : directSrc}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        />

        {needsTranscode && durationSeconds != null && (
          <div className="mt-2">
            <div
              onClick={handleSeekBarClick}
              className="h-2 w-full cursor-pointer rounded-full bg-white/10"
            >
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${progressRatio * 100}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-inkMuted">
              <span>{formatTime(displayedTime)}</span>
              <span>{formatTime(durationSeconds)}</span>
            </div>
            <p className="mt-1 text-xs text-inkMuted">
              Clique n'importe où sur cette barre pour sauter directement à
              cet endroit (redémarre le transcodage à cette position).
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setPlaying(true)}
      className="rounded-ticket bg-accent px-4 py-2 text-sm font-semibold text-background transition hover:bg-accentMuted"
    >
      ▶ {label}
    </button>
  );
}
