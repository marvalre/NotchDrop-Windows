import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getVersion } from "@tauri-apps/api/app";
import { quitApp } from "../lib/api";
import type { Prefs } from "../App";

export function Settings({ prefs, setPrefs, clearClips }: { prefs: Prefs; setPrefs: (p: Prefs) => void; clearClips: () => void }) {
  const [autostart, setAutostart] = useState(false);
  const [version, setVersion] = useState("");
  useEffect(() => {
    void isEnabled().then(setAutostart).catch(() => {});
    void getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="scroll">
      <section className="card">
        <h3>⚙️ General</h3>
        <label className="toggle">
          <span>Abrir al iniciar Windows</span>
          <input
            type="checkbox"
            checked={autostart}
            onChange={async (e) => {
              try { if (e.target.checked) await enable(); else await disable(); } catch { /* ignore */ }
              setAutostart(await isEnabled().catch(() => false));
            }}
          />
        </label>
        <label className="toggle">
          <span>Abrir al pasar el mouse</span>
          <input type="checkbox" checked={prefs.hoverOpen} onChange={(e) => setPrefs({ ...prefs, hoverOpen: e.target.checked })} />
        </label>
        <label className="toggle">
          <span>Recordar el portapapeles al cerrar la app<br /><span className="muted small">Se guarda sin cifrar en esta PC. Las copias de gestores de contraseñas nunca se guardan.</span></span>
          <input type="checkbox" checked={prefs.persistClipboard} onChange={(e) => setPrefs({ ...prefs, persistClipboard: e.target.checked })} />
        </label>
        <div className="row">
          <span className="muted small">Atajo: <b>Ctrl + Alt + N</b> abre y cierra la isla desde cualquier app.</span>
          <button className="small-btn" onClick={clearClips}>Borrar historial</button>
        </div>
      </section>
      <section className="card">
        <div className="row">
          <span><b>NotchDrop para Windows</b> <span className="muted small">v{version}</span></span>
          <button className="small-btn danger" onClick={() => void quitApp()}>Salir</button>
        </div>
      </section>
    </div>
  );
}
