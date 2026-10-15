import { useEffect, useState } from "react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import type { Jobs, WithModal } from "../App";
import { FileInfo, dragIcon, filesInfo, formatBytes, openFile, openSpecial, revealFile } from "../lib/api";
import { isSupportedLink } from "../lib/links";
import { FileIcon } from "../components/FileIcon";

/** Same layout as the macOS Shelf: "File Tray" title, the link downloader, then the tray
 * with Clear / Upload Files and a horizontal strip of files. (AirDrop doesn't exist on Windows.) */
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
  const [localError, setLocalError] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    let current = true; // ignore answers for a list that has since changed
    void filesInfo(files).then((i) => { if (current) setInfos(i); }).catch(() => { if (current) setInfos([]); });
    return () => { current = false; };
  }, [files]);
  // The workflow is "copy a link, open the shelf": offer it without pasting.
  useEffect(() => { if (!link && lastClip && isSupportedLink(lastClip.text)) setLink(lastClip.text.trim()); }, [lastClip]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    const url = link.trim();
    if (!url) { setLocalError({ text: "Pega primero un enlace." }); return; }
    if (!isSupportedLink(url)) { setLocalError({ text: "Eso no parece un enlace válido.", error: true }); return; }
    setLocalError(null);
    if (await jobs.download(url, format)) setLink("");
  };

  const upload = () => void withModal(async () => {
    const picked = await open({ multiple: true, directory: false });
    const list = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (list.length) addFiles(list);
  });

  const drag = (path: string) => void withModal(async () => {
    try { await startDrag({ item: [path], icon: await dragIcon() }); } catch { /* cancelled or unsupported */ }
  });

  // "Mostrar en Explorador": if the file is gone, open the Downloads folder instead (as on the Mac).
  const reveal = (path: string) => void revealFile(path).catch(() => openSpecial("downloads"));

  const status = localError ?? jobs.status;
  const busy = jobs.downloading || jobs.installing;

  return (
    <div className="shelf">
      <div className="shelf-head">
        <span className="shelf-title">File Tray</span>
      </div>
      <div className="download-bar">
        <input
          className="link"
          placeholder="Pega un link de TikTok, Instagram, X, YouTube…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) void download(); }}
        />
        <div className="seg">
          {(["mp4", "mp3"] as const).map((f) => (
            <button key={f} className={format === f ? "on" : ""} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
          ))}
        </div>
        <button className="small-btn" disabled={busy} onClick={() => void download()}>Descargar</button>
      </div>
      {(status || jobs.missing.length > 0) && (
        <div className="row status-row">
          <span className={`small ${status?.error ? "danger" : status?.text.startsWith("✓") ? "green" : "muted"}`} title={status?.text}>
            {status?.text ?? "Para descargar videos faltan unas herramientas gratuitas (yt-dlp y ffmpeg)."}
          </span>
          <div className="row-gap">
            {jobs.status?.path && !jobs.status.error && !localError && (
              <button className="small-btn" onClick={() => reveal(jobs.status!.path!)}>Mostrar en Explorador</button>
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
        <div className="tray-strip">
          {infos.length === 0 && <div className="tray-empty muted">{dragging ? "Suelta aquí" : "Drag & Drop Files Here"}</div>}
          {infos.map((f) => (
            <div
              className={`tile ${f.exists ? "" : "gone"}`}
              key={f.path}
              title={`${f.path}\nDoble clic para abrir · arrástralo a otra app`}
              draggable={f.exists}
              onDragStart={(e) => { e.preventDefault(); if (f.exists) drag(f.path); }}
              onDoubleClick={() => { if (f.exists && !f.isDir) void openFile(f.path); }}
            >
              <button className="tile-remove" title="Quitar" aria-label={`Quitar ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f.path))}><X size={11} /></button>
              <div className="tile-icon"><FileIcon kind={f.kind} isDir={f.isDir} size={28} /></div>
              <div className="tile-name">{f.name}</div>
              <div className="tile-size muted">{!f.exists ? "ya no existe" : f.isDir ? "Carpeta" : formatBytes(f.bytes)}</div>
              <div className="tile-actions">
                {f.exists && <button title="Mostrar en Explorador" aria-label="Mostrar en Explorador" onClick={() => reveal(f.path)}><FolderOpen size={13} /></button>}
                {f.exists && f.targets.length > 0 && <button title="Convertir" aria-label="Convertir" onClick={() => onConvert(f.path)}><RefreshCw size={13} /></button>}
              </div>
            </div>
          ))}
        </div>
        <div className="tray-buttons">
          <button className="small-btn" disabled={infos.length === 0} onClick={() => setFiles([])}>Clear</button>
          <button className="small-btn" onClick={upload}>Upload Files</button>
        </div>
      </div>
    </div>
  );
}
