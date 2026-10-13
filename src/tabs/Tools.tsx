import { useEffect, useRef, useState } from "react";
import { copyText } from "../lib/api";
import { AlarmStore } from "../lib/alarms";
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
  clips: string[];
  alarms: AlarmStore;
  setAlarms: (s: AlarmStore) => void;
  now: number;
  ringing: boolean;
  stopRinging: () => void;
  alarmMsg: string | null;
  setAlarmMsg: (m: string | null) => void;
}) {
  const { clips, alarms, setAlarms, now, ringing, stopRinging, alarmMsg, setAlarmMsg } = props;
  const [copied, setCopied] = useState<number | null>(null);
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 30 * 60_000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  const add = (end: number, minutes: number) => {
    primeAudio();
    stopRinging();
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

  // stopwatch
  const [swRunning, setSwRunning] = useState(false);
  const [swElapsed, setSwElapsed] = useState(0);
  const swStart = useRef(0);
  useEffect(() => {
    if (!swRunning) return;
    const id = window.setInterval(() => setSwElapsed(performance.now() - swStart.current), 100);
    return () => clearInterval(id);
  }, [swRunning]);

  const count = alarms.items.length;
  const status = ringing ? "✅ ¡ALARMA! — sonando…" : alarmMsg ?? (count === 0 ? "Sin alarma activa" : count === 1 ? "1 alarma activa" : `${count} alarmas activas`);

  return (
    <div className="scroll">
      <section className="card">
        <h3 className="violet">📋 Portapapeles</h3>
        {clips.length === 0 && <div className="muted small">Copia texto para verlo aquí.</div>}
        {clips.slice(0, 6).map((c, i) => (
          <div className="row" key={c + i}>
            <span className="clip" title={preview(c)}>{preview(c)}</span>
            <button
              className="small-btn"
              onClick={async () => { await copyText(c); setCopied(i); setTimeout(() => setCopied(null), 1000); }}
            >
              {copied === i ? "¡Copiado!" : "Copiar"}
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <h3 className="green">⏰ Alarmas</h3>
        <div className="presets">
          {PRESETS.map((m) => (
            <button key={m} onClick={() => add(Date.now() + m * 60_000, m)}>{m}m</button>
          ))}
        </div>
        <div className="row">
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
              <span className="mono">⏰ {String(Math.floor(r / 60)).padStart(2, "0")}:{String(r % 60).padStart(2, "0")} restantes — suena a las {timeOf(a.end)}</span>
              <button className="small-btn" aria-label="Cancelar esta alarma" title="Cancelar esta alarma" onClick={() => cancel(a.id)}>✕</button>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h3 className="orange">⏱ Cronómetro</h3>
        <div className="row">
          <span className="stopwatch mono">{stopwatchText(swElapsed)}</span>
          <div className="row-gap">
            <button
              className="small-btn"
              onClick={() => {
                if (swRunning) setSwRunning(false);
                else { swStart.current = performance.now() - swElapsed; setSwRunning(true); }
              }}
            >
              {swRunning ? "Pausar" : "Iniciar"}
            </button>
            <button className="small-btn" onClick={() => { setSwRunning(false); setSwElapsed(0); }}>Reiniciar</button>
          </div>
        </div>
      </section>
    </div>
  );
}
