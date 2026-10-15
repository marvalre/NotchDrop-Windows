import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { AlarmClock, Banknote, Bell, Inbox, Music, NotebookPen, RefreshCw, Settings as Gear, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Done, MediaInfo, baseName, compressFile, convertFile, downloadMedia, errorText, filesInfo, installTools, mediaState, setExpanded, toolsStatus } from "./lib/api";
import { AlarmStore, pillText } from "./lib/alarms";
import { startAlarmTone, stopAlarmTone } from "./lib/alarmTone";
import { ClipItem, ClipboardHistory } from "./lib/clipboard";
import { load, remove, save } from "./lib/store";
import { STOPPED, Stopwatch } from "./lib/stopwatch";
import { CollapseState, INITIAL as COLLAPSE_INITIAL, leaveCollapses, onEnter as enteredState, onListClosed, onListMouseDown } from "./lib/collapse";
import { Player } from "./tabs/Player";
import { Shelf } from "./tabs/Shelf";
import { Tools } from "./tabs/Tools";
import { Notes } from "./tabs/Notes";
import { Convert } from "./tabs/Convert";
import { Currency } from "./tabs/Currency";
import { Settings, UpdateState } from "./tabs/Settings";
import { Tour, TOUR_STEPS } from "./components/Tour";
import { RELEASES_API, isNewer } from "./lib/version";
import { getVersion } from "@tauri-apps/api/app";

export type Tab = "player" | "shelf" | "tools" | "notes" | "convert" | "currency" | "settings";
// Same tabs and order as the macOS app; line icons, like its SF Symbols.
const TABS: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: "player", label: "Player", Icon: Music },
  { id: "shelf", label: "Shelf", Icon: Inbox },
  { id: "tools", label: "Tools", Icon: Zap },
  { id: "notes", label: "Notes", Icon: NotebookPen },
  { id: "convert", label: "Convert", Icon: RefreshCw },
  { id: "currency", label: "Currency", Icon: Banknote },
];

export type Browser = "" | "firefox" | "edge" | "chrome" | "brave";
export interface Prefs { hoverOpen: boolean; persistClipboard: boolean; panelSize: number; cookies: Browser; autoUpdateCheck: boolean; }
const DEFAULT_PREFS: Prefs = { hoverOpen: true, persistClipboard: false, panelSize: 1, cookies: "", autoUpdateCheck: true };

/** Long-running jobs live here, not in the tabs, so collapsing the island or switching tabs
 * neither loses their result nor lets the same job start twice. */
export interface Jobs {
  missing: string[];
  installing: boolean;
  downloading: boolean;
  status: { text: string; error?: boolean; path?: string } | null;
  install: () => void;
  /** Resolves true on success, so the Shelf only clears the link when it worked. */
  download: (url: string, format: "mp4" | "mp3") => Promise<boolean>;
  refreshTools: () => void;
  convert: ConvertJob;
}

/** The Convert tab's job, kept here so collapsing mid-conversion neither loses the result
 * nor lets a second ffmpeg start on the same file. */
export interface ConvertJob {
  busy: boolean;
  result: Done | null;
  error: string | null;
  start: (path: string, mode: "format" | "compress", target: string, percent: number) => void;
  clear: () => void;
}

/** Wraps something that opens a native dialog or starts a system drag: while it runs, the
 * island must not collapse just because the webview lost focus or the pointer left. */
export type WithModal = <T>(fn: () => Promise<T>) => Promise<T>;

const RING_LIMIT_MS = 180_000;
const ART_RETRIES = 5;

