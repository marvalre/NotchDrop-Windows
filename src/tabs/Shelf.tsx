import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { FileInfo, baseName, downloadMedia, dragIcon, errorText, filesInfo, formatBytes, installTools, openFile, revealFile, toolsStatus } from "../lib/api";
import { isSupportedLink } from "../lib/links";

const KIND_ICON: Record<string, string> = { video: "🎬", audio: "🎵", image: "🖼", unsupported: "📄" };

export function Shelf(props: {
  files: string[];
  setFiles: (f: string[]) => void;
  lastClip: string | undefined;
  onConvert: (path: string) => void;
  dragging: boolean;
}) {
  const { files, setFiles, lastClip, onConvert, dragging } = props;
  const [infos, setInfos] = useState<FileInfo[]>([]);
  const [link, setLink] = useState("");
  const [format, setFormat] = useState<"mp4" | "mp3">("mp4");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);

  useEffect(() => { void filesInfo(files).then(setInfos).catch(() => setInfos([])); }, [files]);
  useEffect(() => { void toolsStatus().then((s) => setMissing(s.missing)).catch(() => {}); }, []);
  // The workflow is "copy a link, open the shelf": offer it without pasting.
  useEffect(() => { if (!link && lastClip && isSupportedLink(lastClip)) setLink(lastClip.trim()); }, [lastClip]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const a = listen<string>("tools-progress", (e) => setStatus({ text: e.payload }));
    const b = listen<number>("download-retry", (e) => setStatus({ text: `Reintentando (${e.payload}/6)…` }));
    return () => { void a.then((f) => f()); void b.then((f) => f()); };
  }, []);

  const install = async () => {
    setInstalling(true);
    setStatus({ text: "Descargando herramientas (~75 MB)…" });
    try {
      await installTools();
      const s = await toolsStatus();
      setMissing(s.missing);
      setStatus({ text: s.missing.length ? "Faltan: " + s.missing.join(", ") : "✓ Herramientas instaladas" });
    } catch (e) {
      setStatus({ text: errorText(e), error: true });
    } finally { setInstalling(false); }
  };

  const download = async () => {
    const url = link.trim();
    if (!isSupportedLink(url)) { setStatus({ text: "Eso no parece un enlace válido.", error: true }); return; }
    setBusy(true);
    setStatus({ text: "Descargando…" });
    try {
      const path = await downloadMedia(url, format);
      setFiles([path, ...files.filter((f) => f !== path)]);
      setStatus({ text: `✓ ${baseName(path)} está en Descargas` });
      setLink("");
    } catch (e) {
      setStatus({ text: errorText(e), error: true });
      if (String(e) === "MISSING_TOOLS") void toolsStatus().then((s) => setMissing(s.missing));
    } finally { setBusy(false); }
  };

  const drag = async (path: string) => {
    try { await startDrag({ item: [path], icon: await dragIcon() }); } catch { /* drag cancelled or unsupported */ }
  };

  return (
    <div className="shelf">
      <div className="download-bar">
        <input
          className="link"
          placeholder="Pega un link de TikTok, Instagram, X o YouTube"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) void download(); }}
        />
        <div className="seg">
          {(["mp4", "mp3"] as const).map((f) => (
            <button key={f} className={format === f ? "on" : ""} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
          ))}
        </div>
        <button className="small-btn primary" disabled={busy || installing} onClick={() => void download()}>{busy ? "…" : "Descargar"}</button>
      </div>
      {(status || missing.length > 0) && (
        <div className="row status-row">
          <span className={`small ${status?.error ? "danger" : "muted"}`}>
            {status?.text ?? "Para descargar videos faltan unas herramientas gratuitas (yt-dlp y ffmpeg)."}
          </span>
          {missing.length > 0 && (
            <button className="small-btn primary" disabled={installing} onClick={() => void install()}>
              {installing ? "Instalando…" : "Instalar herramientas"}
            </button>
          )}
        </div>
      )}
      <div className={`tray ${dragging ? "hot" : ""}`}>
        {infos.length === 0 && <div className="tray-empty muted">{dragging ? "Suelta aquí" : "Arrastra archivos aquí para tenerlos a la mano"}</div>}
        {infos.map((f) => (
          <div
            className={`tile ${f.exists ? "" : "gone"}`}
            key={f.path}
            title={f.path}
            draggable={f.exists}
            onDragStart={(e) => { e.preventDefault(); if (f.exists) void drag(f.path); }}
            onDoubleClick={() => f.exists && void openFile(f.path)}
          >
            <div className="tile-icon">{KIND_ICON[f.kind]}</div>
            <div className="tile-name">{f.name}</div>
            <div className="tile-size muted">{f.exists ? formatBytes(f.bytes) : "ya no existe"}</div>
            <div className="tile-actions">
              {f.exists && <button title="Mostrar en la carpeta" onClick={() => void revealFile(f.path)}>📂</button>}
              {f.exists && f.targets.length > 0 && <button title="Convertir" onClick={() => onConvert(f.path)}>↻</button>}
              <button title="Quitar de la bandeja" onClick={() => setFiles(files.filter((x) => x !== f.path))}>✕</button>
            </div>
          </div>
        ))}
      </div>
      {infos.length > 0 && (
        <div className="row">
          <span className="muted small">Arrastra un archivo hacia otra app · doble clic para abrir</span>
          <button className="small-btn" onClick={() => setFiles([])}>Vaciar</button>
        </div>
      )}
    </div>
  );
}
