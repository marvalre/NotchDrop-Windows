/** Stopwatch kept outside the Tools tab so collapsing the island or switching tabs doesn't reset it. */
export interface Stopwatch { running: boolean; startedAt: number; accumulated: number; }
export const STOPPED: Stopwatch = { running: false, startedAt: 0, accumulated: 0 };
export const elapsed = (s: Stopwatch, now: number) => s.accumulated + (s.running ? Math.max(0, now - s.startedAt) : 0);
export const start = (s: Stopwatch, now: number): Stopwatch => (s.running ? s : { running: true, startedAt: now, accumulated: s.accumulated });
export const pause = (s: Stopwatch, now: number): Stopwatch => (s.running ? { running: false, startedAt: 0, accumulated: elapsed(s, now) } : s);
