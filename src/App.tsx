import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { MediaInfo, mediaState, setExpanded } from "./lib/api";
import { AlarmStore, pillText } from "./lib/alarms";
import { startAlarmTone, stopAlarmTone } from "./lib/alarmTone";
import { ClipboardHistory } from "./lib/clipboard";
import { load, remove, save } from "./lib/store";
import { STOPPED, Stopwatch } from "./lib/stopwatch";
import { Player } from "./tabs/Player";
import { Shelf } from "./tabs/Shelf";
import { Tools } from "./tabs/Tools";
import { Notes } from "./tabs/Notes";
import { Convert } from "./tabs/Convert";
import { Currency } from "./tabs/Currency";
import { Settings } from "./tabs/Settings";

export type Tab = "player" | "shelf" | "tools" | "notes" | "convert" | "currency" | "settings";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "player", label: "Player", icon: "♪" },
  { id: "shelf", label: "Shelf", icon: "📥" },
  { id: "tools", label: "Tools", icon: "⚡" },
  { id: "notes", label: "Notes", icon: "✎" },
  { id: "convert", label: "Convert", icon: "↻" },
  { id: "currency", label: "Currency", icon: "$" },
];

export interface Prefs { hoverOpen: boolean; persistClipboard: boolean; }
const DEFAULT_PREFS: Prefs = { hoverOpen: true, persistClipboard: false };


const RING_LIMIT_MS = 180_000;
const ART_RETRIES = 5;

