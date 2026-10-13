import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { MediaInfo, mediaState, setExpanded } from "./lib/api";
import { AlarmStore, pillText } from "./lib/alarms";
import { startAlarmTone, stopAlarmTone } from "./lib/alarmTone";
import { ClipboardHistory } from "./lib/clipboard";
import { load, remove, save } from "./lib/store";
import { Player } from "./tabs/Player";
import { Tools } from "./tabs/Tools";
import { Notes } from "./tabs/Notes";
import { Currency } from "./tabs/Currency";
import { Settings } from "./tabs/Settings";

export type Tab = "player" | "tools" | "notes" | "currency" | "settings";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "player", label: "Player", icon: "♪" },
  { id: "tools", label: "Tools", icon: "⚡" },
  { id: "notes", label: "Notes", icon: "✎" },
  { id: "currency", label: "Currency", icon: "$" },
];

export interface Prefs { hoverOpen: boolean; persistClipboard: boolean; }
const DEFAULT_PREFS: Prefs = { hoverOpen: true, persistClipboard: false };

const RING_LIMIT_MS = 180_000;

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

  // ── clipboard ──
  const [clips, setClips] = useState<string[]>(() => (prefs.persistClipboard ? load<string[]>("clipboard", []) : []));

  // ── alarms ──
  const [alarms, setAlarms] = useState<AlarmStore>(() => AlarmStore.fromJSON(load<string | null>("alarms", null)));
  const [ringingSince, setRingingSince] = useState<number | null>(null);
  const [alarmMsg, setAlarmMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // ── expand / collapse ──
  const openedByKeyboard = useRef(false);
  const enteredSinceKeyboard = useRef(false);
  const leaveTimer = useRef<number | null>(null);

  const expand = useCallback(async (focus: boolean) => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    await setExpanded(true, focus);
    setExp(true);
  }, []);

  const collapse = useCallback(async () => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    openedByKeyboard.current = false;
    enteredSinceKeyboard.current = false;
    setExp(false);
    await setExpanded(false);
  }, []);

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    const un = listen("toggle-island", () => {
      if (expandedRef.current) void collapse();
      else { openedByKeyboard.current = true; enteredSinceKeyboard.current = false; void expand(true); }
    });
    const onBlur = () => { if (expandedRef.current) void collapse(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && expandedRef.current) void collapse(); };
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    return () => { void un.then((f) => f()); window.removeEventListener("blur", onBlur); window.removeEventListener("keydown", onKey); };
  }, [expand, collapse]);

  const onEnter = () => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    enteredSinceKeyboard.current = true;
    if (!expanded && prefs.hoverOpen) void expand(false);
  };
  const onLeave = () => {
    if (!expanded) return;
    // Opened from the keyboard: the pointer is usually somewhere else entirely, so leaving
    // means nothing until it has been inside once (same rule as the macOS version).
    if (openedByKeyboard.current && !enteredSinceKeyboard.current) return;
    // Don't snatch the panel away mid-typing; clicking outside (blur) still closes it.
    const a = document.activeElement;
    if (document.hasFocus() && a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT")) return;
    leaveTimer.current = window.setTimeout(() => void collapse(), 350);
  };

  // ── media polling ──
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const m = await mediaState(artKey.current);
        if (!alive) return;
        if (m) {
          if (m.artworkKey !== artKey.current) { artKey.current = m.artworkKey; setArt(m.artwork); }
        } else { artKey.current = ""; setArt(null); }
        setMedia(m);
      } catch { /* backend not ready */ }
    };
    void tick();
    const id = window.setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
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
    pill = <button className="pill-content pill-alarm ringing" onClick={stopRinging}>🔔 Detener</button>;
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
            <button className={`gear ${tab === "settings" ? "on" : ""}`} onClick={() => setTab("settings")} title="Ajustes">⚙</button>
          </nav>
          <div className="content">
            {tab === "player" && <Player media={media} art={art} />}
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
              />
            )}
            {tab === "notes" && <Notes />}
            {tab === "currency" && <Currency />}
            {tab === "settings" && <Settings prefs={prefs} setPrefs={setPrefs} clearClips={() => setClips([])} />}
          </div>
        </div>
      )}
    </div>
  );
}
