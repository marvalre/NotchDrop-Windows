import { useEffect, useState } from "react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, RefreshCw, Trash2, Upload, X } from "lucide-react";
import type { Jobs, WithModal } from "../App";
import { FileInfo, dragIcon, filesInfo, formatBytes, openFile, revealFile } from "../lib/api";
import { isSupportedLink } from "../lib/links";
import { FileIcon } from "../components/FileIcon";

export function Shelf(props: {
  files: string[];
  setFiles: (f: string[]) => void;
  addFiles: (f: string[]) => void;
  lastClip: { text: string } | undefined;
  onConvert: (path: string) => void;
  dragging: boolean;
  jobs: Jobs;
  withModal: WithModal;
}) {
  const { files, setFiles, addFiles, lastClip, onConvert, dragging, jobs, withModal } = props;
  const [infos, setInfos] = useState<FileInfo[]>([]);
  const [link, setLink] = useState("");
  const [format, setFormat] = useState<"mp4" | "mp3">("mp4");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let current = true; // ignore answers for a list that has since changed
    void filesInfo(files).then((i) => { if (current) setInfos(i); }).catch(() => { if (current) setInfos([]); });
    return () => { current = false; };
  }, [files]);
  // The workflow is "copy a link, open the shelf": offer it without pasting.
  useEffect(() => { if (!link && lastClip && isSupportedLink(lastClip.text)) setLink(lastClip.text.trim()); }, [lastClip]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = () => {
    const url = link.trim();
    if (!isSupportedLink(url)) { setLocalError("Eso no parece un enlace válido."); return; }
    setLocalError(null);
    jobs.download(url, format);
    setLink("");
  };

  const upload = () => void withModal(async () => {
    const picked = await open({ multiple: true, directory: false });
    const list = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (list.length) addFiles(list);
  });

  const drag = (path: string) => void withModal(async () => {
    try { await startDrag({ item: [path], icon: await dragIcon() }); } catch { /* cancelled or unsupported */ }
  });

  const status = localError ? { text: localError, error: true } : jobs.status;
  const busy = jobs.downloading || jobs.installing;

  return (
    <div className="shelf">
      <div className="download-bar">
        <input
          className="link"
          placeholder="Pega un link de TikTok, Instagram, X o YouTube"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) download(); }}
        />
        <div className="seg">
          {(["mp4", "mp3"] as const).map((f) => (
            <button key={f} className={format === f ? "on" : ""} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
          ))}
        </div>
        <button className="small-btn primary icon-text" disabled={busy} onClick={download}>
          <Download size={14} />{jobs.downloading ? "Descargando…" : "Descargar"}
        </button>
      </div>
      {(status || jobs.missing.length > 0) && (
        <div className="row status-row">
          <span className={`small ${status?.error ? "danger" : "muted"}`} title={status?.text}>
            {status?.text ?? "Para descargar videos faltan unas herramientas gratuitas (yt-dlp y ffmpeg)."}
          </span>
          <div className="row-gap">
            {status?.path && !status.error && (
              <button className="small-btn icon-text" onClick={() => void revealFile(status.path!)}><FolderOpen size={13} />Mostrar</button>
            )}
            {jobs.missing.length > 0 && (
              <button className="small-btn primary" disabled={jobs.installing} onClick={jobs.install}>
                {jobs.installing ? "Instalando…" : "Instalar herramientas"}
              </button>
            )}
          </div>
        </div>
      )}
      <div className={`tray ${dragging ? "hot" : ""}`}>
        {infos.length === 0 && <div className="tray-empty muted">{dragging ? "Suelta aquí" : "Arrastra archivos aquí"}</div>}
        {infos.map((f) => (
          <div
            className={`tile ${f.exists ? "" : "gone"}`}
            key={f.path}
            title={f.path}
            draggable={f.exists}
            onDragStart={(e) => { e.preventDefault(); if (f.exists) drag(f.path); }}
            onDoubleClick={() => { if (f.exists && !f.isDir) void openFile(f.path); }}
          >
            <div className="tile-icon"><FileIcon kind={f.kind} isDir={f.isDir} /></div>
            <div className="tile-name">{f.name}</div>
            <div className="tile-size muted">{!f.exists ? "ya no existe" : f.isDir ? "Carpeta" : formatBytes(f.bytes)}</div>
            <div className="tile-actions">
              {f.exists && <button title="Mostrar en la carpeta" aria-label="Mostrar en la carpeta" onClick={() => void revealFile(f.path)}><FolderOpen size={14} /></button>}
              {f.exists && f.targets.length > 0 && <button title="Convertir" aria-label="Convertir" onClick={() => onConvert(f.path)}><RefreshCw size={14} /></button>}
              <button title="Quitar de la bandeja" aria-label="Quitar de la bandeja" onClick={() => setFiles(files.filter((x) => x !== f.path))}><X size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="row">
        <span className="muted small">{infos.length ? "Arrastra un archivo hacia otra app · doble clic para abrir" : ""}</span>
        <div className="row-gap">
          <button className="small-btn icon-text" onClick={upload}><Upload size={13} />Subir archivos</button>
          {infos.length > 0 && <button className="small-btn icon-text" onClick={() => setFiles([])}><Trash2 size={13} />Vaciar</button>}
        </div>
      </div>
    </div>
  );
}
