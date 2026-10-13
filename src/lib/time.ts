/** "1:05". Infinity, NaN and absurd values (live streams, bad metadata) show 0:00 or cap at 99h. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(Math.min(seconds, 359_999));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Stopwatch "mm:ss.d" from elapsed milliseconds. */
export function stopwatchText(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const m = Math.floor(tenths / 600), s = Math.floor((tenths % 600) / 10), d = tenths % 10;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}