function timeOf(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function App() {
  const [expanded, setExp] = useState(false);
  const [tab, setTab] = useState<Tab>("player");
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...load<Partial<Prefs>>("prefs", {}) }));

  // ── media ──
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [art, setArt] = useState<string | null>(null);
  const artKey = useRef("");
  const artTries = useRef<{ key: string; n: number }>({ key: "", n: 0 });

  // ── clipboard / shelf / convert ──
  const [clips, setClips] = useState<string[]>(() => (prefs.persistClipboard ? load<string[]>("clipboard", []) : []));
  const [shelf, setShelfState] = useState<string[]>(() => load<string[]>("shelf", []));
  const setShelf = useCallback((f: string[]) => { setShelfState(f); save("shelf", f); }, []);
  const addToShelf = useCallback((p: string) => setShelfState((prev) => { const n = [p, ...prev.filter((x) => x !== p)]; save("shelf", n); return n; }), []);
  const [convertPath, setConvertPath] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // ── alarms / stopwatch ──
  const [alarms, setAlarms] = useState<AlarmStore>(() => AlarmStore.fromJSON(load<string | null>("alarms", null)));
  const [ringingSince, setRingingSince] = useState<number | null>(null);
  const [alarmMsg, setAlarmMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stopwatch, setStopwatch] = useState<Stopwatch>(STOPPED);

  // ── expand / collapse ──
  const openedByKeyboard = useRef(false);
  const enteredSinceKeyboard = useRef(false);
  const hovering = useRef(false);
  const leaveTimer = useRef<number | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const ringingRef = useRef(false);
  ringingRef.current = ringingSince !== null;

  const cancelLeave = () => { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } };

  const collapse = useCallback(async () => {
    cancelLeave();
    openedByKeyboard.current = false;
    enteredSinceKeyboard.current = false;
    // Shrink the window first, then swap the content: the other way round shows a frame of
    // a panel-sized black block.
    await setExpanded(false);
    setExp(false);
  }, []);

  const scheduleLeave = useCallback(() => {
    cancelLeave();
    leaveTimer.current = window.setTimeout(() => void collapse(), 350);
  }, [collapse]);

  const expand = useCallback(async (focus: boolean, toTab?: Tab) => {
    cancelLeave();
    if (toTab) setTab(toTab);
    setExp(true);
    await setExpanded(true, focus);
    // The pointer may have crossed the 40px pill and left while the window was still
    // resizing; no new mouseleave fires then, so check here or it stays open.
    if (!focus && !hovering.current && !openedByKeyboard.current) scheduleLeave();
  }, [scheduleLeave]);

  useEffect(() => {
    const un = listen("toggle-island", () => {
      if (expandedRef.current) void collapse();
      else { openedByKeyboard.current = true; enteredSinceKeyboard.current = false; void expand(true); }
    });
    const onBlur = () => { if (expandedRef.current && !hovering.current) void collapse(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && expandedRef.current) void collapse(); };
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    return () => { void un.then((f) => f()); window.removeEventListener("blur", onBlur); window.removeEventListener("keydown", onKey); };
  }, [expand, collapse]);

  const onEnter = () => {
    hovering.current = true;
    cancelLeave();
    enteredSinceKeyboard.current = true;
    // While an alarm rings the collapsed pill IS the stop button; hovering must not swap it away.
    if (!expandedRef.current && prefs.hoverOpen && !ringingRef.current) void expand(false);
  };
  const onLeave = () => {
    hovering.current = false;
    if (!expandedRef.current) return;
    // Opened from the keyboard: the pointer is usually somewhere else entirely, so leaving
    // means nothing until it has been inside once (same rule as the macOS version).
    if (openedByKeyboard.current && !enteredSinceKeyboard.current) return;
    // Don't snatch the panel away mid-typing; clicking outside (blur) still closes it.
    const a = document.activeElement;
    if (document.hasFocus() && a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT")) return;
    scheduleLeave();
  };

  // ── files dragged onto the island ──
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") {
        setDragging(true);
        if (!expandedRef.current) { hovering.current = true; void expand(false, "shelf"); } else setTab("shelf");
      } else if (p.type === "drop") {
        setDragging(false);
        setShelfState((prev) => { const n = [...p.paths.filter((x) => !prev.includes(x)), ...prev]; save("shelf", n); return n; });
      } else {
        setDragging(false);
      }
    });
    return () => { void un.then((f) => f()); };
  }, [expand]);

  // ── media polling (never overlapping: the next poll starts after the previous answers) ──
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const m = await mediaState(artKey.current);
        if (!alive) return;
        if (m) {
          if (m.artworkKey !== artKey.current) {
            // SMTC often publishes the title before the thumbnail: don't lock in "no artwork"
            // for this track until a few polls have come back empty.
            const tries = artTries.current.key === m.artworkKey ? artTries.current.n + 1 : 1;
            artTries.current = { key: m.artworkKey, n: tries };
            if (m.artwork || tries >= ART_RETRIES) { artKey.current = m.artworkKey; setArt(m.artwork); }
          }
        } else { artKey.current = ""; setArt(null); }
        setMedia(m);
      } catch { /* backend not ready */ }
      if (alive) timer = window.setTimeout(tick, 1000);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  // ── clipboard ──
  useEffect(() => {
    const un = listen<string>("clipboard-changed", (e) => {
      setClips((prev) => {
        const h = new ClipboardHistory();
        h.items = prev;
        h.push(e.payload);
        return h.items;
      });
    });
    return () => { void un.then((f) => f()); };
  }, []);
  useEffect(() => {
    if (prefs.persistClipboard) save("clipboard", clips); else remove("clipboard");
  }, [clips, prefs.persistClipboard]);

  useEffect(() => { save("prefs", prefs); }, [prefs]);

  // ── notifications permission ──
  useEffect(() => {
    void (async () => {
      try { if (!(await isPermissionGranted())) await requestPermission(); } catch { /* not available */ }
    })();
  }, []);

  // ── alarm clock tick ──
  const stopRinging = useCallback(() => { stopAlarmTone(); setRingingSince(null); }, []);
  const alarmsRef = useRef(alarms);
  alarmsRef.current = alarms;
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      const next = AlarmStore.fromJSON(alarmsRef.current.toJSON());
      const { ring, missed } = next.settle(t);
      if (!ring.length && !missed.length) return;
      alarmsRef.current = next;
      setAlarms(next);
      if (missed.length) {
        const times = missed.map((m) => timeOf(m.end)).join(", ");
        setAlarmMsg(missed.length === 1 ? `⏰ Alarma perdida — era a las ${times}` : `⏰ Alarmas perdidas — eran a las ${times}`);
      }
      if (ring.length) {
        setAlarmMsg(null);
        setRingingSince(t);
        startAlarmTone();
        const m = ring[ring.length - 1].minutes;
        try { sendNotification({ title: "⏰ Alarma de NotchDrop", body: m === 1 ? "Tu alarma está sonando." : `Tu alarma de ${m} minutos está sonando.` }); } catch { /* ignore */ }
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (ringingSince !== null && now - ringingSince > RING_LIMIT_MS) stopRinging();
  }, [now, ringingSince, stopRinging]);
  useEffect(() => { save("alarms", alarms.toJSON()); }, [alarms]);

  // ── collapsed pill ──
  const ringing = ringingSince !== null;
  const nextAlarm = alarms.next;
  let pill: JSX.Element;
  if (ringing) {
    pill = <button className="pill-content pill-alarm ringing" onClick={stopRinging}>🔔 Detener alarma</button>;
  } else if (nextAlarm) {
    pill = (
      <div className="pill-content pill-alarm">
        <span>⏰</span>
        <span className="mono">{pillText((nextAlarm.end - now) / 1000, alarms.items.length)}</span>
        {media && <span className="pill-title">{media.title}</span>}
      </div>
    );
  } else if (media) {
    pill = (
      <div className="pill-content">
        {art ? <img className="pill-art" src={art} alt="" /> : <span className="pill-art placeholder">♪</span>}
        <span className="pill-title">{media.title}</span>
        <span className={`bars ${media.playing ? "on" : ""}`}><i /><i /><i /><i /></span>
      </div>
    );
  } else {
    pill = <div className="pill-content idle"><span className="dot" /></div>;
  }

  return (
    <div className={`island ${expanded ? "expanded" : "collapsed"}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {!expanded && <div className="pill" onClick={() => { if (!ringing) void expand(true); }}>{pill}</div>}
      {expanded && (
        <div className="panel">
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                <span className="tab-icon">{t.icon}</span>{t.label}
              </button>
            ))}
            <button className={`gear ${tab === "settings" ? "on" : ""}`} onClick={() => setTab("settings")} title="Ajustes" aria-label="Ajustes">⚙</button>
          </nav>
          {ringing && (
            <div className="ring-banner">
              <span>🔔 ¡Alarma!</span>
              <button className="small-btn danger" onClick={stopRinging}>Detener</button>
            </div>
          )}
          <div className="content">
            {tab === "player" && <Player media={media} art={art} />}
            {tab === "shelf" && (
              <Shelf files={shelf} setFiles={setShelf} lastClip={clips[0]} dragging={dragging} onConvert={(p) => { setConvertPath(p); setTab("convert"); }} />
            )}
            {tab === "tools" && (
              <Tools
                clips={clips}
                alarms={alarms}
                setAlarms={setAlarms}
                now={now}
                ringing={ringing}
                stopRinging={stopRinging}
                alarmMsg={alarmMsg}
                setAlarmMsg={setAlarmMsg}
                stopwatch={stopwatch}
                setStopwatch={setStopwatch}
              />
            )}
            {tab === "notes" && <Notes />}
            {tab === "convert" && <Convert path={convertPath} setPath={setConvertPath} addToShelf={addToShelf} />}
            {tab === "currency" && <Currency />}
            {tab === "settings" && <Settings prefs={prefs} setPrefs={setPrefs} clearClips={() => setClips([])} />}
          </div>
        </div>
      )}
    </div>
  );
}