function timeOf(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Live waveform bars driven by the real output level (the Rust side reads the peak meter). */
function Bars({ level }: { level: number }) {
  const shape = [0.55, 0.9, 0.7, 1, 0.6];
  return (
    <span className="bars" aria-hidden>
      {shape.map((k, i) => (
        <i key={i} style={{ height: `${4 + Math.min(1, level * k * (0.85 + 0.3 * ((i * 37 + Math.round(level * 50)) % 7) / 7)) * 14}px` }} />
      ))}
    </span>
  );
}

/** The collapsed island, laid out like the macOS notch pills: artwork on the left while
 * something plays, the live waveform on the right whenever the PC is making sound (with or
 * without a media session), only the countdown while an alarm is set, a bell while it rings. */
function Pill({ media, art, alarmText, ringing, onStop }: {
  media: MediaInfo | null; art: string | null; alarmText: string | null; ringing: boolean; onStop: () => void;
}) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const un = listen<number>("audio-level", (e) => setLevel(e.payload));
    return () => { void un.then((f) => f()); };
  }, []);
  if (ringing) {
    return <button className="pill-content pill-alarm ringing" onClick={onStop} aria-label="Detener alarma" title="Detener alarma"><Bell size={16} /></button>;
  }
  const playing = !!media && media.playing;
  const audible = level > 0.02;
  return (
    <div className="pill-content split">
      <span className="pill-left">
        {playing && (art ? <img className="pill-art" src={art} alt="" /> : <span className="pill-art placeholder"><Music size={13} /></span>)}
      </span>
      <span className="pill-right">
        {alarmText ? <span className="pill-alarm mono row-start"><AlarmClock size={14} />{alarmText}</span> : audible ? <Bars level={level} /> : null}
      </span>
    </div>
  );
}

