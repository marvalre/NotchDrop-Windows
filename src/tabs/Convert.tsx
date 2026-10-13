import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Done, FileInfo, baseName, compressFile, convertFile, errorText, filesInfo, formatBytes, installTools, openFile, revealFile, toolsStatus } from "../lib/api";

const PERCENTS = [90, 75, 50, 30];

export function Convert({ path, setPath, addToShelf }: { path: string | null; setPath: (p: string | null) => void; addToShelf: (p: string) => void }) {
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [mode, setMode] = useState<"format" | "compress">("format");
  const [target, setTarget] = useState("");
  const [percent, setPercent] = useState(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => { void toolsStatus().then((s) => setMissing(s.missing.filter((m) => m !== "yt-dlp"))).catch(() => {}); }, []);
  useEffect(() => {
    setResult(null); setError(null);
    if (!path) { setInfo(null); return; }
    void filesInfo([path]).then(([i]) => { setInfo(i ?? null); setTarget(i?.targets[0] ?? ""); });
  }, [path]);

  const pick = async () => {
    const p = await open({ multiple: false, directory: false });
    if (typeof p === "string") setPath(p);
  };

  const run = async () => {
    if (!info) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const r = mode === "format" ? await convertFile(info.path, target) : await compressFile(info.path, percent);
      setResult(r);
      addToShelf(r.path);
    } catch (e) {
      setError(errorText(e));
      if (String(e) === "MISSING_TOOLS") void toolsStatus().then((s) => setMissing(s.missing.filter((m) => m !== "yt-dlp")));
    } finally { setBusy(false); }
  };

  const canCompress = info !== null && info.kind !== "unsupported";
  return (
    <div className="convert">
      <div className="convert-file">
        <div className="tile-icon big">{info ? ({ video: "🎬", audio: "🎵", image: "🖼", unsupported: "📄" } as Record<string, string>)[info.kind] : "📥"}</div>
        <div className="convert-name">{info ? info.name : "Ningún archivo seleccionado"}</div>
        {info && <div className="muted small">{formatBytes(info.bytes)}</div>}
        <button className="small-btn" onClick={() => void pick()}>Elegir archivo</button>
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
          disabled={busy || !info || !info.exists || (mode === "format" ? !target : !canCompress)}
          onClick={() => void run()}
        >
          {busy ? "Trabajando…" : mode === "format" ? "Convertir" : "Comprimir"}
        </button>
        {info && info.kind === "unsupported" && <div className="muted small">Ese tipo de archivo no se puede convertir.</div>}
        {missing.length > 0 && (
          <div className="row">
            <span className="muted small">Video y audio necesitan ffmpeg (gratis).</span>
            <button className="small-btn" onClick={() => void installTools().then(() => toolsStatus()).then((s) => setMissing(s.missing.filter((m) => m !== "yt-dlp"))).catch((e) => setError(errorText(e)))}>Instalar</button>
          </div>
        )}
        {error && <div className="danger small">{error}</div>}
        {result && (
          <div className="result-row">
            <span className="green small">✓ {baseName(result.path)} · {formatBytes(result.originalBytes)} → {formatBytes(result.bytes)}</span>
            <div className="row-gap">
              <button className="small-btn" onClick={() => void openFile(result.path)}>Abrir</button>
              <button className="small-btn" onClick={() => void revealFile(result.path)}>Carpeta</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
