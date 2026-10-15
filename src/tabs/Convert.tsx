import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp, FolderOpen } from "lucide-react";
import type { Jobs, WithModal } from "../App";
import { FileInfo, baseName, errorText, filesInfo, formatBytes, revealFile } from "../lib/api";
import { FileIcon } from "../components/FileIcon";
import { Dropdown } from "../components/Dropdown";

// Same choices as the macOS "Reducir a…" menu.
const PERCENTS = [75, 50, 30, 15].map((p) => ({ value: String(p), label: `${p} % del tamaño` }));

export function Convert({ path, setPath, jobs, withModal }: {
  path: string | null; setPath: (p: string | null) => void; jobs: Jobs; withModal: WithModal;
}) {
  const job = jobs.convert;
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [mode, setMode] = useState<"format" | "compress">("format");
  const [target, setTarget] = useState("");
  const [percent, setPercent] = useState("50");
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    setLookupError(null);
    if (!path) { setInfo(null); return; }
    let current = true; // a slow answer for an older file must not overwrite the new one
    void filesInfo([path])
      .then(([i]) => { if (current) { setInfo(i ?? null); setTarget(i?.targets[0] ?? ""); } })
      .catch((e) => { if (current) { setInfo(null); setLookupError(errorText(e)); } });
    return () => { current = false; };
  }, [path]);

  const pick = () => void withModal(async () => {
    const p = await open({ multiple: false, directory: false, title: "Elige el archivo a convertir" });
    if (typeof p === "string") { job.clear(); setPath(p); }
  });

  // Status line, same wording as the macOS Convert tab.
  let status: { text: string; tone: "muted" | "danger" | "green" } | null = null;
  if (lookupError) status = { text: lookupError, tone: "danger" };
  else if (job.busy) status = { text: mode === "compress" ? "Comprimiendo…" : "Convirtiendo…", tone: "muted" };
  else if (job.error) status = { text: job.error, tone: "danger" };
  else if (job.result) {
    const pct = job.result.originalBytes > 0 ? Math.round((job.result.bytes / job.result.originalBytes) * 100) : null;
    status = { text: `✓ ${baseName(job.result.path)} · ${formatBytes(job.result.originalBytes)} → ${formatBytes(job.result.bytes)}${pct !== null ? ` (${pct} %)` : ""}`, tone: "green" };
  } else if (info && !info.exists) status = { text: "El archivo ya no existe.", tone: "danger" };
  else if (info && (info.kind === "unsupported" || info.isDir)) status = { text: "Tipo de archivo no soportado.", tone: "danger" };
  else if (info && mode === "format" && info.targets.length === 0) status = { text: "No hay otros formatos disponibles para este archivo.", tone: "muted" };

  const usable = !!info && info.exists && !info.isDir && info.kind !== "unsupported";
  const ffMissing = jobs.missing.filter((m) => m !== "yt-dlp");

  return (
    <div className="convert">
      <div className="convert-file">
        <div className="tile-icon big">{info ? <FileIcon kind={info.kind} isDir={info.isDir} size={40} /> : <FileUp size={40} strokeWidth={1.6} />}</div>
        <button className="small-btn" disabled={job.busy} onClick={pick}>Subir archivo</button>
        <div className="convert-name muted small" title={info?.path}>{info ? `${info.name} · ${formatBytes(info.bytes)}` : "Ningún archivo seleccionado"}</div>
      </div>
      <div className="convert-opts">
        <div className="seg wide">
          <button className={mode === "format" ? "on" : ""} disabled={job.busy} onClick={() => setMode("format")}>Cambiar formato</button>
          <button className={mode === "compress" ? "on" : ""} disabled={job.busy} onClick={() => setMode("compress")}>Comprimir</button>
        </div>
        <div className="field">
          <span className="muted small">{mode === "format" ? "Formato de salida" : "Reducir a…"}</span>
          <div className="row-start">
            {mode === "format" ? (
              <Dropdown
                value={target}
                options={(info?.targets ?? []).map((t) => ({ value: t, label: t.toUpperCase() }))}
                onChange={setTarget}
                disabled={!usable || job.busy || (info?.targets.length ?? 0) === 0}
                label="Formato de salida"
                width={150}
              />
            ) : (
              <Dropdown value={percent} options={PERCENTS} onChange={setPercent} disabled={!usable || job.busy} label="Reducir a" width={150} />
            )}
            <button
              className="small-btn primary"
              disabled={job.busy || !usable || (mode === "format" && !target)}
              onClick={() => info && job.start(info.path, mode, target, Number(percent))}
            >
              Convertir
            </button>
          </div>
        </div>
        {status && <div className={`small ${status.tone}`}>{status.text}</div>}
        {job.result && !job.busy && (
          <button className="small-btn icon-text start" onClick={() => void revealFile(job.result!.path)}><FolderOpen size={13} />Mostrar en Explorador</button>
        )}
        {ffMissing.length > 0 && (
          <div className="row">
            <span className="muted small">{jobs.installing ? jobs.status?.text : "Video y audio necesitan ffmpeg (gratis)."}</span>
            <button className="small-btn" disabled={jobs.installing} onClick={jobs.install}>{jobs.installing ? "Instalando…" : "Instalar herramientas"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
