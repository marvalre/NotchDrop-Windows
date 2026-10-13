import { MediaInfo, appName, mediaCommand } from "../lib/api";
import { clock } from "../lib/time";

export function Player({ media, art }: { media: MediaInfo | null; art: string | null }) {
  if (!media) {
    return (
      <div className="empty">
        <div className="empty-icon">♪</div>
        <div>No hay nada reproduciéndose</div>
        <div className="muted small">Pon música en Spotify, tu navegador o el Reproductor multimedia.</div>
      </div>
    );
  }
  const pct = media.duration > 0 ? Math.min(100, (media.position / media.duration) * 100) : 0;
  return (
    <div className="player">
      {art ? <img className="art" src={art} alt="" /> : <div className="art placeholder">♪</div>}
      <div className="player-main">
        <div className="np-title" title={media.title}>{media.title}</div>
        <div className="np-sub muted">{[media.artist, media.album].filter(Boolean).join(" • ")}</div>
        <div className="controls">
          <button aria-label="Anterior" onClick={() => void mediaCommand("previous")}>⏮</button>
          <button aria-label={media.playing ? "Pausar" : "Reproducir"} className="play" onClick={() => void mediaCommand("toggle")}>{media.playing ? "⏸" : "▶"}</button>
          <button aria-label="Siguiente" onClick={() => void mediaCommand("next")}>⏭</button>
        </div>
        {media.duration > 0 && (
          <div className="progress">
            <span className="mono small">{clock(media.position)}</span>
            <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            <span className="mono small">-{clock(media.duration - media.position)}</span>
          </div>
        )}
        <div className="muted small source">desde {appName(media.app)}</div>
      </div>
    </div>
  );
}
