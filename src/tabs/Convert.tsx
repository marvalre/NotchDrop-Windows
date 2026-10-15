import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp, FolderOpen, ExternalLink } from "lucide-react";
import type { Jobs, WithModal } from "../App";
import { Done, FileInfo, baseName, compressFile, convertFile, errorText, filesInfo, formatBytes, openFile, revealFile } from "../lib/api";
import { FileIcon } from "../components/FileIcon";

const PERCENTS = [90, 75, 50, 30];

export function Convert({ path, setPath, addToShelf, jobs, withModal }: {
  path: string | null; setPath: (p: string | null) => void; addToShelf: (p: string) => void; jobs: Jobs; withModal: WithModal;
}) {
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [mode, setMode] = useState<"format" | "compress">("format");
  const [target, setTarget] = useState("");
  const [percent, setPercent] = useState(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null); setError(null);
    if (!path) { setInfo(null); return; }
    let current = true; // a slow answer for an older file must not overwrite the new one
    void filesInfo([path])
      .then(([i]) => { if (current) { setInfo(i ?? null); setTarget(i?.targets[0] ?? ""); } })
      .catch((e) => { if (current) { setInfo(null); setError(errorText(e)); } });
    return () => { current = false; };
  }, [path]);

  const pick = () => void withModal(async () => {
    const p = await open({ multiple: false, directory: false });
    if (typeof p === "string") setPath(p);
  });

  const run = async () => {
    if (!info) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const r = mode === "format" ? await convertFile(info.path, target) : await compressFile(info.path, percent);
      setResult(r);
      addToShelf(r.path);
    } catch (e) {
      setError(errorText(e));
      if (String(e) === "MISSING_TOOLS") jobs.refreshTools();
    } finally { setBusy(false); }
  };

  const ffMissing = jobs.missing.filter((m) => m !== "yt-dlp");
  const canCompress = info !== null && info.kind !== "unsupported";
  return (
    <div className="convert">
      <div className="convert-file">
        <div className="tile-icon big">{info ? <FileIcon kind={info.kind} isDir={info.isDir} size={40} /> : <FileUp size={40} strokeWidth={1.6} />}</div>
        <div className="convert-name">{info ? info.name : "Ningún archivo seleccionado"}</div>
        {info && <div className="muted small">{formatBytes(info.bytes)}</div>}
        <button className="small-btn" onClick={pick}>Subir archivo</button>
      </div>
      <div className="convert-opts">
        <div className="seg wide">
          <button className={mode === "format" ? "on" : ""} onClick={() => setMode("format")}>Cambiar formato</button>
          <button className={mode === "compress" ? "on" : ""} onClick={() => setMode("compress")}>Comprimir</button>
        </div>
        {mode === "format" ? (
          <label className="field">
            <span className="muted small">Formato de salida</span>
            <select value={target} disabled={!info || info.targets.length === 0} onChange={(e) => setTarget(e.target.value)}>
              {info?.targets.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </select>
          </label>
        ) : (
          <div className="field">
            <span className="muted small">Tamaño final (aprox. del original)</span>
            <div className="seg">
              {PERCENTS.map((p) => <button key={p} className={percent === p ? "on" : ""} onClick={() => setPercent(p)}>{p}%</button>)}
            </div>
          </div>
        )}
        <button
          className="small-btn primary big"
          disabled={busy || !info || !info.exists || info.isDir || (mode === "format" ? !target : !canCompress)}
          onClick={() => void run()}
        >
          {busy ? "Trabajando…" : mode === "format" ? "Convertir" : "Comprimir"}
        </button>
        {info && (info.kind === "unsupported" || info.isDir) && <div className="muted small">Ese tipo de archivo no se puede convertir.</div>}
        {ffMissing.length > 0 && (
          <div className="row">
            <span className="muted small">{jobs.installing ? jobs.status?.text : "Video y audio necesitan ffmpeg (gratis)."}</span>
            <button className="small-btn" disabled={jobs.installing} onClick={jobs.install}>{jobs.installing ? "Instalando…" : "Instalar"}</button>
          </div>
        )}
        {error && <div className="danger small">{error}</div>}
        {result && (
          <div className="result-row">
            <span className="green small">✓ {baseName(result.path)} · {formatBytes(result.originalBytes)} → {formatBytes(result.bytes)}</span>
            <div className="row-gap">
              <button className="small-btn icon-text" onClick={() => void openFile(result.path)}><ExternalLink size={13} />Abrir</button>
              <button className="small-btn icon-text" onClick={() => void revealFile(result.path)}><FolderOpen size={13} />Mostrar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