export default function App() {
  const [expanded, setExp] = useState(false);
  const [tab, setTab] = useState<Tab>("player");
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...load<Partial<Prefs>>("prefs", {}) }));
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // ── media ──
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [art, setArt] = useState<string | null>(null);
  const artKey = useRef("");
  const artTries = useRef<{ key: string; n: number }>({ key: "", n: 0 });

  // ── clipboard / shelf / convert ──
  const [clips, setClips] = useState<ClipItem[]>(() => (prefs.persistClipboard ? ClipboardHistory.restore(load<unknown>("clipboard", [])).items : []));
  const [shelf, setShelfState] = useState<string[]>(() => load<string[]>("shelf", []));
  const setShelf = useCallback((f: string[]) => { setShelfState(f); save("shelf", f); }, []);
  // New files go to the end, like the macOS shelf.
  const addToShelf = useCallback((paths: string[]) => setShelfState((prev) => {
    const n = [...prev.filter((x) => !paths.includes(x)), ...paths];
    save("shelf", n);
    return n;
  }), []);
  // Files moved or deleted since last time are dropped when the app starts (as on the Mac).
  useEffect(() => {
    void filesInfo(load<string[]>("shelf", [])).then((infos) => {
      const keep = infos.filter((i) => i.exists).map((i) => i.path);
      setShelfState((prev) => { const n = prev.filter((p) => keep.includes(p) || !infos.some((i) => i.path === p)); save("shelf", n); return n; });
    }).catch(() => {});
  }, []);
  const [convertPath, setConvertPath] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // ── alarms / stopwatch ──
  const [alarms, setAlarms] = useState<AlarmStore>(() => AlarmStore.fromJSON(load<string | null>("alarms", null)));
  const [ringingSince, setRingingSince] = useState<number | null>(null);
  const [alarmMsg, setAlarmMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stopwatch, setStopwatch] = useState<Stopwatch>(STOPPED);

  // ── expand / collapse ──
  // See lib/collapse.ts for when the pointer leaving closes the panel.
  const cs = useRef<CollapseState>(COLLAPSE_INITIAL);
  const hovering = useRef(false);
  const modalOpen = useRef(0);
  const leaveTimer = useRef<number | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const ringingRef = useRef(false);
  ringingRef.current = ringingSince !== null;

  const cancelLeave = () => { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } };

  const collapse = useCallback(async () => {
    cancelLeave();
    if (modalOpen.current > 0) return;
    cs.current = COLLAPSE_INITIAL;
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
    await setExpanded(true, focus, prefsRef.current.panelSize);
    // The pointer may have crossed the 40px pill and left while the window was still
    // resizing; no new mouseleave fires then, so check here or it stays open.
    if (!focus && !hovering.current && !cs.current.sticky) scheduleLeave();
  }, [scheduleLeave]);

  const withModal: WithModal = useCallback(async (fn) => {
    modalOpen.current += 1;
    cancelLeave();
    try { return await fn(); } finally {
      modalOpen.current -= 1;
      // The dialog or drag is over: if the pointer isn't on the island anymore, close as usual.
      if (modalOpen.current === 0 && expandedRef.current && !hovering.current && leaveCollapses(cs.current)) scheduleLeave();
    }
  }, [scheduleLeave]);

  useEffect(() => {
    const un = listen("toggle-island", () => {
      if (expandedRef.current) void collapse();
      else { cs.current = { ...COLLAPSE_INITIAL, sticky: true }; void expand(true); }
    });
    const onBlur = () => { if (expandedRef.current && !hovering.current && modalOpen.current === 0 && !cs.current.listOpen) void collapse(); };
    const onKey = (e: KeyboardEvent) => {
      // Escape inside an open list only closes the list.
      if (e.key === "Escape" && expandedRef.current && (e.target as HTMLElement)?.tagName !== "SELECT") void collapse();
    };
    const isSelect = (e: Event) => (e.target as HTMLElement | null)?.tagName === "SELECT";
    const listOpened = (e: Event) => { if (isSelect(e)) { cs.current = onListMouseDown(cs.current); cancelLeave(); } };
    const listClosed = (e: Event) => { if (isSelect(e)) cs.current = onListClosed(cs.current); };
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", listOpened, true);
    document.addEventListener("change", listClosed, true);
    document.addEventListener("focusout", listClosed, true);
    return () => {
      void un.then((f) => f());
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", listOpened, true);
      document.removeEventListener("change", listClosed, true);
      document.removeEventListener("focusout", listClosed, true);
    };
  }, [expand, collapse]);

  const onEnter = () => {
    hovering.current = true;
    cancelLeave();
    cs.current = enteredState(cs.current);
    // While an alarm rings the collapsed pill IS the stop button; hovering must not swap it away.
    if (!expandedRef.current && prefs.hoverOpen && !ringingRef.current) void expand(false);
  };
  const onLeave = () => {
    hovering.current = false;
    if (!expandedRef.current || !leaveCollapses({ ...cs.current, modal: modalOpen.current > 0 })) return;
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
        hovering.current = true;
        if (!expandedRef.current) void expand(false, "shelf"); else setTab("shelf");
      } else if (p.type === "drop") {
        setDragging(false);
        addToShelf(p.paths);
      } else {
        // The drag went past without dropping: no mouse events fire during a system drag and
        // the window never had focus, so close it here or it would stay open.
        setDragging(false);
        hovering.current = false;
        if (expandedRef.current && leaveCollapses({ ...cs.current, modal: modalOpen.current > 0 })) scheduleLeave();
      }
    });
    return () => { void un.then((f) => f()); };
  }, [expand, addToShelf, scheduleLeave]);

  // ── jobs: tool install + link download ──
  const [missing, setMissing] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [jobStatus, setJobStatus] = useState<Jobs["status"]>(null);
  const refreshTools = useCallback(() => { void toolsStatus().then((s) => setMissing(s.missing)).catch(() => {}); }, []);
  useEffect(() => {
    refreshTools();
    const a = listen<string>("tools-progress", (e) => setJobStatus({ text: e.payload }));
    const b = listen<number>("download-retry", (e) => setJobStatus({ text: `Reintentando ${e.payload}/6…` }));
    return () => { void a.then((f) => f()); void b.then((f) => f()); };
  }, [refreshTools]);
  const [converting, setConverting] = useState(false);
  const [convResult, setConvResult] = useState<Done | null>(null);
  const [convError, setConvError] = useState<string | null>(null);
  const convert: ConvertJob = {
    busy: converting, result: convResult, error: convError,
    clear: () => { setConvResult(null); setConvError(null); },
    start: (path, mode, target, percent) => {
      if (converting) return;
      setConverting(true); setConvResult(null); setConvError(null);
      void (mode === "format" ? convertFile(path, target) : compressFile(path, percent))
        .then(setConvResult)
        .catch((e) => { setConvError(errorText(e)); if (String(e) === "MISSING_TOOLS") refreshTools(); })
        .finally(() => setConverting(false));
    },
  };
  const jobs: Jobs = {
    missing, installing, downloading, status: jobStatus, refreshTools, convert,
    install: () => {
      if (installing) return;
      setInstalling(true);
      setJobStatus({ text: "Descargando herramientas (~75 MB)…" });
      void installTools()
        .then(() => toolsStatus())
        .then((s) => { setMissing(s.missing); setJobStatus({ text: s.missing.length ? "Faltan: " + s.missing.join(", ") : "✓ Herramientas instaladas. Pulsa Descargar de nuevo." }); })
        .catch((e) => setJobStatus({ text: errorText(e), error: true }))
        .finally(() => setInstalling(false));
    },
    download: async (url, format) => {
      if (downloading) return false;
      setDownloading(true);
      setJobStatus({ text: format === "mp3" ? "Extrayendo audio…" : "Descargando…" });
      try {
        const path = await downloadMedia(url, format, prefsRef.current.cookies || null);
        addToShelf([path]);
        setJobStatus({ text: `✓ Guardado en Descargas · ${baseName(path)}`, path });
        return true;
      } catch (e) {
        if (String(e) === "MISSING_TOOLS") {
          const st = await toolsStatus().catch(() => ({ missing: missing }));
          setMissing(st.missing);
          setJobStatus({ text: st.missing.includes("yt-dlp") ? "Falta yt-dlp, que hace la descarga." : "Faltan las herramientas de conversión (ffmpeg). Pulsa «Instalar herramientas».", error: true });
        } else {
          setJobStatus({ text: errorText(e), error: true });
        }
        return false;
      } finally {
        setDownloading(false);
      }
    },
  };

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
    const push = (item: ClipItem) => setClips((prev) => { const h = new ClipboardHistory(prev); h.push(item); return h.items; });
    const a = listen<string>("clipboard-changed", (e) => push({ kind: "text", text: e.payload }));
    const b = listen<string>("clipboard-image", (e) => push({ kind: "image", url: e.payload, bytes: Math.floor((e.payload.length * 3) / 4) }));
    return () => { void a.then((f) => f()); void b.then((f) => f()); };
  }, []);
  useEffect(() => {
    if (prefs.persistClipboard) save("clipboard", new ClipboardHistory(clips).persistable()); else remove("clipboard");
  }, [clips, prefs.persistClipboard]);

  useEffect(() => { save("prefs", prefs); }, [prefs]);

  // ── notifications permission ──
  const [notificationsDenied, setNotificationsDenied] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        if (!(await isPermissionGranted())) setNotificationsDenied((await requestPermission()) === "denied");
      } catch { /* not available */ }
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
        setAlarmMsg(missed.length === 1 ? `Alarma perdida — era a las ${times}` : `Alarmas perdidas — eran a las ${times}`);
      }
      if (ring.length) {
        setAlarmMsg(null);
        setRingingSince(t);
        startAlarmTone();
        const m = ring[ring.length - 1].minutes;
        try { sendNotification({ title: "Alarma de NotchDrop", body: m === 1 ? "Tu alarma está sonando." : `Tu alarma de ${m} minutos está sonando.` }); } catch { /* ignore */ }
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (ringingSince !== null && now - ringingSince > RING_LIMIT_MS) stopRinging();
  }, [now, ringingSince, stopRinging]);
  useEffect(() => { save("alarms", alarms.toJSON()); }, [alarms]);

  // ── updates: once a day (if enabled) or on demand, tell when a newer release exists ──
  const [update, setUpdate] = useState<{ status: string; available: string | null; checking: boolean }>({ status: "", available: null, checking: false });
  const checkUpdates = useCallback(async (manual: boolean) => {
    setUpdate((u) => ({ ...u, checking: true }));
    try {
      const current = await getVersion();
      const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error(String(res.status));
      const tag = String((await res.json())?.tag_name ?? "");
      save("updateLastCheck", Date.now());
      if (isNewer(tag, current)) {
        const v = tag.replace(/^v/i, "");
        setUpdate({ status: `Hay una versión nueva: ${v}`, available: v, checking: false });
        if (!manual) try { sendNotification({ title: "NotchDrop", body: `Hay una versión nueva (${v}). Ábrela desde Ajustes → Actualizaciones.` }); } catch { /* ignore */ }
      } else {
        setUpdate({ status: `Versión ${current} · estás al día`, available: null, checking: false });
      }
    } catch {
      setUpdate({ status: "No se pudo buscar ahora (sin conexión).", available: null, checking: false });
    }
  }, []);
  useEffect(() => {
    void getVersion().then((v) => setUpdate((u) => (u.status ? u : { ...u, status: `Versión ${v}` }))).catch(() => {});
    const tick = () => {
      if (!prefsRef.current.autoUpdateCheck) return;
      if (Date.now() - load<number>("updateLastCheck", 0) > 24 * 3600 * 1000) void checkUpdates(false);
    };
    const first = window.setTimeout(tick, 15_000);
    const id = window.setInterval(tick, 3600 * 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [checkUpdates]);
  const updateState: UpdateState = { ...update, check: () => void checkUpdates(true) };

  // ── first-run tour (marked as seen the first time it shows, like the Mac) ──
  const [tourStep, setTourStep] = useState<number | null>(null);
  useEffect(() => {
    if (expanded && tourStep === null && !load<boolean>("tourSeen", false)) {
      save("tourSeen", true);
      setTab("player");
      setTourStep(0);
    }
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!expanded) setTourStep(null); }, [expanded]);

  // ── collapsed pill ──
  const ringing = ringingSince !== null;
  const nextAlarm = alarms.next;
  const alarmText = nextAlarm ? pillText((nextAlarm.end - now) / 1000, alarms.items.length) : null;

  return (
    <div className={`island ${expanded ? "expanded" : "collapsed"}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {!expanded && (
        <div className="pill" onClick={() => { if (!ringing) void expand(true); }}>
          <Pill media={media} art={art} alarmText={alarmText} ringing={ringing} onStop={stopRinging} />
        </div>
      )}
      {expanded && (
        <div className="panel">
          <nav className="tabs" data-tour="tabs">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} data-tour={id === "shelf" ? "shelf" : undefined} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                <Icon size={15} strokeWidth={2.2} />{label}
              </button>
            ))}
            <button data-tour="settings" className={`gear ${tab === "settings" ? "on" : ""}`} onClick={() => setTab("settings")} title="Ajustes" aria-label="Ajustes"><Gear size={17} /></button>
          </nav>
          {ringing && (
            <div className="ring-banner">
              <span className="row-start"><Bell size={15} /> ¡Alarma!</span>
              <button className="small-btn danger" onClick={stopRinging}>Detener</button>
            </div>
          )}
          <div className="content">
            {tab === "player" && <Player media={media} art={art} />}
            {tab === "shelf" && (
              <Shelf
                files={shelf}
                setFiles={setShelf}
                addFiles={addToShelf}
                lastClip={clips.find((c) => c.kind === "text") as { text: string } | undefined}
                dragging={dragging}
                jobs={jobs}
                withModal={withModal}
                onConvert={(p) => { setConvertPath(p); setTab("convert"); }}
              />
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
                notificationsDenied={notificationsDenied}
              />
            )}
            {tab === "notes" && <Notes />}
            {tab === "convert" && <Convert path={convertPath} setPath={setConvertPath} jobs={jobs} withModal={withModal} />}
            {tab === "currency" && <Currency />}
            {tab === "settings" && <Settings prefs={prefs} setPrefs={setPrefs} jobs={jobs} update={updateState} replayTour={() => { setTab("player"); setTourStep(0); }} />}
          </div>
          {tourStep !== null && (
            <Tour
              step={tourStep}
              onSkip={() => setTourStep(null)}
              onNext={() => setTourStep(tourStep + 1 < TOUR_STEPS.length ? tourStep + 1 : null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
