import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { AudioLines, Download, HelpCircle, RefreshCw, Settings as Gear } from "lucide-react";
import type { Browser, Prefs, Jobs } from "../App";
import { openSpecial, quitApp, setExpanded } from "../lib/api";
import { save } from "../lib/store";
import { Dropdown } from "../components/Dropdown";

const SIZES: { label: string; value: number }[] = [
  { label: "Compacto", value: 0.85 },
  { label: "Estándar", value: 1 },
  { label: "Amplio", value: 1.15 },
];

// Same choices as the macOS app, minus Safari (not on Windows).
const BROWSERS: { label: string; value: Browser }[] = [
  { label: "Sin cookies", value: "" },
  { label: "Chrome", value: "chrome" },
  { label: "Firefox", value: "firefox" },
  { label: "Brave", value: "brave" },
  { label: "Edge", value: "edge" },
];

function Toggle({ title, subtitle, checked, onChange }: { title: string; subtitle: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="toggle-text"><span className="toggle-title">{title}</span><span className="muted small">{subtitle}</span></span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export interface UpdateState { status: string; available: string | null; checking: boolean; check: () => void; }

export function Settings({ prefs, setPrefs, jobs, update, replayTour }: {
  prefs: Prefs; setPrefs: (p: Prefs) => void; jobs: Jobs; update: UpdateState; replayTour: () => void;
}) {
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

  const downloadStatus = jobs.installing
    ? jobs.status?.text ?? "Instalando…"
    : jobs.missing.length
      ? `Faltan herramientas (${jobs.missing.join(", ")}). Pulsa «Instalar herramientas»: se descargan solas, sin Terminal.`
      : "Listo. Las descargas van directo a Descargas.";

  return (
    <div className="scroll">
      <section className="card">
        <h3><Gear size={14} strokeWidth={2.4} /> General</h3>
        <Toggle
          title="Iniciar al iniciar sesión"
          subtitle="Abre NotchDrop automáticamente al entrar a Windows."
          checked={autostart}
          onChange={async (on) => {
            try { if (on) await enable(); else await disable(); } catch { /* ignore */ }
            setAutostart(await isEnabled().catch(() => false));
          }}
        />
        <Toggle
          title="Abrir al pasar el mouse por la isla"
          subtitle="Si lo desactivas, haz clic en la isla (o Ctrl + Alt + N) para abrirla."
          checked={prefs.hoverOpen}
          onChange={(v) => setPrefs({ ...prefs, hoverOpen: v })}
        />
        <div className="toggle">
          <span className="toggle-text"><span className="toggle-title">Tamaño del panel expandido</span><span className="muted small">La posición se ajusta sola a tu pantalla; esto es solo qué tan grande se ve.</span></span>
          <div className="seg">
            {SIZES.map((s) => (
              <button key={s.value} className={prefs.panelSize === s.value ? "on" : ""} onClick={() => { setPrefs({ ...prefs, panelSize: s.value }); void setExpanded(true, false, s.value); }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <Toggle
          title="Recordar portapapeles entre reinicios"
          subtitle="Guarda el historial de texto en disco. Las imágenes nunca se guardan."
          checked={prefs.persistClipboard}
          onChange={(v) => setPrefs({ ...prefs, persistClipboard: v })}
        />
      </section>

      <section className="card">
        <h3 className="teal"><AudioLines size={14} strokeWidth={2.4} /> Audio en vivo</h3>
        <span className="small">{audioSeen ? "Activo — detectando el audio del sistema." : "Esperando audio… pon algo a sonar para ver la onda."}</span>
      </section>

      <section className="card">
        <h3 className="blue"><Download size={14} strokeWidth={2.4} /> Descarga de links</h3>
        <span className="small muted">{downloadStatus}</span>
        <span className="muted small">Cookies del navegador (para TikTok/Instagram bloqueados)</span>
        <div className="row">
          <Dropdown value={prefs.cookies} options={BROWSERS} onChange={(v) => setPrefs({ ...prefs, cookies: v })} label="Cookies del navegador" width={140} />
          <div className="row-gap">
            {jobs.missing.length > 0 && <button className="small-btn primary" disabled={jobs.installing} onClick={jobs.install}>{jobs.installing ? "Instalando…" : "Instalar herramientas"}</button>}
            <button className="small-btn" onClick={() => void openSpecial("downloads")}>Abrir carpeta ↗</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h3 className="yellow"><HelpCircle size={14} strokeWidth={2.4} /> Ayuda</h3>
        <div className="row">
          <span className="muted small">Un recorrido de 3 pasos por la isla.</span>
          <button className="small-btn" onClick={replayTour}>Ver tutorial de nuevo</button>
        </div>
      </section>

      <section className="card">
        <h3 className="teal"><RefreshCw size={14} strokeWidth={2.4} /> Actualizaciones</h3>
        <div className="row">
          <span className={`small ${update.available ? "green" : "muted"}`}>{update.status}</span>
          <div className="row-gap">
            {update.available
              ? <button className="small-btn primary" onClick={() => void openSpecial("release")}>Descargar {update.available}</button>
              : <button className="small-btn" disabled={update.checking} onClick={update.check}>{update.checking ? "Buscando…" : "Buscar ahora"}</button>}
          </div>
        </div>
        <Toggle
          title="Buscar actualizaciones automáticamente"
          subtitle="Una vez al día, en GitHub. Nunca se instala nada sin que lo descargues tú."
          checked={prefs.autoUpdateCheck}
          onChange={(v) => { setPrefs({ ...prefs, autoUpdateCheck: v }); save("updateLastCheck", 0); }}
        />
      </section>

      <section className="card">
        <div className="row">
          <span><b>NotchDrop v{version}</b><br /><span className="muted small">Windows · Compilación local</span></span>
          <button className="small-btn danger" onClick={() => void quitApp()}>Salir de NotchDrop</button>
        </div>
      </section>
    </div>
  );
}
