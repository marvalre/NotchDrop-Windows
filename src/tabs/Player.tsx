import { useEffect, useRef, useState } from "react";
import { AudioLines, Music, Pause, Play, SkipBack, SkipForward, MonitorSpeaker, Volume as Speaker0, Volume1, Volume2, VolumeX, Video } from "lucide-react";
import { MediaInfo, Volume, appName, mediaCommand, mediaSeek, openSpecial, volumeGet, volumeMute, volumeSet } from "../lib/api";
import { clock } from "../lib/time";

/** Same layout as the macOS Player: artwork, track, transport + output, seekable progress,
 * volume with mute, and the camera mirror on the right. */
export function Player({ media, art }: { media: MediaInfo | null; art: string | null }) {
  // ── volume (kept in sync with changes made from the keyboard or the taskbar) ──
  const [vol, setVol] = useState<Volume | null>(null);
  const dragging = useRef(false);
  const lastUserChange = useRef(0);
  const pendingLevel = useRef<number | null>(null);
  const sendTimer = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    // A poll answered right after a drag would snap the knob back to the old level.
    const read = () => void volumeGet().then((v) => {
      if (alive && v && !dragging.current && Date.now() - lastUserChange.current > 1500) setVol(v);
    }).catch(() => {});
    read();
    const id = window.setInterval(read, 1500);
    return () => { alive = false; clearInterval(id); if (sendTimer.current) clearTimeout(sendTimer.current); };
  }, []);

  // At most ~12 volume changes a second while dragging, and always the final one.
  const sendLevel = (level: number) => {
    lastUserChange.current = Date.now();
    pendingLevel.current = level;
    if (sendTimer.current) return;
    sendTimer.current = window.setTimeout(() => {
      sendTimer.current = null;
      const l = pendingLevel.current;
      pendingLevel.current = null;
      if (l !== null) void volumeSet(l);
    }, 80);
  };

  // ── seek ──
  // While dragging, `scrub` is the knob. After release the new position is shown straight away
  // and kept until the player reports a position near it (as on the Mac), instead of jumping back.
  const [scrub, setScrub] = useState<number | null>(null);
  const [committed, setCommitted] = useState<{ at: number; t: number } | null>(null);
  useEffect(() => {
    if (!committed || !media) return;
    const expected = committed.at + (media.playing ? (Date.now() - committed.t) / 1000 : 0);
    if (Math.abs(media.position - expected) < 2.5 || Date.now() - committed.t > 4000) setCommitted(null);
  }, [media, committed]);
  const duration = media?.duration ?? 0;
  const position = scrub ?? (committed ? committed.at + (media?.playing ? (Date.now() - committed.t) / 1000 : 0) : media?.position ?? 0);
  const canSeek = !!media && media.canSeek && duration > 0;
  const commitSeek = () => {
    if (scrub === null) return;
    const at = scrub;
    setScrub(null);
    setCommitted({ at, t: Date.now() });
    void mediaSeek(at);
  };

  // Three steps, like the macOS speaker icon.
  const VolIcon = !vol || vol.muted || vol.level === 0 ? VolumeX : vol.level < 0.33 ? Speaker0 : vol.level < 0.66 ? Volume1 : Volume2;
  const isSpotify = !!media && /spotify/i.test(media.app);

  return (
    <div className="player">
      <div className="art-wrap">
        {art ? <img className="art" src={art} alt="" /> : <div className="art placeholder"><Music size={44} strokeWidth={1.5} /></div>}
        {isSpotify && <span className="art-badge" title="Spotify"><AudioLines size={12} strokeWidth={2.6} /></span>}
      </div>

      <div className="player-main">
        <div className="np-title" title={media?.title}>{media?.title ?? "No hay música"}</div>
        <div className="np-sub muted">{media ? [media.artist, media.album].filter(Boolean).join(" • ") : "Reproduce algo en cualquier app"}</div>

        <div className="controls">
          <button aria-label="Anterior" disabled={!media} onClick={() => void mediaCommand("previous")}><SkipBack size={20} fill="currentColor" /></button>
          <button aria-label={media?.playing ? "Pausar" : "Reproducir"} className="play" disabled={!media} onClick={() => void mediaCommand("toggle")}>
            {media?.playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>
          <button aria-label="Siguiente" disabled={!media} onClick={() => void mediaCommand("next")}><SkipForward size={20} fill="currentColor" /></button>
          <button aria-label="Salida de audio" title="Elegir salida de audio" className="output" onClick={() => void openSpecial("sound")}><MonitorSpeaker size={19} /></button>
        </div>

        <div className="progress">
          <span className="mono small">{clock(position)}</span>
          <input
            className="slider"
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.5}
            value={Math.min(position, Math.max(1, duration))}
            disabled={!canSeek}
            title={media && !media.canSeek ? "Esta app no permite adelantar" : undefined}
            aria-label="Posición"
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={commitSeek}
            onKeyUp={commitSeek}
            style={{ ["--pct" as string]: `${duration > 0 ? (position / duration) * 100 : 0}%` }}
          />
          <span className="mono small">-{clock(Math.max(0, duration - position))}</span>
        </div>

        <div className="volume">
          <button
            aria-label={vol?.muted ? "Activar sonido" : "Silenciar"}
            disabled={!vol}
            onClick={() => vol && void volumeMute(!vol.muted).then((v) => v && setVol(v))}
          >
            <VolIcon size={17} />
          </button>
          <input
            className="slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={vol ? (vol.muted ? 0 : vol.level) : 0}
            disabled={!vol}
            aria-label="Volumen"
            onPointerDown={() => { dragging.current = true; }}
            onPointerUp={() => { dragging.current = false; lastUserChange.current = Date.now(); }}
            onChange={(e) => {
              const level = Number(e.target.value);
              setVol({ level, muted: false });
              sendLevel(level);
            }}
            style={{ ["--pct" as string]: `${vol ? (vol.muted ? 0 : vol.level) * 100 : 0}%` }}
          />
        </div>
        {media && <div className="muted small source">desde {appName(media.app)}</div>}
      </div>

      <Mirror />
    </div>
  );
}

/** Front camera in a circle, mirrored. Off until clicked; the camera is released as soon as
 * it's turned off or the panel closes (the component unmounts). */
function Mirror() {
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: 480, height: 480 }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play(); }
      })
      .catch(() => { if (!cancelled) { setErr("Sin acceso a la cámara"); setOn(false); } });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [on]);

  return (
    <div className="mirror-wrap">
      <button className={`mirror ${on ? "on" : ""}`} aria-label={on ? "Apagar espejo" : "Espejo de cámara"} title="Espejo de cámara" onClick={() => { setErr(null); setOn(!on); }}>
        {on ? <video ref={videoRef} muted playsInline /> : <Video size={26} fill="currentColor" />}
      </button>
      {err && <div className="mirror-error danger small">{err}. Revisa Configuración → Privacidad → Cámara.</div>}
    </div>
  );
}
