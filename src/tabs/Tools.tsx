import { useEffect, useState } from "react";
import { Stopwatch, elapsed, pause, start } from "../lib/stopwatch";
import { AlarmClock, Clipboard, ExternalLink, Timer, X } from "lucide-react";
import { copyImage, copyText, formatBytes, openSpecial } from "../lib/api";
import type { ClipItem } from "../lib/clipboard";
import { AlarmStore, MAX_ALARMS } from "../lib/alarms";
import { primeAudio } from "../lib/alarmTone";
import { preview } from "../lib/clipboard";
import { stopwatchText } from "../lib/time";

const PRESETS = [5, 10, 15, 30, 45, 60];

function timeOf(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Next occurrence of HH:MM (tomorrow if that time already passed today). */
function nextAt(hhmm: string, from = new Date()): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(from);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function Tools(props: {
  clips: ClipItem[];
  alarms: AlarmStore;
  setAlarms: (s: AlarmStore) => void;
  now: number;
  ringing: boolean;
  stopRinging: () => void;
  alarmMsg: string | null;
  setAlarmMsg: (m: string | null) => void;
  stopwatch: Stopwatch;
  setStopwatch: (s: Stopwatch) => void;
}) {
  const { clips, alarms, setAlarms, now, ringing, stopRinging, alarmMsg, setAlarmMsg, stopwatch, setStopwatch } = props;
  const [copied, setCopied] = useState<number | null>(null);
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 30 * 60_000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  const add = (end: number, minutes: number) => {
    primeAudio();
    stopRinging();
    if (alarms.items.length >= MAX_ALARMS) { setAlarmMsg(`Ya tienes ${MAX_ALARMS} alarmas; cancela una para poner otra.`); return; }
    setAlarmMsg(null);
    const next = AlarmStore.fromJSON(alarms.toJSON());
    next.add(end, minutes);
    setAlarms(next);
  };
  const cancel = (id: string) => {
    const next = AlarmStore.fromJSON(alarms.toJSON());
    next.remove(id);
    setAlarms(next);
  };

  // Stopwatch state lives in App so it survives collapsing the island and switching tabs.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!stopwatch.running) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [stopwatch.running]);
  const swElapsed = elapsed(stopwatch, Date.now());
  const swRunning = stopwatch.running;

  const count = alarms.items.length;
  const status = ringing ? "✅ ¡ALARMA! — sonando…" : alarmMsg ?? (count === 0 ? "Sin alarma activa" : count === 1 ? "1 alarma activa" : `${count} alarmas activas`);

  return (
    <div className="scroll">
      <section className="card">
        <h3 className="violet"><Clipboard size={14} strokeWidth={2.4} /> Portapapeles</h3>
        {clips.length === 0 && <div className="muted small">Copia texto o una imagen para verlos aquí.</div>}
        {clips.slice(0, 6).map((c, i) => (
          <div className="row" key={(c.kind === "text" ? c.text : c.url).slice(0, 200) + i}>
            {c.kind === "text" ? (
              <span className="clip" title={preview(c.text)}>{preview(c.text)}</span>
            ) : (
              <span className="clip clip-image"><img src={c.url} alt="" /> Imagen · {formatBytes(c.bytes)}</span>
            )}
            <button
              className="small-btn"
              onClick={async () => {
                try { if (c.kind === "text") await copyText(c.text); else await copyImage(c.url); setCopied(i); setTimeout(() => setCopied(null), 1000); } catch { /* clipboard busy */ }
              }}
            >
              {copied === i ? "¡Copiado!" : "Copiar"}
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="row">
          <h3 className="green"><AlarmClock size={14} strokeWidth={2.4} /> Alarmas</h3>
          <button className="small-btn icon-text" onClick={() => void openSpecial("clock")}><ExternalLink size={12} />Abrir Reloj</button>
        </div>
        <div className="presets">
          {PRESETS.map((m) => (
            <button key={m} onClick={() => add(Date.now() + m * 60_000, m)}>{m}m</button>
          ))}
        </div>
        <div className="row-start">
          <input className="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <button
            className="small-btn"
            onClick={() => {
              const end = nextAt(time);
              if (end) add(end, Math.max(1, Math.round((end - Date.now()) / 60_000)));
            }}
          >
            Fijar hora
          </button>
        </div>
        <div className="row">
          <span className={ringing ? "green" : "muted"}>{status}</span>
          {ringing && <button className="small-btn danger" onClick={stopRinging}>Detener</button>}
        </div>
        {alarms.items.map((a) => {
          const r = Math.max(0, Math.floor((a.end - now) / 1000));
          return (
            <div className="row" key={a.id}>
              <span className="mono row-start"><AlarmClock size={14} /> {String(Math.floor(r / 60)).padStart(2, "0")}:{String(r % 60).padStart(2, "0")} restantes — suena a las {timeOf(a.end)}</span>
              <button className="small-btn" aria-label="Cancelar esta alarma" title="Cancelar esta alarma" onClick={() => cancel(a.id)}><X size={13} /></button>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h3 className="orange"><Timer size={14} strokeWidth={2.4} /> Cronómetro</h3>
        <div className="row">
          <span className="stopwatch mono">{stopwatchText(swElapsed)}</span>
          <div className="row-gap">
            <button
              className="small-btn"
              onClick={() => {
                const t = Date.now();
                setStopwatch(swRunning ? pause(stopwatch, t) : start(stopwatch, t));
              }}
            >
              {swRunning ? "Pausar" : "Iniciar"}
            </button>
            <button className="small-btn" onClick={() => setStopwatch({ running: false, startedAt: 0, accumulated: 0 })}>Reiniciar</button>
          </div>
        </div>
      </section>
    </div>
  );
}
