import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { AudioLines, Download, ExternalLink, Settings as Gear } from "lucide-react";
import type { Browser, Jobs, Prefs } from "../App";
import { openSpecial, quitApp, setExpanded } from "../lib/api";

const SIZES: { label: string; value: number }[] = [
  { label: "Compacto", value: 0.85 },
  { label: "Estándar", value: 1 },
  { label: "Amplio", value: 1.15 },
];

const BROWSERS: { label: string; value: Browser }[] = [
  { label: "Ninguno", value: "" },
  { label: "Firefox", value: "firefox" },
  { label: "Edge", value: "edge" },
  { label: "Chrome", value: "chrome" },
  { label: "Brave", value: "brave" },
];

function Toggle({ title, subtitle, checked, onChange }: { title: string; subtitle: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="toggle-text"><span className="toggle-title">{title}</span><span className="muted small">{subtitle}</span></span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Settings({ prefs, setPrefs, clearClips, jobs }: { prefs: Prefs; setPrefs: (p: Prefs) => void; clearClips: () => void; jobs: Jobs }) {
  const [autostart, setAutostart] = useState(false);
  const [version, setVersion] = useState("");
  const [audioSeen, setAudioSeen] = useState(false);
  useEffect(() => {
    void isEnabled().then(setAutostart).catch(() => {});
    void getVersion().then(setVersion).catch(() => {});
    // The level stream only sends changes, so a non-zero level means the meter works.
    const un = listen<number>("audio-level", (e) => { if (e.payload > 0) setAudioSeen(true); });
    return () => { void un.then((f) => f()); };
  }, []);

  return (
    <div className="scroll">
      <section className="card">
        <h3><Gear size={14} strokeWidth={2.4} /> General</h3>
        <Toggle
          title="Iniciar con Windows"
          subtitle="Abre NotchDrop automáticamente al entrar a Windows."
          checked={autostart}
          onChange={async (on) => {
            try { if (on) await enable(); else await disable(); } catch { /* ignore */ }
            setAutostart(await isEnabled().catch(() => false));
          }}
        />
        <Toggle
          title="Abrir al pasar el mouse por la isla"
          subtitle="Si lo desactivas, haz clic en la isla o usa Ctrl + Alt + N."
          checked={prefs.hoverOpen}
          onChange={(v) => setPrefs({ ...prefs, hoverOpen: v })}
        />
        <div className="toggle">
          <span className="toggle-text"><span className="toggle-title">Tamaño del panel expandido</span><span className="muted small">Solo cambia qué tan grande se ve al abrirse.</span></span>
          <div className="seg">
            {SIZES.map((s) => (
              <button
                key={s.value}
                className={prefs.panelSize === s.value ? "on" : ""}
                onClick={() => { setPrefs({ ...prefs, panelSize: s.value }); void setExpanded(true, false, s.value); }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <Toggle
          title="Recordar portapapeles entre reinicios"
          subtitle="Guarda el historial de texto en esta PC, sin cifrar. Las imágenes y las copias de gestores de contraseñas nunca se guardan."
          checked={prefs.persistClipboard}
          onChange={(v) => setPrefs({ ...prefs, persistClipboard: v })}
        />
        <div className="row">
          <span className="muted small">Atajo: <b>Ctrl + Alt + N</b> abre y cierra la isla desde cualquier app.</span>
          <button className="small-btn" onClick={clearClips}>Borrar historial</button>
        </div>
      </section>

      <section className="card">
        <h3 className="teal"><AudioLines size={14} strokeWidth={2.4} /> Audio en vivo</h3>
        <span className="small">
          {audioSeen ? "Activo — la onda sigue el audio de tu PC." : "Esperando audio… pon algo a sonar para ver la onda."}
          <span className="muted"> Solo mide el volumen de salida; no graba nada.</span>
        </span>
      </section>

      <section className="card">
        <h3 className="blue"><Download size={14} strokeWidth={2.4} /> Descarga de links</h3>
        <div className="toggle">
          <span className="toggle-text"><span className="toggle-title">Cookies del navegador</span><span className="muted small">Para contenido que pide iniciar sesión. Chrome y Edge a veces no dejan leerlas; Firefox es lo más fiable.</span></span>
          <select className="browser" value={prefs.cookies} onChange={(e) => setPrefs({ ...prefs, cookies: e.target.value as Browser })}>
            {BROWSERS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </div>
        <div className="row">
          <span className={`small ${jobs.missing.length ? "muted" : "green"}`}>
            {jobs.installing ? jobs.status?.text : jobs.missing.length ? `Faltan herramientas: ${jobs.missing.join(", ")}.` : "✓ yt-dlp y ffmpeg instalados."}
          </span>
          <div className="row-gap">
            {jobs.missing.length > 0 && <button className="small-btn primary" disabled={jobs.installing} onClick={jobs.install}>{jobs.installing ? "Instalando…" : "Instalar herramientas"}</button>}
            <button className="small-btn icon-text" onClick={() => void openSpecial("downloads")}><ExternalLink size={12} />Abrir carpeta</button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="row">
          <span><b>NotchDrop para Windows</b> <span className="muted small">v{version}</span></span>
          <button className="small-btn danger" onClick={() => void quitApp()}>Salir de NotchDrop</button>
        </div>
      </section>
    </div>
  );
}
